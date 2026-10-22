/**
 * acesso.js — entrada do Supervisor Lube (2026-10-22).
 *
 * Mesmo jeito do Painel e do SAC: "Entrar" e "Primeiro acesso", na base de login
 * do Painel (Supabase Auth). Conversa direto com o Auth por fetch (sem biblioteca
 * de CDN: a rede da empresa já bloqueou CDN antes e o app tem de abrir sempre).
 *
 *  - Primeiro acesso: RCA informa o código dele; supervisor não precisa (o TI liga
 *    a conta ao setor). A conta nasce PENDENTE e só o TI libera (aba Acessos).
 *  - Quem já tem conta na base (Painel ou SAC) e entra sem acesso ao app vê o
 *    "Pedir acesso".
 *  - Gerente: quem tem o "SUPERVISOR LUBE" liberado no Painel entra direto.
 *  - A sessão fica no aparelho; o app abre com a última conta conhecida e confere
 *    por trás (sem rede, abre com a cópia guardada).
 */
(function () {
  "use strict";

  var CFG = window.SUP_CFG;
  var CHAVE_SESSAO = "sup-lube-sessao", CHAVE_CONTA = "sup-lube-conta", CHAVE_EMAIL = "sup-lube-email";
  var RE_EMAIL = /^[^\s@<>(),;:"\[\]\\]+@[^\s@<>(),;:"\[\]\\]+\.[a-z]{2,}$/i;
  var MSG = {
    pendente: "Seu pedido de acesso está com o TI. Assim que for liberado, é só entrar.",
    recusado: "Seu pedido de acesso ao app foi recusado. Fale com o TI (cpd@lube.com.br).",
    bloqueado: "Seu acesso ao app está bloqueado. Fale com o TI (cpd@lube.com.br).",
  };
  var $ = function (s) { return document.querySelector(s); };
  var conta = null;

  // Modo prévia: só no servidor local desta máquina (node servidor_local.js --previa), para testar as telas
  // com o dado real sem a senha de ninguém. ?previa=gerente | supervisor-4 | rca-1234. Fora do localhost não existe.
  var PREVIA = null;
  // só no servidor local (http://localhost:3104); o app nativo também é "localhost", mas em https/capacitor
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && location.protocol === "http:" && !CFG.nativo) {
    try {
      var q = new URLSearchParams(location.search).get("previa");
      if (q) sessionStorage.setItem("sup-lube-previa", q);
      PREVIA = sessionStorage.getItem("sup-lube-previa");
    } catch (e) { PREVIA = null; }
    if (PREVIA && !/^(gerente|supervisor-\d+|rca-\d+)$/.test(PREVIA)) PREVIA = null;
  }
  function contaPrevia() {
    if (PREVIA === "gerente") return { situacao: "liberado", tipo: "gerente", nome: "Prévia (gerente)", email: "previa@local", admin: true };
    var m = /^(supervisor|rca)-(\d+)$/.exec(PREVIA);
    return m[1] === "supervisor"
      ? { situacao: "liberado", tipo: "supervisor", nome: "Prévia (supervisor)", email: "previa@local", codsupervisor: Number(m[2]), admin: false }
      : { situacao: "liberado", tipo: "rca", nome: "Prévia (RCA)", email: "previa@local", codusur: Number(m[2]), admin: false };
  }

  function ler(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function gravar(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } }
  function texto(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }

  /* ================= Auth (fetch) ================= */
  function erroAuth(corpo, status) {
    var m = String((corpo && (corpo.msg || corpo.error_description || corpo.message || corpo.error)) || "");
    var cod = String((corpo && (corpo.error_code || corpo.error)) || "");
    if (/invalid_credentials|invalid_grant|Invalid login/i.test(cod + m)) return "E-mail ou senha incorretos.";
    if (/user_already_exists|already registered/i.test(cod + m)) return "JA_EXISTE";
    if (/weak_password|at least/i.test(cod + m)) return "A senha precisa ter pelo menos 8 caracteres.";
    if (/email_address_invalid|invalid email/i.test(cod + m)) return "Este e-mail não é válido.";
    if (/Acesso restrito/i.test(m)) return "Este e-mail não pode ser usado aqui. Fale com o TI.";
    if (status === 429 || /rate limit/i.test(m)) return "Muitas tentativas seguidas. Espere um minuto e tente de novo.";
    return "Não consegui falar com o login agora" + (m ? ": " + m : ".");
  }
  function auth(caminho, corpo, token) {
    var h = { apikey: CFG.key, "Content-Type": "application/json" };
    if (token) h.Authorization = "Bearer " + token;
    return fetch(CFG.url + "/auth/v1/" + caminho, { method: "POST", headers: h, body: JSON.stringify(corpo || {}) })
      .then(function (r) {
        return r.text().then(function (t) {
          var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
          if (!r.ok) { var e2 = new Error(erroAuth(j, r.status)); e2.status = r.status; throw e2; }
          return j;
        });
      });
  }
  function guardarSessao(j) {
    if (!j || !j.access_token) return null;
    var s = { access_token: j.access_token, refresh_token: j.refresh_token, expira: Date.now() + (Number(j.expires_in) || 3600) * 1000,
              email: j.user && j.user.email, id: j.user && j.user.id };
    gravar(CHAVE_SESSAO, s);
    return s;
  }
  var renovando = null;
  /* token válido (renova sozinho perto de vencer). Sem rede: devolve o que tem (a API diz se venceu). */
  function token() {
    if (PREVIA) return Promise.resolve("teste-local-" + PREVIA);
    var s = ler(CHAVE_SESSAO);
    if (!s) return Promise.resolve(null);
    if (s.expira - Date.now() > 90000) return Promise.resolve(s.access_token);
    if (!renovando) {
      renovando = auth("token?grant_type=refresh_token", { refresh_token: s.refresh_token })
        .then(function (j) { var n = guardarSessao(j); return n && n.access_token; })
        .catch(function (e) {
          if (e && e.status && e.status >= 400 && e.status < 500) { gravar(CHAVE_SESSAO, null); return null; }
          return s.access_token;
        })
        .then(function (t) { renovando = null; return t; });
    }
    return renovando;
  }
  function rpc(fn, args) {
    if (PREVIA) return Promise.resolve(fn === "sup_meu_acesso" ? contaPrevia() : null);
    return token().then(function (t) {
      if (!t) { var e = new Error("sem sessão"); e.status = 401; throw e; }
      return fetch(CFG.url + "/rest/v1/rpc/" + fn, {
        method: "POST", headers: { apikey: CFG.key, Authorization: "Bearer " + t, "Content-Type": "application/json" },
        body: JSON.stringify(args || {}),
      }).then(function (r) {
        return r.text().then(function (x) {
          if (!r.ok) { var e2 = new Error("O login respondeu " + r.status); e2.status = r.status; throw e2; }
          return x ? JSON.parse(x) : null;
        });
      });
    });
  }

  /* ================= telas ================= */
  function erro(html) { var el = $("#gate-erro"); el.innerHTML = html || ""; el.hidden = !html; }
  function ocupado(b, sim, rotulo) { b.setAttribute("aria-busy", sim ? "true" : "false"); if (rotulo) b.textContent = rotulo; }
  function modo(m) {
    document.querySelectorAll("#gate-modos button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-modo") === m)); });
    document.querySelectorAll(".gate form").forEach(function (f) { f.hidden = f.getAttribute("data-form") !== m; });
    $("#gate-modos").hidden = m === "pedir";
    $("#gate-ok").hidden = true;
    erro("");
  }
  function mostrarLogin(m, mensagem) {
    conta = null;
    // abertura de 3 s com a logo (1.4); sem a abertura (versão antiga do index) troca na hora
    var trocar = function () { $("#tela-app").hidden = true; $("#tela-login").hidden = false; };
    if (window.SUP_ABERTURA) window.SUP_ABERTURA.sair(trocar); else { $("#tela-carregando").hidden = true; trocar(); }
    modo(m || "entrar");
    var em = ler(CHAVE_EMAIL);
    if (em && !$("#l-email").value) $("#l-email").value = em;
    if (mensagem) erro(mensagem);
  }
  function mostrarOk(mensagem) {
    document.querySelectorAll(".gate form").forEach(function (f) { f.hidden = true; });
    $("#gate-modos").hidden = true;
    $("#gate-ok-msg").innerHTML = mensagem;
    $("#gate-ok").hidden = false;
    erro("");
  }
  function codBox(sel, box) {
    var rca = $(sel).value === "rca";
    $(box).hidden = !rca;
  }

  /* ================= decisões ================= */
  function decidir(c, acabouDeEntrar) {
    if (c && c.situacao === "liberado") {
      conta = c;
      gravar(CHAVE_CONTA, c);
      if (acabouDeEntrar) rpc("sup_registrar", { p_acao: "login", p_detalhe: navigator.userAgent.slice(0, 120) }).catch(function () {});
      if (window.SUP_APP) window.SUP_APP.pronto(c);
      return;
    }
    gravar(CHAVE_CONTA, null);
    if (c && c.situacao === "sem_cadastro") {
      mostrarLogin("pedir");
      $("#pedir-texto").textContent = c.corporativo
        ? "Sua conta é do Painel Lube e ainda não tem o Supervisor Lube liberado. Se você é RCA ou supervisor, peça abaixo; gerente pede ao TI para liberar o sistema no Painel."
        : "Sua conta já existe (do SAC), mas ainda não tem acesso a este app. Peça abaixo — o TI libera.";
      return;
    }
    var msg = (c && MSG[c.situacao]) || "Seu acesso ao app não está liberado. Fale com o TI.";
    return sair(true).then(function () { mostrarLogin("entrar"); if (c && c.situacao === "pendente") mostrarOk(texto(msg)); else erro(texto(msg)); });
  }

  function entrar(ev) {
    ev.preventDefault();
    var email = $("#l-email").value.trim().toLowerCase(), senha = $("#l-senha").value;
    erro("");
    if (!RE_EMAIL.test(email)) { erro("Informe o seu e-mail."); $("#l-email").focus(); return; }
    if (!senha) { erro("Informe a senha."); $("#l-senha").focus(); return; }
    var b = $("#btn-entrar");
    ocupado(b, true, "Entrando…");
    auth("token?grant_type=password", { email: email, password: senha })
      .then(function (j) {
        guardarSessao(j);
        gravar(CHAVE_EMAIL, email);
        $("#l-senha").value = "";
        return rpc("sup_meu_acesso").then(function (c) { return decidir(c, true); });
      })
      .catch(function (e) { erro(texto(e && e.message ? e.message : "Não consegui entrar agora. Tente de novo.")); })
      .then(function () { ocupado(b, false, "Entrar"); });
  }

  function cadastrar(ev) {
    ev.preventDefault();
    var nome = $("#c-nome").value.trim(), email = $("#c-email").value.trim().toLowerCase(), senha = $("#c-senha").value;
    var tipo = $("#c-tipo").value, cod = $("#c-cod").value.replace(/\D/g, ""), convite = $("#c-convite").value.replace(/\D/g, "");
    erro("");
    if (convite && convite.length !== 6) { erro("O código do convite tem 6 números."); $("#c-convite").focus(); return; }
    if (nome.length < 3) { erro("Informe o seu nome."); $("#c-nome").focus(); return; }
    if (!RE_EMAIL.test(email)) { erro("Informe um e-mail válido."); $("#c-email").focus(); return; }
    if (senha.length < 8) { erro("A senha precisa ter pelo menos 8 caracteres."); $("#c-senha").focus(); return; }
    if (tipo === "rca" && !cod) { erro("Informe o seu código de RCA (o mesmo do WinThor)."); $("#c-cod").focus(); return; }
    var b = $("#btn-cadastrar");
    ocupado(b, true, "Enviando…");
    auth("signup", { email: email, password: senha, data: { sistema: "supervisor", tipo: tipo, codigo: tipo === "rca" ? cod : "", nome: nome, convite: convite } })
      .then(function (j) {
        gravar(CHAVE_EMAIL, email);
        var pendente = function () {
          gravar(CHAVE_SESSAO, null);
          mostrarOk((convite ? "<b>Conta criada, mas o código do convite não conferiu</b> (ou já foi usado).<br>" : "<b>Pedido enviado.</b><br>") +
            "O TI confere os seus dados e libera o acesso. Depois é só entrar com o e-mail <b>" + texto(email) + "</b> e a senha que você criou.");
        };
        // com convite (1.2), a conta já nasce liberada: entra direto, sem passar pela tela de entrada
        if (!convite || !j || !j.access_token) { pendente(); return; }
        guardarSessao(j);
        return rpc("sup_meu_acesso").then(function (c) { if (c && c.situacao === "liberado") decidir(c, true); else pendente(); }).catch(pendente);
      })
      .catch(function (e) {
        if (e && e.message === "JA_EXISTE") {
          modo("entrar"); $("#l-email").value = email;
          erro("Este e-mail já tem conta (do Painel ou do SAC). Entre com a mesma senha: se faltar acesso ao app, você pede em seguida.");
          return;
        }
        erro(texto(e && e.message ? e.message : "Não consegui enviar agora. Tente de novo."));
      })
      .then(function () { ocupado(b, false, "Pedir acesso"); });
  }

  function pedir(ev) {
    ev.preventDefault();
    var tipo = $("#p-tipo").value, cod = $("#p-cod").value.replace(/\D/g, ""), convite = $("#p-convite").value.replace(/\D/g, "");
    if (tipo === "rca" && !cod) { erro("Informe o seu código de RCA (o mesmo do WinThor)."); $("#p-cod").focus(); return; }
    if (convite && convite.length !== 6) { erro("O código do convite tem 6 números."); $("#p-convite").focus(); return; }
    var b = $("#btn-pedir");
    ocupado(b, true, "Enviando…");
    rpc("sup_pedir_acesso", { p_tipo: tipo, p_codigo: tipo === "rca" ? Number(cod) : null, p_nome: "", p_convite: convite || null })
      .then(function (c) { return decidir(c, true); })
      .catch(function (e) { erro(texto(e && e.message ? e.message : "Não consegui enviar agora.")); })
      .then(function () { ocupado(b, false, "Pedir acesso"); });
  }

  function sair(silencioso) {
    if (PREVIA) { try { sessionStorage.removeItem("sup-lube-previa"); } catch (e) { /* ignora */ } PREVIA = null; conta = null; return Promise.resolve(); }
    var s = ler(CHAVE_SESSAO);
    var fim = function () { gravar(CHAVE_SESSAO, null); gravar(CHAVE_CONTA, null); conta = null; };
    if (!s) { fim(); return Promise.resolve(); }
    var p = silencioso ? Promise.resolve() : rpc("sup_registrar", { p_acao: "logout", p_detalhe: "" }).catch(function () {});
    return p.then(function () { return auth("logout", {}, s.access_token).catch(function () {}); }).then(fim);
  }

  /* ================= início ================= */
  function iniciar() {
    document.querySelectorAll("#gate-modos button").forEach(function (b) { b.addEventListener("click", function () { modo(b.getAttribute("data-modo")); }); });
    $("#form-entrar").addEventListener("submit", entrar);
    $("#form-cadastro").addEventListener("submit", cadastrar);
    $("#form-pedir").addEventListener("submit", pedir);
    $("#c-tipo").addEventListener("change", function () { codBox("#c-tipo", "#c-cod-box"); });
    $("#p-tipo").addEventListener("change", function () { codBox("#p-tipo", "#p-cod-box"); });
    $("#btn-esqueci").addEventListener("click", function () {
      erro("Para trocar a senha, fale com o TI: <b>cpd@lube.com.br</b>. A troca é feita no painel administrativo.");
    });
    document.addEventListener("click", function (ev) {
      var a = ev.target.closest("[data-acao='sair']");
      if (a && !a.closest("#folha")) { ev.preventDefault(); sair(false).then(function () { mostrarLogin("entrar"); }); }
    });

    if (PREVIA) { decidir(contaPrevia(), false); return; }
    var s = ler(CHAVE_SESSAO);
    if (!s) { mostrarLogin("entrar"); return; }
    var guardada = ler(CHAVE_CONTA);
    if (guardada && guardada.situacao === "liberado") {
      // abre na hora com a última conta conhecida; confere por trás
      decidir(guardada, false);
      rpc("sup_meu_acesso").then(function (c) {
        if (!c || c.situacao !== "liberado") return decidir(c, false);
        var mudou = JSON.stringify(c) !== JSON.stringify(guardada);
        conta = c; gravar(CHAVE_CONTA, c);
        if (mudou && window.SUP_APP) window.SUP_APP.pronto(c);
      }).catch(function (e) {
        if (e && e.status === 401) { sair(true).then(function () { mostrarLogin("entrar", "Sua sessão expirou. Entre de novo."); }); }
        /* sem rede: segue com a cópia */
      });
      return;
    }
    $("#carregando-motivo").textContent = "Conferindo o seu acesso…";
    rpc("sup_meu_acesso").then(function (c) { decidir(c, false); })
      .catch(function () { mostrarLogin("entrar", "Não consegui conferir o seu acesso agora. Confira a internet e entre de novo."); });
  }

  window.SUP_ACESSO = {
    iniciar: iniciar, token: token, rpc: rpc,
    conta: function () { return conta; },
    sair: function () { return sair(false).then(function () { mostrarLogin("entrar"); }); },
    expirou: function () { return sair(true).then(function () { mostrarLogin("entrar", "Sua sessão expirou. Entre de novo."); }); },
    negado: function (m) { return sair(true).then(function () { mostrarLogin("entrar", texto(m)); }); },
  };
})();
