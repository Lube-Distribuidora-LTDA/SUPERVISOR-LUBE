/**
 * app.js — Supervisor Lube.
 *
 * 1.1 (2026-10-22): as seis abas do protótipo com o dado real.
 * 1.2 (2026-10-22, prévia): "Resumo" numa tela só; cada aba dividida em páginas (controle segmentado, sem
 *   precisar rolar); barra de baixo no desenho do Painel Lube; navegação no jeito do iPhone (tela que entra
 *   pela direita, voltar arrastando da borda, folha que sobe com o fundo recuando, puxar para atualizar) e o
 *   cadastro dos supervisores pelo administrador, com convite. O RCA ainda não usa o app (o perfil fica no
 *   código, para depois).
 *
 * O pacote vem pronto da carga (supervisor.pacote, via /api/dados) e o aparelho
 * calcula os filtros. A última cópia fica no aparelho (IndexedDB): o app abre na
 * hora com ela e confere por trás se há versão nova (ETag) — quem abre nunca
 * espera o banco.
 *
 * Perfis: gerente (todos os setores + comparação entre setores), supervisor (só o
 * setor dele, a "região") e RCA (só a rota dele — a API já manda filtrado).
 */
(function () {
'use strict';

const CFG = window.SUP_CFG, A = window.SUP_ACESSO;
const $ = s => document.querySelector(s);
const REDUZ = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const EASE = 'cubic-bezier(.32,.72,0,1)';   // a curva das telas do iPhone

/* ---------------- utilidades ---------------- */
const DAY = 864e5;
const dt = d => new Date(d * DAY);
const dow = d => dt(d).getUTCDay();
const p2 = n => String(n).padStart(2, '0');
const dm = d => { const x = dt(d); return p2(x.getUTCDate()) + '/' + p2(x.getUTCMonth() + 1); };
const dmy = d => dm(d) + '/' + dt(d).getUTCFullYear();
const iso = d => { const x = dt(d); return x.getUTCFullYear() + '-' + p2(x.getUTCMonth() + 1) + '-' + p2(x.getUTCDate()); };
const fromIso = s => { const [y, m, dd] = String(s).split('-').map(Number); return Math.round(Date.UTC(y, m - 1, dd) / DAY); };
const mStart = (y, m) => Math.round(Date.UTC(y, m, 1) / DAY);
const mesDe = d => { const x = dt(d); return mStart(x.getUTCFullYear(), x.getUTCMonth()); };
const mesSeg = (d, k) => { const x = dt(d); return mStart(x.getUTCFullYear(), x.getUTCMonth() + k); };
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_L = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const DIAS_L = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const diaLongo = d => DIAS[dow(d)] + ', ' + dm(d);
const nomeMes = d => MESES[dt(d).getUTCMonth()] + '/' + dt(d).getUTCFullYear();
const hm = iso8601 => { if (!iso8601) return '—'; const x = new Date(iso8601); return p2(x.getHours()) + ':' + p2(x.getMinutes()); };
const diaHm = iso8601 => { if (!iso8601) return '—'; const x = new Date(iso8601); return p2(x.getDate()) + '/' + p2(x.getMonth() + 1) + ' ' + hm(iso8601); };

const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brl = v => 'R$ ' + nf0.format(Math.round(v));
const brl2 = v => 'R$ ' + nf2.format(v);
const brlK = v => { const a = Math.abs(v); if (a >= 1e6) return 'R$ ' + nf2.format(v / 1e6) + ' mi'; if (a >= 1e4) return 'R$ ' + nf1.format(v / 1e3) + ' mil'; return brl(v); };
const pct = (v, d) => (d === 0 ? nf0 : nf1).format((isFinite(v) ? v : 0) * 100) + '%';
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const titulo = s => String(s || '').toLowerCase().replace(/(^|\s|\/|-|\()(\S)/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Do|Da|De|Dos|Das|E)\b/g, w => w.toLowerCase());
const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const soma = (arr, f) => { let t = 0; for (const x of arr) t += f(x); return t; };
const iniciais = s => (String(s || '').split('@')[0].match(/\p{L}+/gu) || []).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';
const curto = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const primeiro = s => String(s || '').trim().split(/\s+/)[0] || '';

/* ---------------- estado ---------------- */
const S = {
  tab: 'resumo', escopo: null, chave: null,
  // página aberta em cada tela que tem páginas
  pag: { vendas: 'hoje', carteira: 'pos', abc: 'cli', inad: 'resumo', dev: 'resumo', cli: 'resumo', adm: 'regioes' },
  pilha: [], rolagens: [],   // telas empilhadas por cima da aba (cliente, busca, lista completa, supervisores)
  v: { rca: 0, dia: null, de: null, ate: null, q: 'mes', graf: 'fat' },
  c: { mes: null, rca: 0, cid: '', bai: '' },
  k: { raw: '', modo: 'forn' },
  a: { per: 'mes', rca: 0 },
  i: { open: 0 },
  d: { per: 'mes', open: 0 },
  adm: { filtro: 'pendente', dados: null, carregando: false, erro: '' },
  contado: null, mudou: false, convite: '',
};
let conta = null, D = null, R = null, baixando = false, ultimaConferencia = 0, offline = false, instalar = null, appNovo = null;
let LISTA_TODA = null;   // id da lista aberta inteira ("Ver todos")
try { const sv = JSON.parse(localStorage.getItem('sup-lube-tela') || '{}'); if (sv.tab) S.tab = sv.tab; } catch (e) { /* sem armazenamento */ }
function salvarTela() { try { localStorage.setItem('sup-lube-tela', JSON.stringify({ tab: S.tab })); } catch (e) { /* ignora */ } }

/* ---------------- cópia no aparelho (IndexedDB) ---------------- */
const IDB = (() => {
  let db = null;
  function abrir() {
    if (db) return Promise.resolve(db);
    return new Promise((ok, falha) => {
      try {
        const r = indexedDB.open('sup-lube', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('pacotes');
        r.onsuccess = () => { db = r.result; ok(db); };
        r.onerror = () => falha(r.error);
      } catch (e) { falha(e); }
    });
  }
  const tx = (modo, fn) => abrir().then(d => new Promise((ok, falha) => {
    const t = d.transaction('pacotes', modo), st = t.objectStore('pacotes'), r = fn(st);
    t.oncomplete = () => ok(r && r.result); t.onerror = () => falha(t.error);
  }));
  return {
    get: k => tx('readonly', st => st.get(k)).catch(() => null),
    set: (k, v) => tx('readwrite', st => st.put(v, k)).catch(() => null),
    limpar: () => tx('readwrite', st => st.clear()).catch(() => null),
  };
})();

/* ---------------- dados ---------------- */
function montar(p) {
  const d = {
    tipo: (p.escopo && p.escopo.tipo) || 'setor', codusur: p.escopo && p.escopo.codusur,
    setor: p.setor || { cod: null, nome: '' }, hoje: p.hoje, ini: p.ini, cargas: p.cargas || {}, gerado: p.gerado_em,
    rcas: (p.rcas || []).map(r => ({ cod: r[0], nome: titulo(r[1]), ativo: !!r[2] })),
    nf: (p.nf || []).map(r => ({ d: r[0], ped: r[1], cli: r[2], rca: r[3], vl: +r[4] || 0, cmv: +r[5] || 0 })),
    ped: (p.ped || []).map(r => ({ d: r[0], min: r[1], num: r[2], cli: r[3], rca: r[4], vl: +r[5] || 0, pos: r[6], ori: r[7], dfat: r[8] })),
    tit: (p.tit || []).map(r => ({ cli: r[0], rca: r[1], dup: r[2], prest: r[3], venc: r[4], valor: +r[5] || 0, cob: r[6], grupo: r[7], fil: r[8], emis: r[9] })),
    item: (p.item || []).map(r => ({ mes: r[0], cli: r[1], p: r[2], rca: r[3], q: +r[4] || 0, v: +r[5] || 0, c: +r[6] || 0, ult: r[7], n: r[8] || 0 })),
    dev: (p.dev || []).map(r => ({ d: r[0], cli: r[1], rca: r[2], nota: r[3], mot: r[4], v: +r[5] || 0 })),
    prod: p.prod || {}, forn: p.forn || {}, mot: p.mot || {}, cob: p.cob || {},
    cli: (p.cli || []).map(r => ({ cod: r[0], fantasia: titulo(r[1] || r[2]) || ('Cliente ' + r[0]), razao: r[2] || '', cnpj: r[3], ramo: r[4], cidade: r[5] || '', bairro: r[6] || '', end: r[7] || '', fone: r[8], cel: r[9], rca: r[10], plano: r[11], prazo: r[12], limite: +r[13] || 0, bloq: !!r[14], ult: r[15], cad: r[16], sup: r[17] })),
  };
  d.RMAP = new Map(d.rcas.map(r => [r.cod, r]));
  // telas e filtros mostram só RCA ativo (Júlio, 2026-10-22); o inativo segue no pacote para o total da região
  // fechar (título antigo, venda do mês) e aparece só numa linha de aviso
  d.ativos = d.rcas.filter(r => r.ativo);
  d.CMAP = new Map(d.cli.map(c => [c.cod, c]));
  if (d.tipo === 'rca' && d.rcas[0]) d.rcaNome = d.rcas[0].nome;
  return d;
}
const rcaNome = cod => { const r = D && D.RMAP.get(cod); return r ? r.nome : (cod ? 'RCA ' + cod : '—'); };
const prodNome = p => (D.prod[p] && D.prod[p][0]) || ('Produto ' + p);
const fornDe = p => (D.prod[p] && D.prod[p][1]) || 0;
const fornNome = f => titulo(D.forn[f] || ('Fornecedor ' + f));
const cliNome = cod => { const c = D && D.CMAP.get(cod); return c ? c.fantasia : 'Cliente ' + cod; };
const rcaAtivo = cod => { const r = D.RMAP.get(cod); return !!(r && r.ativo); };
/* "Inclui R$ X de RCA inativo": o total fecha e a lista mostra só quem está ativo */
const avisoInativo = (v, oQue) => v > 0.005 ? `<span class="nota">O total inclui ${brl(v)} ${oQue} de RCA inativo (fora da lista).</span>` : '';
const ehRca = () => D && D.tipo === 'rca';
const ehGerente = () => conta && conta.tipo === 'gerente';
const naCarteira = c => ehRca() ? c.rca === D.codusur : c.sup === D.setor.cod;
const carteiraAtiva = c => (c.ult != null && c.ult >= D.hoje - 180) || (c.cad != null && c.cad >= D.hoje - 90);

function resumoNf(list) {
  let vl = 0, cmv = 0; const cl = new Set(), pd = new Set();
  for (const o of list) { vl += o.vl; cmv += o.cmv; if (o.vl > 0) { cl.add(o.cli); pd.add(o.ped); } }
  return { vl, cmv, mg: vl ? (vl - cmv) / vl : 0, ped: pd.size, pos: cl.size, tk: pd.size ? vl / pd.size : 0 };
}
function resumoPed(list) {
  let vl = 0; const cl = new Set();
  for (const o of list) { vl += o.vl; cl.add(o.cli); }
  return { vl, ped: list.length, pos: cl.size, tk: list.length ? vl / list.length : 0 };
}
function periodo(chave) {
  const H = D.hoje, m0 = mesDe(H);
  let r;
  if (chave === 'hoje') r = [H, H];
  else if (chave === 'semana') r = [H - ((dow(H) + 6) % 7), H];
  else if (chave === 'mes') r = [m0, H];
  else if (chave === 'ant') r = [mesSeg(m0, -1), m0 - 1];
  else if (chave === '3m') r = [mesSeg(m0, -2), H];
  else r = [H, H];
  return [Math.max(D.ini, r[0]), r[1]];
}
const mesesDoPeriodo = chave => { const m0 = mesDe(D.hoje); return chave === 'ant' ? [mesSeg(m0, -1)] : chave === '3m' ? [mesSeg(m0, -2), mesSeg(m0, -1), m0] : [m0]; };

/* ---------------- peças de interface ---------------- */
const seg = (act, atual, ops) => '<div class="seg" role="group">' + ops.map(([v, l]) => `<button type="button" data-a="${act}" data-v="${v}" aria-pressed="${String(v) === String(atual)}">${l}</button>`).join('') + '</div>';
const chips = (act, atual, ops, cls) => `<div class="chips${cls ? ' ' + cls : ''}" role="group">` + ops.map(([v, l]) => `<button type="button" class="chip" data-a="${act}" data-v="${v}" aria-pressed="${v === atual}">${l}</button>`).join('') + '</div>';
/* filtros em pílula: uma linha só, que desliza para o lado quando não cabe */
function pilSel(id, rotulo, atual, ops) {
  return `<label class="pil" for="${id}"><span>${rotulo}</span><select id="${id}">${ops.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(atual) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
}
const pilData = (id, rotulo, d) => `<label class="pil" for="${id}"><span>${rotulo}</span><input type="date" id="${id}" value="${iso(d)}" min="${iso(D.ini)}" max="${iso(D.hoje)}"></label>`;
function pilRca(id, atual) {
  if (ehRca()) return '';
  return pilSel(id, 'RCA', atual, [[0, 'Todos'], ...D.ativos.map(r => [r.cod, r.cod + ' · ' + r.nome])]);
}
const KIC = {
  cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.6-3.4 3-5.2 6-5.2s5.4 1.8 6 5.2"/><path d="M16 4.6a3 3 0 0 1 0 6M18 14.6c1.8.7 2.9 2.4 3.2 5.4"/>',
  cart: '<path d="M3 4h2.2l2.2 11h10.4l2-8H6.3"/><circle cx="9.5" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  percent: '<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.4"/><circle cx="17" cy="17" r="2.4"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17.2v.1"/>',
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  ret: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.8 3.6-6 7-6s6.2 2.2 7 6"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  shield: '<path d="M12 3 4.5 6v6c0 4.4 3.2 7.8 7.5 9 4.3-1.2 7.5-4.6 7.5-9V6z"/>',
  wallet: '<path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4z"/><path d="M4 7V5.5A1.5 1.5 0 0 1 5.5 4H16v3M16 13.5h.1"/>',
  repeat: '<path d="M17 3l3 3-3 3"/><path d="M4 12V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3"/><path d="M20 12v3a3 3 0 0 1-3 3H4"/>',
  truck: '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>',
};
const KMAP = { 'Venda': 'cash', 'Digitado': 'cart', 'Faturado': 'truck', 'Positivação': 'users', 'Pedidos': 'receipt', 'Ticket médio': 'receipt', 'Margem': 'percent', 'Vencido': 'alert', 'Títulos': 'doc', 'Clientes': 'users', 'Bloqueados': 'lock', 'A vencer': 'cal', 'Devolvido': 'ret', 'Devoluções': 'ret', 'Resp. do RCA': 'user', 'Prazo': 'cal', 'Limite de crédito': 'shield', 'Limite': 'shield', 'Em aberto': 'doc', 'Disponível': 'wallet', 'Última': 'cal', 'Frequência': 'repeat' };
const IC2 = {
  back: '<path d="M15 4.5 7.5 12l7.5 7.5"/>',
  frente: '<path d="m9 5 7 7-7 7"/>',
  busca: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.6-4.6"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  baixo: '<path d="m6 9 6 6 6-6"/>',
  mais: '<path d="M12 5v14M5 12h14"/>',
  copiar: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
};
const ic = (n, cls) => `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${IC2[n] || KIC[n] || ''}</svg>`;
const kpi = (l, v, d, cls) => {
  const icn = KIC[KMAP[l] || (l.startsWith('Classe') ? 'layers' : 'cash')];
  const zero = /^(R\$ )?0(%)?$/.test(String(v).replace(/<[^>]+>/g, '')) ? ' zero' : '';
  return `<div class="kpi ${cls || ''}${zero}"><span class="l"><svg viewBox="0 0 24 24" aria-hidden="true">${icn}</svg><span>${l}</span></span><span class="v">${v}</span>${d ? `<span class="d">${d}</span>` : ''}</div>`;
};
const bar = (frac, cls) => `<div class="bar ${cls || ''}"><i style="width:${Math.max(0, Math.min(100, (frac || 0) * 100)).toFixed(1)}%"></i></div>`;
const vazio = t => `<div class="empty">${t}</div>`;
function anel(fr) {
  const C = 2 * Math.PI * 19, v = Math.max(0, Math.min(1, fr || 0));
  return `<svg class="anel" viewBox="0 0 46 46" aria-hidden="true"><circle cx="23" cy="23" r="19" class="trilho"/><circle cx="23" cy="23" r="19" class="valor" style="stroke-dasharray:${(C * v).toFixed(1)} ${C.toFixed(1)}"/></svg>`;
}
/* lista resumida: as primeiras linhas e "Ver todos", que abre a lista inteira numa tela por cima */
function limitar(rows, lim, id, tit, rodapeTodo, total) {
  if (LISTA_TODA === id) return rows.join('') + (rodapeTodo || '');
  if (rows.length <= lim) return rows.join('');
  return rows.slice(0, lim).join('') + `<button type="button" class="row ver-todos" data-a="lista" data-v="${id}" data-t="${esc(tit)}"><span class="t">Ver todos</span><span class="r"><span>${nf0.format(total || rows.length)}</span>${ic('frente')}</span></button>`;
}

function graficoDias(d1, d2, fonte, rca, destaque) {
  const dias = []; for (let d = d1; d <= d2; d++) if (dow(d) !== 0) dias.push(d);
  if (dias.length < 2) return '';
  const idx = new Map(dias.map((d, i) => [d, i])), vals = dias.map(() => 0);
  for (const o of (fonte === 'dig' ? D.ped : D.nf)) { if (rca && o.rca !== rca) continue; const i = idx.get(o.d); if (i !== undefined) vals[i] += o.vl; }
  const max = Math.max(1, ...vals), W = 400, H = 130, T = 22, B = 18, bw = W / dias.length, rotulos = dias.length <= 8;
  let r = `<svg class="ch" viewBox="0 0 ${W} ${H}" role="img" aria-label="Venda ${fonte === 'dig' ? 'digitada' : 'faturada'} por dia">`;
  r += `<line class="g" x1="0" x2="${W}" y1="${T}" y2="${T}"/><line class="g" x1="0" x2="${W}" y1="${H - B}" y2="${H - B}"/>`;
  if (!rotulos) r += `<text x="0" y="${T - 6}">${brlK(max)}</text>`;
  vals.forEach((v, i) => {
    if (!v) return;
    const h = v / max * (H - T - B), x = i * bw + bw * .15, w = Math.max(1, bw * .7);
    r += `<rect class="${dias[i] === destaque ? 'hl' : 'b'}" x="${x.toFixed(1)}" y="${(H - B - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" style="--i:${i}"><title>${diaLongo(dias[i])}: ${brl2(v)}</title></rect>`;
    if (rotulos) r += `<text x="${(x + w / 2).toFixed(1)}" y="${(H - B - h - 4).toFixed(1)}" text-anchor="middle">${brlK(v)}</text>`;
  });
  r += `<text x="0" y="${H - 4}">${dm(dias[0])}</text><text x="${W}" y="${H - 4}" text-anchor="end">${dm(dias[dias.length - 1])}</text></svg>`;
  return r;
}
/* barrinhas do mês no Resumo (sem números: o número grande já está em cima) */
function miniBarras(d1, d2) {
  const dias = []; for (let d = d1; d <= d2; d++) if (dow(d) !== 0) dias.push(d);
  if (dias.length < 2) return '';
  const idx = new Map(dias.map((d, i) => [d, i])), vals = dias.map(() => 0);
  for (const o of D.nf) { const i = idx.get(o.d); if (i !== undefined) vals[i] += o.vl; }
  const max = Math.max(1, ...vals), W = 300, H = 38, bw = W / dias.length;
  return `<svg class="mini" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">` + vals.map((v, i) => v > 0
    ? `<rect x="${(i * bw + bw * .18).toFixed(1)}" y="${(H - v / max * H).toFixed(1)}" width="${Math.max(1, bw * .64).toFixed(1)}" height="${(v / max * H).toFixed(1)}" rx="1.4"${i === dias.length - 1 ? ' class="hl"' : ''} style="--i:${i}"/>` : '').join('') + '</svg>';
}

/* ---------------- aba: resumo (o dia numa tela só) ---------------- */
function vResumo() {
  const H = D.hoje, m0 = mesDe(H);
  const hj = resumoPed(D.ped.filter(o => o.d === H)), ant = resumoPed(D.ped.filter(o => o.d === H - 7));
  const fh = resumoNf(D.nf.filter(o => o.d === H));
  const dl = ant.vl ? hj.vl / ant.vl - 1 : null;
  const mes = resumoNf(D.nf.filter(o => o.d >= m0 && o.d <= H));
  // mês anterior com o mesmo número de dias corridos (comparação justa)
  const a0 = mesSeg(m0, -1), a1 = Math.min(m0 - 1, a0 + (H - m0));
  const mAnt = a0 >= D.ini ? resumoNf(D.nf.filter(o => o.d >= a0 && o.d <= a1)) : null;
  const dMes = mAnt && mAnt.vl ? mes.vl / mAnt.vl - 1 : null;
  const cart = D.cli.filter(c => naCarteira(c) && carteiraAtiva(c));
  const comprou = new Set(); for (const o of D.nf) if (o.d >= m0 && o.vl > 0) comprou.add(o.cli);
  const pos = cart.filter(c => comprou.has(c.cod)).length, fp = cart.length ? pos / cart.length : 0;
  const venc = D.tit.filter(t => t.grupo === 'cobranca' && t.venc < H), vt = soma(venc, t => t.valor), vc = new Set(venc.map(t => t.cli)).size;
  const devM = soma(D.dev.filter(x => x.d >= m0 && x.d <= H), x => x.v);
  const pf = new Map(); let totI = 0;
  for (const it of D.item) if (it.mes === m0) { pf.set(it.cli, (pf.get(it.cli) || 0) + it.v); totI += it.v; }
  const rk = [...pf.entries()].sort((a, b) => b[1] - a[1]); let acc = 0, nA = 0;
  for (const [, v] of rk) { if (acc < .8) nA++; acc += v / (totI || 1); }
  const lider = rk[0];
  // RCA ativo (vendeu nos últimos 30 dias) que ainda não digitou hoje
  const semPed = !ehRca() && dow(H) !== 0
    ? D.rcas.filter(r => r.ativo && D.nf.some(o => o.rca === r.cod && o.d >= H - 30) && !D.ped.some(o => o.d === H && o.rca === r.cod)).length : 0;
  const delta = (v, txt) => v == null ? '' : `<span class="delta ${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '▲' : '▼'} ${pct(Math.abs(v), 0)}</span> ${txt}`;
  return `
  <div class="resumo">
    <button type="button" class="hoje-card" data-a="ir" data-v="vendas:hoje">
      <span class="cartao-rot">${ic('cart')}Digitado hoje <small>até ${hm(D.cargas.pedido)}</small>${ic('frente', 'seta')}</span>
      <span class="valor-grande" data-cnt="${hj.vl}" data-f="brlK">${brlK(hj.vl)}</span>
      <span class="sub">${dl != null ? delta(dl, 'vs. ' + diaLongo(H - 7)) : 'sem pedido em ' + diaLongo(H - 7) + ' para comparar'}</span>
      <span class="trio">
        <span><small>Faturado</small><b data-cnt="${fh.vl}" data-f="brlK">${brlK(fh.vl)}</b></span>
        <span><small>Pedidos</small><b data-cnt="${hj.ped}" data-f="n">${nf0.format(hj.ped)}</b></span>
        <span><small>Clientes</small><b data-cnt="${hj.pos}" data-f="n">${nf0.format(hj.pos)}</b></span>
      </span>
      ${semPed ? `<span class="alerta">${semPed} ${semPed > 1 ? 'RCAs ativos sem pedido' : 'RCA ativo sem pedido'} hoje</span>` : ''}
    </button>
    <button type="button" class="mes-card" data-a="ir" data-v="vendas:periodo">
      <span class="cartao-rot">${ic('cash')}Faturado em ${MESES_L[dt(H).getUTCMonth()]} <small>até ${dm(H)}</small>${ic('frente', 'seta')}</span>
      <span class="linha-valor"><span class="valor-grande" data-cnt="${mes.vl}" data-f="brlK">${brlK(mes.vl)}</span><span class="pill">margem ${pct(mes.mg)}</span></span>
      <span class="sub">${dMes != null ? delta(dMes, 'vs. ' + MESES[dt(a0).getUTCMonth()] + ' no mesmo período') : nf0.format(mes.pos) + ' clientes faturados'}</span>
      ${miniBarras(m0, H)}
    </button>
    <div class="tiles">
      <button type="button" class="tile ouro" data-a="ir" data-v="carteira:pos">${anel(fp)}<span class="cartao-rot">${ic('users')}Carteira</span><span class="v" data-cnt="${fp}" data-f="pct0">${pct(fp, 0)}</span><span class="d">${nf0.format(pos)} de ${nf0.format(cart.length)} compraram no mês</span></button>
      <button type="button" class="tile perigo" data-a="ir" data-v="inad:resumo"><span class="cartao-rot">${ic('alert')}Vencido</span><span class="v" data-cnt="${vt}" data-f="brlK">${brlK(vt)}</span><span class="d">${nf0.format(vc)} ${vc === 1 ? 'cliente' : 'clientes'} com título vencido</span></button>
      <button type="button" class="tile atencao" data-a="ir" data-v="dev:resumo"><span class="cartao-rot">${ic('ret')}Devolução</span><span class="v">${pct(mes.vl ? devM / mes.vl : 0)}</span><span class="d">${brlK(devM)} devolvidos no mês</span></button>
      <button type="button" class="tile" data-a="ir" data-v="abc:cli"><span class="cartao-rot">${ic('layers')}Maior cliente</span><span class="v txt">${lider ? esc(cliNome(lider[0])) : '—'}</span><span class="d">${lider ? brlK(lider[1]) + ' · ' + nA + ' ' + (nA === 1 ? 'cliente' : 'clientes') + ' na classe A' : 'sem venda no mês'}</span></button>
    </div>
  </div>`;
}

/* ---------------- aba: vendas ---------------- */
function vVendas() {
  const V = S.v, H = D.hoje;
  if (V.dia == null || V.dia > H || V.dia < D.ini) V.dia = H;
  if (V.de == null) { const p = periodo(V.q || 'mes'); V.de = p[0]; V.ate = p[1]; }
  const rca = ehRca() ? 0 : V.rca, f = o => !rca || o.rca === rca;
  const linhasRca = () => D.ativos.map(r => ({
    r, dd: resumoPed(D.ped.filter(o => o.d === V.dia && o.rca === r.cod)), df: resumoNf(D.nf.filter(o => o.d === V.dia && o.rca === r.cod)),
    p: resumoNf(D.nf.filter(o => o.d >= V.de && o.d <= V.ate && o.rca === r.cod)),
  })).sort((a, b) => b.p.vl - a.p.vl);

  const dia = () => {
    const pd = resumoPed(D.ped.filter(o => o.d === V.dia && f(o))), pa = resumoPed(D.ped.filter(o => o.d === V.dia - 7 && f(o)));
    const fd = resumoNf(D.nf.filter(o => o.d === V.dia && f(o)));
    const delta = pa.vl ? pd.vl / pa.vl - 1 : 0;
    const dTxt = pa.vl ? `<span class="delta ${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '▲' : '▼'} ${pct(Math.abs(delta), 0)}</span> vs. ${diaLongo(V.dia - 7)} (${brlK(pa.vl)})` : (V.dia - 7 >= D.ini ? `sem pedido em ${diaLongo(V.dia - 7)}` : '');
    const parcial = V.dia === H ? ` · até ${hm(D.cargas.pedido)}` : '';
    const sem = !ehRca() && !rca && V.dia === H && dow(H) !== 0 ? linhasRca().filter(x => x.r.ativo && !x.dd.ped && x.p.vl).length : 0;
    return `
    <div class="pilulas">${pilRca('v-rca', rca)}${pilData('v-dia', 'Dia', V.dia)}</div>
    <div class="h">Venda do dia <small>${diaLongo(V.dia)}${parcial}</small></div>
    <div class="kpis k2">${kpi('Digitado', brlK(pd.vl), dTxt, 'hero')}${kpi('Faturado', brlK(fd.vl), fd.vl ? 'margem ' + pct(fd.mg) : 'notas do dia')}${kpi('Pedidos', nf0.format(pd.ped), 'digitados')}${kpi('Positivação', nf0.format(pd.pos), 'clientes com pedido')}${kpi('Ticket médio', brlK(pd.tk), 'por pedido')}</div>
    ${sem ? `<button type="button" class="faixa toque" data-a="pag" data-v="rcas">${sem} ${sem > 1 ? 'RCAs ativos ainda sem pedido' : 'RCA ativo ainda sem pedido'} hoje${ic('frente', 'seta')}</button>` : ''}`;
  };
  const periodoPag = () => {
    const per = resumoNf(D.nf.filter(o => o.d >= V.de && o.d <= V.ate && f(o)));
    const pp = resumoPed(D.ped.filter(o => o.d >= V.de && o.d <= V.ate && f(o)));
    return `
    ${chips('v-q', V.q, [['hoje', 'Hoje'], ['semana', 'Semana'], ['mes', 'Mês'], ['ant', 'Mês anterior'], ['3m', '3 meses'], ['', 'Escolher datas']], 'rola')}
    ${V.q === '' ? `<div class="pilulas">${pilData('v-de', 'De', V.de)}${pilData('v-ate', 'Até', V.ate)}</div>` : ''}
    <div class="h">Acumulado <small>${dmy(V.de)} a ${dmy(V.ate)}${rca ? ' · ' + esc(rcaNome(rca)) : ''}</small></div>
    <div class="kpis k2">${kpi('Venda', brlK(per.vl), 'faturada', 'hero')}${kpi('Margem', pct(per.mg), brlK(per.vl - per.cmv) + ' de lucro bruto')}${kpi('Digitado', brlK(pp.vl), nf0.format(pp.ped) + ' pedidos')}${kpi('Positivação', nf0.format(per.pos), 'clientes faturados')}${kpi('Ticket médio', brlK(per.tk), nf0.format(per.ped) + ' pedidos faturados')}</div>
    ${seg('v-graf', V.graf, [['fat', 'Faturado por dia'], ['dig', 'Digitado por dia']])}
    <div class="card">${graficoDias(V.de, V.ate, V.graf, rca, V.dia) || '<span class="muted">Escolha um período com mais de um dia para ver a venda diária.</span>'}</div>`;
  };
  const rcasPag = () => {
    const ls = linhasRca(), tot = ls.reduce((a, x) => a + x.p.vl, 0) || 1;
    const rows = ls.map(({ r, dd, df, p }) => `
      <button type="button" class="row${r.cod === rca ? ' sel' : ''}" data-a="v-rca" data-v="${r.cod === rca ? 0 : r.cod}">
        <span class="t">${esc(r.nome)} <span class="code">${r.cod}</span></span>
        <span class="r">${brlK(p.vl)}</span>
        <span class="sub">Dia: digitado ${brlK(dd.vl)} · faturado ${brlK(df.vl)} · ${dd.ped} ped. ${V.dia === H && !dd.ped && r.ativo ? '<span class="pill warn">sem pedido hoje</span>' : ''}</span>
        <span class="sub r"><span class="pill ${p.vl && p.mg < .12 ? 'warn' : ''}">margem ${pct(p.mg)}</span></span>
        <span class="sub full">${p.pos} clientes positivados · ${p.ped} pedidos faturados no período</span>
        <span class="full">${bar(p.vl / tot)}</span>
      </button>`);
    return `<div class="h">Por RCA <small>dia ${dm(V.dia)} · período ${dm(V.de)} a ${dm(V.ate)}</small></div>
      <div class="list" data-lista="v-rcas">${rows.length ? limitar(rows, 5, 'v-rcas', 'Venda por RCA') : vazio('Nenhum RCA ativo no setor.')}</div>
      ${avisoInativo(soma(D.nf.filter(o => o.d >= V.de && o.d <= V.ate && !rcaAtivo(o.rca)), o => o.vl), 'de venda faturada no período')}
      <div class="nota">Toque num RCA para ver a venda só dele.</div>`;
  };
  const setoresPag = () => {
    const i0 = R.meses.length - 1, ls = R.setores.map(s => ({ s, v: s.venda[i0], c: s.cmv[i0], pos: s.pos[i0] })).sort((a, b) => b.v - a.v);
    const mx = ls.length ? ls[0].v || 1 : 1;
    const rows = ls.map(x => `
      <button type="button" class="row${x.s.cod === D.setor.cod ? ' sel' : ''}" data-a="setor" data-v="${x.s.cod}">
        <span class="t">${esc(x.s.nome)}</span><span class="r">${brlK(x.v)}</span>
        <span class="sub">${nf0.format(x.pos)} clientes positivados</span><span class="sub r"><span class="pill">margem ${pct(x.v ? (x.v - x.c) / x.v : 0)}</span></span>
        <span class="full">${bar(x.v / mx, 'gold')}</span>
      </button>`);
    return `<div class="h">Por setor <small>${nomeMes(R.meses[i0])} · toque para abrir</small></div><div class="list" data-lista="v-setores">${limitar(rows, 6, 'v-setores', 'Venda por setor')}</div>`;
  };
  return { pags: [['hoje', 'Dia', dia], ['periodo', 'Período', periodoPag], !ehRca() && ['rcas', 'RCAs', rcasPag], ehGerente() && R && ['setores', 'Setores', setoresPag]] };
}

/* ---------------- aba: carteira ---------------- */
function vCarteira() {
  const C = S.c, H = D.hoje, m0 = mesDe(H);
  const meses = []; for (let m = m0; m >= mesDe(D.ini); m = mesSeg(m, -1)) meses.push(m);
  if (C.mes == null || !meses.includes(C.mes)) C.mes = m0;
  const d1 = C.mes, d2 = Math.min(H, mesSeg(C.mes, 1) - 1);
  const rca = ehRca() ? D.codusur : C.rca;
  const cart = D.cli.filter(c => naCarteira(c) && carteiraAtiva(c) && (!rca || c.rca === rca));
  const cartSet = new Set(cart.map(c => c.cod));
  const vendas = new Map();
  for (const o of D.nf) {
    if (o.d < d1 || o.d > d2 || o.vl <= 0 || (rca && o.rca !== rca)) continue;
    const x = vendas.get(o.cli) || { vl: 0, n: new Set() }; x.vl += o.vl; x.n.add(o.ped); vendas.set(o.cli, x);
  }
  const potIni = mesSeg(d1, -3), temPot = potIni >= D.ini;
  const pot = new Map(), ult = new Map();
  for (const o of D.nf) {
    if (o.vl <= 0 || (rca && o.rca !== rca)) continue;
    if (o.d >= potIni && o.d < d1) pot.set(o.cli, (pot.get(o.cli) || 0) + o.vl);
    if (o.d <= d2 && (!ult.has(o.cli) || ult.get(o.cli) < o.d)) ult.set(o.cli, o.d);
  }
  const ultima = c => { const u = ult.get(c.cod); return u != null ? u : (c.ult != null && c.ult <= d2 ? c.ult : null); };
  const baseTodos = [...cart, ...[...vendas.keys()].filter(k => !cartSet.has(k)).map(k => D.CMAP.get(k) || { cod: k, fantasia: 'Cliente ' + k, cidade: '', bairro: '' })];
  const noLugar = c => (!C.cid || c.cidade === C.cid) && (!C.bai || c.bairro === C.bai);
  const cidades = [...new Set(baseTodos.map(c => c.cidade).filter(Boolean))].sort();
  const bairros = C.cid ? [...new Set(baseTodos.filter(c => c.cidade === C.cid).map(c => c.bairro).filter(Boolean))].sort() : [];
  const cartF = cart.filter(noLugar);
  const pos = cartF.filter(c => vendas.has(c.cod)).length, fr = cartF.length ? pos / cartF.length : 0;
  const comp = baseTodos.filter(c => vendas.has(c.cod) && noLugar(c)).map(c => ({ c, vl: vendas.get(c.cod).vl, n: vendas.get(c.cod).n.size, fora: !cartSet.has(c.cod) })).sort((a, b) => b.vl - a.vl);
  const nao = cartF.filter(c => !vendas.has(c.cod)).map(c => ({ c, pot: temPot ? (pot.get(c.cod) || 0) / 3 : null, ult: ultima(c) })).sort((a, b) => (b.pot || 0) - (a.pot || 0) || (b.ult || 0) - (a.ult || 0));
  const fora = comp.filter(x => x.fora).length;
  const chave = C.cid ? 'bairro' : 'cidade', grupos = new Map();
  for (const c of cartF) { const k = c[chave] || '(sem ' + chave + ')', g = grupos.get(k) || { t: 0, c: 0 }; g.t++; if (vendas.has(c.cod)) g.c++; grupos.set(k, g); }
  const gl = [...grupos.entries()].sort((a, b) => b[1].t - a[1].t);
  const topo = `<div class="pilulas">
    ${pilSel('c-mes', 'Mês', C.mes, meses.map(m => [m, nomeMes(m) + (m === m0 ? ' (até hoje)' : '')]))}
    ${ehRca() ? '' : pilRca('c-rca', C.rca)}
    ${pilSel('c-cid', 'Cidade', C.cid, [['', 'Todas'], ...cidades.map(c => [c, titulo(c)])])}
    ${C.cid ? pilSel('c-bai', 'Bairro', C.bai, [['', 'Todos'], ...bairros.map(b => [b, titulo(b)])]) : ''}
  </div>`;
  const posPag = () => `
    <div class="card pos-card">${anel(fr)}
      <div><div class="cartao-rot">Positivação no mês</div><div class="big">${pct(fr, 0)}</div><div class="sub">${nf0.format(pos)} de ${nf0.format(cartF.length)} clientes da carteira compraram</div></div>
    </div>
    <span class="nota">Carteira ativa: clientes ${ehRca() ? 'da sua rota' : 'dos RCAs do setor'} com compra nos últimos 180 dias.${fora ? ` Mais ${fora} ${fora > 1 ? 'clientes de fora da carteira compraram' : 'cliente de fora da carteira comprou'}.` : ''}</span>
    <div class="h">Por ${chave} <small>toque para filtrar</small></div>
    <div class="list" data-lista="c-lugar">${gl.length ? limitar(gl.map(([k, g]) => `
      <button type="button" class="row" data-a="${chave === 'cidade' ? 'c-cid' : 'c-bai'}" data-v="${esc(k)}">
        <span class="t">${esc(titulo(k))}</span><span class="r">${g.c}/${g.t} · ${pct(g.c / g.t, 0)}</span>
        <span class="full">${bar(g.c / g.t)}</span>
      </button>`), 4, 'c-lugar', 'Positivação por ' + chave) : vazio('Nenhum cliente neste filtro.')}</div>`;
  const linhaComp = x => `
      <button type="button" class="row" data-a="cli" data-v="${x.c.cod}">
        <span class="t">${esc(x.c.fantasia)} <span class="code">${x.c.cod}</span></span>
        <span class="r">${brl(x.vl)}</span>
        <span class="sub">${esc(titulo(x.c.bairro))}${x.c.bairro ? ' · ' : ''}${esc(titulo(x.c.cidade))}${rca || ehRca() ? '' : ' · ' + esc(rcaNome(x.c.rca))}</span>
        <span class="sub r">${x.n + (x.n > 1 ? ' pedidos' : ' pedido') + (x.fora ? ' <span class="pill">fora da carteira</span>' : '')}</span>
      </button>`;
  const linhaNao = x => `
      <button type="button" class="row" data-a="cli" data-v="${x.c.cod}">
        <span class="t">${esc(x.c.fantasia)} <span class="code">${x.c.cod}</span></span>
        <span class="r">${x.pot ? brl(x.pot) + '/mês' : '—'}</span>
        <span class="sub">${esc(titulo(x.c.bairro))}${x.c.bairro ? ' · ' : ''}${esc(titulo(x.c.cidade))}${rca || ehRca() ? '' : ' · ' + esc(rcaNome(x.c.rca))}</span>
        <span class="sub r">${x.ult != null ? `última ${dm(x.ult)} <span class="pill ${d2 - x.ult > 60 ? 'bad' : 'warn'}">${d2 - x.ult} dias</span>` : 'sem compras'}</span>
      </button>`;
  const mais300 = (n, oQue) => n > 300 ? vazio(`Mostrando 300 de ${nf0.format(n)} ${oQue}. Filtre por cidade ou RCA para ver o resto.`) : '';
  const compPag = () => `<div class="h">Compraram em ${nomeMes(C.mes)} <small>ordem de valor</small></div>
    <div class="list" data-lista="c-comp">${comp.length ? limitar(comp.slice(0, 300).map(linhaComp), 5, 'c-comp', 'Compraram em ' + nomeMes(C.mes), mais300(comp.length, 'compradores'), comp.length) : vazio('Nenhum cliente neste filtro.')}</div>`;
  const naoPag = () => `<div class="h">Não compraram <small>${temPot ? 'maior potencial primeiro' : 'compra mais recente primeiro'}</small></div>
    <div class="list" data-lista="c-nao">${nao.length ? limitar(nao.slice(0, 300).map(linhaNao), 5, 'c-nao', 'Não compraram em ' + nomeMes(C.mes), mais300(nao.length, 'clientes'), nao.length) : vazio('Todos os clientes da carteira compraram. 👏')}</div>
    ${!temPot ? '<span class="nota">O potencial (média dos 3 meses anteriores) não aparece no mês mais antigo: o app guarda só os últimos 4 meses.</span>' : ''}`;
  return { topo, pags: [['pos', 'Positivação', posPag], ['comp', `Compram<span class="n">${nf0.format(comp.length)}</span>`, compPag], ['nao', `Não compram<span class="n">${nf0.format(nao.length)}</span>`, naoPag]] };
}

/* ---------------- tela: cliente (abre por cima, como no iPhone) ---------------- */
const ICA = {
  fone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  zap: '<path d="M4 20l1.3-4A8 8 0 1 1 8 18.7z"/><path d="M9 9.5c.3 2 2.2 4.2 4.5 4.9l1.2-1.1 1.8.8-.3 1.6c-3.8.4-7.6-3.3-7.3-7.2l1.5-.4.9 1.8z"/>',
  mapa: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
};
/* telefone do WinThor: com DDD (10-11 dígitos) vale para ligar e WhatsApp; sem DDD (8-9) só para ligar */
function telDigitos(s, min) { const d = String(s || '').replace(/\D/g, '').replace(/^0+/, '').replace(/^55(?=\d{10,11}$)/, ''); return d.length >= (min || 10) && d.length <= 11 ? d : ''; }
function telaCliente(cod) {
  const H = D.hoje, c = D.CMAP.get(cod);
  if (!c) return { titulo: 'Cliente ' + cod, html: `<div class="msg">O cliente ${esc(cod)} não faz parte da sua base${ehRca() ? ' (sua rota)' : ' (sua região)'}, ou não compra há mais de um ano. Confira o código.</div>` };
  const nfs = D.nf.filter(o => o.cli === c.cod && o.vl > 0);
  const porPed = new Map(); for (const o of nfs) { const x = porPed.get(o.ped) || { d: o.d, vl: 0, cmv: 0 }; x.vl += o.vl; x.cmv += o.cmv; x.d = Math.max(x.d, o.d); porPed.set(o.ped, x); }
  const peds = [...porPed.entries()].map(([num, x]) => ({ num, ...x })).sort((a, b) => a.d - b.d);
  const datas = [...new Set(peds.map(p => p.d))].sort((a, b) => a - b);
  const ultD = datas.length ? datas[datas.length - 1] : (c.ult != null ? c.ult : null);
  const dias = ultD != null ? H - ultD : null;
  const gaps = datas.slice(1).map((d, i) => d - datas[i]), freq = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
  const v90 = peds.filter(p => p.d > H - 90);
  const abertos = D.tit.filter(t => t.cli === c.cod && t.grupo === 'cobranca'), venc = abertos.filter(t => t.venc < H);
  const outros = D.tit.filter(t => t.cli === c.cod && t.grupo !== 'cobranca');
  const emAberto = soma(abertos, t => t.valor), vencido = soma(venc, t => t.valor), disp = c.limite - emAberto;
  const pills = [];
  if (c.bloq) pills.push('<span class="pill bad">Bloqueado no WinThor</span>');
  if (vencido > 0) pills.push(`<span class="pill bad">${brl(vencido)} vencidos</span>`);
  if (dias === null || dias > 45) pills.push(`<span class="pill warn">${dias === null ? 'Sem compra registrada' : 'Sem comprar há ' + dias + ' dias'}</span>`);
  if (!pills.length) pills.push('<span class="pill good">Ativo</span>');
  const fone = telDigitos(c.cel, 8) || telDigitos(c.fone, 8), zap = telDigitos(c.cel) || telDigitos(c.fone);
  const ligar = fone ? 'tel:' + (fone.length >= 10 ? '+55' : '') + fone : '#';
  const ender = [c.end, c.bairro, c.cidade].filter(Boolean).join(', ');
  const emAbertoDig = D.ped.filter(o => o.cli === c.cod && o.pos !== 'F').sort((a, b) => b.d - a.d);
  const porF = new Map(), porP = new Map();
  for (const it of D.item) {
    if (it.cli !== c.cod) continue;
    const fo = fornDe(it.p), fx = porF.get(fo) || { ult: 0, v90: 0, prods: new Set() };
    fx.ult = Math.max(fx.ult, it.ult || 0); if (it.ult > H - 90) { fx.v90 += it.v; fx.prods.add(it.p); } porF.set(fo, fx);
    const p = porP.get(it.p); if (!p || (it.ult || 0) > p.d) porP.set(it.p, { d: it.ult || 0, q: it.q, pu: it.q ? it.v / it.q : 0 });
  }
  const lf = [...porF.entries()].sort((a, b) => b[1].ult - a[1].ult || b[1].v90 - a[1].v90);
  const lp = [...porP.entries()].sort((a, b) => b[1].d - a[1].d).slice(0, 25);

  const topo = `
  <div class="acoes">
    <a class="acao" href="${ligar}" aria-disabled="${!fone}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICA.fone}</svg>Ligar</a>
    <a class="acao" href="${zap ? 'https://wa.me/55' + zap : '#'}" target="_blank" rel="noopener" aria-disabled="${!zap}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICA.zap}</svg>WhatsApp</a>
    <a class="acao" href="${ender ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(ender) : '#'}" target="_blank" rel="noopener" aria-disabled="${!ender}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICA.mapa}</svg>Mapa</a>
  </div>`;
  const pResumo = () => `
    <div class="kpis k2">
      ${kpi('Prazo', esc(c.plano || '—'), c.prazo != null ? c.prazo + ' dias' : '')}
      ${kpi('Limite', brl(c.limite), 'de crédito')}
      ${kpi('Em aberto', brl(emAberto), abertos.length + (abertos.length === 1 ? ' título' : ' títulos'))}
      ${kpi('Disponível', `<span class="${disp < 0 ? 'down' : ''}">${brl(disp)}</span>`, '')}
    </div>
    ${bar(c.limite ? emAberto / c.limite : 0, emAberto > c.limite ? 'bad' : '')}
    ${vencido ? `<button type="button" class="msg bad toque" data-a="pag" data-v="titulos">${brl(vencido)} vencidos em ${venc.length} ${venc.length > 1 ? 'títulos' : 'título'} · maior atraso ${Math.max(...venc.map(t => H - t.venc))} dias${ic('frente', 'seta')}</button>` : ''}
    <div class="card compras-card">
      <div class="cartao-rot">${ic('cal')}Compras</div>
      <div class="trio">
        <span><small>Última</small><b>${ultD != null ? dm(ultD) : '—'}</b><em>${dias !== null ? `há ${dias} dias` : ''}</em></span>
        <span><small>Frequência</small><b>${freq ? nf0.format(freq) + ' dias' : '—'}</b><em>entre compras</em></span>
        <span><small>Ticket</small><b>${peds.length ? brlK(soma(peds, p => p.vl) / peds.length) : '—'}</b><em>por pedido</em></span>
      </div>
      <div class="nota">${brl(soma(v90, p => p.vl))} em ${v90.length} ${v90.length === 1 ? 'pedido faturado' : 'pedidos faturados'} nos últimos 90 dias.</div>
    </div>`;
  const pTitulos = () => {
    const rows = abertos.slice().sort((a, b) => a.venc - b.venc).map(t => `
      <div class="row"><span class="t">Título ${t.dup}${t.prest ? '-' + esc(t.prest) : ''}</span><span class="r">${brl2(t.valor)}</span>
      <span class="sub">vence ${dmy(t.venc)} · ${esc(titulo(D.cob[t.cob] || t.cob || ''))}</span><span class="sub r">${t.venc < H ? `<span class="pill ${H - t.venc > 30 ? 'bad' : 'warn'}">${H - t.venc} dias</span>` : '<span class="pill">a vencer</span>'}</span></div>`);
    return `<div class="h">Títulos em aberto <small>${brl(emAberto)}</small></div>
      <div class="list" data-lista="k-tit">${rows.length ? limitar(rows, Math.max(6, venc.length), 'k-tit', 'Títulos de ' + c.fantasia) : vazio('Nenhum título em aberto. 👏')}</div>
      ${outros.length ? `<div class="faixa info">Fora da cobrança (jurídico, perdas ou crédito): ${brl(soma(outros, t => t.valor))} em ${outros.length} ${outros.length > 1 ? 'títulos' : 'título'}.</div>` : ''}`;
  };
  const pCompras = () => {
    let rows;
    if (S.k.modo === 'forn') rows = lf.map(([fo, x]) => `
      <div class="row"><span class="t">${esc(fornNome(fo))}</span><span class="r">${brl(x.v90)}</span>
      <span class="sub">última compra ${dm(x.ult)} · há ${H - x.ult} dias</span><span class="sub r">${x.prods.size} ${x.prods.size === 1 ? 'produto' : 'produtos'} em 90 d</span></div>`);
    else if (S.k.modo === 'prod') rows = lp.map(([p, x]) => `
      <div class="row"><span class="t">${esc(prodNome(p))}</span><span class="r">${dm(x.d)}</span>
      <span class="sub">${esc(fornNome(fornDe(p)))}</span><span class="sub r">${nf0.format(x.q)} un · ${brl2(x.pu)}</span></div>`);
    else rows = emAbertoDig.slice(0, 5).map(o => `
      <div class="row"><span class="t">Pedido ${o.num}</span><span class="r">${brl(o.vl)}</span>
      <span class="sub">${diaLongo(o.d)} · digitado</span><span class="sub r"><span class="pill warn">${({ L: 'liberado', B: 'bloqueado', M: 'montado', P: 'pendente' })[o.pos] || 'em aberto'}</span></span></div>`).concat(peds.slice(-10).reverse().map(o => `
      <div class="row"><span class="t">Pedido ${o.num}</span><span class="r">${brl(o.vl)}</span>
      <span class="sub">${diaLongo(o.d)} · faturado</span><span class="sub r">margem ${pct(o.vl ? (o.vl - o.cmv) / o.vl : 0)}</span></div>`));
    return `${chips('k-modo', S.k.modo, [['forn', 'Por fornecedor'], ['prod', 'Por produto'], ['ped', 'Pedidos']])}
      <div class="list" data-lista="k-${S.k.modo}">${rows.length ? limitar(rows, 6, 'k-' + S.k.modo, 'Compras de ' + c.fantasia) : vazio(S.k.modo === 'ped' ? 'Sem pedidos nos últimos meses.' : 'Sem compras nos últimos meses.')}</div>`;
  };
  const pDados = () => `
    <div class="card"><dl class="kv" style="margin:0">
      <div><dt>CNPJ / CPF</dt><dd class="sel-text">${esc(c.cnpj || '—')}</dd></div>
      <div><dt>Ramo</dt><dd>${esc(titulo(c.ramo) || '—')}</dd></div>
      <div class="w"><dt>Razão social</dt><dd>${esc(c.razao || '—')}</dd></div>
      <div class="w"><dt>Endereço de entrega</dt><dd>${esc(c.end || '—')}${c.bairro ? ' · ' + esc(titulo(c.bairro)) : ''}${c.cidade ? ' · ' + esc(titulo(c.cidade)) : ''}</dd></div>
      <div><dt>Telefone</dt><dd class="sel-text">${esc(c.cel || c.fone || '—')}</dd></div>
      <div><dt>RCA da carteira</dt><dd>${esc(rcaNome(c.rca))} ${c.rca ? `<span class="code">${c.rca}</span>` : ''}</dd></div>
    </dl></div>`;
  return {
    titulo: c.fantasia, sub: `<span class="code">${c.cod}</span> · ${esc(titulo(c.bairro))}${c.bairro ? ' · ' : ''}${esc(titulo(c.cidade))}`,
    extra: `<div class="pills-linha">${pills.join('')}</div>`, topo,
    pags: [['resumo', 'Resumo', pResumo], ['titulos', `Títulos${abertos.length ? `<span class="n">${abertos.length}</span>` : ''}`, pTitulos], ['compras', 'Compras', pCompras], ['dados', 'Dados', pDados]],
  };
}
/* tela de busca: o resultado muda a cada letra, sem redesenhar o campo (o teclado não fecha) */
function telaBusca() {
  return `<form id="fcli" class="busca-ios" role="search">${ic('busca')}<input id="codcli" type="search" enterkeyhint="search" autocomplete="off" placeholder="Código ou nome do cliente" value="${esc(S.k.raw)}" aria-label="Código ou nome do cliente"></form>
    <div id="busca-res">${resultadosBusca()}</div>`;
}
function resultadosBusca() {
  const q = semAcento(S.k.raw).trim(), H = D.hoje;
  if (q.length >= 2 || /^\d+$/.test(q)) {
    const ach = D.cli.filter(c => String(c.cod).startsWith(q) || semAcento(c.fantasia).includes(q) || semAcento(c.razao).includes(q)).slice(0, 40);
    const marca = s => { const t = String(s), i = semAcento(t).indexOf(q); return i < 0 ? esc(t) : esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + q.length)) + '</mark>' + esc(t.slice(i + q.length)); };
    return `<div class="h">Resultado <small>${ach.length >= 40 ? 'os 40 primeiros' : ach.length + (ach.length === 1 ? ' cliente' : ' clientes')}</small></div><div class="list">${ach.length ? ach.map(c => `<button type="button" class="row" data-a="cli" data-v="${c.cod}"><span class="t">${marca(c.fantasia)} <span class="code">${marca(c.cod)}</span></span><span class="r">${ic('frente')}</span><span class="sub full">${esc(titulo(c.bairro))}${c.bairro ? ' · ' : ''}${esc(titulo(c.cidade))}</span></button>`).join('') : vazio('Nenhum cliente da sua base com esse código ou nome.')}</div>`;
  }
  const m0 = mesDe(H), top = new Map();
  for (const o of D.nf) if (o.d >= m0 && o.vl > 0) top.set(o.cli, (top.get(o.cli) || 0) + o.vl);
  const maiores = [...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  return `<div class="h">Maiores compradores do mês</div><div class="list">${maiores.length ? maiores.map(([cod, v]) => { const c = D.CMAP.get(cod); return `<button type="button" class="row" data-a="cli" data-v="${cod}"><span class="t">${esc(cliNome(cod))} <span class="code">${cod}</span></span><span class="r">${brl(v)}</span><span class="sub full">${c ? esc(titulo(c.bairro)) + (c.bairro ? ' · ' : '') + esc(titulo(c.cidade)) : ''}</span></button>`; }).join('') : vazio('Sem compras no mês.')}</div>`;
}

/* ---------------- aba: curva ABC ---------------- */
/* 1.2 (Júlio): "os clientes de maior venda para o menor" e sem a opção de fornecedor */
function vAbc() {
  const A2 = S.a, meses = new Set(mesesDoPeriodo(A2.per)), modo = S.pag.abc === 'prod' ? 'prod' : 'cli';
  const rca = ehRca() ? D.codusur : A2.rca;
  const pag = () => {
    const m = new Map();
    for (const it of D.item) {
      if (!meses.has(it.mes) || (rca && it.rca !== rca)) continue;
      const k = modo === 'cli' ? it.cli : it.p;
      const x = m.get(k) || { v: 0, mg: 0, cl: new Set() }; x.v += it.v; x.mg += it.v - it.c; x.cl.add(modo === 'cli' ? it.p : it.cli); m.set(k, x);
    }
    const tot = [...m.values()].reduce((a, x) => a + x.v, 0) || 1;
    let acc = 0;
    const rows = [...m.entries()].sort((a, b) => b[1].v - a[1].v).map(([k, x]) => {
      const antes = acc; acc += x.v / tot;
      return { k, ...x, part: x.v / tot, acc, abc: antes < .8 ? 'A' : antes < .95 ? 'B' : 'C' };
    });
    const max = rows.length ? rows[0].v : 1;
    const base = D.cli.filter(c => naCarteira(c) && carteiraAtiva(c) && (!rca || c.rca === rca)).length || 1;
    const resumoCl = ['A', 'B', 'C'].map(cl => { const r = rows.filter(x => x.abc === cl); return [cl, r.length, r.reduce((a, x) => a + x.part, 0)]; });
    const nome = k => modo === 'cli' ? cliNome(k) : prodNome(k);
    const ms = [...meses].sort((a, b) => a - b), rotulo = ms.length > 1 ? nomeMes(ms[0]) + ' a ' + nomeMes(ms[ms.length - 1]) : nomeMes(ms[0]);
    const LIM = modo === 'cli' ? 300 : 150;
    const linhas = rows.slice(0, LIM).map((x, i) => {
      const c = modo === 'cli' ? D.CMAP.get(x.k) : null;
      const detalhe = modo === 'cli'
        ? `${x.cl.size} ${x.cl.size === 1 ? 'produto' : 'produtos'}${c ? ' · ' + esc(titulo(c.cidade)) + (rca || ehRca() ? '' : ' · ' + esc(rcaNome(c.rca))) : ''}`
        : `${x.cl.size} de ${base} clientes da carteira compraram${x.cl.size / base < .25 && x.abc !== 'C' ? ' · <span class="pill warn">pouca positivação</span>' : ''}`;
      return `
      <${modo === 'cli' ? `button type="button" data-a="cli" data-v="${x.k}"` : 'div'} class="row">
        <span class="t"><span class="code">${i + 1}.</span> ${esc(nome(x.k))}${modo === 'cli' ? ` <span class="code">${x.k}</span>` : ''}</span>
        <span class="r">${brlK(x.v)}</span>
        <span class="sub">${pct(x.part)} da venda · acumulado ${pct(x.acc, 0)} · margem ${pct(x.v ? x.mg / x.v : 0)}</span>
        <span class="sub r"><span class="pill ${x.abc}">${x.abc}</span></span>
        <span class="sub full">${detalhe}</span>
        <span class="full">${bar(x.v / max, x.abc === 'A' ? 'gold' : '')}</span>
      </${modo === 'cli' ? 'button' : 'div'}>`;
    });
    const quem = n => modo === 'cli' ? (n === 1 ? 'cliente' : 'clientes') : (n === 1 ? 'produto' : 'produtos');
    return `
    <div class="kpis">${resumoCl.map(([cl, n, p]) => kpi(`Classe ${cl}`, nf0.format(n), quem(n) + ' · ' + pct(p, 0) + ' da venda')).join('')}</div>
    <div class="h">${modo === 'cli' ? 'Clientes, da maior venda para a menor' : 'Ranking'} <small>${rotulo} · ${brlK(tot)}</small></div>
    <div class="list" data-lista="a-${modo}">${rows.length ? limitar(linhas, 5, 'a-' + modo, modo === 'cli' ? 'Clientes por venda' : 'Ranking de produtos', rows.length > LIM ? vazio(`Mostrando os ${LIM} primeiros de ${rows.length}.`) : '', rows.length) : vazio('Sem venda faturada no período.')}</div>`;
  };
  const topo = `<div class="pilulas">${pilSel('a-per', 'Período', A2.per, [['mes', 'Mês atual'], ['ant', 'Mês anterior'], ['3m', 'Últimos 3 meses']])}${pilRca('a-rca', A2.rca)}</div>`;
  return { topo, pags: [['cli', 'Por cliente', pag], ['prod', 'Por produto', pag]] };
}

/* ---------------- aba: inadimplência ---------------- */
const FAIXAS = [[1, 15, 'age1'], [16, 30, 'age2'], [31, 60, 'age3'], [61, 90, 'age4'], [91, 99999, 'age5']];
function vInad() {
  const H = D.hoje;
  const meus = D.tit.filter(t => t.grupo === 'cobranca' && t.venc < H);
  const aVencer = D.tit.filter(t => t.grupo === 'cobranca' && t.venc >= H);
  const jur = D.tit.filter(t => t.grupo === 'juridico'), fora = D.tit.filter(t => t.grupo === 'fora');
  const tot = soma(meus, t => t.valor);
  const clis = new Set(meus.map(t => t.cli));
  const bloq = [...clis].filter(c => { const x = D.CMAP.get(c); return x && x.bloq; }).length;
  const faixas = FAIXAS.map(([a, b, cor]) => ({ a, b, cor, v: soma(meus.filter(t => H - t.venc >= a && H - t.venc <= b), t => t.valor) }));
  const resumo = () => `
    <div class="kpis k2">${kpi('Vencido', brlK(tot), 'em aberto hoje', 'perigo wide')}${kpi('Títulos', nf0.format(meus.length), 'vencidos')}${kpi('Clientes', nf0.format(clis.size), 'com título vencido')}${kpi('Bloqueados', nf0.format(bloq), 'no WinThor', 'atencao')}${kpi('A vencer', brlK(soma(aVencer, t => t.valor)), nf0.format(aVencer.length) + ' títulos')}</div>
    <div class="card sec"><div class="cartao-rot">Por atraso</div>
      <div class="stack">${faixas.map(fx => fx.v ? `<i style="width:${(fx.v / (tot || 1) * 100).toFixed(1)}%;background:var(--${fx.cor})" title="${fx.b > 9999 ? '+90' : fx.a + '–' + fx.b} dias: ${brl2(fx.v)}"></i>` : '').join('')}</div>
      <div class="legend">${faixas.map(fx => `<span><i style="background:var(--${fx.cor})"></i>${fx.b > 9999 ? '+90' : fx.a + '–' + fx.b} dias · <b class="num">${brlK(fx.v)}</b></span>`).join('')}</div>
    </div>
    ${jur.length ? `<div class="faixa">Jurídico e perdas: ${brl(soma(jur, t => t.valor))} em ${jur.length} ${jur.length > 1 ? 'títulos' : 'título'} — fora da soma acima.</div>` : ''}
    ${fora.length ? `<div class="faixa info">Fora da cobrança (bonificação, devolução, crédito): ${brl(soma(fora, t => t.valor))} em ${fora.length} ${fora.length > 1 ? 'títulos' : 'título'}.</div>` : ''}`;
  const porCli = lista => {
    const cl = new Map();
    for (const t of lista) { const x = cl.get(t.cli) || { v: 0, at: 0, n: 0 }; x.v += t.valor; x.at = Math.max(x.at, H - t.venc); x.n++; cl.set(t.cli, x); }
    return [...cl.entries()].sort((a, b) => b[1].v - a[1].v);
  };
  const linhaCli = ([cod, y], filho) => `
        <button type="button" class="row" data-a="cli" data-v="${cod}"${filho ? ' data-filho' : ''}>
          <span class="t">${esc(cliNome(cod))} <span class="code">${cod}</span></span><span class="r">${brl(y.v)}</span>
          <span class="sub">${y.n} ${y.n > 1 ? 'títulos' : 'título'}${D.CMAP.get(cod) && D.CMAP.get(cod).bloq ? ' · <span class="pill bad">bloqueado</span>' : ''}</span><span class="sub r"><span class="pill ${y.at > 30 ? 'bad' : 'warn'}">${y.at} dias</span></span>
        </button>`;
  const clientesPag = () => { const l = porCli(meus); return `<div class="h">Seus clientes com título vencido</div><div class="list" data-lista="i-cli">${l.length ? limitar(l.map(x => linhaCli(x, false)), 6, 'i-cli', 'Clientes com título vencido') : vazio('Nenhum título vencido. 👏')}</div>`; };
  const rcasPag = () => {
    const porRca = D.ativos.map(r => {
      const ts = meus.filter(t => t.rca === r.cod);
      return { r, v: soma(ts, t => t.valor), n: ts.length, cl: porCli(ts) };
    }).filter(x => x.n).sort((a, b) => b.v - a.v);
    const semRca = meus.filter(t => !rcaAtivo(t.rca));
    const maxR = porRca[0] ? porRca[0].v || 1 : 1;
    const rows = porRca.map(x => `
      <button type="button" class="row" data-a="i-open" data-v="${S.i.open === x.r.cod ? 0 : x.r.cod}" aria-expanded="${S.i.open === x.r.cod}">
        <span class="t">${esc(x.r.nome)} <span class="code">${x.r.cod}</span></span><span class="r">${brl(x.v)}</span>
        <span class="sub">${x.n} títulos · ${x.cl.length} clientes</span><span class="sub r">${S.i.open === x.r.cod ? 'fechar ▲' : 'ver ▼'}</span>
        <span class="full">${bar(x.v / maxR, 'bad')}</span>
      </button>
      ${S.i.open === x.r.cod ? x.cl.map(y => linhaCli(y, true)).join('') : ''}`);
    const lim = Math.max(5, porRca.findIndex(x => x.r.cod === S.i.open) + 1);
    return `<div class="h">Por RCA <small>toque para ver os clientes</small></div>
      <div class="list" data-lista="i-rcas">${rows.length ? limitar(rows, lim, 'i-rcas', 'Vencido por RCA') : vazio('Nenhum título vencido no setor. 👏')}</div>
      ${semRca.length ? `<span class="nota">O vencido inclui ${brl(soma(semRca, t => t.valor))} em ${semRca.length} ${semRca.length > 1 ? 'títulos' : 'título'} de RCA inativo ou que saiu do setor (fora da lista).</span>` : ''}`;
  };
  const setoresPag = () => {
    const ls = R.setores.slice().sort((a, b) => b.vencido - a.vencido), mx = ls.length ? ls[0].vencido || 1 : 1;
    const rows = ls.map(x => `
      <button type="button" class="row${x.cod === D.setor.cod ? ' sel' : ''}" data-a="setor" data-v="${x.cod}">
        <span class="t">${esc(x.nome)}</span><span class="r">${brlK(x.vencido)}</span>
        <span class="sub full">${nf0.format(x.clientes)} clientes${x.juridico ? ' · jurídico ' + brlK(x.juridico) : ''}</span><span class="full">${bar(x.vencido / mx, 'bad')}</span>
      </button>`);
    return `<div class="h">Por setor <small>toque para trocar de setor</small></div><div class="list" data-lista="i-setores">${limitar(rows, 6, 'i-setores', 'Vencido por setor')}</div>`;
  };
  return { pags: [['resumo', 'Resumo', resumo], ehRca() ? ['clientes', 'Clientes', clientesPag] : ['rcas', 'Por RCA', rcasPag], ehGerente() && R && ['setores', 'Setores', setoresPag]] };
}

/* ---------------- aba: devolução ---------------- */
function vDev() {
  const DV = S.d, [d1, d2] = periodo(DV.per);
  const meus = D.dev.filter(x => x.d >= d1 && x.d <= d2);
  const venda = resumoNf(D.nf.filter(o => o.d >= d1 && o.d <= d2)).vl || 0;
  const resp = x => { const m = D.mot[x.mot]; return !!(m && m[1]); };
  const tot = soma(meus, x => x.v), rv = soma(meus.filter(resp), x => x.v);
  const notas = new Set(meus.map(x => x.nota)).size;
  const mot = new Map(); for (const x of meus) { const y = mot.get(x.mot) || { v: 0, n: 0 }; y.v += x.v; y.n++; mot.set(x.mot, y); }
  const ml = [...mot.entries()].sort((a, b) => b[1].v - a[1].v), maxM = ml.length ? ml[0][1].v || 1 : 1;
  const linhasMot = ml.map(([k, y]) => `
      <div class="row"><span class="t">${esc(titulo((D.mot[k] || [])[0] || 'Motivo ' + k))} ${(D.mot[k] || [])[1] ? '<span class="pill rca">RCA</span>' : ''}</span><span class="r">${brl(y.v)}</span>
      <span class="sub full">${y.n} ${y.n > 1 ? 'ocorrências' : 'ocorrência'}</span><span class="full">${bar(y.v / maxM, 'bad')}</span></div>`);
  const resumo = () => `
    <div class="kpis k2">${kpi('Devolvido', brlK(tot), `${pct(venda ? tot / venda : 0)} da venda faturada de ${dm(d1)} a ${dm(d2)}`, 'perigo wide')}${kpi('Devoluções', nf0.format(notas), 'notas de devolução')}${kpi('Clientes', nf0.format(new Set(meus.map(x => x.cli)).size), 'que devolveram')}${kpi('Resp. do RCA', brlK(rv), pct(tot ? rv / tot : 0, 0) + ' do total', 'atencao')}${kpi('Venda', brlK(venda), 'faturada')}</div>
    <div class="h">Principais motivos</div>
    <div class="list">${ml.length ? linhasMot.slice(0, 3).join('') + (ml.length > 3 ? `<button type="button" class="row ver-todos" data-a="pag" data-v="motivos"><span class="t">Ver todos os motivos</span><span class="r"><span>${ml.length}</span>${ic('frente')}</span></button>` : '') : vazio('Nenhuma devolução no período. 👏')}</div>`;
  const linhaDev = (y, filho) => `
        <button type="button" class="row" data-a="cli" data-v="${y.cli}"${filho ? ' data-filho' : ''}>
          <span class="t">${esc(cliNome(y.cli))}</span><span class="r">${brl(y.v)}</span>
          <span class="sub">${dm(y.d)} · nota ${y.nota}</span><span class="sub r">${resp(y) ? '<span class="pill rca">RCA</span>' : ''}</span>
          <span class="sub full">${esc(titulo((D.mot[y.mot] || [])[0] || 'Motivo ' + y.mot))}</span>
        </button>`;
  const minhasPag = () => `<div class="h">Suas devoluções</div><div class="list" data-lista="d-minhas">${meus.length ? limitar(meus.slice().sort((a, b) => b.d - a.d).map(y => linhaDev(y, false)), 6, 'd-minhas', 'Suas devoluções') : vazio('Nenhuma devolução no período. 👏')}</div>`;
  const rcasPag = () => {
    const porRca = D.ativos.map(r => {
      const l = meus.filter(x => x.rca === r.cod), v = soma(l, x => x.v), vr = resumoNf(D.nf.filter(o => o.d >= d1 && o.d <= d2 && o.rca === r.cod)).vl;
      return { r, l, v, p: vr ? v / vr : 0, rv: soma(l.filter(resp), x => x.v) };
    }).filter(x => x.l.length).sort((a, b) => b.v - a.v);
    const maxR = porRca[0] ? porRca[0].v || 1 : 1;
    const rows = porRca.map(x => `
      <button type="button" class="row" data-a="d-open" data-v="${S.d.open === x.r.cod ? 0 : x.r.cod}" aria-expanded="${S.d.open === x.r.cod}">
        <span class="t">${esc(x.r.nome)} <span class="code">${x.r.cod}</span></span><span class="r">${brl(x.v)}</span>
        <span class="sub">${new Set(x.l.map(y => y.nota)).size} devoluções · ${pct(x.p)} da venda dele</span><span class="sub r">${x.rv ? `<span class="pill rca">RCA ${brlK(x.rv)}</span>` : ''}</span>
        <span class="full">${bar(x.v / maxR, 'bad')}</span>
      </button>
      ${S.d.open === x.r.cod ? x.l.slice().sort((a, b) => b.d - a.d).map(y => linhaDev(y, true)).join('') : ''}`);
    const lim = Math.max(5, porRca.findIndex(x => x.r.cod === S.d.open) + 1);
    return `<div class="h">Por RCA <small>toque para ver as devoluções</small></div><div class="list" data-lista="d-rcas">${rows.length ? limitar(rows, lim, 'd-rcas', 'Devolução por RCA') : vazio('Nenhuma devolução no período. 👏')}</div>
      ${avisoInativo(soma(meus.filter(x => !rcaAtivo(x.rca)), x => x.v), 'de devolução')}`;
  };
  const motivosPag = () => `<div class="h">Motivos <small>${dm(d1)} a ${dm(d2)}</small></div><div class="list" data-lista="d-mot">${ml.length ? limitar(linhasMot, 7, 'd-mot', 'Motivos de devolução') : vazio('Nenhuma devolução no período.')}</div>`;
  const setoresPag = () => {
    const idx = mesesDoPeriodo(DV.per).map(m => R.meses.indexOf(m)).filter(i => i >= 0);
    const ls = R.setores.map(s => { const v = idx.reduce((a, i) => a + s.dev[i], 0), vd = idx.reduce((a, i) => a + s.venda[i], 0); return { s, v, p: vd ? v / vd : 0 }; }).sort((a, b) => b.p - a.p);
    const mx = Math.max(...ls.map(x => x.p)) || 1;
    const rows = ls.map(x => `
      <button type="button" class="row${x.s.cod === D.setor.cod ? ' sel' : ''}" data-a="setor" data-v="${x.s.cod}">
        <span class="t">${esc(x.s.nome)}</span><span class="r">${pct(x.p)}</span>
        <span class="sub full">${brl(x.v)} devolvidos</span><span class="full">${bar(x.p / mx, 'bad')}</span>
      </button>`);
    return `<div class="h">Por setor <small>% sobre a venda</small></div><div class="list" data-lista="d-setores">${limitar(rows, 6, 'd-setores', 'Devolução por setor')}</div>`;
  };
  const topo = chips('d-per', DV.per, [['mes', 'Mês atual'], ['ant', 'Mês anterior'], ['3m', 'Últimos 3 meses']], 'rola');
  return { topo, pags: [['resumo', 'Resumo', resumo], ehRca() ? ['minhas', 'Notas', minhasPag] : ['rcas', 'Por RCA', rcasPag], ['motivos', 'Motivos', motivosPag], ehGerente() && R && ['setores', 'Setores', setoresPag]] };
}

/* ---------------- supervisores e acessos (administrador) ---------------- */
function telaAdm() {
  const AD = S.adm, base = { chave: 'adm', titulo: 'Acessos', sub: 'Gestores e supervisores do app' };
  if (AD.carregando && !AD.dados) return Object.assign(base, { html: '<div class="esq" style="height:46px"></div><div class="esq" style="height:340px"></div>' });
  if (AD.erro && !AD.dados) return Object.assign(base, { html: `<div class="msg bad">${esc(AD.erro)}</div><button class="btn sec" data-a="adm-recarregar" type="button">Tentar de novo</button>` });
  if (!AD.dados) return Object.assign(base, { html: '' });
  const cs = AD.dados.contas || [], cv = AD.dados.convites || [], setores = AD.dados.setores || [];
  const regs = setores.map(([cod, nome]) => ({
    cod, nome,
    contas: cs.filter(c => c.tipo === 'supervisor' && c.codsupervisor === cod && c.situacao === 'liberado'),
    convites: cv.filter(v => v.codsupervisor === cod && v.situacao === 'aguardando'),
  }));
  const com = regs.filter(r => r.contas.length || r.convites.length).length;
  const pend = cs.filter(c => c.situacao === 'pendente').length;
  const gestores = [...cs.filter(c => c.tipo === 'gerente' && c.situacao === 'liberado').map(c => ({ nome: c.nome || c.email, email: c.email, st: 'liberado' })),
    ...cv.filter(v => v.tipo === 'gerente' && v.situacao === 'aguardando').map(v => ({ nome: v.nome, email: v.email, st: 'aguardando' }))];
  const botao = `<button type="button" class="btn cheio com-ic" data-a="novo-sup">${ic('mais')}Cadastrar gestor ou supervisor</button>`;
  const gestoresPag = () => `${botao.replace('data-a="novo-sup"', 'data-a="novo-sup" data-v="g"')}
    <div class="nota">O <b>gestor</b> vê <b>todas as regiões</b>, só para consultar: não cadastra ninguém. Quem tem o SUPERVISOR LUBE liberado no Painel também entra como gestor.</div>
    <div class="h">Gestores <small>${gestores.length} ${gestores.length === 1 ? 'cadastrado' : 'cadastrados'}</small></div>
    <div class="list">${gestores.length ? gestores.map(g => `<div class="row"><span class="t">${esc(g.nome)}</span><span class="r">${g.st === 'liberado' ? '<span class="pill good">liberado</span>' : '<span class="pill warn">convite enviado</span>'}</span><span class="sub full">${esc(g.email)}</span></div>`).join('') : vazio('Nenhum gestor cadastrado pelo app.')}</div>`;
  const regioes = () => `
    ${botao}
    <div class="nota">Cada supervisor vê <b>só a região dele</b>. O gestor vê todas. Por enquanto os RCAs não usam o app.</div>
    <div class="h">Regiões <small>${com} de ${regs.length} com supervisor</small></div>
    <div class="list">${regs.map(r => {
      const nomes = [...r.contas.map(c => esc(c.nome || c.email)), ...r.convites.map(v => esc(v.nome) + ' (convite enviado)')];
      const st = r.contas.length ? `<span class="pill good">${r.contas.length > 1 ? r.contas.length + ' liberados' : 'liberado'}</span>` : r.convites.length ? '<span class="pill warn">aguardando</span>' : '<span class="pill">sem supervisor</span>';
      return `<button type="button" class="row" data-a="novo-sup" data-v="${r.cod}"><span class="t">${esc(r.nome)}</span><span class="r">${st}</span><span class="sub full">${nomes.length ? nomes.join(' · ') : 'Toque para cadastrar o supervisor desta região.'}</span></button>`;
    }).join('')}</div>`;
  return Object.assign(base, { html: embrulhar('adm', { pags: [['regioes', 'Supervisores', regioes], ['gestores', 'Gestores', gestoresPag], ['contas', `Contas${pend ? `<span class="n">${pend}</span>` : ''}`, vContas]] }) });
}
function vContas() {
  const AD = S.adm, cs = AD.dados.contas || [], setores = AD.dados.setores || [];
  const n = s => cs.filter(c => c.situacao === s).length;
  const lista = cs.filter(c => AD.filtro === 'todos' || c.situacao === AD.filtro);
  const sit = { pendente: 'warn', liberado: 'good', recusado: 'bad', bloqueado: 'bad' };
  return chips('adm-f', AD.filtro, [['pendente', `Pendentes (${n('pendente')})`], ['liberado', `Liberados (${n('liberado')})`], ['todos', `Todos (${cs.length})`]]) +
    '<div class="faixa info">Aqui ficam as contas criadas pelo Primeiro acesso. Quem tem o SUPERVISOR LUBE liberado no Painel entra direto como gestor.</div>' +
    (lista.length ? lista.map(c => `
    <div class="card conta-card" data-conta="${c.id}">
      <div class="topo"><div><b>${esc(c.nome || '(sem nome)')}</b><span>${esc(c.email)}</span></div><span class="pill ${sit[c.situacao] || ''}">${esc(c.situacao)}</span></div>
      <div class="filters">
        <div class="fld"><label>Perfil</label><select data-campo="tipo">${c.tipo === 'rca' ? '<option value="rca" selected>RCA</option>' : ''}<option value="supervisor"${c.tipo === 'supervisor' ? ' selected' : ''}>Supervisor (só a região)</option><option value="gerente"${c.tipo === 'gerente' ? ' selected' : ''}>Gestor (vê tudo)</option></select></div>
        <div class="fld" data-so="rca"${c.tipo === 'rca' ? '' : ' hidden'}><label>Código do RCA</label><input data-campo="codusur" inputmode="numeric" value="${c.codusur || ''}"></div>
        <div class="fld" data-so="supervisor"${c.tipo === 'supervisor' ? '' : ' hidden'}><label>Região</label><select data-campo="codsupervisor"><option value="">Escolha a região</option>${setores.map(([cod, nome]) => `<option value="${cod}"${c.codsupervisor === cod ? ' selected' : ''}>${esc(nome)}</option>`).join('')}</select></div>
      </div>
      ${c.tipo === 'rca' && c.codusur ? `<div class="sub">${c.rca_nome ? `WinThor: <b>${esc(titulo(c.rca_nome))}</b>${c.rca_ativo === false ? ' (inativo)' : ''} · ${c.email_confere ? '<span class="pill good">e-mail confere</span>' : '<span class="pill warn">e-mail diferente do WinThor</span>'}` : '<span class="pill bad">código não encontrado no WinThor</span>'}</div>` : ''}
      <div class="sub">pedido em ${diaHm(c.criado_em)}${c.decidido_em ? ' · decidido em ' + diaHm(c.decidido_em) : ''}</div>
      <div class="botoes">
        ${c.situacao !== 'liberado' ? `<button type="button" class="btn peq verde" data-a="adm-decidir" data-v="liberado">Liberar</button>` : `<button type="button" class="btn peq sec" data-a="adm-decidir" data-v="liberado">Salvar</button>`}
        ${c.situacao === 'pendente' ? `<button type="button" class="btn peq sec" data-a="adm-decidir" data-v="recusado">Recusar</button>` : ''}
        ${c.situacao === 'liberado' ? `<button type="button" class="btn peq" data-a="adm-decidir" data-v="bloqueado">Bloquear</button>` : ''}
      </div>
    </div>`).join('') : vazio('Nenhuma conta neste filtro.'));
}
async function carregarAcessos() {
  S.adm.carregando = true; S.adm.erro = ''; if (S.chave === 'adm') render();
  try {
    const t = await A.token();
    const r = await fetch((CFG.api || '') + '/api/acessos', { headers: { Authorization: 'Bearer ' + t }, cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.mensagem || 'Não consegui ler os acessos (' + r.status + ').');
    S.adm.dados = j;
  } catch (e) { S.adm.erro = e.message || String(e); }
  S.adm.carregando = false; if (S.chave === 'adm') render();
}
async function postAcessos(corpo) {
  const t = await A.token();
  const r = await fetch((CFG.api || '') + '/api/acessos', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.mensagem || 'Não consegui gravar (' + r.status + ').');
  return j;
}
async function decidirAcesso(card, situacao) {
  const campo = n => card.querySelector(`[data-campo="${n}"]`);
  try {
    await postAcessos({ id: card.dataset.conta, situacao, tipo: campo('tipo').value, codusur: campo('codusur').value.replace(/\D/g, ''), codsupervisor: campo('codsupervisor').value });
    toast(situacao === 'liberado' ? 'Acesso liberado.' : situacao === 'recusado' ? 'Pedido recusado.' : 'Acesso bloqueado.');
    await carregarAcessos();
  } catch (e) { toast(e.message || String(e), true); }
}
/* cadastro do gestor (vê todas as regiões) ou do supervisor (só a região dele): folha que sobe, no jeito do iPhone.
   cod: região já escolhida (toque numa região) ou 'g' (veio da página Gestores) */
function abrirCadastro(cod) {
  const AD = S.adm.dados;
  if (!AD) { toast('Carregando as regiões… tente de novo em instantes.'); return; }
  const gestor = cod === 'g';
  cod = gestor ? null : (cod ? +cod : null);
  const ja = cod ? (AD.contas || []).filter(c => c.tipo === 'supervisor' && c.codsupervisor === cod && c.situacao === 'liberado') : [];
  const conv = cod ? (AD.convites || []).filter(v => v.codsupervisor === cod && v.situacao === 'aguardando') : [];
  abrirFolha(`
    <div class="alca" aria-hidden="true"></div>
    <div class="folha-cab"><button type="button" class="link" data-a="fechar-folha">Cancelar</button><b>Novo acesso</b><button type="submit" form="f-sup" class="link forte">Salvar</button></div>
    <form id="f-sup" novalidate>
      <div class="segios perfil" role="radiogroup" aria-label="Perfil" style="--n:2;--i:${gestor ? 1 : 0}"><i class="thumb" aria-hidden="true"></i>
        <button type="button" role="radio" data-perfil="supervisor" aria-selected="${!gestor}">Supervisor</button><button type="button" role="radio" data-perfil="gerente" aria-selected="${gestor}">Gestor</button></div>
      <input type="hidden" id="s-tipo" value="${gestor ? 'gerente' : 'supervisor'}">
      <div class="grupo">
        <label class="campo"><span>Nome</span><input id="s-nome" autocomplete="off" autocapitalize="words" placeholder="Nome completo"></label>
        <label class="campo"><span>E-mail</span><input id="s-email" type="email" inputmode="email" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="nome@lube.com.br"></label>
        <label class="campo" id="s-setor-box"${gestor ? ' hidden' : ''}><span>Região</span><select id="s-setor"><option value="">Escolha a região</option>${(AD.setores || []).map(([c, nm]) => `<option value="${c}"${c === cod ? ' selected' : ''}>${esc(nm)}</option>`).join('')}</select></label>
      </div>
      ${ja.length || conv.length ? `<div class="faixa info">Nesta região: ${[...ja.map(c => esc(c.nome || c.email) + ' (liberado)'), ...conv.map(v => esc(v.nome) + ' (convite enviado)')].join(', ')}.</div>` : ''}
      <div class="nota" id="s-nota">${notaPerfil(gestor)}</div>
      <div class="msg bad" id="s-erro" role="alert" hidden></div>
      <button class="btn cheio" type="submit" id="s-salvar">Salvar e gerar o convite</button>
    </form>`, 'Novo acesso');
}
const notaPerfil = gestor => (gestor
  ? 'O gestor vê <b>todas as regiões</b>, só para consultar.'
  : 'O supervisor vê <b>só a região escolhida</b>.') +
  ' Depois de salvar, mande o convite pelo WhatsApp: a pessoa baixa o app, toca em <b>Primeiro acesso</b> com este e-mail e o código do convite, e já entra liberada.';
function escolherPerfil(tipo) {
  const g = tipo === 'gerente', sg = $('#folha .segios.perfil');
  $('#s-tipo').value = g ? 'gerente' : 'supervisor';
  sg.style.setProperty('--i', g ? 1 : 0);
  sg.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.perfil === tipo)));
  $('#s-setor-box').hidden = g;
  $('#s-nota').innerHTML = notaPerfil(g);
}
async function salvarSupervisor() {
  const tipo = $('#s-tipo').value === 'gerente' ? 'gerente' : 'supervisor';
  const nome = $('#s-nome').value.trim(), email = $('#s-email').value.trim().toLowerCase(), cod = tipo === 'supervisor' ? Number($('#s-setor').value) : null;
  const erro = m => { const e = $('#s-erro'); e.textContent = m; e.hidden = !m; };
  erro('');
  if (nome.length < 3) { erro('Informe o nome completo.'); $('#s-nome').focus(); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { erro('Informe um e-mail válido.'); $('#s-email').focus(); return; }
  if (tipo === 'supervisor' && !cod) { erro('Escolha a região do supervisor.'); return; }
  const b = $('#s-salvar'); b.setAttribute('aria-busy', 'true'); b.textContent = 'Salvando…';
  try {
    const j = await postAcessos({ acao: 'convidar', tipo, nome, email, codsupervisor: cod });
    const setor = tipo === 'gerente' ? null : ((S.adm.dados.setores || []).find(s => s[0] === cod) || [0, 'região ' + cod])[1];
    mostrarConvite({ tipo, nome, email, setor, codigo: j.codigo, liberou: !!j.liberou });
    carregarAcessos();
  } catch (e) { erro(e.message || String(e)); b.removeAttribute('aria-busy'); b.textContent = 'Salvar e gerar o convite'; }
}
function textoConvite(x) {
  const ver = x.tipo === 'gerente' ? 'de todas as regiões' : 'da região ' + x.setor;
  const passo = x.liberou
    ? `2. Abra e entre com o e-mail ${x.email} e a senha que você já usa.`
    : `2. Abra e toque em "Primeiro acesso". Use o e-mail ${x.email}` + (x.codigo ? ` e o código do convite ${x.codigo}` : '') + `, e crie a sua senha.`;
  return `Olá, ${primeiro(x.nome)}! Seu acesso ao app Supervisor Lube está pronto.\n\n1. Baixe o app: ${CFG.site}/baixar\n${passo}\n\n` +
    `Você vai ver a venda, a carteira e os clientes ${ver}.`;
}
function mostrarConvite(x) {
  const txt = textoConvite(x);
  S.convite = txt;
  abrirFolha(`
    <div class="alca" aria-hidden="true"></div>
    <div class="sucesso"><svg class="ok" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29"/><path d="M20 33l8 8 16-17"/></svg>
      <b>${x.tipo === 'gerente' ? 'Gestor' : 'Supervisor'} ${x.liberou ? 'liberado' : 'cadastrado'}</b><span class="sub">${esc(x.nome)} · ${x.tipo === 'gerente' ? 'todas as regiões' : esc(x.setor)}</span></div>
    ${x.liberou ? '<div class="faixa info">Essa pessoa já tinha conta: o acesso foi liberado agora. Basta entrar com a senha de sempre.</div>' : ''}
    <div class="h">Convite <small>mande para ele</small></div>
    <div class="convite">${esc(txt)}</div>
    <a class="btn cheio zap" href="https://wa.me/?text=${encodeURIComponent(txt)}" target="_blank" rel="noopener">Enviar pelo WhatsApp</a>
    <button type="button" class="btn sec cheio com-ic" data-a="copiar-convite">${ic('copiar')}Copiar a mensagem</button>
    <button type="button" class="link" data-a="fechar-folha">Fechar</button>`, 'Convite do supervisor');
}

/* ---------------- telas: montagem ---------------- */
const ICON = {
  resumo: '<rect x="3.5" y="3.5" width="7" height="8" rx="2"/><rect x="13.5" y="3.5" width="7" height="5" rx="2"/><rect x="13.5" y="11.5" width="7" height="9" rx="2"/><rect x="3.5" y="14.5" width="7" height="6" rx="2"/>',
  vendas: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />',
  carteira: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.6-3.4 3-5.2 6-5.2s5.4 1.8 6 5.2"/><path d="M16 4.6a3 3 0 0 1 0 6M18 14.6c1.8.7 2.9 2.4 3.2 5.4"/>',
  abc: '<path d="M4 6h16M4 12h11M4 18h6"/>',
  inad: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  dev: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
};
const TABS = [
  ['resumo', 'Resumo', vResumo, 'Resumo'], ['vendas', 'Vendas', vVendas, 'Vendas'], ['carteira', 'Carteira', vCarteira, 'Carteira'],
  ['abc', 'Curva ABC', vAbc, 'ABC'], ['inad', 'Inadimplência', vInad, 'Inadimpl.'], ['dev', 'Devolução', vDev, 'Devolução'],
];
if (!TABS.some(t => t[0] === S.tab)) S.tab = 'resumo';
const ESQ = '<div class="esq" style="height:150px"></div><div class="esq" style="height:90px"></div><div class="esq" style="height:220px"></div>';

/* uma tela com páginas: o controle segmentado e só a página aberta (as outras nem são calculadas) */
function embrulhar(chave, r) {
  if (typeof r === 'string') return r;
  const ps = r.pags.filter(Boolean);
  let atual = S.pag[chave];
  if (!ps.some(p => p[0] === atual)) atual = S.pag[chave] = ps[0][0];
  const i = ps.findIndex(p => p[0] === atual);
  const seg2 = ps.length > 1 ? `<div class="segios" role="tablist" style="--n:${ps.length};--i:${i}"><i class="thumb" aria-hidden="true"></i>${ps.map(([id, rot]) => `<button type="button" role="tab" data-a="pag" data-v="${id}" aria-selected="${id === atual}">${rot}</button>`).join('')}</div>` : '';
  return (r.topo || '') + seg2 + `<div class="pagina" data-pag="${atual}">${ps[i][2]()}</div>`;
}
function montarTela() {
  const it = S.pilha[S.pilha.length - 1];
  if (!it) {
    const t = TABS.find(x => x[0] === S.tab) || TABS[0];
    return { chave: t[0], titulo: t[1], raiz: true, html: D ? embrulhar(t[0], t[2]()) : ESQ };
  }
  if (it.t === 'adm') return telaAdm();
  if (!D) return { chave: it.t, titulo: it.titulo || '', html: ESQ };
  if (it.t === 'cli') { const r = telaCliente(it.cod); return { chave: 'cli', titulo: r.titulo, sub: r.sub, extra: r.extra, longo: true, html: r.pags ? embrulhar('cli', r) : r.html }; }
  if (it.t === 'busca') return { chave: 'busca', titulo: 'Clientes', sub: ehRca() ? 'da sua rota' : 'da região ' + esc(D.setor.nome), html: telaBusca() };
  if (it.t === 'lista') return telaLista(it);
  return { chave: 'x', titulo: '', html: '' };
}
/* "Ver todos": monta a tela de baixo com a lista inteira e mostra só a lista */
function telaLista(it) {
  const eu = S.pilha.pop(); let base;
  LISTA_TODA = it.id;
  try { base = montarTela(); } finally { LISTA_TODA = null; S.pilha.push(eu); }
  const tmp = document.createElement('div'); tmp.innerHTML = base.html;
  const el = tmp.querySelector(`[data-lista="${it.id}"]`);
  return { chave: 'lista', titulo: it.titulo, sub: esc(base.titulo), longo: it.titulo.length > 22, html: el ? el.outerHTML : vazio('Esta lista mudou. Volte e abra de novo.') };
}
function dataLonga() {
  const x = D ? dt(D.hoje) : new Date(), utc = !!D;
  const w = utc ? x.getUTCDay() : x.getDay(), d = utc ? x.getUTCDate() : x.getDate(), m = utc ? x.getUTCMonth() : x.getMonth();
  return DIAS_L[w] + ', ' + d + ' de ' + MESES_L[m];
}
function setorHtml() {
  const nome = D ? D.setor.nome : '…';
  if (ehGerente() && R) return `<button type="button" class="setor-pill" data-a="setores" aria-label="Trocar de setor (agora ${esc(nome)})">${ic('pin')}<span>${esc(nome)}</span>${ic('baixo', 'seta')}</button>`;
  if (D && ehRca()) return `<span class="setor-pill fixo">${ic('user')}<span>RCA ${D.codusur} · ${esc(D.rcaNome || '')}</span></span>`;
  return `<span class="setor-pill fixo" title="Sua região">${ic('pin')}<span>${esc(nome)}</span></span>`;
}
function whenHtml() {
  if (!D) return '';
  const ped = D.cargas.pedido, fat = D.cargas.faturado;
  const velho = ped && (Date.now() - new Date(ped).getTime() > 3 * 3600e3);
  const tit = 'Pedidos digitados até ' + diaHm(ped) + '; venda faturada até ' + diaHm(fat) + '; títulos ' + diaHm(D.cargas.titulo) + '. Toque para atualizar.';
  return `<button type="button" class="when${offline ? ' off' : velho ? ' velho' : ''}" id="when" title="${esc(tit)}">${offline ? 'sem conexão · ' : ''}pedidos ${hm(ped)} · faturado ${hm(fat)}</button>`;
}
/* título grande (rola junto com a tela; quando some, o título pequeno aparece na barra) */
function grande(t) {
  if (t.raiz) return `<div class="grande"><div class="sobre">${esc(dataLonga())}</div><h1>${esc(t.titulo)}</h1><div class="linha">${setorHtml()}${whenHtml()}</div></div>`;
  return `<div class="grande"><h1${t.longo ? ' class="longo"' : ''}>${esc(t.titulo)}</h1>${t.sub ? `<div class="sub">${t.sub}</div>` : ''}${t.extra || ''}</div>`;
}
function faixas() {
  return (offline ? '<div class="faixa">Sem conexão: mostrando a última cópia guardada no aparelho.</div>' : '') +
    (appNovo ? `<button type="button" class="faixa info toque" data-a="baixar-app">Nova versão do app (${esc(appNovo.versao)}) — toque para baixar e instalar.${ic('frente', 'seta')}</button>` : '');
}
const perfilRotulo = () => !conta ? '—' : conta.tipo === 'gerente' ? 'Gestor' : conta.tipo === 'supervisor' ? 'Supervisor' : 'RCA ' + (conta.codusur || '');
function barra(t) {
  const n = S.pilha.length;
  const ant = n ? (n > 1 ? S.pilha[n - 2].titulo : (TABS.find(x => x[0] === S.tab) || TABS[0])[1]) : null;
  $('#nav-esq').innerHTML = ant != null
    ? `<button type="button" class="voltar" data-a="voltar" aria-label="Voltar para ${esc(ant)}">${ic('back')}<span>${esc(curto(ant, 16))}</span></button>`
    : '<span class="placa mini"><img src="logo-lube.png" alt="Lube" width="60" height="20"></span>';
  $('#nav-titulo').textContent = t.titulo || '';
  $('#btn-busca').hidden = t.chave === 'busca' || !D;
  $('#conta-btn').textContent = iniciais(conta && (conta.nome || conta.email));
}
function montarDock() {
  const d = $('#dock-itens');
  if (d.childElementCount) return;
  d.style.setProperty('--n', TABS.length);
  d.innerHTML = '<span class="dock-pilula" aria-hidden="true"></span>' + TABS.map(([k, l, , c]) => `<button type="button" data-a="tab" data-v="${k}" aria-label="${l}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg><span>${c}</span></button>`).join('');
}
function dockAtualizar() {
  const i = Math.max(0, TABS.findIndex(x => x[0] === S.tab));
  const d = $('#dock-itens'); d.style.setProperty('--i', i);
  d.querySelectorAll('button').forEach((b, j) => { if (j === i) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
}

/* ---------------- desenho e movimento ---------------- */
function fotografar(el) {
  const r = el.getBoundingClientRect(), g = el.cloneNode(true);
  g.removeAttribute('id'); g.querySelectorAll('[id]').forEach(x => x.removeAttribute('id'));
  g.classList.remove('entrando', 'em-anim'); g.classList.add('fantasma'); g.setAttribute('aria-hidden', 'true');
  Object.assign(g.style, { position: 'fixed', top: r.top + 'px', left: r.left + 'px', width: r.width + 'px', height: r.height + 'px', margin: '0', pointerEvents: 'none', transform: '' });
  document.body.appendChild(g);
  return g;
}
const sombra = v => { $('#sombra').style.opacity = v; };
function animar(tipo, g) {
  const view = $('#view');
  const limpa = () => { if (g) g.remove(); sombra(0); view.classList.remove('em-anim'); view.style.zIndex = ''; };
  if (tipo === 'push' || tipo === 'pop') {
    // como no iPhone: a tela nova entra pela direita e a de baixo recua um pouco e escurece
    const T = tipo === 'push' ? 500 : 420, o = { duration: T, easing: EASE };
    view.classList.add('em-anim');
    if (tipo === 'push') {
      g.style.zIndex = 3; view.style.zIndex = 5;
      g.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-28%)' }], o);
      $('#sombra').animate([{ opacity: 0 }, { opacity: .26 }], o);
      view.animate([{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }], o).onfinish = limpa;
    } else {
      g.style.zIndex = 5; view.style.zIndex = 3;
      g.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(100%)' }], o).onfinish = limpa;
      $('#sombra').animate([{ opacity: .26 }, { opacity: 0 }], o);
      view.animate([{ transform: 'translateX(-28%)' }, { transform: 'translateX(0)' }], o);
    }
  } else if (tipo === 'aba') {
    view.classList.add('em-anim'); g.style.zIndex = 3; view.style.zIndex = 5;
    g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: 'ease-out', fill: 'forwards' });
    view.animate([{ opacity: 0, transform: 'translateY(12px) scale(.985)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: EASE }).onfinish = limpa;
  } else {
    // troca de página: desliza para o lado do toque
    const p = view.querySelector(':scope > .pagina'), dir = tipo === 'pag+' ? 1 : -1, o = { duration: 360, easing: EASE };
    if (g) g.animate([{ transform: 'translateX(0)', opacity: 1 }, { transform: `translateX(${-dir * 22}%)`, opacity: 0 }], Object.assign({ fill: 'forwards' }, o)).onfinish = limpa;
    if (p) p.animate([{ transform: `translateX(${dir * 22}%)`, opacity: 0 }, { transform: 'none', opacity: 1 }], o);
  }
}
function entrar(view) {
  view.querySelectorAll('.list').forEach(l => { let i = 0; for (const r of l.children) { if (i > 14) break; r.style.setProperty('--i', i++); } });
  view.classList.add('entrando');
  clearTimeout(view._ent); view._ent = setTimeout(() => view.classList.remove('entrando'), 1100);
}
const FMT = { brlK, n: v => nf0.format(Math.round(v)), pct0: v => pct(v, 0) };
function contar(raiz) {
  if (REDUZ) return;
  raiz.querySelectorAll('[data-cnt]').forEach(el => {
    const alvo = +el.dataset.cnt, f = FMT[el.dataset.f] || FMT.n, t0 = performance.now(), T = 900;
    if (!alvo) return;
    const passo = t => { const k = Math.min(1, (t - t0) / T), e = 1 - Math.pow(1 - k, 4); el.textContent = f(alvo * e); if (k < 1) requestAnimationFrame(passo); };
    el.textContent = f(0); requestAnimationFrame(passo);
  });
}

/* o: { anim: 'push' | 'pop' | 'aba' | 'pag+' | 'pag-', topo: true, rolar: y } */
function render(o) {
  o = o || {};
  if (!conta) return;
  const view = $('#view'), anim = REDUZ ? null : o.anim;
  let g = null, segAnt = null;
  if (anim === 'pag+' || anim === 'pag-') {
    const p = view.querySelector(':scope > .pagina'); if (p) g = fotografar(p);
    const sg = view.querySelector(':scope > .segios'); if (sg) segAnt = sg.style.getPropertyValue('--i');
  } else if (anim) g = fotografar(view);
  // filtros em pílula que deslizam: guarda onde estavam (senão voltam para o começo a cada toque)
  const rolos = anim ? [] : [...view.querySelectorAll('.pilulas, .chips.rola')].map(x => x.scrollLeft);
  let t;
  try { t = montarTela(); } catch (e) { console.error(e); t = { chave: 'erro', titulo: 'Ops', html: `<div class="msg bad">Algo deu errado ao montar esta tela: ${esc(e.message)}. Toque em outra aba ou atualize.</div>` }; }
  S.chave = t.chave;
  barra(t);
  view.innerHTML = grande(t) + faixas() + t.html;
  if (segAnt != null) {
    const sg = view.querySelector(':scope > .segios');
    if (sg) { const novo = sg.style.getPropertyValue('--i'); sg.style.setProperty('--i', segAnt); void sg.offsetWidth; sg.style.setProperty('--i', novo); }
  }
  if (rolos.length) view.querySelectorAll('.pilulas, .chips.rola').forEach((x, i) => { if (rolos[i]) x.scrollLeft = rolos[i]; });
  if (o.rolar != null) window.scrollTo(0, o.rolar); else if (o.topo) window.scrollTo(0, 0);
  dockAtualizar();
  if (anim) animar(anim, g);
  if (anim === 'aba' || anim === 'push') entrar(view);
  if (t.chave === 'resumo' && D) {
    const k = S.escopo + '|' + D.gerado;
    if (S.contado !== k) { S.contado = k; entrar(view); contar(view); }
  }
  salvarTela();
  aoRolar();
}
function empurrar(item) { S.rolagens[S.pilha.length] = window.scrollY; S.pilha.push(item); render({ anim: 'push', topo: true }); }
function voltar() { if (!S.pilha.length) return; S.pilha.pop(); render({ anim: 'pop', rolar: S.rolagens[S.pilha.length] || 0 }); }
function irAba(v) {
  if (!TABS.some(t => t[0] === v)) return;
  if (v === S.tab) {
    // tocar na aba aberta: volta para o começo dela (como no iPhone)
    if (S.pilha.length) { const y = S.rolagens[0] || 0; S.pilha = []; render({ anim: 'pop', rolar: y }); }
    else window.scrollTo({ top: 0, behavior: REDUZ ? 'auto' : 'smooth' });
    return;
  }
  S.tab = v; S.pilha = []; S.rolagens = [];
  render({ anim: 'aba', topo: true });
  const db = $(`#dock-itens button[data-v="${v}"]`);
  if (db && !REDUZ) { db.classList.remove('pulou'); void db.offsetWidth; db.classList.add('pulou'); }
}
function irPagina(id) {
  const sg = $('#view > .segios'), atual = S.pag[S.chave];
  if (!sg || id === atual) return;
  const ids = [...sg.querySelectorAll('button')].map(b => b.dataset.v);
  if (!ids.includes(id)) return;
  S.pag[S.chave] = id;
  // se o controle já subiu para trás da barra, a página nova começa logo abaixo dele
  const topoSeg = sg.getBoundingClientRect().top - $('#nav').getBoundingClientRect().bottom;
  render({ anim: ids.indexOf(id) > ids.indexOf(atual) ? 'pag+' : 'pag-', rolar: topoSeg < 0 ? Math.max(0, window.scrollY + topoSeg - 10) : null });
}
function trocarPagina(dir) {
  const sg = $('#view > .segios'); if (!sg) return;
  const ids = [...sg.querySelectorAll('button')].map(b => b.dataset.v), j = ids.indexOf(S.pag[S.chave]) + dir;
  if (j >= 0 && j < ids.length) { irPagina(ids[j]); return; }
  // na ponta: um tranco de mola dizendo "não tem mais"
  const p = $('#view > .pagina');
  if (p && !REDUZ) p.animate([{ transform: 'none' }, { transform: `translateX(${-dir * 14}px)` }, { transform: 'none' }], { duration: 360, easing: 'cubic-bezier(.34,1.56,.64,1)' });
}

/* barra de cima: o fundo de vidro e o título pequeno aparecem conforme o título grande sai */
let rolTick = false;
function aoRolar() {
  if (rolTick) return; rolTick = true;
  requestAnimationFrame(() => {
    rolTick = false;
    const gr = document.querySelector('#view > .grande'), h = gr ? gr.offsetHeight : 60;
    const p = Math.max(0, Math.min(1, window.scrollY / Math.max(30, h - 4)));
    const nav = $('#nav'); nav.style.setProperty('--p', p.toFixed(3)); nav.classList.toggle('rolou', p >= 1);
  });
}
window.addEventListener('scroll', aoRolar, { passive: true });

let toastTimer = null;
function toast(msg, ruim) {
  const t = $('#toast'); t.textContent = msg; t.classList.toggle('bad', !!ruim); t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 4000);
}

/* ---------------- folha que sobe (menu, setores, cadastro) ---------------- */
function abrirFolha(html, rotulo) {
  const f = $('#folha'), v = $('#veu'), app = $('#tela-app .app');
  f.innerHTML = html; f.setAttribute('aria-label', rotulo || 'Janela'); f.scrollTop = 0;
  if (!f.hidden) { if (!REDUZ) f.firstElementChild && [...f.children].forEach(c => c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260 })); return; }
  // o fundo recua e arredonda, como o cartão do iPhone
  const y = window.scrollY, h = innerHeight, H = app.offsetHeight, baixo = Math.max(0, H - y - h);
  app.style.transformOrigin = `50% ${y + h / 2}px`;
  app.style.clipPath = `inset(${y}px 0 ${baixo}px 0 round 0px)`;
  f.hidden = false; v.hidden = false; f.style.transform = '';
  void app.offsetWidth;
  app.style.clipPath = `inset(${y}px 0 ${baixo}px 0 round 20px)`;
  document.body.classList.add('atras');
  if (!REDUZ) {
    f.animate([{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], { duration: 520, easing: EASE });
    v.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 380, easing: 'ease-out' });
  }
}
function fecharFolha() {
  const f = $('#folha'), v = $('#veu'), app = $('#tela-app .app');
  if (f.hidden) return;
  document.body.classList.remove('atras');
  if (app.style.clipPath) app.style.clipPath = app.style.clipPath.replace(/round [\d.]+px/, 'round 0px');
  const fim = () => { f.hidden = true; v.hidden = true; f.style.transform = ''; v.style.opacity = ''; f.innerHTML = ''; f.getAnimations().forEach(a => a.cancel()); v.getAnimations().forEach(a => a.cancel()); setTimeout(() => { if (f.hidden) { app.style.clipPath = ''; app.style.transformOrigin = ''; } }, 200); };
  if (!S.adm.dados) S.adm.erro = '';
  if (REDUZ) { fim(); return; }
  const de = f.style.transform || 'translateY(0)';
  f.animate([{ transform: de }, { transform: 'translateY(100%)' }], { duration: 320, easing: 'cubic-bezier(.32,0,.67,0)', fill: 'forwards' }).onfinish = fim;
  v.animate([{ opacity: getComputedStyle(v).opacity }, { opacity: 0 }], { duration: 320, fill: 'forwards' });
}
const ICM = {
  atual: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
  acessos: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.6-3.4 3-5.2 6-5.2s5.4 1.8 6 5.2"/><path d="M17 8l2 2 4-4"/>',
  instalar: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 21h16"/>',
  sair: '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
};
function abrirMenu() {
  const ios = !CFG.nativo && /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches && !navigator.standalone;
  const pend = S.adm.dados ? (S.adm.dados.contas || []).filter(c => c.situacao === 'pendente').length : null;
  abrirFolha(`
    <div class="alca" aria-hidden="true"></div>
    <div class="quem"><span class="conta-btn">${esc(iniciais(conta.nome || conta.email))}</span><div><b>${esc(conta.nome || conta.email)}</b><span>${esc(conta.email || '')} · ${esc(perfilRotulo())}</span></div></div>
    <button type="button" class="item" data-a="m-atualizar"><svg viewBox="0 0 24 24">${ICM.atual}</svg>Atualizar dados<small>${D ? 'gerado ' + diaHm(D.gerado) : ''}</small></button>
    ${conta.admin ? `<button type="button" class="item" data-a="m-acessos"><svg viewBox="0 0 24 24">${ICM.acessos}</svg>Gestores e supervisores<small>${pend ? pend + ' pendente' + (pend === 1 ? '' : 's') : ''}</small></button>` : ''}
    ${instalar ? `<button type="button" class="item" data-a="m-instalar"><svg viewBox="0 0 24 24">${ICM.instalar}</svg>Instalar na tela inicial</button>` : ''}
    ${ios ? `<div class="item" style="cursor:default"><svg viewBox="0 0 24 24">${ICM.instalar}</svg><span>No iPhone: toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>.</span></div>` : ''}
    <button type="button" class="item sair" data-a="m-sair"><svg viewBox="0 0 24 24">${ICM.sair}</svg>Sair</button>
    <div class="versao">Supervisor Lube · versão ${esc(CFG.versao)}</div>`, 'Sua conta');
  // uma tentativa por abertura do menu: se falhar, o erro fica na tela de supervisores (não tenta de novo em laço)
  if (conta.admin && !S.adm.dados && !S.adm.carregando && !S.adm.erro) carregarAcessos().then(() => { if (!$('#folha').hidden && S.adm.dados && $('#folha [data-a="m-acessos"]')) abrirMenu(); });
}
function abrirSetores() {
  if (!R) return;
  const i0 = R.meses.length - 1;
  abrirFolha(`
    <div class="alca" aria-hidden="true"></div>
    <div class="folha-tit">Escolha o setor</div>
    <div class="list">${R.setores.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map(s => `
      <button type="button" class="row${D && s.cod === D.setor.cod ? ' sel' : ''}" data-a="setor" data-v="${s.cod}">
        <span class="t">${esc(s.nome)}</span><span class="r">${D && s.cod === D.setor.cod ? ic('check', 'ok-ic') : brlK(s.venda[i0])}</span>
      </button>`).join('')}</div>`, 'Escolha o setor');
}
function copiar() {
  const p = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(S.convite) : Promise.reject(new Error('sem'));
  p.then(() => toast('Mensagem copiada.')).catch(() => toast('Não consegui copiar. Toque e segure no texto do convite para copiar.', true));
}

/* ---------------- carregar ---------------- */
function chaveCache(escopo) { return (conta && conta.email || '') + '|' + escopo; }
async function baixar(escopo, etag) {
  const t = await A.token();
  if (!t) { A.expirou(); throw new Error('sessão'); }
  const h = { Authorization: 'Bearer ' + t }; if (etag) h['If-None-Match'] = '"' + etag + '"';
  const r = await fetch((CFG.api || '') + '/api/dados' + (escopo && escopo[0] !== 'R' ? '?escopo=' + escopo : ''), { headers: h, cache: 'no-store' });
  if (r.status === 304) return null;
  if (r.status === 401) { A.expirou(); throw new Error('sessão'); }
  const etagNova = (r.headers.get('ETag') || '').replace(/^W\//, '').replace(/"/g, '');
  if (r.status === 403) { const j = await r.json().catch(() => ({})); A.negado(j.mensagem || 'Seu acesso não está liberado.'); throw new Error('acesso'); }
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.mensagem || 'O servidor respondeu ' + r.status); }
  return { pkg: await r.json(), etag: etagNova };
}
/* abre o escopo: primeiro a cópia do aparelho, depois a versão nova por trás */
async function abrirEscopo(escopo, aoMontar) {
  const k = chaveCache(escopo);
  const guardado = await IDB.get(k);
  if (guardado && guardado.pkg) aoMontar(guardado.pkg, false);
  try {
    const novo = await baixar(escopo, guardado && guardado.etag);
    offline = false;
    if (novo) { await IDB.set(k, novo); aoMontar(novo.pkg, !!guardado); }
    return true;
  } catch (e) {
    if (e.message === 'sessão' || e.message === 'acesso') return false;
    offline = !navigator.onLine || /fetch|network|Failed/i.test(e.message);
    if (!guardado) throw e;
    toast(offline ? 'Sem conexão: mostrando a última cópia.' : e.message, true);
    render();
    return false;
  }
}
function montarResumo(p) {
  return { meses: p.meses || [], hoje: p.hoje, setores: (p.setores || []).map(s => ({ cod: s[0], nome: s[1], venda: s[2], cmv: s[3], dev: s[4], vencido: +s[5] || 0, juridico: +s[6] || 0, clientes: s[7] || 0, pos: s[8] || [] })) };
}
async function carregarTudo() {
  if (baixando) return; baixando = true; ultimaConferencia = Date.now();
  try {
    if (ehGerente()) {
      await abrirEscopo('G', p => { R = montarResumo(p); if (D) render(); });
      if (!R || !R.setores.length) throw new Error('O resumo dos setores ainda não está pronto.');
      let alvo = null;
      try { alvo = Number(localStorage.getItem('sup-lube-setor')); } catch (e) { /* ignora */ }
      if (!R.setores.some(s => s.cod === alvo)) { const i0 = R.meses.length - 1; alvo = R.setores.slice().sort((a, b) => b.venda[i0] - a.venda[i0])[0].cod; }
      await abrirSetor(alvo);
    } else if (conta.tipo === 'supervisor') {
      await abrirSetor(Number(conta.codsupervisor));
    } else {
      S.escopo = 'R' + conta.codusur;
      await abrirEscopo(S.escopo, (p, atualizou) => { D = montar(p); render(); if (atualizou) { S.mudou = true; toast('Dados atualizados.'); } });
    }
  } catch (e) {
    if (!D) $('#view').innerHTML = `<div class="msg bad">${esc(e.message || 'Não consegui carregar os dados.')}</div><button class="btn sec" type="button" data-a="m-atualizar">Tentar de novo</button>`;
  } finally { baixando = false; }
}
async function abrirSetor(cod) {
  const escopo = 'S' + cod;
  if (S.escopo !== escopo) { S.escopo = escopo; D = null; render(); }
  try { localStorage.setItem('sup-lube-setor', String(cod)); } catch (e) { /* ignora */ }
  await abrirEscopo(escopo, (p, atualizou) => { if (S.escopo !== escopo) return; D = montar(p); render(); if (atualizou) { S.mudou = true; toast('Dados atualizados.'); } });
}
function trocarSetor(cod) {
  S.v.rca = 0; S.c.rca = 0; S.c.cid = ''; S.c.bai = ''; S.a.rca = 0; S.i.open = 0; S.d.open = 0; S.k.raw = '';
  S.pilha = []; S.rolagens = [];
  if (baixando) return;
  baixando = true;
  abrirSetor(cod).catch(e => toast(e.message || 'Não consegui abrir o setor.', true)).finally(() => { baixando = false; });
}

/* ---------------- eventos ---------------- */
document.addEventListener('click', e => {
  if (e.target.closest('#veu')) { fecharFolha(); return; }
  if (e.target.closest('#conta-btn')) { abrirMenu(); return; }
  if (e.target.closest('#btn-busca')) { if (D) empurrar({ t: 'busca', titulo: 'Clientes' }); return; }
  if (e.target.closest('#when')) { if (!baixando) { toast('Conferindo se há dados novos…'); carregarTudo(); } return; }
  const pf = e.target.closest('#folha [data-perfil]'); if (pf) { escolherPerfil(pf.dataset.perfil); return; }
  const b = e.target.closest('[data-a]'); if (!b) return;
  const a = b.dataset.a, v = b.dataset.v;
  const naRaiz = () => { if (!S.pilha.length) return false; S.pilha = []; render({ anim: 'pop', rolar: 0 }); return true; };
  switch (a) {
    case 'tab': irAba(v); return;
    case 'pag': irPagina(v); return;
    case 'ir': { const [tab, pag] = v.split(':'); if (pag) S.pag[tab] = pag; irAba(tab); return; }
    case 'voltar': voltar(); return;
    case 'cli': S.pag.cli = 'resumo'; empurrar({ t: 'cli', cod: +v, titulo: cliNome(+v) }); return;
    case 'lista': empurrar({ t: 'lista', id: v, titulo: b.dataset.t || 'Lista' }); return;
    case 'setores': abrirSetores(); return;
    case 'setor': fecharFolha(); trocarSetor(+v); return;
    case 'v-rca': S.v.rca = +v; S.pag.vendas = 'hoje'; if (!naRaiz()) render({ anim: 'pag-' }); return;
    case 'v-q': if (v) { S.v.q = v; const [d1, d2] = periodo(v); S.v.de = d1; S.v.ate = d2; } else S.v.q = ''; break;
    case 'v-graf': S.v.graf = v; break;
    case 'c-cid': S.c.cid = v; S.c.bai = ''; if (naRaiz()) return; break;
    case 'c-bai': S.c.bai = v; if (naRaiz()) return; break;
    case 'k-modo': S.k.modo = v; break;
    case 'i-open': S.i.open = +v; break;
    case 'd-per': S.d.per = v; S.d.open = 0; break;
    case 'd-open': S.d.open = +v; break;
    case 'adm-f': S.adm.filtro = v; break;
    case 'adm-recarregar': carregarAcessos(); return;
    case 'adm-decidir': { const card = b.closest('[data-conta]'); b.setAttribute('aria-busy', 'true'); decidirAcesso(card, v); return; }
    case 'novo-sup': abrirCadastro(v || null); return;
    case 'fechar-folha': fecharFolha(); return;
    case 'copiar-convite': copiar(); return;
    case 'm-atualizar': fecharFolha(); toast('Conferindo se há dados novos…'); carregarTudo(); return;
    case 'm-acessos': fecharFolha(); S.adm.erro = ''; empurrar({ t: 'adm', titulo: 'Acessos' }); if (!S.adm.dados) carregarAcessos(); return;
    case 'm-instalar': fecharFolha(); if (instalar) { instalar.prompt(); instalar = null; } return;
    case 'm-sair': fecharFolha(); IDB.limpar(); D = null; R = null; conta = null; S.escopo = null; S.pilha = []; S.adm.dados = null; A.sair(); return;
    case 'baixar-app': if (appNovo) location.href = CFG.site + appNovo.apk; return;
    default: return;
  }
  render();
});

document.addEventListener('change', e => {
  const t = e.target, v = t.value;
  if (t.closest('[data-conta]')) {
    if (t.dataset.campo === 'tipo') { const card = t.closest('[data-conta]'); card.querySelectorAll('[data-so]').forEach(el => { el.hidden = el.dataset.so !== v; }); }
    return;
  }
  if (t.closest('#folha') || !D) return;
  const data = s => { const d = fromIso(s); return isNaN(d) ? null : Math.max(D.ini, Math.min(D.hoje, d)); };
  switch (t.id) {
    case 'v-rca': S.v.rca = +v; break;
    case 'v-dia': { const d = data(v); if (d !== null) S.v.dia = d; break; }
    case 'v-de': { const d = data(v); if (d !== null) { S.v.de = d; S.v.q = ''; } break; }
    case 'v-ate': { const d = data(v); if (d !== null) { S.v.ate = d; S.v.q = ''; } break; }
    case 'c-mes': S.c.mes = +v; break;
    case 'c-rca': S.c.rca = +v; S.c.cid = ''; S.c.bai = ''; break;
    case 'c-cid': S.c.cid = v; S.c.bai = ''; break;
    case 'c-bai': S.c.bai = v; break;
    case 'a-rca': S.a.rca = +v; break;
    case 'a-per': S.a.per = v; break;
    default: return;
  }
  if (S.v.de > S.v.ate) { const x = S.v.de; S.v.de = S.v.ate; S.v.ate = x; }
  render();
});

document.addEventListener('submit', e => {
  if (e.target.id === 'f-sup') { e.preventDefault(); salvarSupervisor(); return; }
  if (e.target.id !== 'fcli') return;
  e.preventDefault();
  const raw = document.getElementById('codcli').value.trim(), so = raw.replace(/\D/g, '');
  S.k.raw = raw;
  if (so && so === raw && D.CMAP.has(+so)) { document.activeElement && document.activeElement.blur(); S.pag.cli = 'resumo'; empurrar({ t: 'cli', cod: +so, titulo: cliNome(+so) }); return; }
  const r = $('#busca-res'); if (r) r.innerHTML = resultadosBusca();
  if (so && so === raw && !D.CMAP.has(+so)) toast('O cliente ' + so + ' não faz parte da sua base.', true);
});
document.addEventListener('input', e => {
  if (e.target.id !== 'codcli') return;
  S.k.raw = e.target.value;
  clearTimeout(document._busca);
  document._busca = setTimeout(() => { const r = $('#busca-res'); if (r) r.innerHTML = resultadosBusca(); }, 180);
});

/* no app Android/iPhone (casca Capacitor) a WebView não abre "nova aba": WhatsApp, mapa e site de fora
   seguem na mesma janela e a casca entrega ao app certo do celular (WhatsApp, Maps, navegador) */
document.addEventListener('click', e => {
  const a = e.target.closest('a[href]');
  if (!a || a.getAttribute('href') === '#') return;
  const nativo = window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform();
  if (nativo && a.target === '_blank') { e.preventDefault(); location.href = a.href; }
}, true);

/* ---------------- gestos: voltar pela borda, trocar de página deslizando, puxar para atualizar ---------------- */
let toque = null, vlt = null;
window.addEventListener('touchstart', e => {
  toque = null;
  if (e.touches.length !== 1 || !conta || $('#tela-app').hidden || !$('#folha').hidden) return;
  const t = e.touches[0], alvo = e.target, view = $('#view');
  if (alvo.closest('.dock, .nav')) return;
  toque = {
    x0: t.clientX, y0: t.clientY, t0: performance.now(), dx: 0, dy: 0, modo: null,
    volta: S.pilha.length > 0 && t.clientX < 30,
    pag: !!view.querySelector(':scope > .segios') && !alvo.closest('.pilulas, .chips, .seg, select, input, .ch'),
    puxa: !S.pilha.length && !!D && window.scrollY <= 0 && !alvo.closest('.pilulas, .chips'),
  };
}, { passive: true });
window.addEventListener('touchmove', e => {
  if (!toque) return;
  const t = e.touches[0]; toque.dx = t.clientX - toque.x0; toque.dy = t.clientY - toque.y0;
  const adx = Math.abs(toque.dx), ady = Math.abs(toque.dy);
  if (!toque.modo) {
    if (adx < 8 && ady < 8) return;
    if (toque.volta && toque.dx > 0 && adx > ady) { toque.modo = 'volta'; voltaIniciar(); }
    else if (toque.pag && adx > ady * 1.4) toque.modo = 'pag';
    else if (toque.puxa && toque.dy > 0 && ady > adx && window.scrollY <= 0) toque.modo = 'puxa';
    else { toque = null; return; }
  }
  if (toque.modo === 'volta') voltaMover(toque.dx);
  else if (toque.modo === 'puxa') puxaMover(toque.dy);
}, { passive: true });
function fimToque(cancelou) {
  if (!toque) return;
  const tq = toque; toque = null;
  const vel = tq.dx / Math.max(1, performance.now() - tq.t0);
  if (tq.modo === 'volta') voltaSoltar(!cancelou && (tq.dx > innerWidth * .33 || vel > .45));
  else if (tq.modo === 'pag' && !cancelou && Math.abs(tq.dx) > 56) trocarPagina(tq.dx < 0 ? 1 : -1);
  else if (tq.modo === 'puxa') puxaSoltar(cancelou ? 0 : tq.dy);
}
window.addEventListener('touchend', () => fimToque(false));
window.addEventListener('touchcancel', () => fimToque(true));

function voltaIniciar() {
  const view = $('#view'), eu = S.pilha.pop(); let ant;
  try { ant = montarTela(); } finally { S.pilha.push(eu); }
  const baixo = document.createElement('main');
  baixo.className = 'gut fantasma'; baixo.setAttribute('aria-hidden', 'true');
  baixo.innerHTML = grande(ant) + faixas() + ant.html;
  baixo.querySelectorAll('[id]').forEach(x => x.removeAttribute('id'));
  const r = view.getBoundingClientRect(), topoDoc = r.top + window.scrollY, y = S.rolagens[S.pilha.length - 1] || 0;
  Object.assign(baixo.style, { position: 'fixed', top: (topoDoc - y) + 'px', left: r.left + 'px', width: r.width + 'px', zIndex: 3, transform: 'translateX(-28%)', pointerEvents: 'none' });
  document.body.appendChild(baixo);
  view.classList.add('em-anim'); view.style.zIndex = 5;
  vlt = { baixo, w: r.width };
  sombra(.26);
}
function voltaMover(dx) {
  if (!vlt) return;
  const k = Math.max(0, Math.min(1, dx / vlt.w));
  $('#view').style.transform = `translateX(${Math.max(0, dx)}px)`;
  vlt.baixo.style.transform = `translateX(${(-28 * (1 - k)).toFixed(2)}%)`;
  sombra((.26 * (1 - k)).toFixed(3));
}
function voltaSoltar(ok) {
  if (!vlt) return;
  const view = $('#view'), { baixo, w } = vlt; vlt = null;
  const x = new DOMMatrix(getComputedStyle(view).transform).m41, o = { duration: 300, easing: EASE, fill: 'forwards' };
  const limpa = () => { baixo.remove(); view.getAnimations().forEach(a => a.cancel()); view.style.transform = ''; view.style.zIndex = ''; view.classList.remove('em-anim'); sombra(0); };
  $('#sombra').animate([{ opacity: $('#sombra').style.opacity || 0 }, { opacity: ok ? 0 : .26 }], o);
  if (ok) {
    view.animate([{ transform: `translateX(${x}px)` }, { transform: `translateX(${w}px)` }], o);
    baixo.animate([{ transform: baixo.style.transform }, { transform: 'translateX(0)' }], o).onfinish = () => {
      S.pilha.pop(); const y = S.rolagens[S.pilha.length] || 0;
      render({ rolar: y }); limpa();
    };
  } else {
    baixo.animate([{ transform: baixo.style.transform }, { transform: 'translateX(-28%)' }], o);
    view.animate([{ transform: `translateX(${x}px)` }, { transform: 'translateX(0)' }], o).onfinish = limpa;
  }
}
function puxaMover(dy) {
  const d = Math.min(130, dy * .5), p = $('#puxar');
  $('#view').style.transform = `translateY(${d}px)`;
  p.style.opacity = Math.min(1, d / 56).toFixed(2);
  p.style.transform = `translateY(${(d * .35).toFixed(1)}px) rotate(${(d * 4).toFixed(0)}deg)`;
}
function puxaSoltar(dy) {
  const d = Math.min(130, dy * .5), view = $('#view'), p = $('#puxar');
  const solta = de => {
    view.style.transform = '';
    if (!REDUZ) view.animate([{ transform: `translateY(${de}px)` }, { transform: 'none' }], { duration: 420, easing: EASE });
    p.style.opacity = 0; p.classList.remove('gira');
  };
  if (d < 60 || baixando) { solta(d); return; }
  view.style.transform = 'translateY(54px)';
  if (!REDUZ) view.animate([{ transform: `translateY(${d}px)` }, { transform: 'translateY(54px)' }], { duration: 260, easing: EASE });
  p.style.transform = 'translateY(19px)'; p.style.opacity = 1; p.classList.add('gira');
  const t0 = Date.now(); S.mudou = false;
  Promise.resolve(carregarTudo()).finally(() => setTimeout(() => {
    solta(54);
    if (!S.mudou && !offline) toast('Tudo em dia: os dados já são os mais novos.');
  }, Math.max(0, 700 - (Date.now() - t0))));   // gira pelo menos 0,7 s (senão parece que não fez nada)
}
/* arrastar a folha para baixo fecha (pela alça ou com a folha no topo) */
(function () {
  let fz = null;
  const f = () => $('#folha');
  document.addEventListener('touchstart', e => {
    const fo = f(); if (fo.hidden || !fo.contains(e.target)) { fz = null; return; }
    if (fo.scrollTop > 0 && !e.target.closest('.alca, .folha-cab, .folha-tit, .quem')) { fz = null; return; }
    if (e.target.closest('input, select, textarea')) { fz = null; return; }
    fz = { y0: e.touches[0].clientY, t0: performance.now(), dy: 0 };
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!fz) return;
    fz.dy = Math.max(0, e.touches[0].clientY - fz.y0);
    f().style.transform = `translateY(${fz.dy}px)`;
    $('#veu').style.opacity = Math.max(0, 1 - fz.dy / 420).toFixed(2);
  }, { passive: true });
  document.addEventListener('touchend', () => {
    if (!fz) return;
    const z = fz; fz = null;
    if (z.dy > 110 || z.dy / Math.max(1, performance.now() - z.t0) > .6) { fecharFolha(); return; }
    const fo = f(), de = fo.style.transform;
    fo.style.transform = ''; $('#veu').style.opacity = '';
    if (z.dy > 0 && !REDUZ) fo.animate([{ transform: de }, { transform: 'translateY(0)' }], { duration: 380, easing: EASE });
  });
})();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && conta && Date.now() - ultimaConferencia > 5 * 60e3) carregarTudo();
});
window.addEventListener('online', () => { if (conta && offline) carregarTudo(); });
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); instalar = e; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('#folha').hidden) fecharFolha(); else if (S.pilha.length) voltar(); } });

/* ---------------- ligação com a entrada ---------------- */
window.SUP_APP = {
  pronto(c) {
    const trocou = !conta || conta.email !== c.email || conta.tipo !== c.tipo || conta.codusur !== c.codusur || conta.codsupervisor !== c.codsupervisor;
    conta = c;
    $('#tela-carregando').hidden = true; $('#tela-login').hidden = true; $('#tela-app').hidden = false;
    montarDock();
    if (trocou) { D = null; R = null; S.escopo = null; S.pilha = []; S.adm.dados = null; render({ topo: true }); carregarTudo(); }
    else render();
  },
};

/* ---------------- app nativo (APK / iPhone) ---------------- */
// As telas já estão dentro do aparelho: o service worker só serve ao site no navegador.
if (!CFG.nativo && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* sem cache offline do app, segue normal */ });
}
if (CFG.nativo) try {
  const P = (window.Capacitor && window.Capacitor.Plugins) || {};
  // botão "voltar" do Android: fecha a folha, volta a tela de cima, volta ao Resumo; só minimiza no Resumo
  if (P.App && P.App.addListener) {
    P.App.addListener('backButton', () => {
      if (!$('#folha').hidden) { fecharFolha(); return; }
      if (!$('#tela-app').hidden) {
        if (S.pilha.length) { voltar(); return; }
        if (S.tab !== 'resumo') { irAba('resumo'); return; }
      }
      if (P.App.minimizeApp) P.App.minimizeApp(); else if (P.App.exitApp) P.App.exitApp();
    });
  }
  // versão nova do APK: o site publica versao-app.json; quem tem um número de build menor vê o aviso.
  // O APK 1.0 (que só abria o site) não tem o plugin App: conta como build 1.
  const minhaBuild = P.App && P.App.getInfo ? P.App.getInfo().then(i => Number(i && i.build) || 1).catch(() => 1) : Promise.resolve(1);
  minhaBuild.then(build => fetch(CFG.site + '/versao-app.json', { cache: 'no-store' })
    .then(r => r.ok ? r.json() : null)
    .then(v => { if (v && Number(v.versionCode) > build && v.apk) { appNovo = v; if (conta) render(); } }))
    .catch(() => { /* sem rede: confere na próxima abertura */ });
} catch (e) { /* recurso nativo indisponível nesta versão: o app segue normal */ }
// carretel do "puxar para atualizar" (12 raios, como o do iPhone)
$('#puxar').innerHTML = '<svg viewBox="0 0 30 30" aria-hidden="true"><g stroke="currentColor" stroke-width="2.6" stroke-linecap="round">' +
  Array.from({ length: 12 }, (_, i) => `<line x1="15" y1="3.5" x2="15" y2="8.2" opacity="${(1 - i / 12 * .85).toFixed(2)}" transform="rotate(${-i * 30} 15 15)"/>`).join('') + '</g></svg>';
A.iniciar();
})();
