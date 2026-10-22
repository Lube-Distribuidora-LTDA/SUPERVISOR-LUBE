/**
 * /api/acessos — a aba "Acessos" do app (só administrador do Painel).
 *
 * GET   lista as contas do app (public.sup_usuarios, lida no Painel COM O TOKEN de
 *       quem pediu: o RLS do Painel só entrega para administrador) e completa com o
 *       WinThor carregado no DATA WAREHOUSE: nome do RCA, setor dele e se o e-mail
 *       da conta é o mesmo cadastrado na rotina 517 (PCUSUARI.EMAIL/EMAIL2).
 * POST  { id, situacao, tipo, codusur, codsupervisor } — libera, recusa, bloqueia ou
 *       corrige o vínculo. Grava quem decidiu e quando (rastreabilidade).
 */
"use strict";
const { consultar, json, semConfiguracao, erroBanco } = require("./_db.js");
const { sessao, painel } = require("./_sessao.js");

function lerCorpo(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve) => {
    let t = ""; req.on("data", (c) => { t += c; if (t.length > 1e5) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(t || "{}")); } catch (_) { resolve({}); } });
  });
}

module.exports = async (req, res) => {
  if (semConfiguracao(res)) return;
  let s;
  try { s = await sessao(req); }
  catch (e) { return json(res, 502, { erro: "login_indisponivel", mensagem: "Não consegui conferir o seu login agora." }); }
  if (!s.ok) return json(res, s.status, { erro: "acesso", mensagem: s.mensagem });
  if (!s.conta.admin) return json(res, 403, { erro: "acesso", mensagem: "Só o administrador do Painel decide os acessos." });

  try {
    if (req.method === "GET") {
      const contas = await painel(s.token,
        "/rest/v1/sup_usuarios?select=id,email,nome,tipo,codusur,codsupervisor,situacao,criado_em,decidido_em&order=criado_em.desc");
      const sup = await consultar(
        `SELECT s.codsupervisor, s.nome FROM core.dim_supervisor s
          WHERE EXISTS (SELECT 1 FROM core.dim_rca r WHERE r.codsupervisor = s.codsupervisor
                          AND r.dttermino IS NULL AND coalesce(r.bloqueio, 'N') <> 'S')
          ORDER BY s.nome`);
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
      return json(res, 200, { contas: lista, setores: sup.rows.map((x) => [x.codsupervisor, x.nome]) });
    }

    if (req.method === "POST") {
      const b = await lerCorpo(req);
      if (!/^[0-9a-f-]{36}$/i.test(String(b.id || ""))) return json(res, 400, { erro: "id" });
      const situacao = ["pendente", "liberado", "recusado", "bloqueado"].includes(b.situacao) ? b.situacao : null;
      const tipo = ["rca", "supervisor", "gerente"].includes(b.tipo) ? b.tipo : null;
      if (!situacao || !tipo) return json(res, 400, { erro: "dados", mensagem: "Situação ou perfil inválido." });
      const codusur = tipo === "rca" ? Number(b.codusur) || null : null;
      const codsupervisor = tipo === "supervisor" ? Number(b.codsupervisor) || null : null;
      if (situacao === "liberado" && tipo === "rca" && !codusur) return json(res, 400, { erro: "dados", mensagem: "Informe o código do RCA antes de liberar." });
      if (situacao === "liberado" && tipo === "supervisor" && !codsupervisor) return json(res, 400, { erro: "dados", mensagem: "Escolha o setor antes de liberar." });
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
