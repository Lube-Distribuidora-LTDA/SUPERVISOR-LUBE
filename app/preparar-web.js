/**
 * preparar-web.js — copia as telas do app (../web) para dentro do APK (www/).
 *
 * O app nativo leva as telas dentro dele (abre na hora, sem internet mostra a última
 * cópia dos dados) e busca só os dados em supervisor-lube.vercel.app/api. Vai para o APK só
 * o que a tela usa: nunca a API, o SQL, o servidor local, a guarda da Sentinela nem o
 * próprio APK de download (web/baixar).
 *
 *   node preparar-web.js        (o GERAR APK.bat roda sozinho, antes do "cap sync")
 */
"use strict";
const fs = require("fs");
const path = require("path");

const WEB = path.join(__dirname, "..", "web");
const WWW = path.join(__dirname, "www");
const LEVAR = ["index.html", "manifest.webmanifest", "logo-lube.png", "css", "js", "fonts", "icones"];

fs.rmSync(WWW, { recursive: true, force: true });
fs.mkdirSync(WWW, { recursive: true });
let n = 0;
function copiar(de, para) {
  const st = fs.statSync(de);
  if (st.isDirectory()) {
    fs.mkdirSync(para, { recursive: true });
    for (const f of fs.readdirSync(de)) copiar(path.join(de, f), path.join(para, f));
  } else { fs.copyFileSync(de, para); n++; }
}
for (const item of LEVAR) copiar(path.join(WEB, item), path.join(WWW, item));
console.log("Telas copiadas para o APK: " + n + " arquivos em " + WWW);
