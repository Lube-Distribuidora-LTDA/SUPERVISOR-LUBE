/**
 * gerar-telas.js — o pacote das telas que o app baixa sozinho (1.11; Júlio: "atualizou e já mudou", sem baixar APK).
 *
 * O APK traz as telas dentro dele. Ao abrir (e ao voltar para a frente), o app lê web/telas/versao.json no site:
 * se o número "telas" de lá for maior que o dele (CFG.telas, em web/js/config.js), baixa o .zip, o plugin
 * @capgo/capacitor-updater confere o SHA-256 e troca as telas. Sem o servidor da Capgo (modo manual, sem
 * estatística). Se a tela nova não abrir (o app não avisa "pronto" em 10 s), o plugin volta para a anterior.
 * Vão no pacote os mesmos arquivos que o preparar-web.js põe no APK.
 *
 * Tela nova (sem mudança do Android):  suba "telas" e "versao" no web/js/config.js,  node gerar-telas.js,
 * e publique o site com o web/telas junto. Mudança do Android (plugin novo, ícone, permissão): APK novo e
 * MIN_NATIVO = o versionCode dele.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { WEB, LEVAR } = require("./preparar-web.js");

const MIN_NATIVO = 12;   // o menor versionCode de APK que entende estas telas: o 1.11, o primeiro com o atualizador

const cfg = fs.readFileSync(path.join(WEB, "js", "config.js"), "utf8");
const telas = Number((/telas:\s*(\d+)/.exec(cfg) || [])[1]);
const versao = (/versao:\s*'([^']+)'/.exec(cfg) || [])[1] || "";
if (!telas) throw new Error("O web/js/config.js está sem o número das telas (telas: N).");

// os arquivos em ordem fixa: o mesmo conteúdo dá o mesmo .zip e o mesmo SHA-256
const arquivos = [];
function juntar(rel) {
  const abs = path.join(WEB, rel);
  if (fs.statSync(abs).isDirectory()) for (const f of fs.readdirSync(abs).sort()) juntar(path.join(rel, f));
  else arquivos.push(rel.split(path.sep).join("/"));
}
for (const item of LEVAR) juntar(item);

// .zip escrito aqui mesmo (deflate do Node), sem dependência
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = b => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const DATA_DOS = ((2026 - 1980) << 9) | (1 << 5) | 1;   // data fixa (01/01/2026): o .zip não muda só porque foi gerado de novo
const locais = [], central = [];
let pos = 0;
for (const nome of arquivos) {
  const dado = fs.readFileSync(path.join(WEB, nome)), comp = zlib.deflateRawSync(dado, { level: 9 });
  const n = Buffer.from(nome, "utf8"), c = crc32(dado);
  const loc = Buffer.alloc(30);
  loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0x0800, 6); loc.writeUInt16LE(8, 8);
  loc.writeUInt16LE(0, 10); loc.writeUInt16LE(DATA_DOS, 12); loc.writeUInt32LE(c, 14);
  loc.writeUInt32LE(comp.length, 18); loc.writeUInt32LE(dado.length, 22); loc.writeUInt16LE(n.length, 26); loc.writeUInt16LE(0, 28);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8);
  cen.writeUInt16LE(8, 10); cen.writeUInt16LE(0, 12); cen.writeUInt16LE(DATA_DOS, 14); cen.writeUInt32LE(c, 16);
  cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(dado.length, 24); cen.writeUInt16LE(n.length, 28);
  cen.writeUInt32LE(pos, 42);
  locais.push(loc, n, comp); central.push(cen, n);
  pos += loc.length + n.length + comp.length;
}
const cd = Buffer.concat(central), fim = Buffer.alloc(22);
fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(arquivos.length, 8); fim.writeUInt16LE(arquivos.length, 10);
fim.writeUInt32LE(cd.length, 12); fim.writeUInt32LE(pos, 16);
const zip = Buffer.concat([...locais, cd, fim]);

// só o pacote atual fica na pasta (os antigos continuam no histórico do git)
const DEST = path.join(WEB, "telas");
fs.mkdirSync(DEST, { recursive: true });
for (const f of fs.readdirSync(DEST)) if (/^telas-\d+\.zip$/.test(f)) fs.rmSync(path.join(DEST, f));
const nomeZip = "telas-" + telas + ".zip";
fs.writeFileSync(path.join(DEST, nomeZip), zip);
const sha256 = crypto.createHash("sha256").update(zip).digest("hex");
const info = {
  telas, versao, url: "/telas/" + nomeZip, sha256, minNativo: MIN_NATIVO, arquivos: arquivos.length, bytes: zip.length,
  nota: "Gerado pelo app/gerar-telas.js. O app nativo baixa o pacote quando 'telas' for maior que o dele e o versionCode do APK for pelo menos minNativo.",
};
fs.writeFileSync(path.join(DEST, "versao.json"), JSON.stringify(info, null, 2) + "\n");
console.log(`Telas ${telas} (${versao}): ${arquivos.length} arquivos, ${(zip.length / 1024).toFixed(0)} KB, sha256 ${sha256}`);
