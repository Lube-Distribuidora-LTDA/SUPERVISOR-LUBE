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

/* o resumo entre setores (supervisor.pacote_resumo: setores = [cod, nome, ...]) só com as regiões liberadas.
   1.12 (GERAL): 'geral' traz, para cada conjunto de regiões, quantos clientes têm aquele conjunto ([[7, 12], 3] = 3
   clientes com pedido no ES - Vitória Norte e no ES - Vitória Sul). Sai daqui só com as regiões liberadas: o gestor não
   fica sabendo nem a contagem de cliente de região que não vê. */
function filtrarGeral(geral, ok) {
  const out = {};
  for (const [k, lista] of Object.entries(geral || {})) {
    if (!Array.isArray(lista)) continue;
    const m = new Map();
    for (const item of lista) {
      const regs = (Array.isArray(item && item[0]) ? item[0] : []).map(Number).filter((c) => ok.has(c));
      if (!regs.length) continue;
      const ch = regs.join(",");
      m.set(ch, [regs, (m.has(ch) ? m.get(ch)[1] : 0) + (Number(item[1]) || 0)]);
    }
    out[k] = [...m.values()];
  }
  return out;
}
function filtrarResumo(p, estados) {
  if (!p || !estados) return p;
  const out = Object.assign({}, p);
  out.setores = (p.setores || []).filter((s) => regiaoLiberada(estados, s[0], s[1]));
  if (p.geral) out.geral = filtrarGeral(p.geral, new Set(out.setores.map((s) => Number(s[0]))));
  out.estados = estados;
  return out;
}

module.exports = { UFS, estadoDaRegiao, limpar, estadosDaConta, regiaoLiberada, filtrarResumo, filtrarGeral };
