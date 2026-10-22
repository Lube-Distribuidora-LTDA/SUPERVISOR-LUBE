/**
 * servidor_local.js — abre o app no seu computador, antes (ou sem) publicar na Vercel.
 *
 * Serve a pasta web/ e atende /api/dados e /api/acessos com AS MESMAS funções que a
 * Vercel usa, contra o DATA WAREHOUSE de verdade e com o login de verdade (base do
 * Painel). A senha do banco vem do ENV do ETL: é lida para a memória deste processo e
 * nunca é impressa nem gravada.
 *
 *   cd web
 *   npm install            (uma vez)
 *   node servidor_local.js
 *   abra http://localhost:3104
 *
 * Só escuta a própria máquina (127.0.0.1).
 * Onde procura o ENV: o caminho passado como argumento, ..\etl\ENV, C:\BI\SUPERVISOR\ENV.
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const WEB = __dirname;
const PORTA = Number(process.env.PORTA || 3104);

// --previa: entra sem login de verdade, como gerente, supervisor ou RCA (só nesta máquina; ver api/_sessao.js
// e js/acesso.js). Serve para testar as telas com o dado real sem usar a senha de ninguém.
const PREVIA = process.argv.includes("--previa");
if (PREVIA) process.env.SUP_MODO_PREVIA = "1";
const argEnv = process.argv.slice(2).find((a) => !a.startsWith("--"));
const candidatos = [argEnv, path.join(WEB, "..", "etl", "ENV"), "C:\\BI\\SUPERVISOR\\ENV"].filter(Boolean);
const arquivoEnv = candidatos.find((c) => fs.existsSync(c));
if (!arquivoEnv && !process.env.SUPABASE_DB_PASSWORD) {
  console.error("Nao achei o arquivo ENV. Passe o caminho: node servidor_local.js \"C:\\caminho\\ENV\"");
  process.exit(1);
}
if (arquivoEnv) {
  for (const linha of fs.readFileSync(arquivoEnv, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linha);
    if (!m || linha.trim().startsWith("#")) continue;
    let v = m[2];
    if (/^".*"$/.test(v)) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
process.env.SUPABASE_DB_PORT = process.env.SUPABASE_DB_PORT || "5432";

const rotas = {
  "/api/dados": require(path.join(WEB, "api", "dados.js")),
  "/api/acessos": require(path.join(WEB, "api", "acessos.js")),
};
const TIPOS = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost");
  if (rotas[u.pathname]) { req.query = Object.fromEntries(u.searchParams); return rotas[u.pathname](req, res); }
  // pasta (ex.: /baixar/) abre o index.html dela, como na Vercel
  const f = path.join(WEB, u.pathname.endsWith("/") ? decodeURIComponent(u.pathname) + "index.html" : decodeURIComponent(u.pathname));
  // só serve o que está dentro de web/, nunca o código do servidor, as funções nem o node_modules
  const ok = f.startsWith(WEB + path.sep) && !f.includes("node_modules") && !f.includes(path.sep + "api" + path.sep) &&
             !f.includes(path.sep + "db" + path.sep) &&
             !/servidor_local\.js$|\.ts$|package(-lock)?\.json$/.test(f) && fs.existsSync(f) && fs.statSync(f).isFile();
  if (!ok) { res.statusCode = 404; return res.end("nao encontrado"); }
  res.setHeader("Content-Type", TIPOS[path.extname(f)] || "application/octet-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.end(fs.readFileSync(f));
}).listen(PORTA, "127.0.0.1", () => {
  console.log("Supervisor Lube em http://localhost:" + PORTA + "   (Ctrl+C para parar)");
  if (PREVIA) console.log("MODO PREVIA: abra http://localhost:" + PORTA + "/?previa=gerente (ou supervisor-4, rca-1234) — sem login de verdade, so nesta maquina.");
});
