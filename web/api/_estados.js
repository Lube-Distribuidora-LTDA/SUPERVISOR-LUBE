/**
 * _estados.js — 1.11.6 (2026-11-11): o gestor vê TODAS as regiões ou SÓ OS ESTADOS que o administrador escolheu
 * (Júlio: "a visão do gestor seja geral ou em estados específicos, por exemplo: BA, ES só e o outro só RJ").
 *
 * O estado de uma região é o do NOME dela no WinThor (core.dim_supervisor): "ES - NORTE" = ES, "BA - SUL" = BA,
 * "RJ - FARMA" = RJ. Região sem estado no nome (LUBE DISTRIBUIDORA, ADMINISTRAÇÃO, VENDA INTERNA, INATIVO) = OUTRAS.
 * Região nova com "ES - " no nome entra sozinha para quem vê o ES.
 *
 * A escolha mora no Painel (sup_usuarios.estados, lida por sup_meu_acesso): nulo = todas as regiões.
 * Gestor pelo Painel (administrador ou "Todos os sistemas") vê sempre todas.
 */
"use strict";

const ESTADOS = ["ES", "BA", "RJ", "OUTRAS"];

function estadoDaRegiao(nome) {
  const m = /^\s*(ES|BA|RJ)\s*-/i.exec(String(nome || ""));
  return m ? m[1].toUpperCase() : "OUTRAS";
}

/* lista limpa (na ordem ES, BA, RJ, OUTRAS) ou null = todas; vazio ou só valor estranho = null */
function limpar(lista) {
  if (!Array.isArray(lista)) return null;
  const set = new Set(lista.map((x) => String(x || "").trim().toUpperCase()));
  const e = ESTADOS.filter((x) => set.has(x));
  return e.length ? e : null;
}

/* o que a conta vê: null = todas as regiões; só o gestor tem recorte por estado */
function estadosDaConta(c) {
  if (!c || c.tipo !== "gerente") return null;
  return limpar(c.estados);
}

/* o resumo entre setores (supervisor.pacote_resumo: setores = [cod, nome, ...]) só com as regiões dos estados */
function filtrarResumo(p, estados) {
  if (!p || !estados) return p;
  const out = Object.assign({}, p);
  out.setores = (p.setores || []).filter((s) => estados.includes(estadoDaRegiao(s[1])));
  out.estados = estados;
  return out;
}

module.exports = { ESTADOS, estadoDaRegiao, limpar, estadosDaConta, filtrarResumo };
