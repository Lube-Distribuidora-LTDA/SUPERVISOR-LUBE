/**
 * GET /api/itens?escopo=S7|GERAL&de=20758&ate=20773[&rca=123][&forns=1,2][&prod=1]   (Authorization: Bearer <token>)
 * — 1.14 (2026-11-16)
 *
 * Vendas › Fornecedor e Carteira › Mix/SKU (Júlio: "uma aba de fornecedor, onde eu escolho os fornecedores que eu quero
 * visualizar as vendas" e "MIX/SKU ... o número de SKU vendido naquele período da carteira, podendo filtrar também por
 * fornecedor ... (o número mix precisa sair do mesmo lugar que a Análise Comercial)").
 * supervisor.itens_periodo (db/18): a base e a regra da Análise Comercial, no período da tela (de/até em dias desde
 * 1970, como o app guarda as datas). Lido na hora, só quando a página abre.
 *   escopo  S<cód> (gestor: a região, se liberada para ele; supervisor: só a dele) ou GERAL (gestor: as regiões dele)
 *   rca     filtra um RCA (o RCA logado vê sempre só ele)
 *   forns   os fornecedores escolhidos para o total (vazio = todos)
 *   prod    um fornecedor para abrir os produtos
 */
"use strict";
const { consultar, json, semConfiguracao, erroBanco } = require("./_db.js");
const { sessao } = require("./_sessao.js");
const { cors } = require("./_cors.js");
const { escopoDaConta } = require("./_escopo.js");
const { estadosDaConta, regiaoLiberada } = require("./_estados.js");

const dia = (v) => { const n = Number(v); return Number.isInteger(n) && n > 18000 && n < 30000 ? n : null; };
const DIA_MS = 864e5;
const iso = (n) => new Date(n * DIA_MS).toISOString().slice(0, 10);

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "GET") return json(res, 405, { erro: "metodo" });
  if (semConfiguracao(res)) return;

  let s;
  try { s = await sessao(req); }
  catch (e) { return json(res, 502, { erro: "login_indisponivel", mensagem: "Não consegui conferir o seu login agora. Tente de novo em instantes." }); }
  if (!s.ok) return json(res, s.status, { erro: "acesso", mensagem: s.mensagem });

  const q = req.query || {};
  const de = dia(q.de), ate = dia(q.ate);
  if (de == null || ate == null || ate < de || ate - de > 400) return json(res, 400, { erro: "dados", mensagem: "Período inválido." });
  const forns = String(q.forns || "").split(",").filter((x) => /^\d{1,9}$/.test(x)).map(Number).slice(0, 200);
  const prod = /^\d{1,9}$/.test(String(q.prod || "")) ? Number(q.prod) : null;
  let rca = /^\d{1,6}$/.test(String(q.rca || "")) && Number(q.rca) > 0 ? Number(q.rca) : null;

  try {
    let sups;
    if (String(q.escopo || "").toUpperCase() === "GERAL") {
      if (s.conta.tipo !== "gerente") return json(res, 403, { erro: "acesso", mensagem: "O GERAL é só do gestor." });
      const estados = estadosDaConta(s.conta);
      const r = await consultar(
        `SELECT s.codsupervisor AS cod, s.nome FROM core.dim_supervisor s
          WHERE s.codsupervisor IN (SELECT supervisor.setores_ativos())`);
      sups = r.rows.filter((x) => regiaoLiberada(estados, x.cod, x.nome)).map((x) => Number(x.cod));
    } else {
      const alvo = await escopoDaConta(s.conta, q.escopo);
      if (alvo.status) return json(res, alvo.status, { erro: alvo.erro, mensagem: alvo.mensagem });
      if (alvo.escopo === "G") return json(res, 400, { erro: "dados", mensagem: "Escolha a região." });
      sups = [Number(alvo.escopo.slice(1))];
      if (alvo.rca) {
        // o RCA vê só ele; a venda dele conta em qualquer região (a Análise Comercial pode pôr o RCA em outra, como a Solange)
        rca = alvo.rca.cod;
        sups = (await consultar("SELECT array_agg(c) AS a FROM supervisor.setores_ativos() c")).rows[0].a || sups;
      }
    }
    if (!sups.length) return json(res, 200, { forn: [], tot: { venda: 0, dev: 0, custo: 0, posit: 0, mix: 0 }, prod: [] });
    const r = await consultar("SELECT supervisor.itens_periodo($1::int[], $2::int, $3::date, $4::date, $5::int[], $6::int)::text AS j",
      [sups, rca, iso(de), iso(ate), forns.length ? forns : null, prod]);
    return json(res, 200, JSON.parse(r.rows[0].j));
  } catch (e) {
    return erroBanco(res, e);
  }
};
