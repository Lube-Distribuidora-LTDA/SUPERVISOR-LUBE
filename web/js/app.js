/**
 * app.js — Supervisor Lube (2026-10-22): as seis abas do protótipo com o dado real.
 *
 * O pacote vem pronto da carga (supervisor.pacote, via /api/dados) e o aparelho
 * calcula os filtros. A última cópia fica no aparelho (IndexedDB): o app abre na
 * hora com ela e confere por trás se há versão nova (ETag) — quem abre nunca
 * espera o banco.
 *
 * Perfis: gerente (todos os setores + comparação entre setores), supervisor (só o
 * setor dele) e RCA (só a rota dele — a API já manda filtrado).
 */
(function () {
'use strict';

const CFG = window.SUP_CFG, A = window.SUP_ACESSO;
const $ = s => document.querySelector(s);

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
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
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

/* ---------------- estado ---------------- */
const S = {
  tab: 'vendas', escopo: null,
  v: { rca: 0, dia: null, de: null, ate: null, q: 'mes', graf: 'fat' },
  c: { mes: null, modo: 'comp', rca: 0, cid: '', bai: '' },
  k: { cod: null, raw: '', modo: 'forn', volta: null },
  a: { modo: 'forn', per: 'mes', rca: 0 },
  i: { open: 0 },
  d: { per: 'mes', open: 0 },
  adm: { filtro: 'pendente', dados: null, carregando: false, erro: '' },
};
let conta = null, D = null, R = null, baixando = false, ultimaConferencia = 0, offline = false, instalar = null, appNovo = null;
try { const sv = JSON.parse(localStorage.getItem('sup-lube-tela') || '{}'); if (sv.tab) S.tab = sv.tab; } catch (e) { /* sem armazenamento */ }
function salvarTela() { try { localStorage.setItem('sup-lube-tela', JSON.stringify({ tab: S.tab === 'acessos' ? 'vendas' : S.tab })); } catch (e) { /* ignora */ } }

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
  d.CMAP = new Map(d.cli.map(c => [c.cod, c]));
  if (d.tipo === 'rca' && d.rcas[0]) d.rcaNome = d.rcas[0].nome;
  return d;
}
const rcaNome = cod => { const r = D && D.RMAP.get(cod); return r ? r.nome : (cod ? 'RCA ' + cod : '—'); };
const prodNome = p => (D.prod[p] && D.prod[p][0]) || ('Produto ' + p);
const fornDe = p => (D.prod[p] && D.prod[p][1]) || 0;
const fornNome = f => titulo(D.forn[f] || ('Fornecedor ' + f));
const cliNome = cod => { const c = D.CMAP.get(cod); return c ? c.fantasia : 'Cliente ' + cod; };
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
const chips = (act, atual, ops) => '<div class="chips" role="group">' + ops.map(([v, l]) => `<button type="button" class="chip" data-a="${act}" data-v="${v}" aria-pressed="${v === atual}">${l}</button>`).join('') + '</div>';
function selRca(id, atual) {
  if (ehRca()) return '';
  return `<div class="fld"><label for="${id}">RCA</label><select id="${id}"><option value="0">Todos os RCAs</option>` +
    D.rcas.map(r => `<option value="${r.cod}"${r.cod === atual ? ' selected' : ''}>${r.cod} · ${esc(r.nome)}${r.ativo ? '' : ' (inativo)'}</option>`).join('') + '</select></div>';
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
const KMAP = { 'Venda': 'cash', 'Digitado': 'cart', 'Faturado': 'truck', 'Positivação': 'users', 'Pedidos': 'receipt', 'Ticket médio': 'receipt', 'Margem': 'percent', 'Vencido': 'alert', 'Títulos': 'doc', 'Clientes': 'users', 'Bloqueados': 'lock', 'A vencer': 'cal', 'Devolvido': 'ret', 'Devoluções': 'ret', 'Resp. do RCA': 'user', 'Prazo': 'cal', 'Limite de crédito': 'shield', 'Em aberto': 'doc', 'Disponível': 'wallet', 'Última': 'cal', 'Frequência': 'repeat' };
const kpi = (l, v, d, cls) => {
  const ic = KIC[KMAP[l] || (l.startsWith('Classe') ? 'layers' : 'cash')];
  const zero = /^(R\$ )?0(%)?$/.test(String(v).replace(/<[^>]+>/g, '')) ? ' zero' : '';
  return `<div class="kpi ${cls || ''}${zero}"><span class="l"><svg viewBox="0 0 24 24" aria-hidden="true">${ic}</svg><span>${l}</span></span><span class="v">${v}</span>${d ? `<span class="d">${d}</span>` : ''}</div>`;
};
const bar = (frac, cls) => `<div class="bar ${cls || ''}"><i style="width:${Math.max(0, Math.min(100, (frac || 0) * 100)).toFixed(1)}%"></i></div>`;
const vazio = t => `<div class="empty">${t}</div>`;

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
    r += `<rect class="${dias[i] === destaque ? 'hl' : 'b'}" x="${x.toFixed(1)}" y="${(H - B - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5"><title>${diaLongo(dias[i])}: ${brl2(v)}</title></rect>`;
    if (rotulos) r += `<text x="${(x + w / 2).toFixed(1)}" y="${(H - B - h - 4).toFixed(1)}" text-anchor="middle">${brlK(v)}</text>`;
  });
  r += `<text x="0" y="${H - 4}">${dm(dias[0])}</text><text x="${W}" y="${H - 4}" text-anchor="end">${dm(dias[dias.length - 1])}</text></svg>`;
  return r;
}

/* ---------------- aba: vendas ---------------- */
function vVendas() {
  const V = S.v, H = D.hoje;
  if (V.dia == null || V.dia > H || V.dia < D.ini) V.dia = H;
  if (V.de == null) { const p = periodo(V.q || 'mes'); V.de = p[0]; V.ate = p[1]; }
  const rca = ehRca() ? 0 : V.rca, f = o => !rca || o.rca === rca;
  const pd = resumoPed(D.ped.filter(o => o.d === V.dia && f(o))), pa = resumoPed(D.ped.filter(o => o.d === V.dia - 7 && f(o)));
  const fd = resumoNf(D.nf.filter(o => o.d === V.dia && f(o)));
  const delta = pa.vl ? pd.vl / pa.vl - 1 : 0;
  const dTxt = pa.vl ? `<span class="delta ${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '▲' : '▼'} ${pct(Math.abs(delta), 0)}</span> vs. ${diaLongo(V.dia - 7)} (${brlK(pa.vl)})` : (V.dia - 7 >= D.ini ? `sem pedido em ${diaLongo(V.dia - 7)}` : '');
  const per = resumoNf(D.nf.filter(o => o.d >= V.de && o.d <= V.ate && f(o)));
  const pp = resumoPed(D.ped.filter(o => o.d >= V.de && o.d <= V.ate && f(o)));
  const parcial = V.dia === H ? ` · até ${hm(D.cargas.pedido)}` : '';
  let html = `
  <div class="filters">${selRca('v-rca', rca)}<div class="fld"><label for="v-dia">Dia</label><input type="date" id="v-dia" value="${iso(V.dia)}" max="${iso(H)}" min="${iso(D.ini)}"></div></div>
  <section class="sec">
    <div class="h">Venda do dia <small>${diaLongo(V.dia)}${parcial}</small></div>
    <div class="kpis k2">${kpi('Digitado', brlK(pd.vl), dTxt, 'hero')}${kpi('Faturado', brlK(fd.vl), fd.vl ? 'margem ' + pct(fd.mg) : 'notas do dia')}${kpi('Pedidos', nf0.format(pd.ped), 'digitados')}${kpi('Positivação', nf0.format(pd.pos), 'clientes com pedido')}${kpi('Ticket médio', brlK(pd.tk), 'por pedido')}</div>
  </section>
  <section class="sec">
    <div class="h">Acumulado do período <small>${dmy(V.de)} a ${dmy(V.ate)}</small></div>
    ${chips('v-q', V.q, [['hoje', 'Hoje'], ['semana', 'Semana'], ['mes', 'Mês'], ['ant', 'Mês anterior'], ['3m', '3 meses']])}
    <div class="filters"><div class="fld"><label for="v-de">De</label><input type="date" id="v-de" value="${iso(V.de)}" min="${iso(D.ini)}" max="${iso(H)}"></div><div class="fld"><label for="v-ate">Até</label><input type="date" id="v-ate" value="${iso(V.ate)}" min="${iso(D.ini)}" max="${iso(H)}"></div></div>
    <div class="kpis k2">${kpi('Venda', brlK(per.vl), 'faturada', 'hero')}${kpi('Margem', pct(per.mg), brlK(per.vl - per.cmv) + ' de lucro bruto')}${kpi('Digitado', brlK(pp.vl), nf0.format(pp.ped) + ' pedidos')}${kpi('Positivação', nf0.format(per.pos), 'clientes faturados')}${kpi('Pedidos', nf0.format(per.ped), 'faturados')}${kpi('Ticket médio', brlK(per.tk), 'faturado por pedido')}</div>
    ${seg('v-graf', V.graf, [['fat', 'Faturado por dia'], ['dig', 'Digitado por dia']])}
    <div class="card">${graficoDias(V.de, V.ate, V.graf, rca, V.dia) || '<span class="muted">Escolha um período com mais de um dia para ver a venda diária.</span>'}</div>
  </section>`;
  if (!ehRca()) {
    const linhas = D.rcas.map(r => ({
      r, dd: resumoPed(D.ped.filter(o => o.d === V.dia && o.rca === r.cod)), df: resumoNf(D.nf.filter(o => o.d === V.dia && o.rca === r.cod)),
      p: resumoNf(D.nf.filter(o => o.d >= V.de && o.d <= V.ate && o.rca === r.cod)),
    })).filter(x => x.r.ativo || x.p.vl || x.dd.vl).sort((a, b) => b.p.vl - a.p.vl);
    const tot = linhas.reduce((a, x) => a + x.p.vl, 0) || 1;
    html += `
  <section class="sec">
    <div class="h">Por RCA <small>toque para filtrar</small></div>
    <div class="list">${linhas.length ? linhas.map(({ r, dd, df, p }) => `
      <button type="button" class="row${r.cod === rca ? ' sel' : ''}" data-a="v-rca" data-v="${r.cod === rca ? 0 : r.cod}">
        <span class="t">${esc(r.nome)} <span class="code">${r.cod}</span></span>
        <span class="r">${brlK(p.vl)}</span>
        <span class="sub">Dia: digitado ${brlK(dd.vl)} · faturado ${brlK(df.vl)} · ${dd.ped} ped. ${V.dia === H && !dd.ped && r.ativo ? '<span class="pill warn">sem pedido hoje</span>' : ''}</span>
        <span class="sub r"><span class="pill ${p.vl && p.mg < .12 ? 'warn' : ''}">margem ${pct(p.mg)}</span></span>
        <span class="sub full">${p.pos} clientes positivados · ${p.ped} pedidos faturados no período</span>
        <span class="full">${bar(p.vl / tot)}</span>
      </button>`).join('') : vazio('Nenhum RCA com venda no período.')}
    </div>
  </section>`;
  }
  if (ehGerente() && R) {
    const i0 = R.meses.length - 1, ls = R.setores.map(s => ({ s, v: s.venda[i0], c: s.cmv[i0], pos: s.pos[i0] })).sort((a, b) => b.v - a.v);
    const mx = ls.length ? ls[0].v || 1 : 1;
    html += `
  <section class="sec"><div class="h">Por setor <small>${nomeMes(R.meses[i0])} · toque para abrir</small></div>
    <div class="list">${ls.map(x => `
      <button type="button" class="row${x.s.cod === D.setor.cod ? ' sel' : ''}" data-a="setor" data-v="${x.s.cod}">
        <span class="t">${esc(x.s.nome)}</span><span class="r">${brlK(x.v)}</span>
        <span class="sub">${nf0.format(x.pos)} clientes positivados</span><span class="sub r"><span class="pill">margem ${pct(x.v ? (x.v - x.c) / x.v : 0)}</span></span>
        <span class="full">${bar(x.v / mx, 'gold')}</span>
      </button>`).join('')}</div></section>`;
  }
  return html;
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
  const pos = cartF.filter(c => vendas.has(c.cod)).length;
  const comp = baseTodos.filter(c => vendas.has(c.cod) && noLugar(c)).map(c => ({ c, vl: vendas.get(c.cod).vl, n: vendas.get(c.cod).n.size, fora: !cartSet.has(c.cod) })).sort((a, b) => b.vl - a.vl);
  const nao = cartF.filter(c => !vendas.has(c.cod)).map(c => ({ c, pot: temPot ? (pot.get(c.cod) || 0) / 3 : null, ult: ultima(c) })).sort((a, b) => (b.pot || 0) - (a.pot || 0) || (b.ult || 0) - (a.ult || 0));
  const fora = comp.filter(x => x.fora).length;
  const lista = C.modo === 'comp' ? comp : nao;
  const chave = C.cid ? 'bairro' : 'cidade', grupos = new Map();
  for (const c of cartF) { const k = c[chave] || '(sem ' + chave + ')', g = grupos.get(k) || { t: 0, c: 0 }; g.t++; if (vendas.has(c.cod)) g.c++; grupos.set(k, g); }
  const gl = [...grupos.entries()].sort((a, b) => b[1].t - a[1].t);
  return `
  <div class="filters">
    <div class="fld"><label for="c-mes">Mês</label><select id="c-mes">${meses.map(m => `<option value="${m}"${C.mes === m ? ' selected' : ''}>${nomeMes(m)}${m === m0 ? ' (até hoje)' : ''}</option>`).join('')}</select></div>
    ${selRca('c-rca', C.rca)}
  </div>
  <div class="filters">
    <div class="fld"><label for="c-cid">Cidade</label><select id="c-cid"><option value="">Todas as cidades</option>${cidades.map(c => `<option value="${esc(c)}"${c === C.cid ? ' selected' : ''}>${esc(titulo(c))}</option>`).join('')}</select></div>
    <div class="fld"><label for="c-bai">Bairro</label><select id="c-bai"${C.cid ? '' : ' disabled'}><option value="">${C.cid ? 'Todos os bairros' : 'Escolha a cidade'}</option>${bairros.map(b => `<option value="${esc(b)}"${b === C.bai ? ' selected' : ''}>${esc(titulo(b))}</option>`).join('')}</select></div>
  </div>
  <div class="card sec">
    <div class="h">Positivação no mês <small>${pos} de ${cartF.length} clientes da carteira</small></div>
    <div class="kpis" style="grid-template-columns:auto minmax(0,1fr);align-items:center;gap:12px"><span class="num" style="font-size:30px;font-weight:800;color:var(--gold)">${pct(cartF.length ? pos / cartF.length : 0, 0)}</span>${bar(cartF.length ? pos / cartF.length : 0, 'gold')}</div>
    <span class="sub">Carteira ativa: clientes ${ehRca() ? 'da sua rota' : 'dos RCAs do setor'} com compra nos últimos 180 dias.${fora ? ` Mais ${fora} ${fora > 1 ? 'clientes de fora da carteira compraram' : 'cliente de fora da carteira comprou'}.` : ''}</span>
  </div>
  <section class="sec">
    <div class="h">Por ${chave} <small>toque para filtrar</small></div>
    <div class="list">${gl.length ? gl.map(([k, g]) => `
      <button type="button" class="row" data-a="${chave === 'cidade' ? 'c-cid' : 'c-bai'}" data-v="${esc(k)}">
        <span class="t">${esc(titulo(k))}</span><span class="r">${g.c}/${g.t} · ${pct(g.c / g.t, 0)}</span>
        <span class="full">${bar(g.c / g.t)}</span>
      </button>`).join('') : vazio('Nenhum cliente neste filtro.')}</div>
  </section>
  <section class="sec">
    ${seg('c-modo', C.modo, [['comp', `Compradores <span class="n">${comp.length}</span>`], ['nao', `Não compradores <span class="n">${nao.length}</span>`]])}
    <div class="list">${lista.length ? lista.slice(0, 300).map(x => `
      <button type="button" class="row" data-a="cli" data-v="${x.c.cod}">
        <span class="t">${esc(x.c.fantasia)} <span class="code">${x.c.cod}</span></span>
        <span class="r">${C.modo === 'comp' ? brl(x.vl) : (x.pot ? brl(x.pot) + '/mês' : '—')}</span>
        <span class="sub">${esc(titulo(x.c.bairro))}${x.c.bairro ? ' · ' : ''}${esc(titulo(x.c.cidade))}${rca || ehRca() ? '' : ' · ' + esc(rcaNome(x.c.rca))}</span>
        <span class="sub r">${C.modo === 'comp' ? x.n + (x.n > 1 ? ' pedidos' : ' pedido') + (x.fora ? ' <span class="pill">fora da carteira</span>' : '') : (x.ult != null ? `última ${dm(x.ult)} <span class="pill ${d2 - x.ult > 60 ? 'bad' : 'warn'}">${d2 - x.ult} dias</span>` : 'sem compras')}</span>
      </button>`).join('') + (lista.length > 300 ? vazio(`Mostrando 300 de ${lista.length}. Filtre por cidade ou RCA para ver o resto.`) : '') : vazio('Nenhum cliente neste filtro.')}</div>
    ${C.modo === 'nao' && !temPot ? '<span class="sub">O potencial (média dos 3 meses anteriores) não aparece no mês mais antigo: o app guarda só os últimos 4 meses.</span>' : ''}
  </section>`;
}

/* ---------------- aba: cliente ---------------- */
const ICA = {
  fone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  zap: '<path d="M4 20l1.3-4A8 8 0 1 1 8 18.7z"/><path d="M9 9.5c.3 2 2.2 4.2 4.5 4.9l1.2-1.1 1.8.8-.3 1.6c-3.8.4-7.6-3.3-7.3-7.2l1.5-.4.9 1.8z"/>',
  mapa: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
};
/* telefone do WinThor: com DDD (10-11 dígitos) vale para ligar e WhatsApp; sem DDD (8-9) só para ligar */
function telDigitos(s, min) { const d = String(s || '').replace(/\D/g, '').replace(/^0+/, '').replace(/^55(?=\d{10,11}$)/, ''); return d.length >= (min || 10) && d.length <= 11 ? d : ''; }
function vCliente() {
  const K = S.k, H = D.hoje;
  const volta = K.volta && K.cod ? `<button type="button" class="link" data-a="voltar" style="align-self:flex-start;padding-left:0">← Voltar para ${esc(({ vendas: 'Vendas', carteira: 'Carteira', abc: 'Curva ABC', inad: 'Inadimplência', dev: 'Devolução' })[K.volta] || 'a tela anterior')}</button>` : '';
  const form = `${volta}<form id="fcli" class="sec"><label class="h" for="codcli">Cliente</label>
    <div class="search"><input id="codcli" autocomplete="off" placeholder="Código ou nome" value="${esc(K.raw)}"><button class="btn" type="submit">Buscar</button></div></form>`;
  if (!K.cod) {
    const q = semAcento(K.raw).trim();
    if (q.length >= 2) {
      const ach = D.cli.filter(c => String(c.cod).startsWith(q) || semAcento(c.fantasia).includes(q) || semAcento(c.razao).includes(q)).slice(0, 40);
      const marca = s => { const t = String(s), i = semAcento(t).indexOf(q); return i < 0 ? esc(t) : esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + q.length)) + '</mark>' + esc(t.slice(i + q.length)); };
      return form + `<section class="sec"><div class="h">Resultado <small>${ach.length >= 40 ? 'os 40 primeiros' : ach.length + (ach.length === 1 ? ' cliente' : ' clientes')}</small></div><div class="list">${ach.length ? ach.map(c => `<button type="button" class="row" data-a="cli" data-v="${c.cod}"><span class="t">${marca(c.fantasia)} <span class="code">${marca(c.cod)}</span></span><span class="r code">abrir</span><span class="sub full">${esc(titulo(c.bairro))}${c.bairro ? ' · ' : ''}${esc(titulo(c.cidade))}</span></button>`).join('') : vazio('Nenhum cliente da sua base com esse código ou nome.')}</div></section>`;
    }
    const m0 = mesDe(H), top = new Map();
    for (const o of D.nf) if (o.d >= m0 && o.vl > 0) top.set(o.cli, (top.get(o.cli) || 0) + o.vl);
    const maiores = [...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    return form + `<section class="sec"><div class="h">Maiores compradores do mês</div><div class="list">${maiores.length ? maiores.map(([cod, v]) => { const c = D.CMAP.get(cod); return `<button type="button" class="row" data-a="cli" data-v="${cod}"><span class="t">${esc(cliNome(cod))} <span class="code">${cod}</span></span><span class="r">${brl(v)}</span><span class="sub full">${c ? esc(titulo(c.bairro)) + (c.bairro ? ' · ' : '') + esc(titulo(c.cidade)) : ''}</span></button>`; }).join('') : vazio('Sem compras no mês.')}</div></section>`;
  }
  const c = D.CMAP.get(K.cod);
  if (!c) return form + `<div class="msg">O cliente ${esc(K.cod)} não faz parte da sua base${ehRca() ? ' (sua rota)' : ' (seu setor)'}, ou não compra há mais de um ano. Confira o código.</div>`;

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

  // últimas compras (itens dos últimos meses que o app guarda)
  const porF = new Map(), porP = new Map();
  for (const it of D.item) {
    if (it.cli !== c.cod) continue;
    const fo = fornDe(it.p), f = porF.get(fo) || { ult: 0, v90: 0, prods: new Set() };
    f.ult = Math.max(f.ult, it.ult || 0); if (it.ult > H - 90) { f.v90 += it.v; f.prods.add(it.p); } porF.set(fo, f);
    const p = porP.get(it.p); if (!p || (it.ult || 0) > p.d) porP.set(it.p, { d: it.ult || 0, q: it.q, pu: it.q ? it.v / it.q : 0 });
  }
  const lf = [...porF.entries()].sort((a, b) => b[1].ult - a[1].ult || b[1].v90 - a[1].v90);
  const lp = [...porP.entries()].sort((a, b) => b[1].d - a[1].d).slice(0, 25);

  return form + `
  <div class="card cli-head">
    <div style="display:flex;flex-wrap:wrap;gap:6px">${pills.join('')}</div>
    <h2>${esc(c.fantasia)}</h2>
    <div class="sub">${c.cod} · ${esc(c.razao)}</div>
  </div>
  <div class="acoes">
    <a class="acao" href="${ligar}" aria-disabled="${!fone}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICA.fone}</svg>Ligar</a>
    <a class="acao" href="${zap ? 'https://wa.me/55' + zap : '#'}" target="_blank" rel="noopener" aria-disabled="${!zap}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICA.zap}</svg>WhatsApp</a>
    <a class="acao" href="${ender ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(ender) : '#'}" target="_blank" rel="noopener" aria-disabled="${!ender}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICA.mapa}</svg>Mapa</a>
  </div>
  <section class="sec"><div class="h">Dados do cliente</div>
    <div class="card"><dl class="kv" style="margin:0">
      <div><dt>CNPJ / CPF</dt><dd class="sel-text">${esc(c.cnpj || '—')}</dd></div>
      <div><dt>Ramo</dt><dd>${esc(titulo(c.ramo) || '—')}</dd></div>
      <div class="w"><dt>Endereço de entrega</dt><dd>${esc(c.end || '—')}${c.bairro ? ' · ' + esc(titulo(c.bairro)) : ''}${c.cidade ? ' · ' + esc(titulo(c.cidade)) : ''}</dd></div>
      <div><dt>Telefone</dt><dd class="sel-text">${esc(c.cel || c.fone || '—')}</dd></div>
      <div><dt>RCA da carteira</dt><dd>${esc(rcaNome(c.rca))} ${c.rca ? `<span class="code">${c.rca}</span>` : ''}</dd></div>
    </dl></div>
  </section>
  <section class="sec"><div class="h">Prazo e limite</div>
    <div class="kpis k2">
      ${kpi('Prazo', esc(c.plano || '—'), c.prazo != null ? c.prazo + ' dias' : '')}
      ${kpi('Limite de crédito', brl(c.limite), '')}
      ${kpi('Em aberto', brl(emAberto), abertos.length + (abertos.length === 1 ? ' título' : ' títulos'))}
      ${kpi('Disponível', `<span class="${disp < 0 ? 'down' : ''}">${brl(disp)}</span>`, '')}
    </div>
    ${bar(c.limite ? emAberto / c.limite : 0, emAberto > c.limite ? 'bad' : '')}
    ${vencido ? `<div class="msg bad">${brl(vencido)} vencidos em ${venc.length} ${venc.length > 1 ? 'títulos' : 'título'} · maior atraso ${Math.max(...venc.map(t => H - t.venc))} dias</div>` : ''}
    ${abertos.length ? `<div class="list">${abertos.slice().sort((a, b) => a.venc - b.venc).slice(0, Math.max(6, venc.length)).map(t => `
      <div class="row"><span class="t">Título ${t.dup}${t.prest ? '-' + esc(t.prest) : ''}</span><span class="r">${brl2(t.valor)}</span>
      <span class="sub">vence ${dmy(t.venc)} · ${esc(titulo(D.cob[t.cob] || t.cob || ''))}</span><span class="sub r">${t.venc < H ? `<span class="pill ${H - t.venc > 30 ? 'bad' : 'warn'}">${H - t.venc} dias</span>` : '<span class="pill">a vencer</span>'}</span></div>`).join('')}${abertos.length > Math.max(6, venc.length) ? `<div class="empty">Mais ${abertos.length - Math.max(6, venc.length)} títulos a vencer, até ${dmy(Math.max(...abertos.map(t => t.venc)))}.</div>` : ''}</div>` : ''}
    ${outros.length ? `<div class="faixa info">Fora da cobrança (jurídico, perdas ou crédito): ${brl(soma(outros, t => t.valor))} em ${outros.length} ${outros.length > 1 ? 'títulos' : 'título'}.</div>` : ''}
  </section>
  <section class="sec"><div class="h">Compras</div>
    <div class="kpis">
      ${kpi('Última', ultD != null ? dm(ultD) : '—', dias !== null ? `há ${dias} dias` : '')}
      ${kpi('Frequência', freq ? nf0.format(freq) + ' d' : '—', 'entre compras')}
      ${kpi('Ticket médio', peds.length ? brlK(soma(peds, p => p.vl) / peds.length) : '—', 'por pedido')}
    </div>
    <div class="sub">${brl(soma(v90, p => p.vl))} em ${v90.length} ${v90.length === 1 ? 'pedido faturado' : 'pedidos faturados'} nos últimos 90 dias.</div>
  </section>
  <section class="sec"><div class="h">Últimas compras</div>
    ${seg('k-modo', K.modo, [['forn', 'Por fornecedor'], ['prod', 'Por produto'], ['ped', 'Pedidos']])}
    <div class="list">${K.modo === 'forn' ? (lf.length ? lf.map(([f, x]) => `
      <div class="row"><span class="t">${esc(fornNome(f))}</span><span class="r">${brl(x.v90)}</span>
      <span class="sub">última compra ${dm(x.ult)} · há ${H - x.ult} dias</span><span class="sub r">${x.prods.size} ${x.prods.size === 1 ? 'produto' : 'produtos'} em 90 d</span></div>`).join('') : vazio('Sem compras nos últimos meses.'))
    : K.modo === 'prod' ? (lp.length ? lp.map(([p, x]) => `
      <div class="row"><span class="t">${esc(prodNome(p))}</span><span class="r">${dm(x.d)}</span>
      <span class="sub">${esc(fornNome(fornDe(p)))}</span><span class="sub r">${nf0.format(x.q)} un · ${brl2(x.pu)}</span></div>`).join('') : vazio('Sem compras nos últimos meses.'))
    : ((emAbertoDig.length || peds.length) ? emAbertoDig.slice(0, 5).map(o => `
      <div class="row"><span class="t">Pedido ${o.num}</span><span class="r">${brl(o.vl)}</span>
      <span class="sub">${diaLongo(o.d)} · digitado</span><span class="sub r"><span class="pill warn">${({ L: 'liberado', B: 'bloqueado', M: 'montado', P: 'pendente' })[o.pos] || 'em aberto'}</span></span></div>`).join('') + peds.slice(-10).reverse().map(o => `
      <div class="row"><span class="t">Pedido ${o.num}</span><span class="r">${brl(o.vl)}</span>
      <span class="sub">${diaLongo(o.d)} · faturado</span><span class="sub r">margem ${pct(o.vl ? (o.vl - o.cmv) / o.vl : 0)}</span></div>`).join('') : vazio('Sem pedidos nos últimos meses.'))}
    </div>
  </section>`;
}

/* ---------------- aba: curva ABC ---------------- */
function vAbc() {
  const A2 = S.a, meses = new Set(mesesDoPeriodo(A2.per));
  const rca = ehRca() ? D.codusur : A2.rca;
  const m = new Map();
  for (const it of D.item) {
    if (!meses.has(it.mes) || (rca && it.rca !== rca)) continue;
    const k = A2.modo === 'forn' ? fornDe(it.p) : it.p;
    const x = m.get(k) || { v: 0, mg: 0, cl: new Set() }; x.v += it.v; x.mg += it.v - it.c; x.cl.add(it.cli); m.set(k, x);
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
  const nome = k => A2.modo === 'forn' ? fornNome(k) : prodNome(k);
  const ms = [...meses].sort((a, b) => a - b), rotulo = ms.length > 1 ? nomeMes(ms[0]) + ' a ' + nomeMes(ms[ms.length - 1]) : nomeMes(ms[0]);
  const LIM = 150;
  return `
  ${seg('a-modo', A2.modo, [['forn', 'Por fornecedor'], ['prod', 'Por produto']])}
  <div class="filters">${selRca('a-rca', A2.rca)}</div>
  ${chips('a-per', A2.per, [['mes', 'Mês atual'], ['ant', 'Mês anterior'], ['3m', 'Últimos 3 meses']])}
  <div class="kpis">${resumoCl.map(([cl, n, p]) => kpi(`Classe ${cl}`, nf0.format(n), (A2.modo === 'forn' ? (n === 1 ? 'fornecedor' : 'fornecedores') : (n === 1 ? 'produto' : 'produtos')) + ' · ' + pct(p, 0) + ' da venda')).join('')}</div>
  <section class="sec">
    <div class="h">Ranking <small>${rotulo} · ${brlK(tot)}</small></div>
    <div class="list">${rows.length ? rows.slice(0, LIM).map((x, i) => `
      <div class="row">
        <span class="t"><span class="code">${i + 1}.</span> ${esc(nome(x.k))}</span>
        <span class="r">${brlK(x.v)}</span>
        <span class="sub">${pct(x.part)} da venda · acumulado ${pct(x.acc, 0)} · margem ${pct(x.v ? x.mg / x.v : 0)}</span>
        <span class="sub r"><span class="pill ${x.abc}">${x.abc}</span></span>
        <span class="sub full">${x.cl.size} de ${base} clientes da carteira compraram${x.cl.size / base < .25 && x.abc !== 'C' ? ' · <span class="pill warn">pouca positivação</span>' : ''}</span>
        <span class="full">${bar(x.v / max, x.abc === 'A' ? 'gold' : '')}</span>
      </div>`).join('') + (rows.length > LIM ? vazio(`Mostrando os ${LIM} primeiros de ${rows.length}.`) : '') : vazio('Sem venda faturada no período.')}</div>
  </section>`;
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
  let html = `
  <div class="kpis k2">${kpi('Vencido', brlK(tot), 'em aberto hoje', 'perigo wide')}${kpi('Títulos', nf0.format(meus.length), 'vencidos')}${kpi('Clientes', nf0.format(clis.size), 'com título vencido')}${kpi('Bloqueados', nf0.format(bloq), 'no WinThor', 'atencao')}${kpi('A vencer', brlK(soma(aVencer, t => t.valor)), nf0.format(aVencer.length) + ' títulos')}</div>
  <section class="sec"><div class="h">Por atraso</div>
    <div class="card sec">
      <div class="stack">${faixas.map(f => f.v ? `<i style="width:${(f.v / (tot || 1) * 100).toFixed(1)}%;background:var(--${f.cor})" title="${f.b > 9999 ? '+90' : f.a + '–' + f.b} dias: ${brl2(f.v)}"></i>` : '').join('')}</div>
      <div class="legend">${faixas.map(f => `<span><i style="background:var(--${f.cor})"></i>${f.b > 9999 ? '+90' : f.a + '–' + f.b} dias · <b class="num">${brlK(f.v)}</b></span>`).join('')}</div>
    </div>
    ${jur.length ? `<div class="faixa">Jurídico e perdas: ${brl(soma(jur, t => t.valor))} em ${jur.length} ${jur.length > 1 ? 'títulos' : 'título'} — fora da soma acima.</div>` : ''}
    ${fora.length ? `<div class="faixa info">Fora da cobrança (bonificação, devolução, crédito): ${brl(soma(fora, t => t.valor))} em ${fora.length} ${fora.length > 1 ? 'títulos' : 'título'}.</div>` : ''}
  </section>`;
  if (ehGerente() && R) {
    const ls = R.setores.slice().sort((a, b) => b.vencido - a.vencido), mx = ls.length ? ls[0].vencido || 1 : 1;
    html += `<section class="sec"><div class="h">Por setor <small>toque para trocar de setor</small></div>
    <div class="list">${ls.map(x => `
      <button type="button" class="row${x.cod === D.setor.cod ? ' sel' : ''}" data-a="setor" data-v="${x.cod}">
        <span class="t">${esc(x.nome)}</span><span class="r">${brlK(x.vencido)}</span>
        <span class="sub full">${nf0.format(x.clientes)} clientes${x.juridico ? ' · jurídico ' + brlK(x.juridico) : ''}</span><span class="full">${bar(x.vencido / mx, 'bad')}</span>
      </button>`).join('')}</div></section>`;
  }
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
  if (ehRca()) {
    const l = porCli(meus);
    return html + `<section class="sec"><div class="h">Seus clientes com título vencido</div><div class="list">${l.length ? l.map(x => linhaCli(x, false)).join('') : vazio('Nenhum título vencido. 👏')}</div></section>`;
  }
  const porRca = D.rcas.map(r => {
    const ts = meus.filter(t => t.rca === r.cod);
    return { r, v: soma(ts, t => t.valor), n: ts.length, cl: porCli(ts) };
  }).filter(x => x.n).sort((a, b) => b.v - a.v);
  const semRca = meus.filter(t => !D.RMAP.has(t.rca));
  const maxR = porRca[0] ? porRca[0].v || 1 : 1;
  return html + `
  <section class="sec"><div class="h">Por RCA <small>toque para ver os clientes</small></div>
    <div class="list">${porRca.length ? porRca.map(x => `
      <button type="button" class="row" data-a="i-open" data-v="${S.i.open === x.r.cod ? 0 : x.r.cod}" aria-expanded="${S.i.open === x.r.cod}">
        <span class="t">${esc(x.r.nome)} <span class="code">${x.r.cod}</span></span><span class="r">${brl(x.v)}</span>
        <span class="sub">${x.n} títulos · ${x.cl.length} clientes</span><span class="sub r">${S.i.open === x.r.cod ? 'fechar ▲' : 'ver ▼'}</span>
        <span class="full">${bar(x.v / maxR, 'bad')}</span>
      </button>
      ${S.i.open === x.r.cod ? x.cl.map(y => linhaCli(y, true)).join('') : ''}`).join('') : vazio('Nenhum título vencido no setor. 👏')}</div>
    ${semRca.length ? `<span class="sub">${semRca.length} títulos (${brl(soma(semRca, t => t.valor))}) são de RCA que não está mais no setor.</span>` : ''}
  </section>`;
}

/* ---------------- aba: devolução ---------------- */
function vDev() {
  const DV = S.d, [d1, d2] = periodo(DV.per);
  const meus = D.dev.filter(x => x.d >= d1 && x.d <= d2);
  const venda = resumoNf(D.nf.filter(o => o.d >= d1 && o.d <= d2)).vl || 0;
  const resp = x => { const m = D.mot[x.mot]; return !!(m && m[1]); };
  const tot = soma(meus, x => x.v), rv = soma(meus.filter(resp), x => x.v);
  const notas = new Set(meus.map(x => x.nota)).size;
  let html = `
  ${chips('d-per', DV.per, [['mes', 'Mês atual'], ['ant', 'Mês anterior'], ['3m', 'Últimos 3 meses']])}
  <div class="kpis k2">${kpi('Devolvido', brlK(tot), `${pct(venda ? tot / venda : 0)} da venda faturada de ${dm(d1)} a ${dm(d2)}`, 'perigo wide')}${kpi('Devoluções', nf0.format(notas), 'notas de devolução')}${kpi('Clientes', nf0.format(new Set(meus.map(x => x.cli)).size), 'que devolveram')}${kpi('Resp. do RCA', brlK(rv), pct(tot ? rv / tot : 0, 0) + ' do total', 'atencao')}${kpi('Venda', brlK(venda), 'faturada')}</div>`;
  if (ehGerente() && R) {
    const idx = mesesDoPeriodo(DV.per).map(m => R.meses.indexOf(m)).filter(i => i >= 0);
    const ls = R.setores.map(s => { const v = idx.reduce((a, i) => a + s.dev[i], 0), vd = idx.reduce((a, i) => a + s.venda[i], 0); return { s, v, p: vd ? v / vd : 0 }; }).sort((a, b) => b.p - a.p);
    const mx = Math.max(...ls.map(x => x.p)) || 1;
    html += `<section class="sec"><div class="h">Por setor <small>% sobre a venda</small></div>
    <div class="list">${ls.map(x => `
      <button type="button" class="row${x.s.cod === D.setor.cod ? ' sel' : ''}" data-a="setor" data-v="${x.s.cod}">
        <span class="t">${esc(x.s.nome)}</span><span class="r">${pct(x.p)}</span>
        <span class="sub full">${brl(x.v)} devolvidos</span><span class="full">${bar(x.p / mx, 'bad')}</span>
      </button>`).join('')}</div></section>`;
  }
  const linhaDev = (y, filho) => `
        <button type="button" class="row" data-a="cli" data-v="${y.cli}"${filho ? ' data-filho' : ''}>
          <span class="t">${esc(cliNome(y.cli))}</span><span class="r">${brl(y.v)}</span>
          <span class="sub">${dm(y.d)} · nota ${y.nota}</span><span class="sub r">${resp(y) ? '<span class="pill rca">RCA</span>' : ''}</span>
          <span class="sub full">${esc(titulo((D.mot[y.mot] || [])[0] || 'Motivo ' + y.mot))}</span>
        </button>`;
  if (ehRca()) {
    html += `<section class="sec"><div class="h">Suas devoluções</div><div class="list">${meus.length ? meus.slice().sort((a, b) => b.d - a.d).map(y => linhaDev(y, false)).join('') : vazio('Nenhuma devolução no período. 👏')}</div></section>`;
  } else {
    const porRca = D.rcas.map(r => {
      const l = meus.filter(x => x.rca === r.cod), v = soma(l, x => x.v), vr = resumoNf(D.nf.filter(o => o.d >= d1 && o.d <= d2 && o.rca === r.cod)).vl;
      return { r, l, v, p: vr ? v / vr : 0, rv: soma(l.filter(resp), x => x.v) };
    }).filter(x => x.l.length).sort((a, b) => b.v - a.v);
    const maxR = porRca[0] ? porRca[0].v || 1 : 1;
    html += `<section class="sec"><div class="h">Por RCA <small>toque para ver as devoluções</small></div>
    <div class="list">${porRca.length ? porRca.map(x => `
      <button type="button" class="row" data-a="d-open" data-v="${S.d.open === x.r.cod ? 0 : x.r.cod}" aria-expanded="${S.d.open === x.r.cod}">
        <span class="t">${esc(x.r.nome)} <span class="code">${x.r.cod}</span></span><span class="r">${brl(x.v)}</span>
        <span class="sub">${new Set(x.l.map(y => y.nota)).size} devoluções · ${pct(x.p)} da venda dele</span><span class="sub r">${x.rv ? `<span class="pill rca">RCA ${brlK(x.rv)}</span>` : ''}</span>
        <span class="full">${bar(x.v / maxR, 'bad')}</span>
      </button>
      ${S.d.open === x.r.cod ? x.l.slice().sort((a, b) => b.d - a.d).map(y => linhaDev(y, true)).join('') : ''}`).join('') : vazio('Nenhuma devolução no período. 👏')}</div></section>`;
  }
  const mot = new Map(); for (const x of meus) { const y = mot.get(x.mot) || { v: 0, n: 0 }; y.v += x.v; y.n++; mot.set(x.mot, y); }
  const ml = [...mot.entries()].sort((a, b) => b[1].v - a[1].v), maxM = ml.length ? ml[0][1].v || 1 : 1;
  html += `<section class="sec"><div class="h">Motivos</div>
    <div class="list">${ml.length ? ml.map(([k, y]) => `
      <div class="row"><span class="t">${esc(titulo((D.mot[k] || [])[0] || 'Motivo ' + k))} ${(D.mot[k] || [])[1] ? '<span class="pill rca">RCA</span>' : ''}</span><span class="r">${brl(y.v)}</span>
      <span class="sub full">${y.n} ${y.n > 1 ? 'ocorrências' : 'ocorrência'}</span><span class="full">${bar(y.v / maxM, 'bad')}</span></div>`).join('') : vazio('Nenhuma devolução no período.')}</div>
  </section>`;
  return html;
}

/* ---------------- acessos (administrador) ---------------- */
function vAcessos() {
  const AD = S.adm;
  const topo = `<button type="button" class="link" data-a="tab" data-v="vendas" style="align-self:flex-start;padding-left:0">← Voltar</button><div class="h">Acessos ao app <small>RCA, supervisor e gerente</small></div>`;
  if (AD.carregando && !AD.dados) return topo + '<div class="esq" style="height:120px"></div><div class="esq" style="height:120px"></div>';
  if (AD.erro && !AD.dados) return topo + `<div class="msg bad">${esc(AD.erro)}</div><button class="btn sec" data-a="adm-recarregar" type="button">Tentar de novo</button>`;
  if (!AD.dados) return topo;
  const cs = AD.dados.contas, setores = AD.dados.setores;
  const n = s => cs.filter(c => c.situacao === s).length;
  const lista = cs.filter(c => AD.filtro === 'todos' || c.situacao === AD.filtro);
  const sit = { pendente: 'warn', liberado: 'good', recusado: 'bad', bloqueado: 'bad' };
  return topo + chips('adm-f', AD.filtro, [['pendente', `Pendentes (${n('pendente')})`], ['liberado', `Liberados (${n('liberado')})`], ['todos', `Todos (${cs.length})`]]) +
    '<div class="faixa info">Gerente entra direto quando tem o SUPERVISOR LUBE liberado no Painel. Aqui ficam as contas de RCA e supervisor (e gerente de fora do Painel).</div>' +
    (lista.length ? lista.map(c => `
    <div class="card conta-card" data-conta="${c.id}">
      <div class="topo"><div><b>${esc(c.nome || '(sem nome)')}</b><span>${esc(c.email)}</span></div><span class="pill ${sit[c.situacao] || ''}">${esc(c.situacao)}</span></div>
      <div class="filters">
        <div class="fld"><label>Perfil</label><select data-campo="tipo"><option value="rca"${c.tipo === 'rca' ? ' selected' : ''}>RCA</option><option value="supervisor"${c.tipo === 'supervisor' ? ' selected' : ''}>Supervisor</option><option value="gerente"${c.tipo === 'gerente' ? ' selected' : ''}>Gerente</option></select></div>
        <div class="fld" data-so="rca"${c.tipo === 'rca' ? '' : ' hidden'}><label>Código do RCA</label><input data-campo="codusur" inputmode="numeric" value="${c.codusur || ''}"></div>
        <div class="fld" data-so="supervisor"${c.tipo === 'supervisor' ? '' : ' hidden'}><label>Setor</label><select data-campo="codsupervisor"><option value="">Escolha o setor</option>${setores.map(([cod, nome]) => `<option value="${cod}"${c.codsupervisor === cod ? ' selected' : ''}>${esc(nome)}</option>`).join('')}</select></div>
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
  S.adm.carregando = true; S.adm.erro = ''; if (S.tab === 'acessos') render();
  try {
    const t = await A.token();
    const r = await fetch((CFG.api || '') + '/api/acessos', { headers: { Authorization: 'Bearer ' + t }, cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.mensagem || 'Não consegui ler os acessos (' + r.status + ').');
    S.adm.dados = j;
  } catch (e) { S.adm.erro = e.message || String(e); }
  S.adm.carregando = false; if (S.tab === 'acessos') render();
}
async function decidirAcesso(card, situacao) {
  const campo = n => card.querySelector(`[data-campo="${n}"]`);
  const corpo = { id: card.dataset.conta, situacao, tipo: campo('tipo').value, codusur: campo('codusur').value.replace(/\D/g, ''), codsupervisor: campo('codsupervisor').value };
  try {
    const t = await A.token();
    const r = await fetch((CFG.api || '') + '/api/acessos', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.mensagem || 'Não consegui gravar (' + r.status + ').');
    toast(situacao === 'liberado' ? 'Acesso liberado.' : situacao === 'recusado' ? 'Pedido recusado.' : 'Acesso bloqueado.');
    await carregarAcessos();
  } catch (e) { toast(e.message || String(e), true); }
}

/* ---------------- cabeçalho, abas, menu ---------------- */
const ICON = {
  vendas: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />',
  carteira: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.6-3.4 3-5.2 6-5.2s5.4 1.8 6 5.2"/><path d="M16 4.6a3 3 0 0 1 0 6M18 14.6c1.8.7 2.9 2.4 3.2 5.4"/>',
  cliente: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.6-4.6"/>',
  abc: '<path d="M4 6h16M4 12h11M4 18h6"/>',
  inad: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  dev: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
};
const TABS = [['vendas', 'Vendas', vVendas], ['carteira', 'Carteira', vCarteira], ['cliente', 'Cliente', vCliente], ['abc', 'Curva ABC', vAbc], ['inad', 'Inadimpl.', vInad], ['dev', 'Devolução', vDev]];

function cabecalho() {
  $('#perfil-rotulo').textContent = !conta ? '—' : conta.tipo === 'gerente' ? 'Gerente' : conta.tipo === 'supervisor' ? 'Supervisor' : 'RCA ' + (conta.codusur || '');
  $('#conta-btn').textContent = iniciais(conta && (conta.nome || conta.email));
  const box = $('#setor-box');
  if (ehGerente() && R) {
    box.innerHTML = `<select id="setor" class="setor-sel" aria-label="Setor">${R.setores.map(s => `<option value="${s.cod}"${D && s.cod === D.setor.cod ? ' selected' : ''}>${esc(s.nome)}</option>`).join('')}</select>`;
  } else if (D && ehRca()) {
    box.innerHTML = `<div class="setor-fixo">${esc(D.rcaNome || conta.nome || 'RCA')}<small>RCA ${D.codusur} · ${esc(D.setor.nome || '')}</small></div>`;
  } else {
    box.innerHTML = `<div class="setor-fixo">${esc(D ? D.setor.nome : '…')}</div>`;
  }
  const w = $('#when');
  if (!D) { w.textContent = ''; return; }
  const ped = D.cargas.pedido, fat = D.cargas.faturado;
  const velho = ped && (Date.now() - new Date(ped).getTime() > 3 * 3600e3);
  w.className = 'when' + (offline ? ' off' : velho ? ' velho' : '');
  w.textContent = (offline ? 'sem conexão · ' : '') + 'pedidos ' + hm(ped) + ' · faturado ' + hm(fat);
  w.title = 'Pedidos digitados até ' + diaHm(ped) + '; venda faturada até ' + diaHm(fat) + '; títulos ' + diaHm(D.cargas.titulo) + '. Toque para atualizar.';
}

function render(topo) {
  if (!conta) return;
  cabecalho();
  const view = $('#view');
  if (S.tab === 'acessos') {
    $('#tabs').innerHTML = abas();
    view.innerHTML = vAcessos();
  } else if (!D) {
    $('#tabs').innerHTML = abas();
    view.innerHTML = '<div class="esq" style="height:150px"></div><div class="esq" style="height:90px"></div><div class="esq" style="height:220px"></div>';
  } else {
    if (!TABS.some(t => t[0] === S.tab)) S.tab = 'vendas';
    $('#tabs').innerHTML = abas();
    const faixa = (offline ? '<div class="faixa">Sem conexão: mostrando a última cópia guardada no aparelho.</div>' : '') +
      (appNovo ? `<button type="button" class="faixa info" data-a="baixar-app" style="width:100%;text-align:left;cursor:pointer">Nova versão do app (${esc(appNovo.versao)}) — toque para baixar e instalar.</button>` : '');
    try { view.innerHTML = faixa + TABS.find(t => t[0] === S.tab)[2](); }
    catch (e) { console.error(e); view.innerHTML = `<div class="msg bad">Algo deu errado ao montar esta tela: ${esc(e.message)}. Toque em outra aba ou atualize.</div>`; }
  }
  salvarTela();
  if (topo) window.scrollTo(0, 0);
}
function abas() {
  return TABS.map(([k, l]) => `<button type="button" data-a="tab" data-v="${k}"${S.tab === k ? ' aria-current="page"' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg><span>${l}</span></button>`).join('');
}

let toastTimer = null;
function toast(msg, ruim) {
  const t = $('#toast'); t.textContent = msg; t.classList.toggle('bad', !!ruim); t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 4000);
}

const ICM = {
  atual: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
  acessos: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.6-3.4 3-5.2 6-5.2s5.4 1.8 6 5.2"/><path d="M17 8l2 2 4-4"/>',
  instalar: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 21h16"/>',
  sair: '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
};
function abrirMenu() {
  const ios = !CFG.nativo && /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches && !navigator.standalone;
  const pend = S.adm.dados ? S.adm.dados.contas.filter(c => c.situacao === 'pendente').length : null;
  $('#folha').innerHTML = `
    <div class="quem"><span class="conta-btn">${esc(iniciais(conta.nome || conta.email))}</span><div><b>${esc(conta.nome || conta.email)}</b><span>${esc(conta.email || '')} · ${esc($('#perfil-rotulo').textContent)}</span></div></div>
    <button type="button" class="item" data-a="m-atualizar"><svg viewBox="0 0 24 24">${ICM.atual}</svg>Atualizar dados<small>${D ? 'gerado ' + diaHm(D.gerado) : ''}</small></button>
    ${conta.admin ? `<button type="button" class="item" data-a="m-acessos"><svg viewBox="0 0 24 24">${ICM.acessos}</svg>Acessos ao app<small>${pend == null ? '' : pend + ' pendente' + (pend === 1 ? '' : 's')}</small></button>` : ''}
    ${instalar ? `<button type="button" class="item" data-a="m-instalar"><svg viewBox="0 0 24 24">${ICM.instalar}</svg>Instalar na tela inicial</button>` : ''}
    ${ios ? `<div class="item" style="cursor:default"><svg viewBox="0 0 24 24">${ICM.instalar}</svg><span>No iPhone: toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>.</span></div>` : ''}
    <button type="button" class="item sair" data-a="m-sair"><svg viewBox="0 0 24 24">${ICM.sair}</svg>Sair</button>
    <div class="versao">Supervisor Lube · versão ${esc(CFG.versao)}</div>`;
  $('#veu').hidden = false; $('#folha').hidden = false;
  // uma tentativa por abertura do menu: se falhar, o erro fica na aba Acessos (não tenta de novo em laço)
  if (conta.admin && !S.adm.dados && !S.adm.carregando && !S.adm.erro) carregarAcessos().then(() => { if (!$('#folha').hidden && S.adm.dados) abrirMenu(); });
}
function fecharMenu() { $('#veu').hidden = true; $('#folha').hidden = true; if (!S.adm.dados) S.adm.erro = ''; }

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
      await abrirEscopo(S.escopo, (p, atualizou) => { D = montar(p); render(); if (atualizou) toast('Dados atualizados.'); });
    }
  } catch (e) {
    if (!D) $('#view').innerHTML = `<div class="msg bad">${esc(e.message || 'Não consegui carregar os dados.')}</div><button class="btn sec" type="button" data-a="m-atualizar">Tentar de novo</button>`;
  } finally { baixando = false; }
}
async function abrirSetor(cod) {
  const escopo = 'S' + cod;
  if (S.escopo !== escopo) { S.escopo = escopo; D = null; render(); }
  try { localStorage.setItem('sup-lube-setor', String(cod)); } catch (e) { /* ignora */ }
  await abrirEscopo(escopo, (p, atualizou) => { if (S.escopo !== escopo) return; D = montar(p); render(); if (atualizou) toast('Dados atualizados.'); });
}
function trocarSetor(cod) {
  S.v.rca = 0; S.c.rca = 0; S.c.cid = ''; S.c.bai = ''; S.a.rca = 0; S.i.open = 0; S.d.open = 0; S.k.cod = null; S.k.raw = '';
  if (baixando) return;
  baixando = true;
  abrirSetor(cod).catch(e => toast(e.message || 'Não consegui abrir o setor.', true)).finally(() => { baixando = false; });
}

/* ---------------- eventos ---------------- */
document.addEventListener('click', e => {
  if (e.target.closest('#veu')) { fecharMenu(); return; }
  if (e.target.closest('#conta-btn')) { abrirMenu(); return; }
  if (e.target.closest('#when')) { if (!baixando) { toast('Conferindo se há dados novos…'); carregarTudo(); } return; }
  const b = e.target.closest('[data-a]'); if (!b) return;
  const a = b.dataset.a, v = b.dataset.v;
  let topo = false;
  switch (a) {
    case 'tab': S.tab = v; topo = true; if (v !== 'cliente') S.k.volta = null; break;
    case 'setor': trocarSetor(+v); return;
    case 'v-rca': S.v.rca = +v; break;
    case 'v-q': { S.v.q = v; const [d1, d2] = periodo(v); S.v.de = d1; S.v.ate = d2; break; }
    case 'v-graf': S.v.graf = v; break;
    case 'c-modo': S.c.modo = v; break;
    case 'c-cid': S.c.cid = v; S.c.bai = ''; break;
    case 'c-bai': S.c.bai = v; break;
    case 'cli': S.k.volta = S.tab !== 'cliente' ? S.tab : S.k.volta; S.k.cod = +v; S.k.raw = v; S.tab = 'cliente'; topo = true; break;
    case 'voltar': S.tab = S.k.volta || 'vendas'; S.k.volta = null; S.k.cod = null; S.k.raw = ''; topo = true; break;
    case 'k-modo': S.k.modo = v; break;
    case 'a-modo': S.a.modo = v; break;
    case 'a-per': S.a.per = v; break;
    case 'i-open': S.i.open = +v; break;
    case 'd-per': S.d.per = v; S.d.open = 0; break;
    case 'd-open': S.d.open = +v; break;
    case 'adm-f': S.adm.filtro = v; break;
    case 'adm-recarregar': carregarAcessos(); return;
    case 'adm-decidir': { const card = b.closest('[data-conta]'); b.setAttribute('aria-busy', 'true'); decidirAcesso(card, v); return; }
    case 'm-atualizar': fecharMenu(); toast('Conferindo se há dados novos…'); carregarTudo(); return;
    case 'm-acessos': fecharMenu(); S.tab = 'acessos'; render(true); carregarAcessos(); return;
    case 'm-instalar': fecharMenu(); if (instalar) { instalar.prompt(); instalar = null; } return;
    case 'm-sair': fecharMenu(); IDB.limpar(); D = null; R = null; conta = null; S.escopo = null; A.sair(); return;
    case 'baixar-app': if (appNovo) location.href = CFG.site + appNovo.apk; return;
    default: return;
  }
  render(topo);
});

document.addEventListener('change', e => {
  const t = e.target, v = t.value;
  if (t.closest('[data-conta]')) {
    if (t.dataset.campo === 'tipo') { const card = t.closest('[data-conta]'); card.querySelectorAll('[data-so]').forEach(el => { el.hidden = el.dataset.so !== v; }); }
    return;
  }
  const data = s => { const d = fromIso(s); return isNaN(d) ? null : Math.max(D.ini, Math.min(D.hoje, d)); };
  switch (t.id) {
    case 'setor': trocarSetor(+v); return;
    case 'v-rca': S.v.rca = +v; break;
    case 'v-dia': { const d = data(v); if (d !== null) S.v.dia = d; break; }
    case 'v-de': { const d = data(v); if (d !== null) { S.v.de = d; S.v.q = ''; } break; }
    case 'v-ate': { const d = data(v); if (d !== null) { S.v.ate = d; S.v.q = ''; } break; }
    case 'c-mes': S.c.mes = +v; break;
    case 'c-rca': S.c.rca = +v; S.c.cid = ''; S.c.bai = ''; break;
    case 'c-cid': S.c.cid = v; S.c.bai = ''; break;
    case 'c-bai': S.c.bai = v; break;
    case 'a-rca': S.a.rca = +v; break;
    default: return;
  }
  if (S.v.de > S.v.ate) { const x = S.v.de; S.v.de = S.v.ate; S.v.ate = x; }
  render(false);
});

document.addEventListener('submit', e => {
  if (e.target.id !== 'fcli') return;
  e.preventDefault();
  const raw = document.getElementById('codcli').value.trim();
  S.k.raw = raw;
  const so = raw.replace(/\D/g, '');
  S.k.cod = so && so === raw ? +so : null;
  if (S.k.cod && !D.CMAP.has(S.k.cod)) { /* mostra a mensagem de fora da base */ }
  render(false);
});
document.addEventListener('input', e => {
  if (e.target.id !== 'codcli') return;
  const raw = e.target.value;
  if (/^\d+$/.test(raw.trim())) return;      // código: espera o Buscar
  S.k.raw = raw; S.k.cod = null;
  clearTimeout(document._busca);
  document._busca = setTimeout(() => {
    const pos = e.target.selectionStart;
    render(false);
    const el = document.getElementById('codcli'); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (x) { /* ignora */ } }
  }, 250);
});

/* no app Android/iPhone (casca Capacitor) a WebView não abre "nova aba": WhatsApp, mapa e site de fora
   seguem na mesma janela e a casca entrega ao app certo do celular (WhatsApp, Maps, navegador) */
document.addEventListener('click', e => {
  const a = e.target.closest('a[href]');
  if (!a || a.getAttribute('href') === '#') return;
  const nativo = window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform();
  if (nativo && a.target === '_blank') { e.preventDefault(); location.href = a.href; }
}, true);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && conta && Date.now() - ultimaConferencia > 5 * 60e3) carregarTudo();
});
window.addEventListener('online', () => { if (conta && offline) carregarTudo(); });
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); instalar = e; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharMenu(); });

/* ---------------- ligação com a entrada ---------------- */
window.SUP_APP = {
  pronto(c) {
    const trocou = !conta || conta.email !== c.email || conta.tipo !== c.tipo || conta.codusur !== c.codusur || conta.codsupervisor !== c.codsupervisor;
    conta = c;
    $('#tela-carregando').hidden = true; $('#tela-login').hidden = true; $('#tela-app').hidden = false;
    if (trocou) { D = null; R = null; S.escopo = null; render(true); carregarTudo(); }
    else render(false);
  },
};

/* ---------------- app nativo (APK / iPhone) ---------------- */
// As telas já estão dentro do aparelho: o service worker só serve ao site no navegador.
if (!CFG.nativo && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* sem cache offline do app, segue normal */ });
}
if (CFG.nativo) try {
  const P = (window.Capacitor && window.Capacitor.Plugins) || {};
  // botão "voltar" do Android: navega dentro do app; só minimiza quando já está em Vendas
  if (P.App && P.App.addListener) {
    P.App.addListener('backButton', () => {
      if (!$('#folha').hidden) { fecharMenu(); return; }
      if (!$('#tela-app').hidden) {
        if (S.tab === 'cliente' && S.k.volta) { S.tab = S.k.volta; S.k.volta = null; S.k.cod = null; S.k.raw = ''; render(true); return; }
        if (S.tab !== 'vendas') { S.tab = 'vendas'; render(true); return; }
      }
      if (P.App.minimizeApp) P.App.minimizeApp(); else if (P.App.exitApp) P.App.exitApp();
    });
  }
  // versão nova do APK: o site publica versao-app.json; quem tem um número de build menor vê o aviso.
  // O APK 1.0 (que só abria o site) não tem o plugin App: conta como build 1.
  const minhaBuild = P.App && P.App.getInfo ? P.App.getInfo().then(i => Number(i && i.build) || 1).catch(() => 1) : Promise.resolve(1);
  minhaBuild.then(build => fetch(CFG.site + '/versao-app.json', { cache: 'no-store' })
    .then(r => r.ok ? r.json() : null)
    .then(v => { if (v && Number(v.versionCode) > build && v.apk) { appNovo = v; if (conta) render(false); } }))
    .catch(() => { /* sem rede: confere na próxima abertura */ });
} catch (e) { /* recurso nativo indisponível nesta versão: o app segue normal */ }
A.iniciar();
})();
