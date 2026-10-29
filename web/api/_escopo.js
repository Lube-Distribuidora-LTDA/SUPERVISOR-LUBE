/**
 * _escopo.js — de qual pacote a conta pode ler, decidido pelo PERFIL (nunca só pelo pedido).
 * A mesma regra do /api/dados, para as rotas do ao vivo (/api/hoje):
 *   gerente     qualquer setor (S<cod>) ou o resumo entre setores (G)
 *   supervisor  só S<o setor dele>
 *   rca         o setor dele, filtrado depois só com as linhas dele
 * Devolve { escopo, rca } ou { status, erro, mensagem } quando não pode.
 */
"use strict";
const { consultar } = require("./_db.js");

async function escopoDaConta(c, pedido) {
  pedido = String(pedido || "").toUpperCase();
  if (c.tipo === "gerente") return { escopo: /^(G|S[0-9]{1,6})$/.test(pedido) ? pedido : "G", rca: null };
  if (c.tipo === "supervisor") {
    const escopo = "S" + Number(c.codsupervisor);
    if (pedido && pedido !== escopo) return { status: 403, erro: "acesso", mensagem: "Você só vê o seu setor." };
    return { escopo, rca: null };
  }
  const cod = Number(c.codusur);
  const r = await consultar("SELECT codsupervisor, nome FROM core.dim_rca WHERE codusur = $1", [cod]);
  if (!r.rows.length || r.rows[0].codsupervisor == null) {
    return { status: 404, erro: "rca", mensagem: "O RCA " + cod + " não está no cadastro do WinThor carregado. Fale com o TI." };
  }
  return { escopo: "S" + r.rows[0].codsupervisor, rca: { cod, nome: r.rows[0].nome } };
}

module.exports = { escopoDaConta };
