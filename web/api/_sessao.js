/**
 * _sessao.js — quem está pedindo? (login do app, na base de login do Painel Lube)
 *
 * O app manda o token da sessão em "Authorization: Bearer". Aqui o token é
 * conferido no próprio Supabase do Painel (/auth/v1/user) e a conta precisa estar
 * LIBERADA (sup_meu_acesso() = 'liberado'). Só a chave pública (anon) é usada —
 * nenhum segredo do Painel fica neste projeto. Mesmo desenho do SAC.
 *
 * Perfis (decisão do Júlio, 2026-10-22):
 *   gerente     todos os setores (e o resumo entre setores)
 *   supervisor  só o setor dele (codsupervisor)
 *   rca         só a rota dele (codusur) — a API filtra antes de mandar
 *
 * Devolve { ok: true, token, userId, email, conta } ou { ok: false, status, mensagem }.
 * Erro de rede/servidor do Painel sobe como exceção (quem chama responde 502:
 * nada sai sem conferir o login).
 */
"use strict";
const PAINEL = require("./_painel.js");

const TEMPO_MS = 8000;

function cabecalhos(token) {
  return { apikey: PAINEL.ANON, Authorization: "Bearer " + token, "Content-Type": "application/json" };
}

async function sessao(req) {
  const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || "";
  // Só para testar nesta máquina, no servidor local em modo prévia (node servidor_local.js --previa).
  // Na Vercel SUP_MODO_PREVIA não existe, então isto nunca vale lá.
  if (process.env.SUP_MODO_PREVIA === "1") {
    const t = /^Bearer\s+teste-local-(gerente|supervisor-(\d+)|rca-(\d+))$/.exec(String(h).trim());
    if (t) {
      const conta = t[1] === "gerente" ? { situacao: "liberado", tipo: "gerente", nome: "Prévia (gerente)", email: "previa@local", admin: true }
        : t[2] ? { situacao: "liberado", tipo: "supervisor", nome: "Prévia (supervisor)", email: "previa@local", codsupervisor: Number(t[2]), admin: false }
        : { situacao: "liberado", tipo: "rca", nome: "Prévia (RCA)", email: "previa@local", codusur: Number(t[3]), admin: false };
      return { ok: true, token: "teste", userId: "teste", email: conta.email, conta };
    }
  }
  const m =/^Bearer\s+([A-Za-z0-9._-]{20,})$/.exec(String(h).trim());
  if (!m) return { ok: false, status: 401, mensagem: "Entre no app para ver os dados." };
  const token = m[1];

  const u = await fetch(PAINEL.URL + "/auth/v1/user", { headers: cabecalhos(token), signal: AbortSignal.timeout(TEMPO_MS) });
  if (u.status === 401 || u.status === 403) return { ok: false, status: 401, mensagem: "Sua sessão expirou. Entre de novo." };
  if (!u.ok) throw new Error("login do Painel respondeu " + u.status);
  const usuario = await u.json();

  const r = await fetch(PAINEL.URL + "/rest/v1/rpc/sup_meu_acesso", {
    method: "POST", headers: cabecalhos(token), body: "{}", signal: AbortSignal.timeout(TEMPO_MS),
  });
  if (!r.ok) throw new Error("sup_meu_acesso respondeu " + r.status);
  const conta = await r.json();
  if (!conta || conta.situacao !== "liberado") {
    return { ok: false, status: 403, mensagem: "Seu acesso ao app não está liberado. Fale com o TI." };
  }
  if (conta.tipo === "supervisor" && !conta.codsupervisor) {
    return { ok: false, status: 403, mensagem: "Sua conta ainda não está ligada a um setor. Fale com o TI." };
  }
  if (conta.tipo === "rca" && !conta.codusur) {
    return { ok: false, status: 403, mensagem: "Sua conta ainda não está ligada a um código de RCA. Fale com o TI." };
  }
  return { ok: true, token, userId: usuario.id, email: String(usuario.email || "").toLowerCase(), conta };
}

/* chamada ao Painel em nome de quem está logado (o RLS do Painel decide o que vale) */
async function painel(token, caminho, opcoes) {
  const o = opcoes || {};
  const r = await fetch(PAINEL.URL + caminho, {
    method: o.method || "GET",
    headers: Object.assign(cabecalhos(token), o.headers || {}),
    body: o.body == null ? undefined : JSON.stringify(o.body),
    signal: AbortSignal.timeout(TEMPO_MS),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error("Painel respondeu " + r.status + ": " + texto.slice(0, 200));
  return texto ? JSON.parse(texto) : null;
}

module.exports = { sessao, painel };
