/**
 * _escopo.js — de qual pacote a conta pode ler, decidido pelo PERFIL (nunca só pelo pedido).
 * A mesma regra no /api/dados e nas rotas do ao vivo (/api/hoje):
 *   gerente     qualquer setor (S<cod>) ou o resumo entre setores (G);
 *               1.11.6: com estados escolhidos, só as regiões desses estados (o resumo sai filtrado e
 *               setor de outro estado dá 403)
 *   supervisor  só S<o setor dele>
 *   rca         o setor dele, filtrado depois só com as linhas dele
 * Devolve { escopo, rca, estados } ou { status, erro, mensagem } quando não pode.
 */
"use strict";
const { consultar } = require("./_db.js");
const { estadosDaConta, estadoDaRegiao } = require("./_estados.js");

async function escopoDaConta(c, pedido) {
  pedido = String(pedido || "").toUpperCase();
  if (c.tipo === "gerente") {
    const estados = estadosDaConta(c);
    const escopo = /^(G|S[0-9]{1,6})$/.test(pedido) ? pedido : "G";
    if (estados && escopo !== "G") {
      const r = await consultar("SELECT nome FROM core.dim_supervisor WHERE codsupervisor = $1", [Number(escopo.slice(1))]);
      if (!r.rows.length || !estados.includes(estadoDaRegiao(r.rows[0].nome))) {
        return { status: 403, erro: "acesso", mensagem: "Essa região não está liberada para você." };
      }
    }
    return { escopo, rca: null, estados };
  }
  if (c.tipo === "supervisor") {
    const escopo = "S" + Number(c.codsupervisor);
    if (pedido && pedido !== escopo) return { status: 403, erro: "acesso", mensagem: "Você só vê o seu setor." };
    return { escopo, rca: null, estados: null };
  }
  const cod = Number(c.codusur);
  const r = await consultar("SELECT codsupervisor, nome FROM core.dim_rca WHERE codusur = $1", [cod]);
  if (!r.rows.length || r.rows[0].codsupervisor == null) {
    return { status: 404, erro: "rca", mensagem: "O RCA " + cod + " não está no cadastro do WinThor carregado. Fale com o Suporte comercial." };
  }
  return { escopo: "S" + r.rows[0].codsupervisor, rca: { cod, nome: r.rows[0].nome }, estados: null };
}

/* sufixo da versão: o mesmo pacote filtrado para o RCA ou para os estados do gestor tem versão própria */
function sufixoDaVersao(alvo) {
  if (alvo.rca) return "-R" + alvo.rca.cod;
  if (alvo.estados) return "-E" + alvo.estados.join(".");
  return "";
}

module.exports = { escopoDaConta, sufixoDaVersao };
