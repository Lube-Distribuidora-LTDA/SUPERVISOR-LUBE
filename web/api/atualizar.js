/**
 * POST /api/atualizar   (Authorization: Bearer <token do login>)
 *
 * O botão "Atualizar dados" (e o puxar para baixo) pede ao AGENTE LUBE uma leitura do WinThor AGORA (1.7,
 * 2026-10-29), no desenho do painel do Inventário: agente.pedir_atualizacao() grava o pedido e avisa por
 * NOTIFY; o agente, na SRV-IA, lê na hora, monta o pacote do dia e responde no pedido. Nenhuma porta aberta
 * na rede da Lube, e o app nunca chega no Oracle.
 *
 * Dois pedidos: o do supervisor (pedidos e títulos) e o do comercial (o faturado e a devolução do app vêm de
 * lá). O app acompanha os dois por /api/hoje?pedidos=<ids>. Com o agente fora do ar (batimento com mais de
 * 3 minutos), nada é pedido e a resposta diz isso: o app confere a carga como antes.
 */
"use strict";
const { consultar, json, semConfiguracao, erroBanco } = require("./_db.js");
const { sessao } = require("./_sessao.js");
const { cors } = require("./_cors.js");

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return json(res, 405, { erro: "metodo", mensagem: "Use POST." }, { Allow: "POST" });
  if (semConfiguracao(res)) return;

  let s;
  try { s = await sessao(req); }
  catch (e) { return json(res, 502, { erro: "login_indisponivel", mensagem: "Não consegui conferir o seu login agora. Tente de novo em instantes." }); }
  if (!s.ok) return json(res, s.status, { erro: "acesso", mensagem: s.mensagem });

  try {
    let r;
    try {
      r = await consultar(
        `WITH a AS (SELECT max(visto_em) AS visto, bool_or(ligado) AS ligado FROM agente.batimento
                     WHERE visto_em > now() - interval '3 minutes')
         SELECT a.visto, coalesce(a.ligado, false) AS ligado,
                CASE WHEN a.visto IS NOT NULL AND a.ligado THEN agente.pedir_atualizacao('supervisor', 'app supervisor-lube') END AS p1,
                CASE WHEN a.visto IS NOT NULL AND a.ligado THEN agente.pedir_atualizacao('comercial', 'app supervisor-lube') END AS p2
           FROM a`, []);
    } catch (e) {
      if (e && (e.code === "42P01" || e.code === "3F000" || e.code === "42883")) {
        return json(res, 200, { agente: false, mensagem: "O agente do WinThor ainda não foi instalado." });
      }
      throw e;
    }
    const l = r.rows[0] || {};
    if (!l.p1) {
      return json(res, 200, { agente: false, visto_em: l.visto || null,
        mensagem: l.visto ? "O agente do WinThor está em pausa." : "O agente do WinThor não está ligado agora." });
    }
    return json(res, 200, { agente: true, pedidos: [Number(l.p1), Number(l.p2)].filter(Boolean) });
  } catch (e) {
    return erroBanco(res, e);
  }
};
