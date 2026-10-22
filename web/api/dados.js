/**
 * GET /api/dados?escopo=S4|G   (Authorization: Bearer <token do login>)
 *
 * Entrega o pacote pronto que a carga guardou em supervisor.pacote (seção 8b do
 * data-warehouse: quem abre nunca espera o banco calcular). O escopo sai do
 * perfil, nunca só do pedido:
 *   gerente     qualquer setor (S<cod>) ou o resumo entre setores (G)
 *   supervisor  só S<o setor dele>
 *   rca         o pacote do setor dele, FILTRADO aqui só com as linhas dele
 *
 * Responde gzip direto do banco (o pacote já vem comprimido) com ETag = versão:
 * o app guarda a última cópia no aparelho e pergunta se mudou; sem mudança, não
 * manda o pacote de novo.
 *
 * "Sem conexão" falso (Júlio, 2026-10-22): na resposta 304 a Vercel tira o cabeçalho
 * Access-Control-Allow-Origin. No app do celular (outra origem) o 304 então vira erro de
 * rede, e o app dizia "sem conexão" justamente quando o dado já estava em dia. Por isso:
 *   - app 1.3 em diante manda "X-Versao" e, sem mudança, recebe 200 { igual: true };
 *   - APK 1.1/1.2 (mandam If-None-Match) vindos do app recebem o pacote inteiro (200);
 *   - o site (mesma origem, não precisa de CORS) continua com o 304.
 */
"use strict";
const zlib = require("zlib");
const { consultar, json, semConfiguracao, erroBanco } = require("./_db.js");
const { sessao } = require("./_sessao.js");
const { cors, ORIGENS_DO_APP } = require("./_cors.js");

/* o RCA só leva as linhas dele (os índices seguem a ordem montada em supervisor.pacote_setor) */
function filtrarRca(p, codusur, nome) {
  const meu = (i) => (r) => r[i] === codusur;
  const out = Object.assign({}, p);
  out.nf = p.nf.filter(meu(3));
  out.ped = p.ped.filter(meu(4));
  out.tit = p.tit.filter(meu(1));
  out.item = p.item.filter(meu(3));
  out.dev = p.dev.filter(meu(2));
  const clis = new Set();
  for (const r of out.nf) clis.add(r[2]);
  for (const r of out.ped) clis.add(r[3]);
  for (const r of out.tit) clis.add(r[0]);
  for (const r of out.item) clis.add(r[1]);
  for (const r of out.dev) clis.add(r[1]);
  out.cli = p.cli.filter((c) => c[10] === codusur || clis.has(c[0]));
  out.rcas = p.rcas.filter(meu(0));
  if (!out.rcas.length) out.rcas = [[codusur, nome || "RCA " + codusur, true]];
  const prods = new Set(out.item.map((r) => r[2]));
  out.prod = {}; const forns = new Set();
  for (const k of Object.keys(p.prod || {})) if (prods.has(Number(k))) { out.prod[k] = p.prod[k]; forns.add(String(p.prod[k][1])); }
  out.forn = {};
  for (const k of Object.keys(p.forn || {})) if (forns.has(k)) out.forn[k] = p.forn[k];
  out.escopo = { tipo: "rca", codusur };
  return out;
}

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "GET") return json(res, 405, { erro: "metodo" });
  if (semConfiguracao(res)) return;

  let s;
  try { s = await sessao(req); }
  catch (e) { return json(res, 502, { erro: "login_indisponivel", mensagem: "Não consegui conferir o seu login agora. Tente de novo em instantes." }); }
  if (!s.ok) return json(res, s.status, { erro: "acesso", mensagem: s.mensagem });

  const c = s.conta;
  const pedido = String((req.query && req.query.escopo) || "").toUpperCase();
  let escopo, rca = null;
  try {
    if (c.tipo === "gerente") {
      escopo = /^(G|S[0-9]{1,6})$/.test(pedido) ? pedido : "G";
    } else if (c.tipo === "supervisor") {
      escopo = "S" + Number(c.codsupervisor);
      if (pedido && pedido !== escopo) return json(res, 403, { erro: "acesso", mensagem: "Você só vê o seu setor." });
    } else {
      rca = Number(c.codusur);
      const r = await consultar("SELECT codsupervisor, nome FROM core.dim_rca WHERE codusur = $1", [rca]);
      if (!r.rows.length || r.rows[0].codsupervisor == null) {
        return json(res, 404, { erro: "rca", mensagem: "O RCA " + rca + " não está no cadastro do WinThor carregado. Fale com o TI." });
      }
      escopo = "S" + r.rows[0].codsupervisor;
      rca = { cod: rca, nome: r.rows[0].nome };
    }

    const limpa = (v) => String(v || "").replace(/^W\//, "").replace(/"/g, "");
    const versaoPedida = limpa(req.headers["x-versao"]);
    const doApp = ORIGENS_DO_APP.has(String(req.headers.origin || ""));
    const etagPedido = versaoPedida || (doApp ? "" : limpa(req.headers["if-none-match"]));
    const sufixo = rca ? "-R" + rca.cod : "";
    const q = await consultar(
      `SELECT versao, gerado_em, CASE WHEN versao || $2 = $3 THEN NULL ELSE payload_gz END AS payload_gz
         FROM supervisor.pacote WHERE escopo = $1`, [escopo, sufixo, etagPedido]);
    if (!q.rows.length) {
      return json(res, 404, { erro: "sem_pacote", mensagem: "Ainda não há dados prontos para " + (escopo === "G" ? "o resumo" : "este setor") + ". A próxima carga monta." });
    }
    const linha = q.rows[0];
    const etag = linha.versao + sufixo;
    // a versão vai sempre num cabeçalho próprio (o app 1.3 lê dele). O ETag padrão fica de fora só para o APK
    // 1.1/1.2 que pergunta com If-None-Match: com o ETag igual ao perguntado, a Vercel ainda poderia trocar o 200
    // por um 304 sem CORS
    res.setHeader("X-Versao-Pacote", etag);
    if (!(doApp && !versaoPedida && req.headers["if-none-match"])) res.setHeader("ETag", '"' + etag + '"');
    res.setHeader("Cache-Control", "private, no-cache");
    res.setHeader("X-Escopo", escopo);
    if (!linha.payload_gz) {
      if (versaoPedida) return json(res, 200, { igual: true, versao: etag }, { "X-Versao-Pacote": etag, "X-Escopo": escopo });
      res.statusCode = 304; return res.end();
    }

    let corpo = linha.payload_gz;
    if (rca) {
      const p = JSON.parse(zlib.gunzipSync(corpo).toString("utf8"));
      corpo = zlib.gzipSync(Buffer.from(JSON.stringify(filtrarRca(p, rca.cod, rca.nome)), "utf8"), { level: 6 });
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Encoding", "gzip");
    return res.end(corpo);
  } catch (e) {
    return erroBanco(res, e);
  }
};

module.exports.filtrarRca = filtrarRca;
