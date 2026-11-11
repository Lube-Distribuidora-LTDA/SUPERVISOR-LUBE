/**
 * _estados.js — 1.11.6 (2026-11-11): o gestor vê TODAS as regiões ou SÓ OS ESTADOS que o administrador escolheu
 * (Júlio: "a visão do gestor seja geral ou em estados específicos, por exemplo: BA, ES só e o outro só RJ").
 *
 * O estado de uma região é o do NOME dela no WinThor (core.dim_supervisor): "ES - NORTE" = ES, "BA - SUL" = BA,
 * "RJ - FARMA" = RJ. Região nova com "ES - " no nome entra sozinha para quem vê o ES.
 * 1.11.7: as regiões SEM estado no nome (ADMINISTRAÇÃO, INATIVO, LUBE DISTRIBUIDORA, VENDA INTERNA) se escolhem uma por uma
 * (Júlio: "a que é outras precisa aparecer pra selecionar elas"): vão na lista como "S<código>" (S3 = LUBE DISTRIBUIDORA).
 * "OUTRAS" (todas as sem estado, da 1.11.6) continua valendo.
 *
 * A escolha mora no Painel (sup_usuarios.estados, lida por sup_meu_acesso): nulo = todas as regiões.
 * Gestor pelo Painel (administrador ou "Todos os sistemas") vê sempre todas.
 */
"use strict";

const UFS = ["ES", "BA", "RJ"];
const RE_ITEM = /^(ES|BA|RJ|OUTRAS|S\d{1,6})$/;

function estadoDaRegiao(nome) {
  const m = /^\s*(ES|BA|RJ)\s*-/i.exec(String(nome || ""));
  return m ? m[1].toUpperCase() : "OUTRAS";
}

/* lista limpa (ES, BA, RJ, OUTRAS e depois as regiões "S<cód>" em ordem) ou null = todas; vazio ou só valor estranho = null */
function limpar(lista) {
  if (!Array.isArray(lista)) return null;
  const set = new Set(lista.map((x) => String(x || "").trim().toUpperCase()).filter((x) => RE_ITEM.test(x)));
  const e = UFS.concat("OUTRAS").filter((x) => set.has(x))
    .concat([...set].filter((x) => x[0] === "S").sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))));
  return e.length ? e : null;
}

/* o que a conta vê: null = todas as regiões; só o gestor tem recorte */
function estadosDaConta(c) {
  if (!c || c.tipo !== "gerente") return null;
  return limpar(c.estados);
}

/* a região (código e nome do WinThor) está liberada para essa lista? */
function regiaoLiberada(estados, cod, nome) {
  if (!estados) return true;
  return estados.includes(estadoDaRegiao(nome)) || estados.includes("S" + Number(cod));
}

/* o resumo entre setores (supervisor.pacote_resumo: setores = [cod, nome, ...]) só com as regiões liberadas */
function filtrarResumo(p, estados) {
  if (!p || !estados) return p;
  const out = Object.assign({}, p);
  out.setores = (p.setores || []).filter((s) => regiaoLiberada(estados, s[0], s[1]));
  out.estados = estados;
  return out;
}

module.exports = { UFS, estadoDaRegiao, limpar, estadosDaConta, regiaoLiberada, filtrarResumo };
