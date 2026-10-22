/**
 * /api/acessos — a tela "Supervisores" do app (só administrador do Painel).
 *
 * GET   lista as contas do app (public.sup_usuarios) e os convites (public.sup_convites), lidos no Painel
 *       COM O TOKEN de quem pediu (o RLS do Painel só entrega para administrador), e as regiões (setores
 *       do WinThor com RCA ativo, do DATA WAREHOUSE). Completa as contas de RCA com o WinThor: nome, setor e
 *       se o e-mail é o mesmo da rotina 517 (PCUSUARI.EMAIL/EMAIL2).
 * POST  { id, situacao, tipo, codusur, codsupervisor } — libera, recusa, bloqueia ou corrige o vínculo.
 *       Grava quem decidiu e quando (rastreabilidade).
 * POST  { acao: 'convidar', tipo, nome, email, codsupervisor } — 1.2: cadastra o gestor (tipo 'gerente', vê todas
 *       as regiões, só consulta) ou o supervisor de uma região (tipo 'supervisor', só a região dele). Grava
 *       o convite (função sup_convidar do Painel, que gera o código de 6 números e, se a pessoa já tem conta,
 *       libera na hora) e devolve o código para o administrador mandar na mensagem.
 *
 * Prévia (servidor local com --previa): contas e convites DE EXEMPLO na memória deste processo; nada é
 * gravado no Painel. As regiões vêm do banco de verdade.
 */
"use strict";
const crypto = require("crypto");
const { consultar, json, semConfiguracao, erroBanco } = require("./_db.js");
const { sessao, painel } = require("./_sessao.js");
const { cors } = require("./_cors.js");

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function lerCorpo(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve) => {
    let t = ""; req.on("data", (c) => { t += c; if (t.length > 1e5) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(t || "{}")); } catch (_) { resolve({}); } });
  });
}

async function regioes() {
  const sup = await consultar(
    `SELECT s.codsupervisor, s.nome FROM core.dim_supervisor s
      WHERE EXISTS (SELECT 1 FROM core.dim_rca r WHERE r.codsupervisor = s.codsupervisor
                      AND r.dttermino IS NULL AND coalesce(r.bloqueio, 'N') <> 'S')
      ORDER BY s.nome`);
  return sup.rows.map((x) => [x.codsupervisor, x.nome]);
}

/* ---------- prévia: dados de exemplo (nomes inventados), só na memória ---------- */
const agora = () => new Date().toISOString();
const PREVIA = { contas: null, convites: [] };
function exemplo(setores) {
  if (PREVIA.contas) return;
  const [a, b] = setores;
  PREVIA.contas = [
    { id: "00000000-0000-4000-8000-000000000001", email: "exemplo.ana@lube.com.br", nome: "Ana Exemplo", tipo: "supervisor", codusur: null, codsupervisor: a ? a[0] : null, situacao: "liberado", criado_em: agora(), decidido_em: agora() },
    { id: "00000000-0000-4000-8000-000000000002", email: "exemplo.bruno@lube.com.br", nome: "Bruno Exemplo", tipo: "supervisor", codusur: null, codsupervisor: null, situacao: "pendente", criado_em: agora(), decidido_em: null },
  ];
  if (b) PREVIA.convites.push({ email: "exemplo.carla@lube.com.br", nome: "Carla Exemplo", tipo: "supervisor", codsupervisor: b[0], situacao: "aguardando", criado_em: agora() });
}

async function convidarPrevia(b, setores) {
  const email = String(b.email || "").trim().toLowerCase(), tipo = b.tipo, cod = Number(b.codsupervisor) || null;
  if (tipo === "supervisor" && !setores.some((s) => s[0] === cod)) return { status: 400, corpo: { erro: "dados", mensagem: "Região inválida." } };
  const conta = PREVIA.contas.find((c) => c.email === email);
  if (conta) Object.assign(conta, { tipo, codsupervisor: cod, codusur: null, situacao: "liberado", decidido_em: agora() });
  PREVIA.convites = PREVIA.convites.filter((v) => v.email !== email);
  PREVIA.convites.unshift({ email, nome: String(b.nome).trim(), tipo, codsupervisor: cod, situacao: conta ? "usado" : "aguardando", criado_em: agora() });
  return { status: 200, corpo: { ok: true, liberou: !!conta, codigo: conta ? null : String(crypto.randomInt(0, 1e6)).padStart(6, "0"), previa: true } };
}

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (semConfiguracao(res)) return;
  let s;
  try { s = await sessao(req); }
  catch (e) { return json(res, 502, { erro: "login_indisponivel", mensagem: "Não consegui conferir o seu login agora." }); }
  if (!s.ok) return json(res, s.status, { erro: "acesso", mensagem: s.mensagem });
  if (!s.conta.admin) return json(res, 403, { erro: "acesso", mensagem: "Só o administrador do Painel decide os acessos." });
  const ehPrevia = process.env.SUP_MODO_PREVIA === "1" && s.token === "teste";

  try {
    if (req.method === "GET") {
      const setores = await regioes();
      if (ehPrevia) { exemplo(setores); return json(res, 200, { contas: PREVIA.contas, convites: PREVIA.convites, setores, previa: true }); }
      const contas = await painel(s.token,
        "/rest/v1/sup_usuarios?select=id,email,nome,tipo,codusur,codsupervisor,situacao,criado_em,decidido_em&order=criado_em.desc");
      // convites: a tabela nasce com a 1.2; sem ela a tela segue com a lista vazia
      const convites = await painel(s.token,
        "/rest/v1/sup_convites?select=email,nome,tipo,codsupervisor,situacao,criado_em,usado_em&situacao=neq.cancelado&order=criado_em.desc")
        .catch(() => []);
      const cods = [...new Set(contas.map((c) => c.codusur).filter((v) => v != null))];
      const rcas = cods.length
        ? (await consultar(
            `SELECT codusur, nome, codsupervisor, lower(btrim(coalesce(email, ''))) AS e1, lower(btrim(coalesce(email2, ''))) AS e2,
                    (dttermino IS NULL AND coalesce(bloqueio, 'N') <> 'S') AS ativo
               FROM core.dim_rca WHERE codusur = ANY($1::int[])`, [cods])).rows
        : [];
      const porCod = new Map(rcas.map((r) => [r.codusur, r]));
      const lista = contas.map((c) => {
        const r = c.codusur != null ? porCod.get(c.codusur) : null;
        return Object.assign({}, c, {
          rca_nome: r ? r.nome : null,
          rca_setor: r ? r.codsupervisor : null,
          rca_ativo: r ? r.ativo : null,
          email_confere: r ? (c.email === r.e1 || c.email === r.e2) : null,
        });
      });
      return json(res, 200, { contas: lista, convites: convites || [], setores });
    }

    if (req.method === "POST") {
      const b = await lerCorpo(req);

      if (b.acao === "convidar") {
        // gestor (tipo 'gerente'): vê todas as regiões, sem região; supervisor: só a região dele
        const tipo = b.tipo === "gerente" ? "gerente" : "supervisor";
        const email = String(b.email || "").trim().toLowerCase(), nome = String(b.nome || "").trim();
        const cod = tipo === "supervisor" ? Number(b.codsupervisor) || null : null;
        if (nome.length < 3 || nome.length > 120) return json(res, 400, { erro: "dados", mensagem: "Informe o nome completo." });
        if (!RE_EMAIL.test(email) || email.length > 200) return json(res, 400, { erro: "dados", mensagem: "Informe um e-mail válido." });
        if (tipo === "supervisor" && !cod) return json(res, 400, { erro: "dados", mensagem: "Escolha a região do supervisor." });
        const setores = await regioes();
        if (ehPrevia) { exemplo(setores); const r = await convidarPrevia({ email, nome, tipo, codsupervisor: cod }, setores); return json(res, r.status, r.corpo); }
        if (tipo === "supervisor" && !setores.some((x) => x[0] === cod)) return json(res, 400, { erro: "dados", mensagem: "Essa região não tem RCA ativo no WinThor." });
        const r = await painel(s.token, "/rest/v1/rpc/sup_convidar", {
          method: "POST", body: { p_email: email, p_nome: nome, p_codsupervisor: cod, p_tipo: tipo },
        });
        return json(res, 200, { ok: true, liberou: !!(r && r.liberou), codigo: r && r.codigo });
      }

      if (!/^[0-9a-f-]{36}$/i.test(String(b.id || ""))) return json(res, 400, { erro: "id" });
      const situacao = ["pendente", "liberado", "recusado", "bloqueado"].includes(b.situacao) ? b.situacao : null;
      const tipo = ["rca", "supervisor", "gerente"].includes(b.tipo) ? b.tipo : null;
      if (!situacao || !tipo) return json(res, 400, { erro: "dados", mensagem: "Situação ou perfil inválido." });
      const codusur = tipo === "rca" ? Number(b.codusur) || null : null;
      const codsupervisor = tipo === "supervisor" ? Number(b.codsupervisor) || null : null;
      if (situacao === "liberado" && tipo === "rca" && !codusur) return json(res, 400, { erro: "dados", mensagem: "Informe o código do RCA antes de liberar." });
      if (situacao === "liberado" && tipo === "supervisor" && !codsupervisor) return json(res, 400, { erro: "dados", mensagem: "Escolha a região antes de liberar." });
      if (ehPrevia) {
        const c = (PREVIA.contas || []).find((x) => x.id === b.id);
        if (!c) return json(res, 404, { erro: "conta", mensagem: "Conta não encontrada." });
        Object.assign(c, { situacao, tipo, codusur, codsupervisor, decidido_em: agora() });
        return json(res, 200, { ok: true, conta: c, previa: true });
      }
      const linhas = await painel(s.token, "/rest/v1/sup_usuarios?id=eq." + b.id, {
        method: "PATCH", headers: { Prefer: "return=representation" },
        body: { situacao, tipo, codusur, codsupervisor, decidido_em: new Date().toISOString(), decidido_por: s.userId },
      });
      if (!linhas || !linhas.length) return json(res, 404, { erro: "conta", mensagem: "Conta não encontrada." });
      const c = linhas[0];
      await painel(s.token, "/rest/v1/rpc/sup_registrar", {
        method: "POST",
        body: { p_acao: "decisao", p_detalhe: `${c.email}: ${situacao}, ${tipo}${codusur ? " RCA " + codusur : ""}${codsupervisor ? " setor " + codsupervisor : ""}` },
      }).catch(() => {});
      return json(res, 200, { ok: true, conta: c });
    }
    return json(res, 405, { erro: "metodo" });
  } catch (e) {
    if (/Painel respondeu/.test(String(e && e.message))) return json(res, 502, { erro: "painel", mensagem: String(e.message) });
    return erroBanco(res, e);
  }
};
