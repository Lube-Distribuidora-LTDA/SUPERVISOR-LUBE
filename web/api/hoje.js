/**
 * GET /api/hoje?escopo=S4|G[&pedidos=12,13]   (Authorization: Bearer <token do login>)
 *
 * O AO VIVO do app (1.7, 2026-10-29): o pacote do dia que o AGENTE LUBE monta depois de cada gravação
 * (supervisor.hoje, por supervisor.atualizar_hoje()): pedidos, notas e devoluções de ontem e hoje e os títulos
 * em aberto do setor; para o gestor, também o resumo entre setores. O app pergunta de 15 em 15 s com o
 * "X-Versao" que tem; sem mudança a resposta é pequena: { igual: true, vivo, pedidos }.
 *
 *   vivo     o agente está ligado (batimento com menos de 3 min) e a hora da última leitura do WinThor de
 *            cada dado (pedido, faturado, títulos, devolução): o indicador "Ao vivo" do app
 *   pedidos  com ?pedidos=: como estão os pedidos do botão Atualizar (/api/atualizar)
 *   janela   com ?janela=1 (app 1.9, 2026-11-04): os dias antigos que o agente ainda relê (pedidos e devoluções de hoje-60
 *            a hoje-2, notas de hoje-35 a hoje-2; supervisor.pacote_janela), com versão própria ("X-Versao-J"): vem só
 *            quando um deles muda. Sem ela, o app 1.8 segue igual. Júlio: "sempre precisam ser os mesmos números" que a
 *            146 e o Central Comercial, que mudam na hora quando o WinThor corrige um dia antigo.
 *
 * O escopo sai do perfil (_escopo.js), como no /api/dados; o RCA leva só as linhas dele e o gestor com estados
 * escolhidos (1.11.6) leva o resumo só com as regiões desses estados.
 */
"use strict";
const zlib = require("zlib");
const { consultar, json, semConfiguracao, erroBanco } = require("./_db.js");
const { sessao } = require("./_sessao.js");
const { cors } = require("./_cors.js");
const { escopoDaConta, sufixoDaVersao } = require("./_escopo.js");
const { filtrarResumo } = require("./_estados.js");

/* o RCA só leva as linhas dele (índices na ordem de supervisor.pacote_hoje, iguais aos do pacote_setor) */
function filtrarRca(p, codusur) {
  const meu = (i) => (r) => r[i] === codusur;
  const out = Object.assign({}, p);
  out.nf = (p.nf || []).filter(meu(3));
  out.ped = (p.ped || []).filter(meu(4));
  out.dev = (p.dev || []).filter(meu(2));
  if (p.tit) out.tit = p.tit.filter(meu(1));
  if (!p.cli) return out;       // a janela não leva títulos nem clientes
  const clis = new Set();
  for (const r of out.nf) clis.add(r[2]);
  for (const r of out.ped) clis.add(r[3]);
  for (const r of out.tit || []) clis.add(r[0]);
  for (const r of out.dev) clis.add(r[1]);
  out.cli = p.cli.filter((c) => c[10] === codusur || clis.has(c[0]));
  return out;
}

const SQL = `
WITH b AS (SELECT max(visto_em) AS visto, bool_or(ligado) AS ligado FROM agente.batimento
            WHERE visto_em > now() - interval '3 minutes'),
     -- 1.8: o digitado vem do pedido da 146 (relatorio146.pedido), não mais do supervisor.pedido
     e AS (SELECT max(lido_em) FILTER (WHERE fluxo = 'relatorio146.pedido')   AS pedido,
                  max(lido_em) FILTER (WHERE fluxo = 'comercial.comissao_nf') AS faturado,
                  max(lido_em) FILTER (WHERE fluxo = 'supervisor.titulo')     AS titulo,
                  max(lido_em) FILTER (WHERE fluxo = 'comercial.devolucao')   AS devolucao
             FROM agente.estado WHERE status IN ('OK', 'AVISO')),
     s AS (SELECT versao, payload FROM supervisor.hoje WHERE escopo = $1),
     g AS (SELECT versao, payload FROM supervisor.hoje WHERE escopo = 'G' AND $2::boolean),
     j AS (SELECT versao, payload FROM supervisor.hoje WHERE escopo = $6 AND $6 <> ''),
     p AS (SELECT coalesce(json_agg(json_build_object('id', id, 'sistema', sistema, 'status', status, 'mensagem', mensagem,
                                                      'segundos', segundos) ORDER BY id), '[]'::json) AS lista
             FROM agente.pedido WHERE id = ANY($4::bigint[])),
     -- a versão leva o escopo: todos os escopos de uma rodada saem com o mesmo carimbo, e o gestor que troca de setor
     -- não pode receber "igual"
     v AS (SELECT $1 || ':' || coalesce((SELECT versao FROM s), '-') || '|' || coalesce((SELECT versao FROM g), '-') || $3 AS versao,
                  CASE WHEN $6 = '' THEN NULL ELSE $6 || ':' || coalesce((SELECT versao FROM j), '-') || $3 END AS versao_j)
SELECT v.versao, v.versao_j,
       CASE WHEN v.versao = $5 THEN NULL ELSE (SELECT payload FROM s) END AS s_payload,
       CASE WHEN v.versao = $5 THEN NULL ELSE (SELECT payload FROM g) END AS g_payload,
       CASE WHEN v.versao_j IS NULL OR v.versao_j = $7 THEN NULL ELSE (SELECT payload FROM j) END AS j_payload,
       b.visto, coalesce(b.ligado, false) AS ligado, e.pedido, e.faturado, e.titulo, e.devolucao, p.lista
  FROM v, b, e, p`;

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "GET") return json(res, 405, { erro: "metodo" });
  if (semConfiguracao(res)) return;

  let s;
  try { s = await sessao(req); }
  catch (e) { return json(res, 502, { erro: "login_indisponivel", mensagem: "Não consegui conferir o seu login agora. Tente de novo em instantes." }); }
  if (!s.ok) return json(res, s.status, { erro: "acesso", mensagem: s.mensagem });

  try {
    const q = req.query || {};
    const alvo = await escopoDaConta(s.conta, q.escopo);
    if (alvo.status) return json(res, alvo.status, { erro: alvo.erro, mensagem: alvo.mensagem });
    const gerente = s.conta.tipo === "gerente";
    const escopo = alvo.escopo === "G" ? "-" : alvo.escopo;      // o gestor sem setor aberto leva só o resumo
    const pedidos = String(q.pedidos || "").split(",").filter((x) => /^\d{1,15}$/.test(x)).slice(0, 4);
    const sufixo = sufixoDaVersao(alvo);
    const versaoPedida = String(req.headers["x-versao"] || "");
    // a janela é por setor ('J' || cod): o gestor sem setor aberto não leva
    const janela = String(q.janela || "") === "1" && /^S\d+$/.test(escopo) ? "J" + escopo.slice(1) : "";
    const versaoJPedida = String(req.headers["x-versao-j"] || "");

    let r;
    try {
      r = await consultar(SQL, [escopo, gerente, sufixo, "{" + pedidos.join(",") + "}", versaoPedida, janela, versaoJPedida]);
    } catch (e) {
      // banco sem o ao vivo (antes da migração supervisor_v6_ao_vivo) ou sem o agente: o app segue com a carga
      if (e && (e.code === "42P01" || e.code === "3F000")) return json(res, 200, { semHoje: true });
      throw e;
    }
    const l = r.rows[0];
    const vivo = {
      agente: !!(l.visto && l.ligado), visto_em: l.visto || null,
      pedido: l.pedido || null, faturado: l.faturado || null, titulo: l.titulo || null, devolucao: l.devolucao || null,
    };
    const cab = { "X-Versao-Pacote": l.versao };
    if (!l.s_payload && !l.g_payload && !l.j_payload) {
      return json(res, 200, { igual: l.versao === versaoPedida, versao: l.versao, versao_j: l.versao_j, vivo, pedidos: l.lista }, cab);
    }
    const doRca = (txt) => (txt && alvo.rca ? JSON.stringify(filtrarRca(JSON.parse(txt), alvo.rca.cod)) : txt) || "null";
    // "igual" fala do pacote do dia e do resumo; a janela pode chegar sozinha (um dia antigo mudou)
    const igual = !l.s_payload && !l.g_payload && l.versao === versaoPedida;
    const corpo = '{"versao":' + JSON.stringify(l.versao) + ',"igual":' + igual + ',"setor":' + doRca(l.s_payload) +
                  ',"resumo":' + (l.g_payload && alvo.estados ? JSON.stringify(filtrarResumo(JSON.parse(l.g_payload), alvo.estados)) : l.g_payload || "null") + ',"versao_j":' + JSON.stringify(l.versao_j) +
                  ',"janela":' + doRca(l.j_payload) + ',"vivo":' + JSON.stringify(vivo) + ',"pedidos":' + JSON.stringify(l.lista) + "}";
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Encoding", "gzip");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Versao-Pacote", l.versao);
    return res.end(zlib.gzipSync(Buffer.from(corpo, "utf8"), { level: 6 }));
  } catch (e) {
    return erroBanco(res, e);
  }
};

module.exports.filtrarRca = filtrarRca;
