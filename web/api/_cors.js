/**
 * _cors.js — deixa o APP NATIVO (Android e iPhone) chamar a API.
 *
 * No app nativo as telas vêm de dentro do aparelho (origem https://localhost no Android e
 * capacitor://localhost no iPhone) e só os dados vêm daqui. O navegador da WebView só
 * entrega a resposta se a API disser que aceita essa origem. Só essas duas entram: o site
 * (supervisor-lube.vercel.app) é a mesma origem e nem passa por aqui.
 *
 * Não abre nada: toda chamada continua exigindo o token do login (Authorization: Bearer),
 * e a API não usa cookie — outra página na mesma origem não teria o token.
 */
"use strict";

const ORIGENS_DO_APP = new Set(["https://localhost", "capacitor://localhost"]);

/** Põe os cabeçalhos de CORS; responde sozinho o "pedido de permissão" (OPTIONS). Devolve true se já respondeu. */
function cors(req, res) {
  const origem = String((req.headers && req.headers.origin) || "");
  if (ORIGENS_DO_APP.has(origem)) {
    res.setHeader("Access-Control-Allow-Origin", origem);
    res.setHeader("Access-Control-Allow-Headers", "Authorization, If-None-Match, X-Versao, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Expose-Headers", "ETag, X-Escopo, X-Versao-Pacote");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  res.setHeader("Vary", "Origin, Authorization");
  if (req.method === "OPTIONS") {
    res.statusCode = ORIGENS_DO_APP.has(origem) ? 204 : 403;
    res.end();
    return true;
  }
  return false;
}

module.exports = { cors, ORIGENS_DO_APP };
