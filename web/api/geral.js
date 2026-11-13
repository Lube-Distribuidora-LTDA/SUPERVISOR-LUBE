/**
 * GET /api/geral?tipo=nao   (Authorization: Bearer <token do login>) — 1.13 (2026-11-13)
 *
 * Carteira › "Não compram" do GERAL do gestor (Júlio: "preciso que na aba de Carteiras tenha a aba 'não compram'
 * (quando eu selecionar GERAL)"). O resto do GERAL vem do resumo entre setores (ao vivo, /api/hoje); a lista de clientes
 * não cabe nele, então sai daqui, só quando a página abre: supervisor.geral_nao_compram (db/17) com as regiões que o
 * gestor vê (todas, ou só as dos estados escolhidos para ele, como no /api/dados e no /api/hoje).
 * Só o gestor (perfil 'gerente'); supervisor e RCA não têm GERAL.
 */
"use strict";
const { consultar, json, semConfiguracao, erroBanco } = require("./_db.js");
const { sessao } = require("./_sessao.js");
const { cors } = require("./_cors.js");
const { estadosDaConta, regiaoLiberada } = require("./_estados.js");

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "GET") return json(res, 405, { erro: "metodo" });
  if (semConfiguracao(res)) return;

  let s;
  try { s = await sessao(req); }
  catch (e) { return json(res, 502, { erro: "login_indisponivel", mensagem: "Não consegui conferir o seu login agora. Tente de novo em instantes." }); }
  if (!s.ok) return json(res, s.status, { erro: "acesso", mensagem: s.mensagem });
  if (!s.conta || s.conta.tipo !== "gerente") return json(res, 403, { erro: "acesso", mensagem: "O GERAL é só do gestor." });

  const tipo = String((req.query || {}).tipo || "nao");
  if (tipo !== "nao") return json(res, 400, { erro: "dados", mensagem: "Pedido inválido." });
  try {
    const estados = estadosDaConta(s.conta);
    const sup = await consultar(
      `SELECT s.codsupervisor AS cod, s.nome FROM core.dim_supervisor s
        WHERE s.codsupervisor IN (SELECT supervisor.setores_ativos())`);
    const regioes = sup.rows.filter((r) => regiaoLiberada(estados, r.cod, r.nome)).map((r) => Number(r.cod));
    if (!regioes.length) return json(res, 200, { cart: 0, nao: 0, pot: 0, regioes: [], clientes: [] });
    const r = await consultar("SELECT supervisor.geral_nao_compram($1::int[])::text AS j", [regioes]);
    return json(res, 200, JSON.parse(r.rows[0].j), { "Cache-Control": "no-store" });
  } catch (e) {
    return erroBanco(res, e);
  }
};
