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
document.documentElement.classList.toggle('android', /Android/i.test(navigator.userAgent));
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
const hms = iso8601 => { if (!iso8601) return '—'; const x = new Date(iso8601); return hm(iso8601) + ':' + p2(x.getSeconds()); };
const diaHmS = iso8601 => { if (!iso8601) return '—'; const x = new Date(iso8601); return p2(x.getDate()) + '/' + p2(x.getMonth() + 1) + ' ' + hms(iso8601); };

const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// 1.7 (Júlio, 2026-10-29): "os números do painel não podem ter arredondamento, precisam ser completos": todo valor em
// reais sai com centavos ("R$ 1.777.174,99", não "R$ 1,78 mi") e toda porcentagem com 2 casas (a margem, com 4: pctM).
// Os nomes antigos ficam (brlK, o 2º argumento do pct) para não mexer em cada tela; o encaixar() faz o número caber.
const brl = v => 'R$ ' + nf2.format(isFinite(v) ? v : 0);
const brl2 = brl;
const brlK = brl;
const pct = v => nf2.format((isFinite(v) ? v : 0) * 100) + '%';
/* MARGEM com 4 casas, como o Central Comercial mostra o % líquido (1.6) */
const nf4 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const pctM = v => nf4.format((isFinite(v) ? v : 0) * 100) + '%';
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
  v: { rca: 0, dia: null, de: null, ate: null, q: 'mes', graf: 'fat', qr: 'mes' },
  c: { q: 'mes', ref: null, rca: 0, cid: '', bai: '' },
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
// as linhas do pacote viram objetos aqui; o pacote da manhã e o pacote do dia (ao vivo, 1.7) usam as mesmas funções.
// FATURADO = o TOTAL LIQUIDO da aba ST do Central Comercial (venda − devolução sem ST; Júlio, 2026-10-30; até ali era a
// devolução com ST) e MARGEM = o "% líquido" (massa de margem ÷ esse total). A devolução vem em linha própria, na data
// dela e com o pedido original. vb é a venda antes da devolução: conta positivação, pedidos, ticket e compras do cliente.
// Pacote de antes da 1.6 (sem [6]): o faturado volta a ser a venda.
// DIGITADO = a venda do Relatório 146 (Júlio, 2026-11-04: "faturamento real"): o banco manda os pedidos da própria
// tabela da 146 ([9] é o custo líquido dela; a margem do dia da 1.8 saiu na 1.9: "deixe apenas no período").
// DEVOLUÇÃO = a da aba Devoluções do Central Comercial (valor com ST), desde 2026-11-04, no banco.
const linhaNf = r => {
  const vb = +r[4] || 0, novo = r[6] != null;
  return { d: r[0], ped: r[1], cli: r[2], rca: r[3], vb, vl: novo ? +r[6] || 0 : vb,
           ls: novo ? +r[7] || 0 : vb, ms: novo ? +r[8] || 0 : vb - (+r[5] || 0) };
};
const linhaPed = r => ({ d: r[0], min: r[1], num: r[2], cli: r[3], rca: r[4], vl: +r[5] || 0, pos: r[6], ori: r[7], dfat: r[8] });
const linhaTit = r => ({ cli: r[0], rca: r[1], dup: r[2], prest: r[3], venc: r[4], valor: +r[5] || 0, cob: r[6], grupo: r[7], fil: r[8], emis: r[9] });
const linhaDev = r => ({ d: r[0], cli: r[1], rca: r[2], nota: r[3], mot: r[4], v: +r[5] || 0 });
// 1.9: [18] RCA 1, [19] RCA 2 e [20] cadastro do Relatório 146 (relatorio146.cliente): a carteira da 146
const linhaCli = r => ({ cod: r[0], fantasia: titulo(r[1] || r[2]) || ('Cliente ' + r[0]), razao: r[2] || '', cnpj: r[3], ramo: r[4], cidade: r[5] || '', bairro: r[6] || '', end: r[7] || '', fone: r[8], cel: r[9], rca: r[10], plano: r[11], prazo: r[12], limite: +r[13] || 0, bloq: !!r[14], ult: r[15], cad: r[16], sup: r[17],
                         rca1: r[18], rca2: r[19], cad146: r[20] });
function montar(p) {
  const d = {
    tipo: (p.escopo && p.escopo.tipo) || 'setor', codusur: p.escopo && p.escopo.codusur,
    setor: p.setor || { cod: null, nome: '' }, hoje: p.hoje, ini: p.ini, cargas: p.cargas || {}, gerado: p.gerado_em,
    rcas: (p.rcas || []).map(r => ({ cod: r[0], nome: titulo(r[1]), ativo: !!r[2] })),
    nf: (p.nf || []).map(linhaNf),
    ped: (p.ped || []).map(linhaPed),
    tit: (p.tit || []).map(linhaTit),
    item: (p.item || []).map(r => ({ mes: r[0], cli: r[1], p: r[2], rca: r[3], q: +r[4] || 0, v: +r[5] || 0, c: +r[6] || 0, ult: r[7], n: r[8] || 0 })),
    dev: (p.dev || []).map(linhaDev),
    prod: p.prod || {}, forn: p.forn || {}, mot: p.mot || {}, cob: p.cob || {},
    // meta da região por dia útil (1.5); null = pacote de antes da meta (a cópia guardada no aparelho)
    meta: p.meta ? p.meta.map(r => ({ d: r[0], v: +r[1] || 0 })) : null,
    cli: (p.cli || []).map(linhaCli),
  };
  d.RMAP = new Map(d.rcas.map(r => [r.cod, r]));
  // telas e filtros mostram só RCA ativo (Júlio, 2026-10-22); o inativo segue no pacote para o total da região
  // fechar (título antigo, venda do mês) e aparece só numa linha de aviso
  d.ativos = d.rcas.filter(r => r.ativo);
  d.CMAP = new Map(d.cli.map(c => [c.cod, c]));
  // 1.9: todos os RCAs do supervisor (a carteira da 146 conta o RCA 1 ou 2 de qualquer um deles); sem a lista é pacote antigo
  d.tem146 = Array.isArray(p.rcas_sup);
  d.rcasSup = new Set(p.rcas_sup || []);
  if (d.tipo === 'rca' && d.rcas[0]) d.rcaNome = d.rcas[0].nome;
  // pacote da manhã recarregado: a janela e o pacote do dia (ao vivo) que já chegaram voltam por cima, nessa ordem
  if (VIVO.escopo === S.escopo) {
    if (VIVO.janela) aplicarJanela(d, VIVO.janela);
    if (VIVO.hoje) aplicarHoje(d, VIVO.hoje, VIVO.versao);
    if (VIVO.janela || VIVO.hoje) aplicarVivo(d);
  }
  return d;
}
const rcaNome = cod => { const r = D && D.RMAP.get(cod); return r ? r.nome : (cod ? 'RCA ' + cod : '—'); };
const prodNome = p => (D.prod[p] && D.prod[p][0]) || ('Produto ' + p);
const fornDe = p => (D.prod[p] && D.prod[p][1]) || 0;
const fornNome = f => titulo(D.forn[f] || ('Fornecedor ' + f));
const cliNome = cod => { const c = D && D.CMAP.get(cod); return c ? c.fantasia : 'Cliente ' + cod; };
const rcaAtivo = cod => { const r = D.RMAP.get(cod); return !!(r && r.ativo); };
/* 1.11.2 (Júlio: "está mostrando informação diferente nas abas sobre RCA que não vendeu, e quando eu clico pra ver quem
   são ele não mostra"): uma regra só no Resumo e em Vendas — RCA ativo que teve pedido (146) nos últimos 30 dias e ainda
   não digitou hoje; domingo não conta. Volta quem é, o último pedido e o faturado do mês, do maior faturado para o menor. */
function rcasSemPedido() {
  const H = D.hoje;
  if (ehRca() || dow(H) === 0) return [];
  const hoje = new Set(), ult = new Map();
  for (const o of D.ped) {
    if (o.d === H) hoje.add(o.rca);
    else if (o.d >= H - 30 && o.d < H && !(ult.get(o.rca) >= o.d)) ult.set(o.rca, o.d);
  }
  const m0 = mesDe(H);
  return D.ativos.filter(r => ult.has(r.cod) && !hoje.has(r.cod))
    .map(r => ({ r, ult: ult.get(r.cod), fm: soma(D.nf.filter(o => o.rca === r.cod && o.d >= m0 && o.d <= H), o => o.vl) }))
    .sort((a, b) => b.fm - a.fm || b.ult - a.ult);
}
/* "Inclui R$ X de RCA inativo": o total fecha e a lista mostra só quem está ativo */
const avisoInativo = (v, oQue) => v > 0.005 ? `<span class="nota">O total inclui ${brl(v)} ${oQue} de RCA inativo (fora da lista).</span>` : '';
const ehRca = () => D && D.tipo === 'rca';
const ehGerente = () => conta && conta.tipo === 'gerente';
const naCarteira = c => ehRca() ? c.rca === D.codusur : c.sup === D.setor.cod;
const carteiraAtiva = c => (c.ult != null && c.ult >= D.hoje - 180) || (c.cad != null && c.cad >= D.hoje - 90);
/* 1.9 (Júlio, 2026-11-04: "sempre precisam ser os mesmos números" da 146): a CARTEIRA é a do Relatório 146, o "Total
   cadastrado": cliente com um RCA do setor (ou o RCA filtrado) como RCA 1 ou RCA 2, cadastrado ANTES do fim do período
   (quem entrou no último dia fica de fora, como na 146). POSITIVADO é cliente com pedido no período (o "Positivados" da
   146, de dentro ou de fora da carteira). Pacote de antes da 1.9 (sem a carteira da 146): a carteira ativa de antes. */
function daCarteira(c, fim, rca) {
  if (!D.tem146) return (rca ? c.rca === rca : naCarteira(c)) && carteiraAtiva(c);
  const r = rca || (ehRca() ? D.codusur : 0);
  const dele = r ? (c.rca1 === r || c.rca2 === r) : (D.rcasSup.has(c.rca1) || D.rcasSup.has(c.rca2));
  return dele && (c.cad146 == null || c.cad146 < fim);
}
const positivados = (d1, d2, rca) => new Set(D.ped.filter(o => o.d >= d1 && o.d <= d2 && (!rca || o.rca === rca)).map(o => o.cli));

function resumoNf(list) {
  let vl = 0, vb = 0, ls = 0, ms = 0; const cl = new Set(), pd = new Set();
  for (const o of list) { vl += o.vl; vb += o.vb; ls += o.ls; ms += o.ms; if (o.vb > 0) { cl.add(o.cli); pd.add(o.ped); } }
  return { vl, vb, ms, mg: ls ? ms / ls : 0, ped: pd.size, pos: cl.size, tk: pd.size ? vb / pd.size : 0 };
}
function resumoPed(list) {
  // pedidos = todos os da 146 (bonificação conta, com valor zero), positivação = clientes distintos, ticket = venda ÷ pedidos
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
  const zero = /^(R\$ )?0(,0+)?%?$/.test(String(v).replace(/<[^>]+>/g, '')) ? ' zero' : '';
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
  return desenharDias(dias, vals, fonte === 'dig' ? 'digitada' : 'faturada', destaque);
}
/* as barras por dia (o GERAL, 1.12, desenha com os valores somados das regiões) */
function desenharDias(dias, vals, qual, destaque) {
  // valor completo sobre a barra só com até 4 dias (com mais, não cabe: o valor de cada dia fica no toque na barra)
  const max = Math.max(1, ...vals), W = 400, H = 130, T = 22, B = 18, bw = W / dias.length, rotulos = dias.length <= 4;
  let r = `<svg class="ch" viewBox="0 0 ${W} ${H}" role="img" aria-label="Venda ${qual} por dia">`;
  r += `<line class="g" x1="0" x2="${W}" y1="${T}" y2="${T}"/><line class="g" x1="0" x2="${W}" y1="${H - B}" y2="${H - B}"/>`;
  if (!rotulos) r += `<text x="0" y="${T - 6}">${brlK(max)}</text>`;
  vals.forEach((v, i) => {
    if (v <= 0) return;   // dia só com devolução fica sem barra (o faturado é líquido desde a 1.6)
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

/* meta do mês (1.5, Júlio: "se a gente já conseguiu bater a meta ou se já está próximo de bater"). A meta é a da
   região no WinThor (PCMETASUP), uma por dia útil. O ritmo compara o faturado com a meta dos dias úteis que já
   terminaram: o dia de hoje ainda está faturando. */
function situacaoMeta(fat, total, ate) {
  if (fat >= total) return ['good', 'Meta batida'];
  if (fat >= total * .9) return ['A', 'Quase lá'];
  return fat >= ate ? ['good', 'No ritmo'] : ['bad', 'Abaixo do ritmo'];
}
function metaDoMes(m0, H, fat) {
  if (!D.meta || ehRca()) return null;            // pacote de antes da 1.5, ou RCA (a meta é da região)
  const m1 = mesSeg(m0, 1);
  let total = 0, ate = 0, dias = 0;
  for (const x of D.meta) if (x.d >= m0 && x.d < m1) { total += x.v; if (x.d < H) ate += x.v; else dias++; }
  if (!total) return { sem: true };
  return { total, ate, dias, fat, falta: total - fat, st: situacaoMeta(fat, total, ate) };
}
/* 1.7 (Júlio: valores completos, "sem ficar aquele monte de informação"): a barra e uma grade 2 × 2 com o essencial */
function blocoMeta(mt, margem) {
  const fr = mt.fat / mt.total, batida = mt.falta <= 0, esperado = mt.ate / mt.total;
  const quarto = batida || !mt.dias ? ['Esperado até ontem', pct(esperado)] : ['Por dia útil', brl(mt.falta / mt.dias)];
  // a marca do ritmo só ajuda enquanto a meta não foi batida
  return `<span class="meta-barra${batida ? ' batida' : ''}" style="--fr:${Math.min(1, fr).toFixed(4)};--ritmo:${Math.min(1, esperado).toFixed(4)}" role="img" aria-label="${pct(fr)} da meta${batida ? '' : '; o esperado até ontem era ' + pct(esperado)}"><i></i>${batida ? '' : '<b></b>'}</span>
      <span class="meta-grade">
        <span><small>Da meta</small><b>${pct(fr)}</b></span>
        <span><small>Margem</small><b>${pctM(margem)}</b></span>
        <span><small>${batida ? 'Acima da meta' : mt.dias ? 'Faltam' : 'Faltaram'}</small><b>${brl(Math.abs(mt.falta))}</b></span>
        <span><small>${quarto[0]}</small><b>${quarto[1]}</b></span>
      </span>`;
}
/* o gestor vê, no mesmo cartão, a soma de todas as regiões (do resumo dos setores) */
function metaTodas(m0) {
  if (!ehGerente() || !R || !R.meses.length || R.meses[R.meses.length - 1] !== m0) return '';
  const i0 = R.meses.length - 1;
  let fat = 0, total = 0, ate = 0;
  for (const s of R.setores) { fat += s.venda[i0] || 0; if (s.meta) { total += +s.meta[i0] || 0; ate += +s.metaAte[i0] || 0; } }
  if (!total) return '';
  const st = situacaoMeta(fat, total, ate);
  return `<span class="meta-todas"><span class="mt-l">Todas as regiões <span class="pill ${st[0]}">${pct(fat / total)}</span></span><span class="mt-v"><b>${brl(fat)}</b> de ${brl(total)}</span></span>`;
}

/* ---------------- aba: resumo (o dia numa tela só) ---------------- */
function vResumo() {
  const H = D.hoje, m0 = mesDe(H);
  const hj = resumoPed(D.ped.filter(o => o.d === H)), ant = resumoPed(D.ped.filter(o => o.d === H - 7));
  const dl = ant.vl ? hj.vl / ant.vl - 1 : null;
  const mes = resumoNf(D.nf.filter(o => o.d >= m0 && o.d <= H));
  // mês anterior com o mesmo número de dias corridos (comparação justa)
  const a0 = mesSeg(m0, -1), a1 = Math.min(m0 - 1, a0 + (H - m0));
  const mAnt = a0 >= D.ini ? resumoNf(D.nf.filter(o => o.d >= a0 && o.d <= a1)) : null;
  const dMes = mAnt && mAnt.vl ? mes.vl / mAnt.vl - 1 : null;
  // carteira e positivados do mês como na 146 (Total cadastrado e Positivados)
  const cart = D.cli.filter(c => daCarteira(c, H, 0));
  const pos = positivados(m0, H, 0).size, fp = cart.length ? pos / cart.length : 0;
  const venc = D.tit.filter(t => t.grupo === 'cobranca' && t.venc < H), vt = soma(venc, t => t.valor), vc = new Set(venc.map(t => t.cli)).size;
  const devM = soma(D.dev.filter(x => x.d >= m0 && x.d <= H), x => x.v);
  const pf = new Map(); let totI = 0;
  for (const it of D.item) if (it.mes === m0) { pf.set(it.cli, (pf.get(it.cli) || 0) + it.v); totI += it.v; }
  const rk = [...pf.entries()].sort((a, b) => b[1] - a[1]); let acc = 0, nA = 0;
  for (const [, v] of rk) { if (acc < .8) nA++; acc += v / (totI || 1); }
  const lider = rk[0];
  const semPed = rcasSemPedido().length;   // a mesma regra de Vendas (1.11.2)
  const delta = (v, txt) => v == null ? '' : `<span class="delta ${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '▲' : '▼'} ${pct(Math.abs(v), 0)}</span> ${txt}`;
  const mt = metaDoMes(m0, H, mes.vl), comMeta = mt && !mt.sem, nomeM = MESES_L[dt(H).getUTCMonth()];
  const comparacao = dMes != null ? delta(dMes, 'vs. ' + MESES[dt(a0).getUTCMonth()] + ' no mesmo período') : nf0.format(mes.pos) + ' clientes faturados';
  return `
  <div class="resumo">
    <button type="button" class="hoje-card" data-a="ir" data-v="vendas:hoje">
      <span class="cartao-rot">${ic('cart')}Digitado hoje <small>até ${hm(D.cargas.pedido)}</small>${ic('frente', 'seta')}</span>
      <span class="valor-grande" data-cnt="${hj.vl}" data-f="brlK">${brlK(hj.vl)}</span>
      <span class="sub">${dl != null ? delta(dl, 'vs. ' + diaLongo(H - 7)) : 'sem pedido em ' + diaLongo(H - 7) + ' para comparar'}</span>
      <span class="trio duo">
        <span><small>Pedidos</small><b data-cnt="${hj.ped}" data-f="n">${nf0.format(hj.ped)}</b></span>
        <span><small>Clientes</small><b data-cnt="${hj.pos}" data-f="n">${nf0.format(hj.pos)}</b></span>
      </span>
      ${semPed ? `<span class="alerta" data-a="v-sem">${semPed} ${semPed > 1 ? 'RCAs ativos sem pedido' : 'RCA ativo sem pedido'} hoje · ver quem</span>` : ''}
    </button>
    ${comMeta ? `<button type="button" class="mes-card com-meta" data-a="ir" data-v="vendas:periodo">
      <span class="cartao-rot">${ic('cash')}Meta de ${nomeM} <small>${mt.dias ? `${mt.dias} ${mt.dias === 1 ? 'dia útil' : 'dias úteis'} com hoje` : 'mês fechado'}</small>${ic('frente', 'seta')}</span>
      <span class="valor-grande" data-cnt="${mes.vl}" data-f="brlK">${brlK(mes.vl)}</span>
      <span class="meta-linha"><span class="meta-de">meta ${brl(mt.total)}</span><span class="pill ${mt.st[0]}">${mt.st[1]}</span></span>
      ${blocoMeta(mt, mes.mg)}
      ${metaTodas(m0)}
    </button>` : `<button type="button" class="mes-card" data-a="ir" data-v="vendas:periodo">
      <span class="cartao-rot">${ic('cash')}Faturado em ${nomeM} <small>até ${dm(H)}</small>${ic('frente', 'seta')}</span>
      <span class="linha-valor"><span class="valor-grande" data-cnt="${mes.vl}" data-f="brlK">${brlK(mes.vl)}</span><span class="pill">Margem ${pctM(mes.mg)}</span></span>
      <span class="sub">${comparacao}</span>
      ${mt && mt.sem ? `<span class="meta-sem">Sem meta cadastrada no WinThor em ${nomeM}.</span>` : ''}
      ${miniBarras(m0, H)}
      ${metaTodas(m0)}
    </button>`}
    <div class="tiles">
      <button type="button" class="tile ouro" data-a="ir" data-v="carteira:pos">${anel(fp)}<span class="cartao-rot">${ic('users')}Carteira</span><span class="v" data-cnt="${fp}" data-f="pct0">${pct(fp, 0)}</span><span class="d">${nf0.format(pos)} positivados de ${nf0.format(cart.length)} cadastrados</span></button>
      <button type="button" class="tile perigo" data-a="ir" data-v="inad:resumo"><span class="cartao-rot">${ic('alert')}Vencido</span><span class="v" data-cnt="${vt}" data-f="brlK">${brlK(vt)}</span><span class="d">${nf0.format(vc)} ${vc === 1 ? 'cliente' : 'clientes'} com título vencido</span></button>
      <button type="button" class="tile atencao" data-a="ir" data-v="dev:resumo"><span class="cartao-rot">${ic('ret')}Devolução</span><span class="v">${pct(mes.vb ? devM / mes.vb : 0)}</span><span class="d">${brlK(devM)} devolvidos no mês</span></button>
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
  const dia = () => {
    const pd = resumoPed(D.ped.filter(o => o.d === V.dia && f(o))), pa = resumoPed(D.ped.filter(o => o.d === V.dia - 7 && f(o)));
    const delta = pa.vl ? pd.vl / pa.vl - 1 : 0;
    const dTxt = pa.vl ? `<span class="delta ${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '▲' : '▼'} ${pct(Math.abs(delta), 0)}</span> vs. ${diaLongo(V.dia - 7)} (${brlK(pa.vl)})` : (V.dia - 7 >= D.ini ? `sem pedido em ${diaLongo(V.dia - 7)}` : '');
    const parcial = V.dia === H ? ` · até ${hm(D.cargas.pedido)}` : '';
    const sem = !rca && V.dia === H ? rcasSemPedido().length : 0;   // a mesma regra do Resumo (1.11.2)
    return `
    <div class="pilulas">${pilRca('v-rca', rca)}${pilData('v-dia', 'Dia', V.dia)}</div>
    <div class="h">Venda do dia <small>${diaLongo(V.dia)}${parcial}</small></div>
    <div class="kpis k2">${kpi('Digitado', brlK(pd.vl), dTxt, 'hero')}${kpi('Pedidos', nf0.format(pd.ped), 'digitados')}${kpi('Positivação', nf0.format(pd.pos), 'clientes com pedido')}${kpi('Ticket médio', brlK(pd.tk), 'por pedido', 'cheia')}</div>
    ${sem ? `<button type="button" class="faixa toque" data-a="v-sem">${sem} ${sem > 1 ? 'RCAs ativos sem pedido' : 'RCA ativo sem pedido'} hoje · ver quem${ic('frente', 'seta')}</button>` : ''}`;
  };
  const periodoPag = () => {
    const per = resumoNf(D.nf.filter(o => o.d >= V.de && o.d <= V.ate && f(o)));
    const pp = resumoPed(D.ped.filter(o => o.d >= V.de && o.d <= V.ate && f(o)));
    return `
    ${chips('v-q', V.q, [['hoje', 'Hoje'], ['semana', 'Semana'], ['mes', 'Mês'], ['ant', 'Mês anterior'], ['3m', '3 meses'], ['', 'Escolher datas']], 'rola')}
    ${V.q === '' ? `<div class="pilulas">${pilData('v-de', 'De', V.de)}${pilData('v-ate', 'Até', V.ate)}</div>` : ''}
    <div class="h">Acumulado <small>${dmy(V.de)} a ${dmy(V.ate)}${rca ? ' · ' + esc(rcaNome(rca)) : ''}</small></div>
    <div class="kpis k2">${kpi('Faturado', brlK(per.vl), 'venda menos devolução', 'hero')}${kpi('Margem', pctM(per.mg), brlK(per.ms) + ' de massa de margem')}${kpi('Digitado', brlK(pp.vl), nf0.format(pp.ped) + ' pedidos')}${kpi('Positivação', nf0.format(pp.pos), 'clientes com pedido')}${kpi('Ticket médio', brlK(pp.tk), 'por pedido')}</div>
    ${seg('v-graf', V.graf, [['fat', 'Faturado por dia'], ['dig', 'Digitado por dia']])}
    <div class="card">${graficoDias(V.de, V.ate, V.graf, rca, V.dia) || '<span class="muted">Escolha um período com mais de um dia para ver a venda diária.</span>'}</div>`;
  };
  /* 1.4 (Júlio): filtro "Mês, semana e dia" no ranking dos RCAs; a data escolhida é o fim da janela */
  const rcasPag = () => {
    const ref = V.dia, qr = V.qr || 'mes';
    const r1 = qr === 'dia' ? ref : qr === 'semana' ? Math.max(D.ini, ref - ((dow(ref) + 6) % 7)) : Math.max(D.ini, mesDe(ref));
    const na = o => o.d >= r1 && o.d <= ref;
    const ls = D.ativos.map(r => ({
      r, f: resumoNf(D.nf.filter(o => na(o) && o.rca === r.cod)), g: resumoPed(D.ped.filter(o => na(o) && o.rca === r.cod)),
    })).sort((a, b) => b.f.vl - a.f.vl || b.g.vl - a.g.vl);
    const tot = ls.reduce((a, x) => a + x.f.vl, 0) || 1;
    const rotulo = qr === 'dia' ? diaLongo(ref) : qr === 'semana' ? `semana de ${dm(r1)} a ${dm(ref)}` : `${nomeMes(ref)}${ref === H ? ' até hoje' : ' até ' + dm(ref)}`;
    // 1.11.2: no Dia de hoje, quem está sem pedido aparece primeiro, na mesma regra do aviso do Resumo e da Venda do dia
    const semHoje = qr === 'dia' && ref === H && !rca ? rcasSemPedido() : [], semSet = new Set(semHoje.map(x => x.r.cod));
    const blocoSem = semHoje.length ? `<div class="h">Sem pedido hoje <small>${semHoje.length} ${semHoje.length > 1 ? 'RCAs' : 'RCA'} · até ${hm(D.cargas.pedido)}</small></div>
      <div class="list" data-lista="v-sem">${limitar(semHoje.map(x => `
        <button type="button" class="row" data-a="v-rca" data-v="${x.r.cod}">
          <span class="t">${esc(x.r.nome)} <span class="code">${x.r.cod}</span></span>
          <span class="r">${brlK(x.fm)}</span>
          <span class="sub">último pedido ${diaLongo(x.ult)} · há ${H - x.ult} ${H - x.ult === 1 ? 'dia' : 'dias'}</span>
          <span class="sub r"><span class="pill warn">sem pedido hoje</span></span>
          <span class="sub full">faturado no mês</span>
        </button>`), 30, 'v-sem', 'Sem pedido hoje')}</div>
      <div class="nota">RCA ativo que teve pedido nos últimos 30 dias e ainda não digitou hoje (domingo não conta).</div>` : '';
    const rows = ls.map(({ r, f: fv, g }) => `
      <button type="button" class="row${r.cod === rca ? ' sel' : ''}" data-a="v-rca" data-v="${r.cod === rca ? 0 : r.cod}">
        <span class="t">${esc(r.nome)} <span class="code">${r.cod}</span></span>
        <span class="r">${brlK(fv.vl)}</span>
        <span class="sub">faturado · digitado ${brlK(g.vl)} em ${g.ped} ${g.ped === 1 ? 'pedido' : 'pedidos'} ${semSet.has(r.cod) ? '<span class="pill warn">sem pedido hoje</span>' : ''}</span>
        <span class="sub r"><span class="pill ${fv.vl && fv.mg < .12 ? 'warn' : ''}">margem ${pctM(fv.mg)}</span></span>
        <span class="sub full">${fv.pos} clientes positivados · ${fv.ped} pedidos faturados</span>
        <span class="full">${bar(fv.vl / tot)}</span>
      </button>`);
    return `<div class="pilulas">${chips('v-qr', qr, [['mes', 'Mês'], ['semana', 'Semana'], ['dia', 'Dia']])}${pilData('v-dia', qr === 'dia' ? 'Dia' : 'Até', ref)}</div>
      ${blocoSem}
      <div class="h">Por RCA <small>${rotulo}</small></div>
      <div class="list" data-lista="v-rcas">${rows.length ? limitar(rows, 5, 'v-rcas', 'Venda por RCA') : vazio('Nenhum RCA ativo no setor.')}</div>
      ${avisoInativo(soma(D.nf.filter(o => na(o) && !rcaAtivo(o.rca)), o => o.vl), 'de faturado')}
      <div class="nota">Toque num RCA para ver a venda só dele.</div>`;
  };
  const setoresPag = () => {
    const i0 = R.meses.length - 1, ls = R.setores.map(s => ({ s, v: s.venda[i0], tls: +s.tls[i0] || 0, ms: +s.massa[i0] || 0, pos: s.pos[i0], mt: s.meta ? +s.meta[i0] || 0 : 0, ate: +s.metaAte[i0] || 0 })).sort((a, b) => b.v - a.v);
    const mx = ls.length ? ls[0].v || 1 : 1;
    // 1.5: com meta, a pílula mostra quanto da meta do mês a região já faturou (a cor segue o ritmo)
    const rows = ls.map(x => `
      <button type="button" class="row${x.s.cod === D.setor.cod ? ' sel' : ''}" data-a="setor" data-v="${x.s.cod}">
        <span class="t">${esc(x.s.nome)}</span><span class="r">${brlK(x.v)}</span>
        <span class="sub">${nf0.format(x.pos)} positivados · <span class="nw">margem ${pctM(x.tls ? x.ms / x.tls : 0)}</span></span><span class="sub r">${x.mt ? `<span class="pill ${situacaoMeta(x.v, x.mt, x.ate)[0]}">${pct(x.v / x.mt, 0)} da meta</span>` : '<span class="pill">sem meta</span>'}</span>
        <span class="full">${bar(x.mt ? x.v / x.mt : x.v / mx, 'gold')}</span>
      </button>`);
    return `<div class="h">Por setor <small>${nomeMes(R.meses[i0])} · toque para abrir</small></div><div class="list" data-lista="v-setores">${limitar(rows, 6, 'v-setores', 'Venda por setor')}</div>`;
  };
  return { pags: [['hoje', 'Dia', dia], ['periodo', 'Período', periodoPag], !ehRca() && ['rcas', 'RCAs', rcasPag], ehGerente() && R && ['setores', 'Setores', setoresPag]] };
}

/* ---------------- aba: carteira ---------------- */
function vCarteira() {
  const C = S.c, H = D.hoje;
  // 1.11 (Júlio): Dia, Semana ou Mês até a data escolhida, como o filtro dos RCAs em Vendas
  if (C.ref == null || C.ref > H || C.ref < D.ini) C.ref = H;
  const q = C.q || 'mes', ref = C.ref;
  const d1 = q === 'dia' ? ref : q === 'semana' ? Math.max(D.ini, ref - ((dow(ref) + 6) % 7)) : Math.max(D.ini, mesDe(ref)), d2 = ref;
  const rotulo = q === 'dia' ? 'em ' + diaLongo(ref) : q === 'semana' ? `de ${dm(d1)} a ${dm(ref)}` : `em ${nomeMes(ref)}${ref === H ? ' até hoje' : ' até ' + dm(ref)}`;
  const noPer = q === 'dia' ? 'no dia' : q === 'semana' ? 'na semana' : 'no mês';
  const rca = ehRca() ? D.codusur : C.rca;
  // 1.9: a carteira e os positivados da 146 (Total cadastrado e Positivados); o valor é a venda do pedido (o digitado)
  const cart = D.cli.filter(c => daCarteira(c, d2, rca));
  const cartSet = new Set(cart.map(c => c.cod));
  const vendas = new Map();
  for (const o of D.ped) {
    if (o.d < d1 || o.d > d2 || (rca && o.rca !== rca)) continue;
    const x = vendas.get(o.cli) || { vl: 0, n: new Set() }; x.vl += o.vl; x.n.add(o.num); vendas.set(o.cli, x);
  }
  // potencial = média dos 3 meses cheios antes do mês da data (no Dia e na Semana também, para não somar pedaço de mês)
  const mRef = mesDe(d1), potIni = mesSeg(mRef, -3), temPot = potIni >= D.ini;
  const pot = new Map(), ult = new Map();
  for (const o of D.ped) {
    if (rca && o.rca !== rca) continue;
    if (o.d >= potIni && o.d < mRef) pot.set(o.cli, (pot.get(o.cli) || 0) + o.vl);
    if (o.d <= d2 && (!ult.has(o.cli) || ult.get(o.cli) < o.d)) ult.set(o.cli, o.d);
  }
  const ultima = c => { const u = ult.get(c.cod); return u != null ? u : (c.ult != null && c.ult <= d2 ? c.ult : null); };
  const baseTodos = [...cart, ...[...vendas.keys()].filter(k => !cartSet.has(k)).map(k => D.CMAP.get(k) || { cod: k, fantasia: 'Cliente ' + k, cidade: '', bairro: '' })];
  const noLugar = c => (!C.cid || c.cidade === C.cid) && (!C.bai || c.bairro === C.bai);
  const cidades = [...new Set(baseTodos.map(c => c.cidade).filter(Boolean))].sort();
  const bairros = C.cid ? [...new Set(baseTodos.filter(c => c.cidade === C.cid).map(c => c.bairro).filter(Boolean))].sort() : [];
  const cartF = cart.filter(noLugar);
  const comp = baseTodos.filter(c => vendas.has(c.cod) && noLugar(c)).map(c => ({ c, vl: vendas.get(c.cod).vl, n: vendas.get(c.cod).n.size, fora: !cartSet.has(c.cod) })).sort((a, b) => b.vl - a.vl);
  // positivados = todos os clientes com pedido (de dentro ou de fora da carteira), como a 146
  const pos = comp.length, fr = cartF.length ? pos / cartF.length : 0;
  const nao = cartF.filter(c => !vendas.has(c.cod)).map(c => ({ c, pot: temPot ? (pot.get(c.cod) || 0) / 3 : null, ult: ultima(c) })).sort((a, b) => (b.pot || 0) - (a.pot || 0) || (b.ult || 0) - (a.ult || 0));
  const fora = comp.filter(x => x.fora).length;
  const chave = C.cid ? 'bairro' : 'cidade', grupos = new Map();
  for (const c of cartF) { const k = c[chave] || '(sem ' + chave + ')', g = grupos.get(k) || { t: 0, c: 0 }; g.t++; if (vendas.has(c.cod)) g.c++; grupos.set(k, g); }
  const gl = [...grupos.entries()].sort((a, b) => b[1].t - a[1].t);
  const topo = `<div class="pilulas">${chips('c-q', q, [['mes', 'Mês'], ['semana', 'Semana'], ['dia', 'Dia']])}${pilData('c-ref', q === 'dia' ? 'Dia' : 'Até', ref)}</div>
  <div class="pilulas">
    ${ehRca() ? '' : pilRca('c-rca', C.rca)}
    ${pilSel('c-cid', 'Cidade', C.cid, [['', 'Todas'], ...cidades.map(c => [c, titulo(c)])])}
    ${C.cid ? pilSel('c-bai', 'Bairro', C.bai, [['', 'Todos'], ...bairros.map(b => [b, titulo(b)])]) : ''}
  </div>`;
  const posPag = () => `
    <div class="card pos-card">${anel(fr)}
      <div><div class="cartao-rot">Positivação ${noPer}</div><div class="big">${pct(fr, 0)}</div><div class="sub">${nf0.format(pos)} positivados de ${nf0.format(cartF.length)} cadastrados · ${rotulo}</div></div>
    </div>
    <span class="nota">Como no Relatório 146: carteira = clientes com ${ehRca() ? 'você' : 'um RCA do setor'} como RCA 1 ou 2, cadastrados até o fim do período; positivado = cliente com pedido no período.${fora ? ` ${fora} ${fora > 1 ? 'positivados são de fora da carteira' : 'positivado é de fora da carteira'}.` : ''}</span>
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
        <span class="sub r">${x.ult != null ? `última ${dm(x.ult)} <span class="pill ${d2 - x.ult > 60 ? 'bad' : 'warn'}">${d2 - x.ult} dias</span>` : 'sem pedido'}</span>
      </button>`;
  const mais300 = (n, oQue) => n > 300 ? vazio(`Mostrando 300 de ${nf0.format(n)} ${oQue}. Filtre por cidade ou RCA para ver o resto.`) : '';
  const compPag = () => `<div class="h">Com pedido <small>${rotulo} · ordem de valor</small></div>
    <div class="list" data-lista="c-comp">${comp.length ? limitar(comp.slice(0, 300).map(linhaComp), 5, 'c-comp', 'Com pedido ' + rotulo, mais300(comp.length, 'positivados'), comp.length) : vazio('Nenhum cliente neste filtro.')}</div>`;
  const naoPag = () => `<div class="h">Sem pedido <small>${rotulo} · ${temPot ? 'maior potencial primeiro' : 'pedido mais recente primeiro'}</small></div>
    <div class="list" data-lista="c-nao">${nao.length ? limitar(nao.slice(0, 300).map(linhaNao), 5, 'c-nao', 'Sem pedido ' + rotulo, mais300(nao.length, 'clientes'), nao.length) : vazio('Todos os clientes da carteira tiveram pedido. 👏')}</div>
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
  // compras do cliente: o valor do pedido é a venda (vb); a margem do pedido é a líquida (massa ÷ total sem ST)
  const nfs = D.nf.filter(o => o.cli === c.cod && o.vb > 0);
  const porPed = new Map(); for (const o of nfs) { const x = porPed.get(o.ped) || { d: o.d, vl: 0, ls: 0, ms: 0 }; x.vl += o.vb; x.ls += o.ls; x.ms += o.ms; x.d = Math.max(x.d, o.d); porPed.set(o.ped, x); }
  const peds = [...porPed.entries()].map(([num, x]) => ({ num, ...x })).sort((a, b) => a.d - b.d);
  const datas = [...new Set(peds.map(p => p.d))].sort((a, b) => a - b);
  const ultD = datas.length ? datas[datas.length - 1] : (c.ult != null ? c.ult : null);
  const dias = ultD != null ? H - ultD : null;
  const gaps = datas.slice(1).map((d, i) => d - datas[i]), freq = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
  const v90 = peds.filter(p => p.d > H - 90);
  const abertos = D.tit.filter(t => t.cli === c.cod && t.grupo === 'cobranca'), venc = abertos.filter(t => t.venc < H);
  const outros = D.tit.filter(t => t.cli === c.cod && t.grupo === 'juridico');   // 1.10: sem os títulos fora da cobrança
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
      ${outros.length ? `<div class="faixa">Jurídico e perdas: ${brl(soma(outros, t => t.valor))} em ${outros.length} ${outros.length > 1 ? 'títulos' : 'título'} — fora do em aberto.</div>` : ''}`;
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
      <span class="sub">${diaLongo(o.d)} · faturado</span><span class="sub r">margem ${pctM(o.ls ? o.ms / o.ls : 0)}</span></div>`));
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
  for (const o of D.nf) if (o.d >= m0 && o.vb > 0) top.set(o.cli, (top.get(o.cli) || 0) + o.vb);
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
    const base = D.cli.filter(c => daCarteira(c, D.hoje, rca)).length || 1;   // a carteira da 146 (1.9)
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
  const jur = D.tit.filter(t => t.grupo === 'juridico');   // 1.10 (Júlio): sem a linha "Fora da cobrança"
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
    ${jur.length ? `<div class="faixa">Jurídico e perdas: ${brl(soma(jur, t => t.valor))} em ${jur.length} ${jur.length > 1 ? 'títulos' : 'título'} — fora da soma acima.</div>` : ''}`;
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
  // a % de devolução é sobre a venda antes da devolução (vb), não sobre o faturado líquido
  const venda = resumoNf(D.nf.filter(o => o.d >= d1 && o.d <= d2)).vb || 0;
  const resp = x => { const m = D.mot[x.mot]; return !!(m && m[1]); };
  const tot = soma(meus, x => x.v), rv = soma(meus.filter(resp), x => x.v);
  const notas = new Set(meus.map(x => x.nota)).size;
  const mot = new Map(); for (const x of meus) { const y = mot.get(x.mot) || { v: 0, n: 0 }; y.v += x.v; y.n++; mot.set(x.mot, y); }
  const ml = [...mot.entries()].sort((a, b) => b[1].v - a[1].v), maxM = ml.length ? ml[0][1].v || 1 : 1;
  const linhasMot = ml.map(([k, y]) => `
      <div class="row"><span class="t">${esc(titulo((D.mot[k] || [])[0] || 'Motivo ' + k))} ${(D.mot[k] || [])[1] ? '<span class="pill rca">RCA</span>' : ''}</span><span class="r">${brl(y.v)}</span>
      <span class="sub full">${y.n} ${y.n > 1 ? 'ocorrências' : 'ocorrência'}</span><span class="full">${bar(y.v / maxM, 'bad')}</span></div>`);
  const resumo = () => `
    <div class="kpis k2">${kpi('Devolvido', brlK(tot), `${pct(venda ? tot / venda : 0)} da venda de ${dm(d1)} a ${dm(d2)}`, 'perigo wide')}${kpi('Devoluções', nf0.format(notas), 'notas de devolução')}${kpi('Clientes', nf0.format(new Set(meus.map(x => x.cli)).size), 'que devolveram')}${kpi('Resp. do RCA', brlK(rv), pct(tot ? rv / tot : 0, 0) + ' do total', 'atencao')}${kpi('Venda', brlK(venda), 'antes das devoluções')}</div>
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
      const l = meus.filter(x => x.rca === r.cod), v = soma(l, x => x.v), vr = resumoNf(D.nf.filter(o => o.d >= d1 && o.d <= d2 && o.rca === r.cod)).vb;
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
    const ls = R.setores.map(s => { const v = idx.reduce((a, i) => a + s.dev[i], 0), vd = idx.reduce((a, i) => a + s.vendaBruta[i], 0); return { s, v, p: vd ? v / vd : 0 }; }).sort((a, b) => b.p - a.p);
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
  const pend = nPendentes(AD.dados);
  const gestores =[...cs.filter(c => c.tipo === 'gerente' && c.situacao === 'liberado').map(c => ({ nome: c.nome || c.email, email: c.email, st: 'liberado', estados: c.estados })),
    ...cv.filter(v => v.tipo === 'gerente' && v.situacao === 'aguardando').map(v => ({ nome: v.nome, email: v.email, st: 'aguardando', estados: v.estados }))];
  const botao = `<button type="button" class="btn cheio com-ic" data-a="novo-sup">${ic('mais')}Cadastrar gestor ou supervisor</button>`;
  const gestoresPag = () => `${botao.replace('data-a="novo-sup"', 'data-a="novo-sup" data-v="g"')}
    <div class="nota">O <b>gestor</b> vê <b>todas as regiões</b> ou <b>só os estados que você marcar</b> (ES, BA, RJ e, uma por uma, as regiões sem estado), só para consultar: não cadastra ninguém. Para mudar o que um gestor vê: <b>Contas › Liberados</b> (já entrou) ou <b>Contas › Pendentes</b> (convite ainda não usado). Quem tem o SUPERVISOR LUBE liberado no Painel entra como gestor de todas as regiões.</div>
    <div class="h">Gestores <small>${gestores.length} ${gestores.length === 1 ? 'cadastrado' : 'cadastrados'}</small></div>
    <div class="list">${gestores.length ? gestores.map(g => `<div class="row"><span class="t">${esc(g.nome)}</span><span class="r">${g.st === 'liberado' ? '<span class="pill good">liberado</span>' : '<span class="pill warn">pendente</span>'}</span><span class="sub full">vê ${esc(veEstados(g.estados, setores))} · ${esc(g.email)}</span></div>`).join('') : vazio('Nenhum gestor cadastrado pelo app.')}</div>`;
  const regioes = () => `
    ${botao}
    <div class="nota">Cada supervisor vê <b>só a região dele</b>. O gestor vê todas ou só os estados marcados para ele. Por enquanto os RCAs não usam o app.</div>
    <div class="h">Regiões <small>${com} de ${regs.length} com supervisor</small></div>
    <div class="list">${regs.map(r => {
      const nomes = [...r.contas.map(c => esc(c.nome || c.email)), ...r.convites.map(v => esc(v.nome) + ' (pendente)')];
      const st = r.contas.length ? `<span class="pill good">${r.contas.length > 1 ? r.contas.length + ' liberados' : 'liberado'}</span>` : r.convites.length ? '<span class="pill warn">pendente</span>' : '<span class="pill">sem supervisor</span>';
      return `<button type="button" class="row" data-a="novo-sup" data-v="${r.cod}"><span class="t">${esc(r.nome)}</span><span class="r">${st}</span><span class="sub full">${nomes.length ? nomes.join(' · ') : 'Toque para cadastrar o supervisor desta região.'}</span></button>`;
    }).join('')}</div>`;
  return Object.assign(base, { html: embrulhar('adm', { pags: [['regioes', 'Supervisores', regioes], ['gestores', 'Gestores', gestoresPag], ['contas', `Contas${pend ? `<span class="n">${pend}</span>` : ''}`, vContas]] }) });
}
/* 1.11.4: convite enviado e ainda não usado conta como pendente (Júlio: "enviou tá no pendente, aceitou já apareceu");
   1.11.8: e a etiqueta diz "pendente" em todas as páginas (Júlio: "coloca pra mim esses 3 como pendente no aplicativo");
   quando a pessoa faz o Primeiro acesso com o código, o convite vira "usado" e a conta já nasce liberada */
const convitesAguardando = AD => ((AD && AD.convites) || []).filter(v => v.situacao === 'aguardando');
/* 1.11.6: o gestor vê TODAS as regiões ou SÓ OS ESTADOS marcados (Júlio: "a visão do gestor seja geral ou em estados
   específicos, por exemplo: BA, ES só e o outro só RJ"). O estado é o do nome da região ("ES - NORTE" = ES).
   1.11.7: as regiões SEM estado no nome (Administração, Inativo, Lube Distribuidora, Venda Interna) aparecem uma por uma
   para marcar (Júlio: "a que é outras precisa aparecer pra selecionar elas") e vão na lista como 'S<código>'. A mesma
   regra da API (_estados.js), que é quem filtra de verdade. Nada marcado = todas. */
const UFS = ['ES', 'BA', 'RJ'];
const ARTIGO_UF = { ES: 'do ES', BA: 'da BA', RJ: 'do RJ' };
const estadoDaRegiao = nome => { const m = /^\s*(ES|BA|RJ)\s*-/i.exec(String(nome || '')); return m ? m[1].toUpperCase() : 'OUTRAS'; };
/* lista limpa: ES, BA, RJ (e OUTRAS, de quem foi gravado na 1.11.6), depois as regiões 'S<cód>' em ordem; vazia = null (todas) */
const limparEstados = l => {
  const s = new Set((Array.isArray(l) ? l : String(l || '').split(',')).map(x => String(x).trim().toUpperCase()).filter(x => /^(ES|BA|RJ|OUTRAS|S\d{1,6})$/.test(x)));
  const e = UFS.concat('OUTRAS').filter(x => s.has(x)).concat([...s].filter(x => x[0] === 'S').sort((a, b) => a.slice(1) - b.slice(1)));
  return e.length ? e : null;
};
const liberada = (e, s) => !e || e.includes(estadoDaRegiao(s[1])) || e.includes('S' + s[0]);
/* "ES - NORTE" vira "ES - Norte"; "LUBE DISTRIBUIDORA" vira "Lube Distribuidora" */
const nomeRegiao = s => { const m = /^\s*(ES|BA|RJ)\s*-\s*(.*)$/i.exec(String(s || '')); return m ? m[1].toUpperCase() + ' - ' + titulo(m[2]) : titulo(s); };
const juntarE = l => l.length <= 1 ? (l[0] || '') : l.slice(0, -1).join(', ') + ' e ' + l[l.length - 1];
const nomeDoCod = (x, setores) => { const s = (setores || []).find(r => 'S' + r[0] === x); return s ? nomeRegiao(s[1]) : 'região ' + x.slice(1); };
/* "ES · BA · Lube Distribuidora" */
const rotuloEstados = (l, setores) => { const e = limparEstados(l); return e ? e.map(x => x === 'OUTRAS' ? 'Sem estado' : x[0] === 'S' ? nomeDoCod(x, setores) : x).join(' · ') : 'Todas as regiões'; };
const veEstados = (l, setores) => limparEstados(l) ? rotuloEstados(l, setores) : 'todas as regiões';
const regioesDosEstados = (l, setores) => { const e = limparEstados(l); return (setores || []).filter(s => liberada(e, s)); };
/* convite: "de todas as regiões" | "das regiões do ES e da BA" | "das regiões do ES e Lube Distribuidora" */
function fraseEstados(l, setores) {
  const e = limparEstados(l);
  if (!e) return 'de todas as regiões';
  const ufs = e.filter(x => UFS.includes(x)).map(x => ARTIGO_UF[x]);
  const nomes = regioesDosEstados(e, setores).filter(s => estadoDaRegiao(s[1]) === 'OUTRAS').map(s => nomeRegiao(s[1]));
  return 'das regiões ' + juntarE(ufs.concat(nomes));
}
/* botões Todas / ES / BA / RJ (com quantas regiões cada um tem), as regiões sem estado uma por uma e, embaixo, quais entram */
function seletorEstados(l, setores) {
  let e = limparEstados(l);
  const outras = (setores || []).filter(s => estadoDaRegiao(s[1]) === 'OUTRAS');
  // quem foi gravado com "OUTRAS" (1.11.6) aparece com cada região sem estado marcada
  if (e && e.includes('OUTRAS')) e = limparEstados(e.filter(x => x !== 'OUTRAS').concat(outras.map(s => 'S' + s[0])));
  const n = k => (setores || []).filter(s => estadoDaRegiao(s[1]) === k).length;
  const chip = (v, r, on) => `<button type="button" class="chip" data-a="est" data-v="${v}" aria-pressed="${on}">${r}</button>`;
  return `<div class="est-box">
      <div class="chips" role="group" aria-label="Estados que o gestor vê">${chip('TODAS', 'Todas', !e)}${UFS.map(k => chip(k, `${k} <small>${n(k)}</small>`, !!(e && e.includes(k)))).join('')}</div>
      ${outras.length ? `<div class="est-rot">Regiões sem estado</div>
      <div class="chips" role="group" aria-label="Regiões sem estado que o gestor vê">${outras.map(s => chip('S' + s[0], esc(nomeRegiao(s[1])), !!(e && e.includes('S' + s[0])))).join('')}</div>` : ''}
      <input type="text" hidden data-campo="estados" value="${e ? e.join(',') : ''}">
      <div class="sub est-quais">${quaisRegioes(e, setores)}</div>
    </div>`;
}
function quaisRegioes(e, setores) {
  const rs = regioesDosEstados(e, setores);
  if (!e) return `Vê as ${(setores || []).length} regiões.`;
  return rs.length ? `Vê ${rs.length} ${rs.length === 1 ? 'região' : 'regiões'}: ${esc(juntarE(rs.map(s => nomeRegiao(s[1]))))}.` : 'Nenhuma região marcada.';
}
function marcarEstado(b) {
  const box = b.closest('.est-box'), inp = box.querySelector('[data-campo="estados"]');
  let e = limparEstados(inp.value) || [];
  if (b.dataset.v === 'TODAS') e = [];
  else e = e.includes(b.dataset.v) ? e.filter(x => x !== b.dataset.v) : e.concat(b.dataset.v);
  e = limparEstados(e);
  inp.value = e ? e.join(',') : '';
  box.querySelectorAll('[data-a="est"]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.v === 'TODAS' ? !e : !!(e && e.includes(x.dataset.v)))));
  const setores = (S.adm.dados && S.adm.dados.setores) || [];
  box.querySelector('.est-quais').innerHTML = quaisRegioes(e, setores);
}
const nPendentes = AD => ((AD && AD.contas) || []).filter(c => c.situacao === 'pendente').length + convitesAguardando(AD).length;
function vContas() {
  const AD = S.adm, cs = AD.dados.contas || [], setores = AD.dados.setores || [], cv = convitesAguardando(AD.dados);
  const n = s => cs.filter(c => c.situacao === s).length;
  const lista = cs.filter(c => AD.filtro === 'todos' || c.situacao === AD.filtro);
  const convs = AD.filtro === 'liberado' ? [] : cv;
  const sit = { pendente: 'warn', liberado: 'good', recusado: 'bad', bloqueado: 'bad' };
  const regiao = cod => ((setores.find(s => s[0] === cod) || [])[1]) || 'região ' + cod;
  /* 1.11.9: o convite pendente se edita aqui (Júlio: "eu gostaria de editar as regiões que eu enviei o convite e que
     estão pendentes"): perfil, região do supervisor ou o que o gestor vê. O código do WhatsApp continua o mesmo. */
  const cartaoConvite = v => `
    <div class="card conta-card" data-convite="${esc(v.email)}">
      <div class="topo"><div><b>${esc(v.nome || '(sem nome)')}</b><span>${esc(v.email)}</span></div><span class="pill warn">pendente</span></div>
      <div class="filters">
        <div class="fld"><label>Perfil</label><select data-campo="tipo"><option value="supervisor"${v.tipo === 'gerente' ? '' : ' selected'}>Supervisor (só a região)</option><option value="gerente"${v.tipo === 'gerente' ? ' selected' : ''}>Gestor (todas ou alguns estados)</option></select></div>
        <div class="fld" data-so="supervisor"${v.tipo === 'gerente' ? ' hidden' : ''}><label>Região</label><select data-campo="codsupervisor"><option value="">Escolha a região</option>${setores.map(([cod, nome]) => `<option value="${cod}"${v.codsupervisor === cod ? ' selected' : ''}>${esc(nome)}</option>`).join('')}</select></div>
      </div>
      <div class="fld" data-so="gerente"${v.tipo === 'gerente' ? '' : ' hidden'}><label>O que o gestor vê</label>${seletorEstados(v.estados, setores)}</div>
      <div class="sub">convite enviado em ${diaHm(v.criado_em)} · falta o Primeiro acesso com o código${v.tipo !== 'gerente' && v.codsupervisor && !setores.some(s => s[0] === v.codsupervisor) ? ' · ' + esc(regiao(v.codsupervisor)) + ' sem RCA ativo' : ''}</div>
      <div class="botoes"><button type="button" class="btn peq sec" data-a="adm-convite">Salvar o convite</button></div>
    </div>`;
  return chips('adm-f', AD.filtro, [['pendente', `Pendentes (${n('pendente') + cv.length})`], ['liberado', `Liberados (${n('liberado')})`], ['todos', `Todos (${cs.length + cv.length})`]]) +
    '<div class="faixa info">Convite enviado fica em Pendentes até a pessoa fazer o Primeiro acesso; aí passa sozinho para Liberados. No convite pendente você troca a região ou o que o gestor vê e toca em "Salvar o convite": o código que a pessoa recebeu continua o mesmo. Aqui também ficam as contas criadas pelo Primeiro acesso sem convite. A lista se atualiza sozinha. Quem tem o SUPERVISOR LUBE liberado no Painel entra direto como gestor.</div>' +
    convs.map(cartaoConvite).join('') +
    (lista.length ? lista.map(c => `
    <div class="card conta-card" data-conta="${c.id}">
      <div class="topo"><div><b>${esc(c.nome || '(sem nome)')}</b><span>${esc(c.email)}</span></div><span class="pill ${sit[c.situacao] || ''}">${esc(c.situacao)}</span></div>
      <div class="filters">
        <div class="fld"><label>Perfil</label><select data-campo="tipo">${c.tipo === 'rca' ? '<option value="rca" selected>RCA</option>' : ''}<option value="supervisor"${c.tipo === 'supervisor' ? ' selected' : ''}>Supervisor (só a região)</option><option value="gerente"${c.tipo === 'gerente' ? ' selected' : ''}>Gestor (todas ou alguns estados)</option></select></div>
        <div class="fld" data-so="rca"${c.tipo === 'rca' ? '' : ' hidden'}><label>Código do RCA</label><input data-campo="codusur" inputmode="numeric" value="${c.codusur || ''}"></div>
        <div class="fld" data-so="supervisor"${c.tipo === 'supervisor' ? '' : ' hidden'}><label>Região</label><select data-campo="codsupervisor"><option value="">Escolha a região</option>${setores.map(([cod, nome]) => `<option value="${cod}"${c.codsupervisor === cod ? ' selected' : ''}>${esc(nome)}</option>`).join('')}</select></div>
      </div>
      <div class="fld" data-so="gerente"${c.tipo === 'gerente' ? '' : ' hidden'}><label>O que o gestor vê</label>${seletorEstados(c.estados, setores)}</div>
      ${c.tipo === 'rca' && c.codusur ? `<div class="sub">${c.rca_nome ? `WinThor: <b>${esc(titulo(c.rca_nome))}</b>${c.rca_ativo === false ? ' (inativo)' : ''} · ${c.email_confere ? '<span class="pill good">e-mail confere</span>' : '<span class="pill warn">e-mail diferente do WinThor</span>'}` : '<span class="pill bad">código não encontrado no WinThor</span>'}</div>` : ''}
      <div class="sub">pedido em ${diaHm(c.criado_em)}${c.decidido_em ? ' · decidido em ' + diaHm(c.decidido_em) : ''}</div>
      <div class="botoes">
        ${c.situacao !== 'liberado' ? `<button type="button" class="btn peq verde" data-a="adm-decidir" data-v="liberado">Liberar</button>` : `<button type="button" class="btn peq sec" data-a="adm-decidir" data-v="liberado">Salvar</button>`}
        ${c.situacao === 'pendente' ? `<button type="button" class="btn peq sec" data-a="adm-decidir" data-v="recusado">Recusar</button>` : ''}
        ${c.situacao === 'liberado' ? `<button type="button" class="btn peq" data-a="adm-decidir" data-v="bloqueado">Bloquear</button>` : ''}
        ${c.situacao === 'recusado' || c.situacao === 'bloqueado' ? `<button type="button" class="btn peq perigo" data-a="adm-excluir">Excluir</button>` : ''}
      </div>
    </div>`).join('') : convs.length ? '' : vazio('Nenhuma conta neste filtro.'));
}
/* silencioso (1.11.4, a leitura de 5 em 5 s da tela aberta): sem esqueleto nem erro na tela; só redesenha se mudou */
async function carregarAcessos(silencioso) {
  if (silencioso && (S.adm.carregando || S.adm.lendo)) return;
  if (!silencioso) { S.adm.carregando = true; S.adm.erro = ''; if (S.chave === 'adm') render(); }
  S.adm.lendo = true;
  try {
    const t = await A.token();
    const r = await fetch((CFG.api || '') + '/api/acessos', { headers: { Authorization: 'Bearer ' + t }, cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.mensagem || 'Não consegui ler os acessos (' + r.status + ').');
    const assinatura = JSON.stringify([j.contas, j.convites, j.setores]);
    const mudou = assinatura !== S.adm.assinatura;
    S.adm.assinatura = assinatura; S.adm.dados = j;
    if (silencioso && (mudou || S.adm.pendente)) redesenharAcessos();
  } catch (e) { if (!silencioso) S.adm.erro = e.message || String(e); }
  S.adm.lendo = false;
  if (!silencioso) { S.adm.carregando = false; if (S.chave === 'adm') render(); }
}
/* nunca redesenha por cima de quem está mexendo: campo com foco, folha aberta, animação ou um cartão de conta com perfil
   ou região trocados e ainda não salvos (fica para a próxima leitura) */
function redesenharAcessos() {
  if (S.chave !== 'adm') return;
  const foco = document.activeElement;
  // lista sem opção marcada no HTML abre na primeira ("Escolha a região"): isso não é edição
  const inicial = s => Math.max(0, [...s.options].findIndex(o => o.defaultSelected));
  const editado = [...document.querySelectorAll('.conta-card [data-campo]')].some(el => el.tagName === 'SELECT'
    ? el.selectedIndex !== inicial(el) : el.value !== el.defaultValue);
  if ((foco && /^(INPUT|SELECT|TEXTAREA)$/.test(foco.tagName)) || !$('#folha').hidden || $('#view').classList.contains('em-anim') || editado) { S.adm.pendente = true; return; }
  S.adm.pendente = false;
  render({ rolar: window.scrollY });
}
const ADM_VIVO_MS = 5e3;
setInterval(() => {
  if (S.chave !== 'adm' || !conta || !conta.admin || document.visibilityState !== 'visible') return;
  carregarAcessos(true);
}, ADM_VIVO_MS);
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
    await postAcessos({ id: card.dataset.conta, situacao, tipo: campo('tipo').value, codusur: campo('codusur').value.replace(/\D/g, ''), codsupervisor: campo('codsupervisor').value,
                        estados: limparEstados(campo('estados') ? campo('estados').value : '') });
    toast(situacao === 'liberado' ? 'Acesso liberado.' : situacao === 'recusado' ? 'Pedido recusado.' : 'Acesso bloqueado.');
    await carregarAcessos();
  } catch (e) { toast(e.message || String(e), true); }
}
/* 1.11.9: grava o convite pendente editado (sup_editar_convite do Painel: só administrador, só convite aguardando,
   mesmo código, histórico em sup_acessos) */
async function salvarConvite(card, b) {
  const campo = n => card.querySelector(`[data-campo="${n}"]`);
  try {
    const tipo = campo('tipo').value === 'gerente' ? 'gerente' : 'supervisor';
    if (tipo === 'supervisor' && !campo('codsupervisor').value) throw new Error('Escolha a região do supervisor.');
    const j = await postAcessos({ acao: 'convite', email: card.dataset.convite, tipo, codsupervisor: campo('codsupervisor').value,
                                  estados: tipo === 'gerente' ? limparEstados(campo('estados').value) : null });
    toast(j.mudou === false ? 'O convite já estava assim.' : 'Convite atualizado. O código que a pessoa recebeu continua o mesmo.');
    S.adm.assinatura = null;
    await carregarAcessos();
  } catch (e) { b.removeAttribute('aria-busy'); toast(e.message || String(e), true); }
}
/* 1.11.5: excluir conta recusada ou bloqueada (Júlio, 2026-11-11). Confirma numa folha; o banco (sup_excluir_conta)
   só aceita do administrador e apaga o login só se ele for só do app (quem usa o Painel ou o SAC continua entrando lá) */
function confirmarExclusao(id) {
  const c = ((S.adm.dados && S.adm.dados.contas) || []).find(x => x.id === id);
  if (!c) return;
  abrirFolha(`
    <div class="alca" aria-hidden="true"></div>
    <div class="folha-cab"><button type="button" class="link" data-a="fechar-folha">Cancelar</button><b>Excluir conta</b><span></span></div>
    <div class="confirma">
      <div class="quem-ex"><b>${esc(c.nome || '(sem nome)')}</b><span>${esc(c.email)} · ${esc(c.situacao)}</span></div>
      <div class="nota">A conta sai do app e a pessoa não entra mais nele. Se o login for só do app, ele também é apagado; quem usa o Painel ou o SAC continua entrando lá. O histórico do pedido fica. <b>Não tem volta.</b> Se a pessoa fizer o Primeiro acesso de novo, aparece em Pendentes.</div>
      <button type="button" class="btn cheio perigo" data-a="adm-excluir-sim" data-v="${esc(c.id)}">Excluir a conta</button>
    </div>`, 'Excluir conta');
}
async function excluirConta(id, b) {
  b.setAttribute('aria-busy', 'true');
  try {
    const r = await postAcessos({ acao: 'excluir', id });
    fecharFolha();
    if (S.adm.dados) S.adm.dados.contas = (S.adm.dados.contas || []).filter(x => x.id !== id);
    S.adm.assinatura = null;
    if (S.chave === 'adm') render({ rolar: window.scrollY });
    toast(r.login ? 'Conta e login excluídos.' : 'Conta do app excluída. O login continua no Painel ou no SAC.');
    carregarAcessos(true);
  } catch (e) { b.removeAttribute('aria-busy'); toast(e.message || String(e), true); }
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
      <div class="fld est-folha" id="s-est-box"${gestor ? '' : ' hidden'}><label>O que o gestor vê</label>${seletorEstados(null, AD.setores)}</div>
      ${ja.length || conv.length ? `<div class="faixa info">Nesta região: ${[...ja.map(c => esc(c.nome || c.email) + ' (liberado)'), ...conv.map(v => esc(v.nome) + ' (pendente)')].join(', ')}.</div>` : ''}
      <div class="nota" id="s-nota">${notaPerfil(gestor)}</div>
      <div class="msg bad" id="s-erro" role="alert" hidden></div>
      <button class="btn cheio" type="submit" id="s-salvar">Salvar e gerar o convite</button>
    </form>`, 'Novo acesso');
}
const notaPerfil = gestor => (gestor
  ? 'O gestor vê <b>todas as regiões</b> ou <b>só os estados marcados</b>, só para consultar.'
  : 'O supervisor vê <b>só a região escolhida</b>.') +
  ' Depois de salvar, mande o convite pelo WhatsApp: a pessoa baixa o app, toca em <b>Primeiro acesso</b> com este e-mail e o código do convite, e já entra liberada.';
function escolherPerfil(tipo) {
  const g = tipo === 'gerente', sg = $('#folha .segios.perfil');
  $('#s-tipo').value = g ? 'gerente' : 'supervisor';
  sg.style.setProperty('--i', g ? 1 : 0);
  sg.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.perfil === tipo)));
  $('#s-setor-box').hidden = g;
  $('#s-est-box').hidden = !g;
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
    const estados = tipo === 'gerente' ? limparEstados($('#s-est-box [data-campo="estados"]').value) : null;
    const j = await postAcessos({ acao: 'convidar', tipo, nome, email, codsupervisor: cod, estados });
    const setor = tipo === 'gerente' ? null : ((S.adm.dados.setores || []).find(s => s[0] === cod) || [0, 'região ' + cod])[1];
    mostrarConvite({ tipo, nome, email, setor, estados, codigo: j.codigo, liberou: !!j.liberou });
    carregarAcessos();
  } catch (e) { erro(e.message || String(e)); b.removeAttribute('aria-busy'); b.textContent = 'Salvar e gerar o convite'; }
}
function textoConvite(x) {
  const ver = x.tipo === 'gerente' ? fraseEstados(x.estados, S.adm.dados && S.adm.dados.setores) : 'da região ' + x.setor;
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
      <b>${x.tipo === 'gerente' ? 'Gestor' : 'Supervisor'} ${x.liberou ? 'liberado' : 'cadastrado'}</b><span class="sub">${esc(x.nome)} · ${x.tipo === 'gerente' ? esc(veEstados(x.estados, S.adm.dados && S.adm.dados.setores)) : esc(x.setor)}</span></div>
    ${x.liberou ? '<div class="faixa info">Essa pessoa já tinha conta: o acesso foi liberado agora. Basta entrar com a senha de sempre.</div>' : ''}
    <div class="h">Convite <small>mande para ele</small></div>
    <div class="convite">${esc(txt)}</div>
    <a class="btn cheio zap" href="https://wa.me/?text=${encodeURIComponent(txt)}" target="_blank" rel="noopener">Enviar pelo WhatsApp</a>
    <button type="button" class="btn sec cheio com-ic" data-a="copiar-convite">${ic('copiar')}Copiar a mensagem</button>
    <button type="button" class="link" data-a="fechar-folha">Fechar</button>`, 'Convite do supervisor');
}

/* ---------------- GERAL do gestor (1.12) ----------------
   Júlio (2026-11-12): "onde eu seleciono a região para olhar, gostaria de colocar um GERAL pra quem é gestor, será
   contabilizado o acumulado daquele momento de todas as regiões que ele tem a visualização" e "ele precisa ficar no topo
   de todas as regiões em destaque dourado". O GERAL soma as regiões do resumo entre setores (R), que a API já entrega só
   com as regiões liberadas para o gestor e que chega ao vivo. Cada número de região é o da tela da região, calculado no
   banco com as mesmas regras (supervisor.pacote_resumo, db/16); cliente que aparece em duas regiões conta UMA vez no total
   (R.geral), como a 146 com vários supervisores. Lista de cliente e de produto continua por região: no GERAL, Carteira e
   Curva ABC mostram as regiões, e o toque numa região abre ela. */
const ehGeral = () => !!(D && D.geral);
function geralDe(R) {
  const i0 = R.meses.length - 1, ss = R.setores, cods = new Set(ss.map(s => s.cod)), gl = R.geral || {};
  const uniao = k => soma((gl[k] || []).filter(x => (x[0] || []).some(c => cods.has(c))), x => +x[1] || 0);
  const porReg = k => { const m = new Map(); for (const [regs, n] of gl[k] || []) for (const c of regs || []) m.set(c, (m.get(c) || 0) + (+n || 0)); return m; };
  const t = { i0, m0: R.meses[i0], n: ss.length, completo: !!R.geral && ss.every(s => s.g),
              vh: 0, nh: 0, v7: 0, vm: 0, nm: 0, sem: 0, fat: 0, vb: 0, tls: 0, ms: 0, dev: 0, venc: 0, jur: 0, fatAnt: 0,
              meta: 0, metaAte: 0, fatMeta: 0, tlsMeta: 0, msMeta: 0, comMeta: 0, semMetaN: 0, semMetaFat: 0, uteis: 0, dias: [] };
  for (const s of ss) {
    const g = s.g || {}, f = +s.venda[i0] || 0, tl = +s.tls[i0] || 0, ms = +s.massa[i0] || 0, mt = s.meta ? +s.meta[i0] || 0 : 0;
    t.vh += g.vh || 0; t.nh += g.nh || 0; t.v7 += g.v7 || 0; t.vm += g.vm || 0; t.nm += g.nm || 0; t.sem += g.sem || 0;
    t.fat += f; t.vb += +s.vendaBruta[i0] || 0; t.tls += tl; t.ms += ms; t.dev += +s.dev[i0] || 0;
    t.venc += s.vencido; t.jur += s.juridico; t.fatAnt += s.fatAnt || 0;
    if (mt) { t.meta += mt; t.metaAte += +s.metaAte[i0] || 0; t.fatMeta += f; t.tlsMeta += tl; t.msMeta += ms; t.comMeta++; t.uteis = Math.max(t.uteis, s.uteis || 0); }
    else if (Math.abs(f) > 0.005) { t.semMetaN++; t.semMetaFat += f; }
    (s.fatDia || []).forEach((v, i) => { t.dias[i] = (t.dias[i] || 0) + (+v || 0); });
  }
  t.cliHoje = uniao('cli_hoje'); t.pos = uniao('cli_mes'); t.cart = uniao('cli_cart'); t.cliVenc = uniao('cli_venc');
  t.reg = { hoje: porReg('cli_hoje'), mes: porReg('cli_mes'), cart: porReg('cli_cart') };
  return t;
}
function montarGeral() {
  const d = { geral: true, tipo: 'geral', setor: { cod: 'GERAL', nome: 'GERAL' }, hoje: R.hoje, ini: R.meses[0] || R.hoje, gerado: R.gerado, hv: '',
              cargas: { pedido: R.gerado, faturado: R.gerado, titulo: R.gerado }, G: geralDe(R) };
  aplicarVivo(d);
  return d;
}
/* o resumo da manhã de antes da 1.12 não traz os números do GERAL: o do dia (ao vivo) chega em segundos */
const geralEsperando = () => `<div class="faixa info">Somando as regiões… O geral aparece em instantes, assim que o resumo ao vivo chegar.</div>${ESQ}`;
const deltaTxt = (v, txt) => v == null ? '' : `<span class="delta ${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '▲' : '▼'} ${pct(Math.abs(v), 0)}</span> ${txt}`;
/* barrinhas do mês (sem domingo), com o faturado por dia somado das regiões */
function barrasGeral(T, grande) {
  const dias = [], vals = [];
  T.dias.forEach((v, i) => { const d = T.m0 + i; if (dow(d) !== 0) { dias.push(d); vals.push(v); } });
  if (dias.length < 2) return '';
  if (grande) return desenharDias(dias, vals, 'faturada', D.hoje);
  const max = Math.max(1, ...vals), W = 300, H = 38, bw = W / dias.length;
  return `<svg class="mini" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">` + vals.map((v, i) => v > 0
    ? `<rect x="${(i * bw + bw * .18).toFixed(1)}" y="${(H - v / max * H).toFixed(1)}" width="${Math.max(1, bw * .64).toFixed(1)}" height="${(v / max * H).toFixed(1)}" rx="1.4"${i === dias.length - 1 ? ' class="hl"' : ''} style="--i:${i}"/>` : '').join('') + '</svg>';
}
const pillMeta = s => { const i0 = R.meses.length - 1, mt = s.meta ? +s.meta[i0] || 0 : 0, v = +s.venda[i0] || 0;
  return mt ? `<span class="pill ${situacaoMeta(v, mt, +s.metaAte[i0] || 0)[0]}">${pct(v / mt, 0)} da meta</span>` : '<span class="pill">sem meta</span>'; };
const regioesN = n => n + (n === 1 ? ' região' : ' regiões');
const notaGeral = () => `<div class="nota">GERAL = a soma ${D.G.n === 1 ? 'da região' : 'das ' + D.G.n + ' regiões'} que você vê, ao vivo. Cliente que aparece em duas regiões conta uma vez só no total, como na 146. Toque numa região para abrir ela.</div>`;
/* regiões por faturado do mês, com a % da meta: Resumo e Vendas */
function listaRegioesFat(id, lim) {
  const i0 = R.meses.length - 1, ls = R.setores.slice().sort((a, b) => (+b.venda[i0] || 0) - (+a.venda[i0] || 0));
  const mx = ls.length ? Math.max(1, +ls[0].venda[i0] || 0) : 1;
  const rows = ls.map(s => {
    const i = i0, mt = s.meta ? +s.meta[i] || 0 : 0, v = +s.venda[i] || 0, tl = +s.tls[i] || 0;
    return `
      <button type="button" class="row" data-a="setor" data-v="${s.cod}">
        <span class="t">${esc(s.nome)}</span><span class="r">${brlK(v)}</span>
        <span class="sub">${nf0.format(D.G.reg.mes.get(s.cod) || 0)} positivados · <span class="nw">margem ${pctM(tl ? (+s.massa[i] || 0) / tl : 0)}</span></span><span class="sub r">${pillMeta(s)}</span>
        <span class="full">${bar(mt ? v / mt : v / mx, 'gold')}</span>
      </button>`;
  });
  return `<div class="list" data-lista="${id}">${limitar(rows, lim, id, 'Faturado por região')}</div>`;
}

function gResumo() {
  const T = D.G, H = D.hoje, nomeM = MESES_L[dt(H).getUTCMonth()];
  if (!T.completo) return geralEsperando();
  const dl = T.v7 ? T.vh / T.v7 - 1 : null, dMes = T.fatAnt ? T.fat / T.fatAnt - 1 : null, a0 = mesSeg(T.m0, -1);
  const fp = T.cart ? T.pos / T.cart : 0, mg = T.tls ? T.ms / T.tls : 0;
  const todasComMeta = T.comMeta && !T.semMetaN;
  const mt = T.meta ? { total: T.meta, ate: T.metaAte, dias: T.uteis, fat: T.fatMeta, falta: T.meta - T.fatMeta, st: situacaoMeta(T.fatMeta, T.meta, T.metaAte) } : null;
  const maior = R.setores.slice().sort((a, b) => (+b.venda[T.i0] || 0) - (+a.venda[T.i0] || 0))[0];
  const linhaMeta = mt && !todasComMeta ? `<span class="meta-todas"><span class="mt-l">Regiões com meta (${T.comMeta}) <span class="pill ${mt.st[0]}">${pct(T.fatMeta / T.meta)}</span></span><span class="mt-v"><b>${brl(T.fatMeta)}</b> de ${brl(T.meta)}</span></span>
      <span class="meta-sem">${T.semMetaN} ${T.semMetaN === 1 ? 'região com venda está' : 'regiões com venda estão'} sem meta no WinThor em ${nomeM} (${brl(T.semMetaFat)} faturados), fora da meta.</span>` : '';
  return `
  <div class="resumo">
    <button type="button" class="hoje-card" data-a="ir" data-v="vendas:hoje">
      <span class="cartao-rot">${ic('cart')}Digitado hoje <small>até ${hm(D.cargas.pedido)}</small>${ic('frente', 'seta')}</span>
      <span class="valor-grande" data-cnt="${T.vh}" data-f="brlK">${brlK(T.vh)}</span>
      <span class="sub">${dl != null ? deltaTxt(dl, 'vs. ' + diaLongo(H - 7)) : 'sem pedido em ' + diaLongo(H - 7) + ' para comparar'}</span>
      <span class="trio duo">
        <span><small>Pedidos</small><b data-cnt="${T.nh}" data-f="n">${nf0.format(T.nh)}</b></span>
        <span><small>Clientes</small><b data-cnt="${T.cliHoje}" data-f="n">${nf0.format(T.cliHoje)}</b></span>
      </span>
      ${T.sem ? `<span class="alerta">${T.sem} ${T.sem > 1 ? 'RCAs ativos sem pedido' : 'RCA ativo sem pedido'} hoje · ver por região</span>` : ''}
    </button>
    ${todasComMeta ? `<button type="button" class="mes-card com-meta" data-a="ir" data-v="vendas:mes">
      <span class="cartao-rot">${ic('cash')}Meta de ${nomeM} <small>${mt.dias ? `${mt.dias} ${mt.dias === 1 ? 'dia útil' : 'dias úteis'} com hoje` : 'mês fechado'}</small>${ic('frente', 'seta')}</span>
      <span class="valor-grande" data-cnt="${T.fat}" data-f="brlK">${brlK(T.fat)}</span>
      <span class="meta-linha"><span class="meta-de">meta ${brl(mt.total)}</span><span class="pill ${mt.st[0]}">${mt.st[1]}</span></span>
      ${blocoMeta(mt, mg)}
    </button>` : `<button type="button" class="mes-card" data-a="ir" data-v="vendas:mes">
      <span class="cartao-rot">${ic('cash')}Faturado em ${nomeM} <small>até ${dm(H)}</small>${ic('frente', 'seta')}</span>
      <span class="linha-valor"><span class="valor-grande" data-cnt="${T.fat}" data-f="brlK">${brlK(T.fat)}</span><span class="pill">Margem ${pctM(mg)}</span></span>
      <span class="sub">${dMes != null ? deltaTxt(dMes, 'vs. ' + MESES[dt(a0).getUTCMonth()] + ' no mesmo período') : nf0.format(T.pos) + ' clientes positivados'}</span>
      ${barrasGeral(T)}
      ${linhaMeta}
    </button>`}
    <div class="tiles">
      <button type="button" class="tile ouro" data-a="ir" data-v="carteira:pos">${anel(fp)}<span class="cartao-rot">${ic('users')}Carteira</span><span class="v" data-cnt="${fp}" data-f="pct0">${pct(fp, 0)}</span><span class="d">${nf0.format(T.pos)} positivados de ${nf0.format(T.cart)} cadastrados</span></button>
      <button type="button" class="tile perigo" data-a="ir" data-v="inad:resumo"><span class="cartao-rot">${ic('alert')}Vencido</span><span class="v" data-cnt="${T.venc}" data-f="brlK">${brlK(T.venc)}</span><span class="d">${nf0.format(T.cliVenc)} ${T.cliVenc === 1 ? 'cliente' : 'clientes'} com título vencido</span></button>
      <button type="button" class="tile atencao" data-a="ir" data-v="dev:resumo"><span class="cartao-rot">${ic('ret')}Devolução</span><span class="v">${pct(T.vb ? T.dev / T.vb : 0)}</span><span class="d">${brlK(T.dev)} devolvidos no mês</span></button>
      <button type="button" class="tile" data-a="ir" data-v="vendas:regioes"><span class="cartao-rot">${ic('layers')}Maior região</span><span class="v txt">${maior ? esc(maior.nome) : '—'}</span><span class="d">${maior ? brlK(+maior.venda[T.i0] || 0) + ' · ' + regioesN(T.n) + ' no geral' : ''}</span></button>
    </div>
    <div class="h">Por região <small>faturado em ${nomeM} · toque para abrir</small></div>
    ${listaRegioesFat('g-res-reg', 6)}
    ${notaGeral()}
  </div>`;
}
function gVendas() {
  const T = D.G, H = D.hoje, nomeM = MESES_L[dt(H).getUTCMonth()];
  if (!T.completo) return geralEsperando();
  const dia = () => {
    const dl = T.v7 ? T.vh / T.v7 - 1 : null;
    const dTxt = dl != null ? `${deltaTxt(dl, 'vs. ' + diaLongo(H - 7))} (${brlK(T.v7)})` : `sem pedido em ${diaLongo(H - 7)}`;
    const ls = R.setores.map(s => ({ s, g: s.g || {}, cl: T.reg.hoje.get(s.cod) || 0 })).sort((a, b) => (b.g.vh || 0) - (a.g.vh || 0) || (b.g.sem || 0) - (a.g.sem || 0));
    const mx = ls.length ? Math.max(1, ls[0].g.vh || 0) : 1;
    const rows = ls.map(x => `
      <button type="button" class="row" data-a="setor" data-v="${x.s.cod}">
        <span class="t">${esc(x.s.nome)}</span><span class="r">${brlK(x.g.vh || 0)}</span>
        <span class="sub">${nf0.format(x.g.nh || 0)} ${x.g.nh === 1 ? 'pedido' : 'pedidos'} · ${nf0.format(x.cl)} ${x.cl === 1 ? 'cliente' : 'clientes'}</span><span class="sub r">${x.g.sem ? `<span class="pill warn">${x.g.sem} sem pedido</span>` : ''}</span>
        <span class="full">${bar((x.g.vh || 0) / mx, 'gold')}</span>
      </button>`);
    return `
    <div class="h">Venda do dia <small>${diaLongo(H)} · até ${hm(D.cargas.pedido)}</small></div>
    <div class="kpis k2">${kpi('Digitado', brlK(T.vh), dTxt, 'hero')}${kpi('Pedidos', nf0.format(T.nh), 'digitados')}${kpi('Positivação', nf0.format(T.cliHoje), 'clientes com pedido')}${kpi('Ticket médio', brlK(T.nh ? T.vh / T.nh : 0), 'por pedido', 'cheia')}</div>
    ${T.sem ? `<div class="faixa">${T.sem} ${T.sem > 1 ? 'RCAs ativos sem pedido' : 'RCA ativo sem pedido'} hoje, somando as regiões. Toque numa região para ver quem.</div>` : ''}
    <div class="h">Por região <small>digitado hoje</small></div>
    <div class="list" data-lista="g-dia">${limitar(rows, 8, 'g-dia', 'Digitado hoje por região')}</div>`;
  };
  const mes = () => `
    <div class="h">Acumulado <small>${nomeM} até ${dm(H)}</small></div>
    <div class="kpis k2">${kpi('Faturado', brlK(T.fat), 'venda menos devolução', 'hero')}${kpi('Margem', pctM(T.tls ? T.ms / T.tls : 0), brlK(T.ms) + ' de massa de margem')}${kpi('Digitado', brlK(T.vm), nf0.format(T.nm) + ' pedidos')}${kpi('Positivação', nf0.format(T.pos), 'clientes com pedido')}${kpi('Ticket médio', brlK(T.nm ? T.vm / T.nm : 0), 'por pedido')}</div>
    <div class="card">${barrasGeral(T, true) || '<span class="muted">O gráfico aparece a partir do segundo dia do mês.</span>'}</div>
    ${notaGeral()}`;
  const regioes = () => `<div class="h">Por região <small>faturado em ${nomeM} · toque para abrir</small></div>${listaRegioesFat('g-reg', 30)}`;
  return { pags: [['hoje', 'Dia', dia], ['mes', 'Mês', mes], ['regioes', 'Regiões', regioes]] };
}
function gCarteira() {
  const T = D.G, nomeM = MESES_L[dt(D.hoje).getUTCMonth()];
  if (!T.completo) return geralEsperando();
  const fp = T.cart ? T.pos / T.cart : 0;
  const ls = R.setores.map(s => { const p = T.reg.mes.get(s.cod) || 0, c = T.reg.cart.get(s.cod) || 0; return { s, p, c, f: c ? p / c : 0 }; })
    .filter(x => x.c || x.p).sort((a, b) => b.f - a.f);
  const rows = ls.map(x => `
      <button type="button" class="row" data-a="setor" data-v="${x.s.cod}">
        <span class="t">${esc(x.s.nome)}</span><span class="r">${pct(x.f, 0)}</span>
        <span class="sub full">${nf0.format(x.p)} positivados de ${nf0.format(x.c)} cadastrados</span><span class="full">${bar(x.f, 'gold')}</span>
      </button>`);
  return `
    <div class="kpis k2">${kpi('Positivação', pct(fp, 0), `${nf0.format(T.pos)} de ${nf0.format(T.cart)} clientes da carteira`, 'hero')}${kpi('Positivados', nf0.format(T.pos), 'com pedido em ' + nomeM)}${kpi('Cadastrados', nf0.format(T.cart), 'na carteira (146)')}</div>
    <div class="h">Por região <small>positivação em ${nomeM} · toque para abrir</small></div>
    <div class="list" data-lista="g-cart">${rows.length ? limitar(rows, 8, 'g-cart', 'Carteira por região') : vazio('Nenhuma região com carteira.')}</div>
    <div class="nota">A lista de clientes é de cada região: toque numa região para ver os clientes dela. No total, cliente que aparece em duas regiões conta uma vez só.</div>`;
}
/* Curva ABC das REGIÕES pelo faturado do mês: A até 80% do total, B até 95%, C o resto (a de cliente e produto é por região) */
function gAbc() {
  const T = D.G, nomeM = MESES_L[dt(D.hoje).getUTCMonth()];
  const i0 = T.i0, ls = R.setores.map(s => ({ s, v: +s.venda[i0] || 0 })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  const tot = soma(ls, x => x.v) || 1; let acc = 0;
  const rows = ls.map(x => {
    const cl = acc < .8 ? 'A' : acc < .95 ? 'B' : 'C'; acc += x.v / tot;
    return `
      <button type="button" class="row" data-a="setor" data-v="${x.s.cod}">
        <span class="t">${esc(x.s.nome)}</span><span class="r">${brlK(x.v)}</span>
        <span class="sub">${pct(x.v / tot)} do total · acumulado ${pct(acc, 0)}</span><span class="sub r"><span class="pill ${cl === 'C' ? '' : cl}">Classe ${cl}</span></span>
        <span class="full">${bar(x.v / ls[0].v, 'gold')}</span>
      </button>`;
  });
  return `
    <div class="h">Curva ABC das regiões <small>faturado em ${nomeM}</small></div>
    <div class="list" data-lista="g-abc">${rows.length ? limitar(rows, 30, 'g-abc', 'Curva ABC das regiões') : vazio('Nenhuma região com faturado no mês.')}</div>
    <div class="nota">Classe A: as regiões que somam até 80% do faturado; B: até 95%; C: o resto. A curva de clientes e de produtos é de cada região: toque numa região para abrir.</div>`;
}
function gInad() {
  const T = D.G;
  if (!T.completo) return geralEsperando();
  const ls = R.setores.slice().sort((a, b) => b.vencido - a.vencido), mx = ls.length ? ls[0].vencido || 1 : 1;
  const rows = ls.filter(x => x.vencido || x.juridico).map(x => `
      <button type="button" class="row" data-a="setor" data-v="${x.cod}">
        <span class="t">${esc(x.nome)}</span><span class="r">${brlK(x.vencido)}</span>
        <span class="sub full">${nf0.format(x.clientes)} clientes${x.juridico ? ' · jurídico ' + brlK(x.juridico) : ''}</span><span class="full">${bar(x.vencido / mx, 'bad')}</span>
      </button>`);
  return `
    <div class="kpis k2">${kpi('Vencido', brlK(T.venc), 'em aberto hoje', 'perigo wide')}${kpi('Clientes', nf0.format(T.cliVenc), 'com título vencido')}${kpi('Regiões', nf0.format(ls.filter(x => x.vencido > 0.005).length), 'com título vencido')}</div>
    ${T.jur ? `<div class="faixa">Jurídico e perdas: ${brl(T.jur)}, fora da soma acima.</div>` : ''}
    <div class="h">Por região <small>toque para ver os clientes</small></div>
    <div class="list" data-lista="g-inad">${rows.length ? limitar(rows, 8, 'g-inad', 'Vencido por região') : vazio('Nenhum título vencido. 👏')}</div>`;
}
function gDev() {
  const DV = S.d, idx = mesesDoPeriodo(DV.per).map(m => R.meses.indexOf(m)).filter(i => i >= 0);
  const ls = R.setores.map(s => { const v = idx.reduce((a, i) => a + (+s.dev[i] || 0), 0), vd = idx.reduce((a, i) => a + (+s.vendaBruta[i] || 0), 0); return { s, v, vd, p: vd ? v / vd : 0 }; });
  const tot = soma(ls, x => x.v), venda = soma(ls, x => x.vd);
  const [d1, d2] = periodo(DV.per);
  const com = ls.filter(x => x.v > 0.005).sort((a, b) => b.p - a.p), mx = Math.max(...com.map(x => x.p)) || 1;
  const rows = com.map(x => `
      <button type="button" class="row" data-a="setor" data-v="${x.s.cod}">
        <span class="t">${esc(x.s.nome)}</span><span class="r">${pct(x.p)}</span>
        <span class="sub full">${brl(x.v)} devolvidos de ${brlK(x.vd)} vendidos</span><span class="full">${bar(x.p / mx, 'bad')}</span>
      </button>`);
  const topo = chips('d-per', DV.per, [['mes', 'Mês atual'], ['ant', 'Mês anterior'], ['3m', 'Últimos 3 meses']], 'rola');
  return topo + `
    <div class="kpis k2">${kpi('Devolvido', brlK(tot), `${pct(venda ? tot / venda : 0)} da venda de ${dm(d1)} a ${dm(d2)}`, 'perigo wide')}${kpi('Venda', brlK(venda), 'antes das devoluções')}${kpi('Regiões', nf0.format(com.length), 'com devolução')}</div>
    <div class="h">Por região <small>% sobre a venda · toque para ver os motivos</small></div>
    <div class="list" data-lista="g-dev">${rows.length ? limitar(rows, 8, 'g-dev', 'Devolução por região') : vazio('Nenhuma devolução no período. 👏')}</div>`;
}
const TELAS_GERAL = { resumo: gResumo, vendas: gVendas, carteira: gCarteira, abc: gAbc, inad: gInad, dev: gDev };

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
/* tela já calculada fica guardada (1.4, Júlio: "está travando bastante entre uma aba e outra"): voltar a uma aba
   com os mesmos filtros e o mesmo pacote não recalcula nada. Some quando chega pacote novo. */
const memo = { base: '', m: new Map() };
function chaveMemo() {
  if (S.pilha.length || LISTA_TODA || !D) return null;
  return [S.tab, S.pag[S.tab], conta && conta.tipo, R ? R.gerado : '', JSON.stringify(S.v), JSON.stringify(S.c),
    JSON.stringify(S.a), S.i.open, JSON.stringify(S.d)].join('|');
}
function montarTela() {
  const it = S.pilha[S.pilha.length - 1];
  if (!it) {
    const t = TABS.find(x => x[0] === S.tab) || TABS[0];
    if (!D) return { chave: t[0], titulo: t[1], raiz: true, html: ESQ };
    const base = S.escopo + '|' + D.gerado + '|' + (D.hv || '');   // hv: a versão do pacote do dia (ao vivo, 1.7)
    if (memo.base !== base) { memo.base = base; memo.m.clear(); }
    const k = chaveMemo();
    if (k && memo.m.has(k)) return memo.m.get(k);
    const tela = { chave: t[0], titulo: t[1], raiz: true, html: embrulhar(t[0], (ehGeral() ? TELAS_GERAL[t[0]] : t[2])()) };
    if (k) memo.m.set(chaveMemo() || k, tela);   // a chave depois do cálculo (ele completa padrões, como o dia de hoje)
    return tela;
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
  if (ehGerente() && R && ehGeral()) return `<button type="button" class="setor-pill geral" data-a="setores" aria-label="Trocar de região (agora o GERAL de ${regioesN(D.G.n)})">${ic('layers')}<span>GERAL · ${regioesN(D.G.n)}</span>${ic('baixo', 'seta')}</button>`;
  if (ehGerente() && R) return `<button type="button" class="setor-pill" data-a="setores" aria-label="Trocar de região (agora ${esc(nome)})">${ic('pin')}<span>${esc(nome)}</span>${ic('baixo', 'seta')}</button>`;
  if (D && ehRca()) return `<span class="setor-pill fixo">${ic('user')}<span>RCA ${D.codusur} · ${esc(D.rcaNome || '')}</span></span>`;
  return `<span class="setor-pill fixo" title="Sua região">${ic('pin')}<span>${esc(nome)}</span></span>`;
}
function whenHtml() {
  if (!D) return '';
  const v = VIVO.vivo;
  // 1.7: com o agente ligado, "Ao vivo" e a hora da última leitura do WinThor
  if (v && v.agente && !offline) {
    const lido = [v.pedido, v.faturado].filter(Boolean).sort().pop();
    const tv = 'Ao vivo: o agente lê o WinThor de segundos em segundos. Pedidos lidos às ' + diaHmS(v.pedido) + '; faturado às ' + diaHmS(v.faturado) + '. Toque para ler agora.';
    return `<button type="button" class="when vivo" id="when" title="${esc(tv)}">Ao vivo · ${hms(lido)}</button>`;
  }
  const ped = D.cargas.pedido, fat = D.cargas.faturado;
  const velho = ped && (Date.now() - new Date(ped).getTime() > 3 * 3600e3);
  const tit = 'Pedidos digitados até ' + diaHm(ped) + '; venda faturada até ' + diaHm(fat) + '; títulos ' + diaHm(D.cargas.titulo) + '. Toque para atualizar.';
  return `<button type="button" class="when${offline ? ' off' : velho ? ' velho' : ''}" id="when" title="${esc(tit)}">${offline ? (navigator.onLine ? 'sem resposta · ' : 'sem internet · ') : ''}pedidos ${hm(ped)} · faturado ${hm(fat)}</button>`;
}
/* título grande (rola junto com a tela; quando some, o título pequeno aparece na barra) */
function grande(t) {
  if (t.raiz) return `<div class="grande"><div class="sobre">${esc(dataLonga())}</div><h1>${esc(t.titulo)}</h1><div class="linha">${setorHtml()}${whenHtml()}</div></div>`;
  return `<div class="grande"><h1${t.longo ? ' class="longo"' : ''}>${esc(t.titulo)}</h1>${t.sub ? `<div class="sub">${t.sub}</div>` : ''}${t.extra || ''}</div>`;
}
function faixas() {
  return (offline ? `<button type="button" class="faixa toque" data-a="m-atualizar">${navigator.onLine ? 'O servidor não respondeu agora' : 'Sem internet'}: mostrando a última cópia guardada no aparelho. Toque para tentar de novo.${ic('frente', 'seta')}</button>` : '') +
    (appNovo ? `<button type="button" class="faixa info toque" data-a="baixar-app">Nova versão do app (${esc(appNovo.versao)}) — toque para baixar e instalar.${ic('frente', 'seta')}</button>` : '');
}
const perfilRotulo = () => !conta ? '—' : conta.tipo === 'gerente' ? 'Gestor' + (limparEstados(conta.estados) ? ' · ' + rotuloEstados(conta.estados, R ? R.setores.map(x => [x.cod, x.nome]) : []) : '') :conta.tipo === 'supervisor' ? 'Supervisor' : 'RCA ' + (conta.codusur || '');
function barra(t) {
  const n = S.pilha.length;
  const ant = n ? (n > 1 ? S.pilha[n - 2].titulo : (TABS.find(x => x[0] === S.tab) || TABS[0])[1]) : null;
  $('#nav-esq').innerHTML = ant != null
    ? `<button type="button" class="voltar" data-a="voltar" aria-label="Voltar para ${esc(ant)}">${ic('back')}<span>${esc(curto(ant, 16))}</span></button>`
    : '<img class="logo topo" src="logo-lube-mini.png" alt="Lube Distribuidora" width="89" height="30">';
  $('#nav-titulo').textContent = t.titulo || '';
  $('#btn-busca').hidden = t.chave === 'busca' || !D || ehGeral();   // no GERAL não há lista de clientes (é por região)
  $('#conta-btn').textContent = iniciais(conta && (conta.nome || conta.email));
  // ponto vermelho na conta enquanto houver versão nova do app para instalar
  $('#conta-btn').classList.toggle('novo', !!appNovo);
  $('#conta-btn').setAttribute('aria-label', appNovo ? 'Sua conta (versão nova do app para instalar)' : 'Sua conta');
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
    // um só movimento, todo na placa de vídeo (opacidade e deslocamento): leve até em celular simples
    view.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: EASE });
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
const FMT = { brlK, n: v => nf0.format(Math.round(v)), pct0: v => pct(v) };
/* o número inteiro sempre à vista (1.7): sem "…" e sem arredondar; se não couber, a fonte só daquele número diminui.
   Mede tudo antes e escreve depois (uma medida só para a tela inteira, sem a tela se recalcular a cada número). */
const SEL_ENCAIXE = '.valor-grande, .kpi .v, .tile .v:not(.txt), .trio b, .meta-grade b, .meta-de, .meta-todas .mt-v';
function encaixar(raiz) {
  const els = [...(raiz || document).querySelectorAll(SEL_ENCAIXE)];
  for (const el of els) el.style.fontSize = '';
  const medidas = els.map(el => {
    const pai = el.parentElement, cp = getComputedStyle(pai);
    const livre = Math.min(el.clientWidth || 1e9, pai.clientWidth - parseFloat(cp.paddingLeft) - parseFloat(cp.paddingRight));
    return [el, livre, el.scrollWidth, parseFloat(getComputedStyle(el).fontSize)];
  });
  for (const [el, livre, precisa, fs] of medidas) {
    if (livre > 0 && precisa > livre + 0.5) el.style.fontSize = Math.max(10, Math.floor(fs * livre / precisa * 10) / 10) + 'px';
  }
}
function contar(raiz) {
  if (REDUZ) return;
  raiz.querySelectorAll('[data-cnt]').forEach(el => {
    const alvo = +el.dataset.cnt, f = FMT[el.dataset.f] || FMT.n, t0 = performance.now(), T = 900;
    if (!alvo) return;
    const passo = t => { const k = Math.min(1, (t - t0) / T), e = 1 - Math.pow(1 - k, 4); el.textContent = f(alvo * e); if (k < 1) requestAnimationFrame(passo); };
    el.textContent = f(0); requestAnimationFrame(passo);
    // garantia: com o app em segundo plano o navegador pausa a animação; o número final aparece de qualquer jeito
    setTimeout(() => { el.textContent = f(alvo); }, T + 250);
  });
}
/* 1.11 (Júlio): ao filtrar, cada número dos cartões corre do valor antigo até o novo. Os das listas não: depois do
   filtro a mesma linha pode ser outro cliente. O par antigo/novo é achado pelo nome do cartão, não pela posição. */
const SEL_NUM = '.valor-grande, .kpi .v, .tile .v:not(.txt), .trio b, .pos-card .big, .meta-grade b';
function chaveNum(el) {
  const k = el.closest('.kpi'); if (k) { const l = k.querySelector('.l'); return 'kpi:' + (l ? l.textContent.trim() : ''); }
  const tr = el.closest('.trio > span'); if (tr) { const s = tr.querySelector('small'); return 'trio:' + (s ? s.textContent.trim() : ''); }
  const c = el.closest('.tile, .pos-card, .hoje-card, .mes-card, .meta-grade');
  return (c ? c.className : '') + ':' + el.className;
}
function numerosDa(raiz) {
  const n = new Map();
  return [...raiz.querySelectorAll(SEL_NUM)].map(el => { const b = chaveNum(el), i = n.get(b) || 0; n.set(b, i + 1); return [b + '#' + i, el]; });
}
const lerNumeros = raiz => new Map(numerosDa(raiz).map(([k, el]) => [k, el.textContent]));
function partesNum(txt) {
  const m = /-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:,\d+)?/.exec(txt); if (!m) return null;
  return { pre: txt.slice(0, m.index), pos: txt.slice(m.index + m[0].length), dec: (m[0].split(',')[1] || '').length, v: +m[0].replace(/\./g, '').replace(',', '.') };
}
function rolarNumeros(raiz, antes) {
  if (REDUZ || !antes || !antes.size) return;
  const vai = [];
  for (const [k, el] of numerosDa(raiz)) {
    const velho = antes.get(k), novo = el.textContent;
    if (velho == null || velho === novo || el.children.length) continue;   // só número puro (sem pílula dentro)
    const a = partesNum(velho), b = partesNum(novo);
    if (!a || !b || a.pre !== b.pre || a.pos !== b.pos) continue;
    vai.push({ el, a, b, novo });
    if (velho.length > novo.length) el.textContent = velho;   // a fonte se ajusta ao maior dos dois: nada vaza no meio
  }
  if (!vai.length) return;
  encaixar(raiz);
  const t0 = performance.now(), T = 650;
  for (const x of vai) {
    const fmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: x.b.dec, maximumFractionDigits: x.b.dec });
    const passo = t => { const k = Math.min(1, (t - t0) / T), e = 1 - Math.pow(1 - k, 3); x.el.textContent = x.b.pre + fmt.format(x.a.v + (x.b.v - x.a.v) * e) + x.b.pos; if (k < 1) requestAnimationFrame(passo); };
    requestAnimationFrame(passo);
    setTimeout(() => { x.el.textContent = x.novo; }, T + 250);
  }
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
  } else if (anim && anim !== 'aba') g = fotografar(view);   // troca de aba não copia a tela velha: só esmaece a nova
  // filtros em pílula que deslizam: guarda onde estavam (senão voltam para o começo a cada toque)
  const rolos = anim ? [] : [...view.querySelectorAll('.pilulas, .chips.rola')].map(x => x.scrollLeft);
  const antes = anim ? null : lerNumeros(view), chaveAnt = S.chave;   // filtro na mesma tela: os números correm (1.11)
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
  encaixar(view);
  if (o.rolar != null) window.scrollTo(0, o.rolar); else if (o.topo) window.scrollTo(0, 0);
  dockAtualizar();
  if (anim) animar(anim, g);
  // a cascata de entrada (cartões subindo, barras crescendo) só na primeira vez que o Resumo abre com o pacote
  let contou = false;
  if (t.chave === 'resumo' && D) {
    const k = S.escopo + '|' + D.gerado;
    if (S.contado !== k) { S.contado = k; entrar(view); contar(view); contou = true; }
  }
  if (antes && !contou && t.chave === chaveAnt) rolarNumeros(view, antes);
  salvarTela();
  aoRolar();
}
/* prepara por trás as outras abas (em tempo livre do celular), para a primeira troca já ser instantânea */
const agendar = f => (window.requestIdleCallback ? requestIdleCallback(f, { timeout: 2000 }) : setTimeout(f, 150));
function aquecer() {
  clearTimeout(aquecer._t);
  aquecer._t = setTimeout(() => {
    const fila = TABS.map(t => t[0]).filter(t => t !== S.tab);
    const passo = () => {
      if (!D || S.pilha.length || !fila.length) return;
      const tab = fila.shift(), atual = S.tab;
      S.tab = tab;
      try { montarTela(); } catch (e) { /* a aba calcula de novo quando for aberta */ } finally { S.tab = atual; }
      agendar(passo);
    };
    agendar(passo);
  }, 600);
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
  // a pílula anda na hora do toque; a tela entra no quadro seguinte (o toque nunca espera o cálculo)
  dockAtualizar();
  const db = $(`#dock-itens button[data-v="${v}"]`);
  if (db && !REDUZ) { db.classList.remove('pulou'); void db.offsetWidth; db.classList.add('pulou'); }
  const vez = irAba.vez = (irAba.vez || 0) + 1;
  requestAnimationFrame(() => setTimeout(() => { if (vez === irAba.vez) render({ anim: 'aba', topo: true }); }, 0));
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
  const pend = S.adm.dados ? nPendentes(S.adm.dados) : null;
  abrirFolha(`
    <div class="alca" aria-hidden="true"></div>
    <div class="quem"><span class="conta-btn">${esc(iniciais(conta.nome || conta.email))}</span><div><b>${esc(conta.nome || conta.email)}</b><span>${esc(conta.email || '')} · ${esc(perfilRotulo())}</span></div></div>
    ${appNovo ? `<button type="button" class="item novo" data-a="baixar-app"><svg viewBox="0 0 24 24">${ICM.instalar}</svg>Atualizar o app<small><span class="pill bad">versão ${esc(appNovo.versao)}</span></small></button>` : ''}
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
  const i0 = R.meses.length - 1, fatTodas = soma(R.setores, s => +s.venda[i0] || 0);
  // 1.12: o GERAL no topo, em destaque dourado (Júlio), com a soma de todas as regiões que o gestor vê
  abrirFolha(`
    <div class="alca" aria-hidden="true"></div>
    <div class="folha-tit">Escolha a região</div>
    <button type="button" class="row geral-op${ehGeral() ? ' sel' : ''}" data-a="setor" data-v="GERAL">
      <span class="t">${ic('layers')}GERAL</span><span class="r">${ehGeral() ? ic('check', 'ok-ic') : brlK(fatTodas)}</span>
      <span class="sub full">${R.setores.length === 1 ? 'A região que você vê' : `A soma das ${R.setores.length} regiões que você vê`}, ao vivo</span>
    </button>
    <div class="list">${R.setores.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map(s => `
      <button type="button" class="row${D && s.cod === D.setor.cod ? ' sel' : ''}" data-a="setor" data-v="${s.cod}">
        <span class="t">${esc(s.nome)}</span><span class="r">${D && s.cod === D.setor.cod ? ic('check', 'ok-ic') : brlK(s.venda[i0])}</span>
      </button>`).join('')}</div>`, 'Escolha a região');
}
/* versão nova do app: ALERTA por cima de tudo (1.3; antes era só uma faixa no começo da tela, que sumia atrás do
   cabeçalho ao rolar — Júlio, 2026-10-22). Aparece uma vez por abertura do app; "Depois" fecha, e o ponto vermelho na
   conta e o item do menu continuam lá. Com "obrigatoria": true no versao-app.json não tem "Depois". */
function novaVersao(v) {
  const repetido = appNovo && appNovo.versionCode === v.versionCode;
  appNovo = v;
  if (conta) render();
  if (!repetido || !S.avisado) mostrarAlertaVersao();
}
function mostrarAlertaVersao() {
  if (!appNovo || $('#alerta-versao')) return;
  S.avisado = true;
  const obrig = !!appNovo.obrigatoria;
  const a = document.createElement('div');
  a.id = 'alerta-versao'; a.className = 'alerta-fundo';
  a.innerHTML = `
    <div class="alerta-ios" role="alertdialog" aria-modal="true" aria-labelledby="al-t" aria-describedby="al-m">
      <div class="alerta-corpo">
        <img src="icones/icone-192.png" alt="" width="56" height="56">
        <b id="al-t">Nova versão do app</b>
        <p id="al-m">O Supervisor Lube <b>${esc(appNovo.versao)}</b> está pronto. Toque em <b>Atualizar</b> e instale por cima: o seu acesso continua.</p>
        ${appNovo.notas ? `<p class="notas">${esc(appNovo.notas)}</p>` : ''}
      </div>
      <div class="alerta-botoes${obrig ? ' um' : ''}">${obrig ? '' : '<button type="button" data-a="alerta-depois">Depois</button>'}<button type="button" class="forte" data-a="baixar-app">Atualizar</button></div>
    </div>`;
  document.body.appendChild(a);
  if (!REDUZ) {
    a.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' });
    a.firstElementChild.animate([{ opacity: 0, transform: 'scale(1.18)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 380, easing: 'cubic-bezier(.2,.9,.3,1.15)' });
  }
  a.querySelector('.forte').focus({ preventScroll: true });
}
function fecharAlertaVersao() {
  const a = $('#alerta-versao'); if (!a) return;
  if (REDUZ) { a.remove(); return; }
  a.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' }).onfinish = () => a.remove();
}
function copiar() {
  const p = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(S.convite) : Promise.reject(new Error('sem'));
  p.then(() => toast('Mensagem copiada.')).catch(() => toast('Não consegui copiar. Toque e segure no texto do convite para copiar.', true));
}

/* ---------------- carregar ---------------- */
/* 1.11.6: os estados do gestor entram na chave: trocou o que ele vê, a cópia antiga do aparelho não abre */
function chaveCache(escopo) { const e = conta && limparEstados(conta.estados); return (conta && conta.email || '') + '|' + (e ? e.join('.') + '|' : '') + escopo; }
async function baixar(escopo, etag) {
  const t = await A.token();
  if (!t) { A.expirou(); throw new Error('sessão'); }
  // 1.3: pergunta "mudou?" pelo X-Versao, e o "não mudou" volta como 200 { igual: true }. Com o If-None-Match de
  // antes o servidor respondia 304, a Vercel tirava o CORS do 304 e o celular dizia "sem conexão" com o dado em dia.
  const h = { Authorization: 'Bearer ' + t }; if (etag) h['X-Versao'] = etag;
  const r = await fetch((CFG.api || '') + '/api/dados' + (escopo && escopo[0] !== 'R' ? '?escopo=' + escopo : ''), { headers: h, cache: 'no-store' });
  if (r.status === 304) return null;
  if (r.status === 401) { A.expirou(); throw new Error('sessão'); }
  const etagNova = r.headers.get('X-Versao-Pacote') || (r.headers.get('ETag') || '').replace(/^W\//, '').replace(/"/g, '');
  if (r.status === 403) { const j = await r.json().catch(() => ({})); A.negado(j.mensagem || 'Seu acesso não está liberado.'); throw new Error('acesso'); }
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.mensagem || 'O servidor respondeu ' + r.status); }
  const j = await r.json();
  if (j && j.igual === true) return null;
  return { pkg: j, etag: etagNova };
}
/* abre o escopo: primeiro a cópia do aparelho, depois a versão nova por trás */
async function abrirEscopo(escopo, aoMontar) {
  const k = chaveCache(escopo);
  const guardado = await IDB.get(k);
  if (guardado && guardado.pkg) aoMontar(guardado.pkg, false);
  try {
    const novo = await baixar(escopo, guardado && guardado.etag);
    const estava = offline; offline = false;
    if (novo) { await IDB.set(k, novo); aoMontar(novo.pkg, !!guardado); }
    else if (estava) render();   // voltou a falar com o servidor: tira o aviso na hora
    return true;
  } catch (e) {
    if (e.message === 'sessão' || e.message === 'acesso') return false;
    offline = !navigator.onLine || /fetch|network|Failed|Load failed/i.test(e.message);
    if (!guardado) throw e;
    // com internet e sem resposta é o servidor que não respondeu (não é "sem conexão"); tenta de novo em 30 s
    if (offline && navigator.onLine) { clearTimeout(abrirEscopo._de_novo); abrirEscopo._de_novo = setTimeout(() => { if (conta && offline) carregarTudo(); }, 30e3); }
    toast(offline ? (navigator.onLine ? 'Não consegui falar com o servidor agora: mostrando a última cópia.' : 'Sem internet: mostrando a última cópia.') : e.message, true);
    render();
    return false;
  }
}
/* ---------------- ao vivo (1.7, Júlio: "o app precisa atualizar toda vez que tiver alguma mudança") ----------------
   O AGENTE LUBE lê o WinThor de segundos em segundos e, depois de gravar, monta o PACOTE DO DIA de cada setor (pedidos,
   notas e devoluções de ontem e hoje + os títulos em aberto) e o resumo do gestor. O app pergunta de 15 em 15 s, só
   com a tela à vista (/api/hoje, com a versão que já tem: sem mudança a resposta é minúscula), e põe o pacote do dia
   por cima do pacote da manhã (carga das 06:20): de ontem em diante vale o do dia; os títulos vêm inteiros dele. */
const VIVO = { escopo: '', versao: '', hoje: null, resumo: null, vivo: null, pendente: false, ocupado: false, timer: null,
               versaoJ: '', janela: null };
/* 1.9: a JANELA são os dias antigos que o agente ainda relê (pedidos e devoluções de hoje-60 a hoje-2, notas de hoje-35 a
   hoje-2). Vem com versão própria e só quando um deles muda (o WinThor corrigiu um dia antigo: a 146 e o Central Comercial
   mudam na hora, e o app também). Entra antes do pacote do dia, que fica por cima onde os dois se cruzam. */
function aplicarJanela(d, j) {
  if (!d || !j || j.ini == null || j.fim == null) return;
  const ini = j.ini, iniNf = j.ini_nf != null ? j.ini_nf : j.ini, fim = j.fim;
  d.nf = d.nf.filter(o => o.d < iniNf || o.d > fim).concat((j.nf || []).map(linhaNf));
  d.ped = d.ped.filter(o => o.d < ini || o.d > fim).concat((j.ped || []).map(linhaPed));
  d.dev = d.dev.filter(o => o.d < ini || o.d > fim).concat((j.dev || []).map(linhaDev));
  Object.assign(d.mot, j.mot || {});
}
function aplicarHoje(d, h, versao) {
  if (!d || !h || h.ini == null) return;
  const ini = h.ini, iniNf = h.ini_nf != null ? h.ini_nf : h.ini;
  // as notas vêm do mês inteiro (o comercial corrige nota antiga de 15 em 15 min); pedidos e devoluções, de ontem em diante
  d.nf = d.nf.filter(o => o.d < iniNf).concat((h.nf || []).map(linhaNf));
  d.ped = d.ped.filter(o => o.d < ini).concat((h.ped || []).map(linhaPed));
  d.dev = d.dev.filter(o => o.d < ini).concat((h.dev || []).map(linhaDev));
  if (h.tit) d.tit = h.tit.map(linhaTit);
  Object.assign(d.cob, h.cob || {}); Object.assign(d.mot, h.mot || {});
  for (const r of h.cli || []) {
    const c = linhaCli(r), velho = d.CMAP.get(c.cod);
    if (velho) Object.assign(velho, c); else { d.cli.push(c); d.CMAP.set(c.cod, c); }
  }
  // de madrugada o pacote da manhã ainda é o de ontem: o dia que vale é o do pacote do dia
  if (h.hoje > d.hoje) d.hoje = h.hoje;
  d.hv = versao || '';
}
/* com o agente ligado, a hora de cada dado é a da última leitura do WinThor (e não a da carga da manhã) */
function aplicarVivo(d) {
  const v = VIVO.vivo;
  if (!d || !v || !v.agente) return;
  for (const k of ['pedido', 'faturado', 'titulo', 'devolucao']) if (v[k]) d.cargas[k] = v[k];
}
/* a tela se refaz sozinha, sem animação e no mesmo lugar; com alguém digitando ou com a folha aberta, espera */
function redesenharAoVivo() {
  const foco = document.activeElement;
  if ((foco && /^(INPUT|SELECT|TEXTAREA)$/.test(foco.tagName)) || !$('#folha').hidden || $('#view').classList.contains('em-anim')) { VIVO.pendente = true; return; }
  VIVO.pendente = false;
  render({ rolar: window.scrollY });
}
async function buscarHoje(pedidos) {
  if (!conta || !S.escopo || !D) return null;
  const t = await A.token();
  if (!t) return null;
  const escopo = S.escopo;
  if (VIVO.escopo !== escopo) { VIVO.escopo = escopo; VIVO.versao = ''; VIVO.hoje = null; VIVO.versaoJ = ''; VIVO.janela = null; }
  const h = { Authorization: 'Bearer ' + t }; if (VIVO.versao) h['X-Versao'] = VIVO.versao; if (VIVO.versaoJ) h['X-Versao-J'] = VIVO.versaoJ;
  const qs = [escopo[0] === 'S' ? 'escopo=' + escopo + '&janela=1' : '', pedidos && pedidos.length ? 'pedidos=' + pedidos.join(',') : ''].filter(Boolean).join('&');
  const r = await fetch((CFG.api || '') + '/api/hoje' + (qs ? '?' + qs : ''), { headers: h, cache: 'no-store' });
  if (!r.ok) return null;
  const j = await r.json();
  if (!j || j.semHoje || S.escopo !== escopo) return j;
  const antes = JSON.stringify(VIVO.vivo);
  VIVO.vivo = j.vivo || null;
  let mudou = false;
  // a janela primeiro; o pacote do dia por cima (de novo, se não mudou: os dois se cruzam no mês)
  if (j.janela) {
    VIVO.janela = j.janela; VIVO.versaoJ = j.versao_j || '';
    if (D) { aplicarJanela(D, j.janela); if (VIVO.hoje && !j.setor) aplicarHoje(D, VIVO.hoje, VIVO.versao); mudou = true; }
  }
  if (!j.igual && (j.setor || j.resumo)) {
    VIVO.versao = j.versao;
    if (j.setor) { VIVO.hoje = j.setor; if (D) { aplicarHoje(D, j.setor, j.versao); mudou = true; } }
    if (j.resumo && ehGerente()) { VIVO.resumo = j.resumo; R = montarResumo(j.resumo); if (ehGeral()) D = montarGeral(); mudou = true; }
  }
  if (D) aplicarVivo(D);
  if (mudou || VIVO.pendente) redesenharAoVivo();
  else if (antes !== JSON.stringify(VIVO.vivo)) { const w = $('#when'); if (w) w.outerHTML = whenHtml(); }   // só a hora do indicador
  return j;
}
function aoVivoLigar() {
  clearInterval(VIVO.timer);
  VIVO.timer = setInterval(() => {
    if (document.visibilityState !== 'visible' || !conta || !D || baixando || VIVO.ocupado) return;
    buscarHoje().catch(() => { /* sem rede agora: tenta de novo daqui a 15 s */ });
  }, 15e3);
}
const esperar = ms => new Promise(ok => setTimeout(ok, ms));
/* "Atualizar dados", puxar para baixo e o toque no indicador: pede ao agente uma leitura do WinThor AGORA (a ponte do
   painel do Inventário); sem o agente ligado, confere a carga como antes */
async function atualizarAgora() {
  if (VIVO.ocupado) return;
  VIVO.ocupado = true; S.mudou = false;
  try {
    const t = await A.token();
    if (!t) return;
    let j = null;
    try {
      const r = await fetch((CFG.api || '') + '/api/atualizar', { method: 'POST', headers: { Authorization: 'Bearer ' + t }, cache: 'no-store' });
      j = r.ok ? await r.json() : null;
    } catch (e) { j = null; }
    if (!j || !j.agente) {
      toast((j && j.mensagem ? j.mensagem + ' ' : '') + 'Conferindo se há dados novos…');
      await carregarTudo();
      return;
    }
    toast('Lendo o WinThor agora…');
    const t0 = Date.now();
    let fim = null;
    while (Date.now() - t0 < 25e3) {
      await esperar(1200);
      const h = await buscarHoje(j.pedidos).catch(() => null);
      const ps = (h && h.pedidos) || [];
      if (ps.length && ps.every(p => p.status !== 'pendente' && p.status !== 'atendendo')) { fim = ps; break; }
    }
    const sup = fim && fim.find(p => p.sistema === 'supervisor');
    if (sup && sup.status === 'atendido') toast('WinThor lido agora' + (sup.segundos != null ? ' (' + String(sup.segundos).replace('.', ',') + ' s)' : '') + ': dados em dia.');
    else toast(fim ? 'O agente não conseguiu ler o WinThor agora. Mostrando o último dado.' : 'O agente está demorando: o dado novo aparece sozinho em instantes.', !!fim);
    await carregarTudo();   // e o pacote da manhã, se mudou
  } finally { VIVO.ocupado = false; }
}

function montarResumo(p) {
  // 1.6: venda = o FATURADO (total líquido, [11]); vendaBruta = a venda antes da devolução ([2]); margem = massa [13] ÷
  // total líquido sem ST [12]. Resumo de antes da 1.6 (sem [11]): tudo volta à venda e ao custo de antes.
  // 1.12 (GERAL): [14] digitado de hoje e do mês, [15] faturado do mês anterior até o mesmo dia, [16] faturado por dia do mês,
  // [17] dias úteis da meta que faltam, e 'geral' (clientes contados uma vez só); resumo de antes da 1.12: g = null
  return { meses: p.meses || [], hoje: p.hoje, gerado: p.gerado_em || String(Date.now()), geral: p.geral || null, setores: (p.setores || []).map(s => {
    const vb = s[2] || [], c = s[3] || [], g = Array.isArray(s[14]) ? s[14] : null;
    return { cod: s[0], nome: s[1], venda: s[11] || vb, vendaBruta: vb, tls: s[12] || vb, massa: s[13] || vb.map((v, i) => v - (c[i] || 0)),
             dev: s[4], vencido: +s[5] || 0, juridico: +s[6] || 0, clientes: s[7] || 0, pos: s[8] || [], meta: s[9] || null, metaAte: s[10] || [],
             g: g && { vh: +g[0] || 0, nh: +g[1] || 0, v7: +g[2] || 0, vm: +g[3] || 0, nm: +g[4] || 0, sem: +g[5] || 0 },
             fatAnt: +s[15] || 0, fatDia: s[16] || [], uteis: +s[17] || 0 };
  }) };
}
async function carregarTudo() {
  if (baixando) return; baixando = true; ultimaConferencia = Date.now();
  try {
    if (ehGerente()) {
      // o resumo do dia (ao vivo) vale sobre o da manhã quando é mais novo
      await abrirEscopo('G', p => { R = montarResumo(VIVO.resumo && String(VIVO.resumo.gerado_em || '') > String(p.gerado_em || '') ? VIVO.resumo : p); if (ehGeral()) D = montarGeral(); if (D) render(); });
      if (!R || !R.setores.length) throw new Error('O resumo dos setores ainda não está pronto.');
      // 1.12: abre no que ficou escolhido; sem escolha (ou região que saiu), no GERAL
      let salvo = null;
      try { salvo = localStorage.getItem('sup-lube-setor'); } catch (e) { /* ignora */ }
      const alvo = Number(salvo);
      if (salvo !== 'GERAL' && R.setores.some(s => s.cod === alvo)) await abrirSetor(alvo); else abrirGeral();
    } else if (conta.tipo === 'supervisor') {
      await abrirSetor(Number(conta.codsupervisor));
    } else {
      S.escopo = 'R' + conta.codusur;
      await abrirEscopo(S.escopo, (p, atualizou) => { D = montar(p); render(); aquecer(); if (atualizou) { S.mudou = true; toast('Dados atualizados.'); } });
    }
  } catch (e) {
    if (!D) $('#view').innerHTML = `<div class="msg bad">${esc(e.message || 'Não consegui carregar os dados.')}</div><button class="btn sec" type="button" data-a="m-atualizar">Tentar de novo</button>`;
  } finally { baixando = false; }
  // ao vivo (1.7): o pacote do dia por cima, já agora, e a pergunta de 15 em 15 s
  if (D) { buscarHoje().catch(() => { /* sem o ao vivo agora: fica o pacote da manhã */ }); if (!VIVO.timer) aoVivoLigar(); }
}
async function abrirSetor(cod) {
  const escopo = 'S' + cod;
  if (S.escopo !== escopo) { S.escopo = escopo; D = null; render(); }
  try { localStorage.setItem('sup-lube-setor', String(cod)); } catch (e) { /* ignora */ }
  await abrirEscopo(escopo, (p, atualizou) => { if (S.escopo !== escopo) return; D = montar(p); render(); aquecer(); if (atualizou) { S.mudou = true; toast('Dados atualizados.'); } });
}
/* 1.12: o GERAL é montado do resumo entre setores que o gestor já tem (R): abre na hora, sem baixar nada */
function abrirGeral() {
  if (!R) return;
  S.escopo = 'GERAL';
  try { localStorage.setItem('sup-lube-setor', 'GERAL'); } catch (e) { /* ignora */ }
  D = montarGeral();
  render(); aquecer();
}
function trocarSetor(cod) {
  S.v.rca = 0; S.c.rca = 0; S.c.cid = ''; S.c.bai = ''; S.a.rca = 0; S.i.open = 0; S.d.open = 0; S.k.raw = '';
  S.pilha = []; S.rolagens = [];
  if (baixando) return;
  if (cod === 'GERAL') { abrirGeral(); buscarHoje().catch(() => { /* o resumo ao vivo vem na próxima pergunta */ }); return; }
  baixando = true;
  abrirSetor(cod).catch(e => toast(e.message || 'Não consegui abrir a região.', true))
    .finally(() => { baixando = false; buscarHoje().catch(() => { /* o pacote do dia do setor novo vem na próxima pergunta */ }); });
}

/* ---------------- eventos ---------------- */
document.addEventListener('click', e => {
  if (e.target.closest('#veu')) { fecharFolha(); return; }
  if (e.target.closest('#conta-btn')) { abrirMenu(); return; }
  if (e.target.closest('#btn-busca')) { if (D && !ehGeral()) empurrar({ t: 'busca', titulo: 'Clientes' }); return; }
  if (e.target.closest('#when')) { if (!baixando) atualizarAgora(); return; }
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
    case 'setor': fecharFolha(); trocarSetor(v === 'GERAL' ? 'GERAL' : +v); return;
    case 'v-rca': S.v.rca = +v; S.pag.vendas = 'hoje'; if (!naRaiz()) render({ anim: 'pag-' }); return;
    case 'v-q': if (v) { S.v.q = v; const [d1, d2] = periodo(v); S.v.de = d1; S.v.ate = d2; } else S.v.q = ''; break;
    case 'v-graf': S.v.graf = v; break;
    case 'v-qr': S.v.qr = v; break;
    case 'v-sem':   // "ver quem": Vendas › RCAs no Dia de hoje, com a lista de quem está sem pedido no topo (1.11.2)
      S.v.qr = 'dia'; S.v.dia = D.hoje; S.v.rca = 0;
      if (S.tab === 'vendas' && !S.pilha.length) { if (S.pag.vendas !== 'rcas') irPagina('rcas'); else render(); }
      else { S.pag.vendas = 'rcas'; irAba('vendas'); }
      return;
    case 'c-q': S.c.q = v; break;
    case 'c-cid': S.c.cid = v; S.c.bai = ''; if (naRaiz()) return; break;
    case 'c-bai': S.c.bai = v; if (naRaiz()) return; break;
    case 'k-modo': S.k.modo = v; break;
    case 'i-open': S.i.open = +v; break;
    case 'd-per': S.d.per = v; S.d.open = 0; break;
    case 'd-open': S.d.open = +v; break;
    case 'adm-f': S.adm.filtro = v; break;
    case 'adm-recarregar': carregarAcessos(); return;
    case 'adm-decidir': { const card = b.closest('[data-conta]'); b.setAttribute('aria-busy', 'true'); decidirAcesso(card, v); return; }
    case 'adm-excluir': { const card = b.closest('[data-conta]'); if (card) confirmarExclusao(card.dataset.conta); return; }
    case 'adm-excluir-sim': excluirConta(v, b); return;
    case 'adm-convite': { const card = b.closest('[data-convite]'); if (!card) return; b.setAttribute('aria-busy', 'true'); salvarConvite(card, b); return; }
    case 'est': marcarEstado(b); return;
    case 'novo-sup': abrirCadastro(v || null); return;
    case 'fechar-folha': fecharFolha(); return;
    case 'copiar-convite': copiar(); return;
    case 'm-atualizar': fecharFolha(); if (D) atualizarAgora(); else { toast('Conferindo se há dados novos…'); carregarTudo(); } return;
    case 'm-acessos': fecharFolha(); S.adm.erro = ''; empurrar({ t: 'adm', titulo: 'Acessos' }); carregarAcessos(!!S.adm.dados); return;
    case 'm-instalar': fecharFolha(); if (instalar) { instalar.prompt(); instalar = null; } return;
    case 'm-sair': fecharFolha(); IDB.limpar(); D = null; R = null; conta = null; S.escopo = null; S.pilha = []; S.adm.dados = null; A.sair(); return;
    case 'baixar-app': fecharAlertaVersao(); fecharFolha(); if (appNovo) location.href = CFG.site + appNovo.apk; return;
    case 'alerta-depois': fecharAlertaVersao(); toast('Quando quiser, atualize pelo menu da sua conta.'); return;
    default: return;
  }
  render();
});

document.addEventListener('change', e => {
  const t = e.target, v = t.value;
  if (t.closest('[data-conta], [data-convite]')) {
    if (t.dataset.campo === 'tipo') { const card = t.closest('[data-conta], [data-convite]'); card.querySelectorAll('[data-so]').forEach(el => { el.hidden = el.dataset.so !== v; }); }
    return;
  }
  if (t.closest('#folha') || !D) return;
  const data = s => { const d = fromIso(s); return isNaN(d) ? null : Math.max(D.ini, Math.min(D.hoje, d)); };
  switch (t.id) {
    case 'v-rca': S.v.rca = +v; break;
    case 'v-dia': { const d = data(v); if (d !== null) S.v.dia = d; break; }
    case 'v-de': { const d = data(v); if (d !== null) { S.v.de = d; S.v.q = ''; } break; }
    case 'v-ate': { const d = data(v); if (d !== null) { S.v.ate = d; S.v.q = ''; } break; }
    case 'c-ref': { const d = data(v); if (d !== null) S.c.ref = d; break; }
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
  // 1.7: puxar pede ao agente uma leitura do WinThor agora (a mensagem do resultado sai de lá)
  Promise.resolve(D ? atualizarAgora() : carregarTudo()).finally(() => setTimeout(() => {
    solta(54);
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
  else if (document.visibilityState === 'visible' && conta && D) buscarHoje().catch(() => { /* tenta de novo em 15 s */ });
  // voltou para o app com a tela Acessos aberta: lê na hora (1.11.4)
  if (document.visibilityState === 'visible' && conta && conta.admin && S.chave === 'adm') carregarAcessos(true);
});
// a fonte dos números chega depois da primeira tela e a largura muda ao girar: o encaixe mede de novo
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => encaixar($('#view')));
window.addEventListener('resize', () => { clearTimeout(encaixar._t); encaixar._t = setTimeout(() => encaixar($('#view')), 150); });
window.addEventListener('online', () => { if (conta && offline) carregarTudo(); });
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); instalar = e; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('#folha').hidden) fecharFolha(); else if (S.pilha.length) voltar(); } });

/* ---------------- ligação com a entrada ---------------- */
window.SUP_APP = {
  pronto(c) {
    const trocou = !conta || conta.email !== c.email || conta.tipo !== c.tipo || conta.codusur !== c.codusur || conta.codsupervisor !== c.codsupervisor;
    conta = c;
    // a tela do app entra depois da abertura de 3 s com a logo; o pacote já começa a carregar por trás
    // 1.12: a tela montada por trás da abertura (o GERAL abre na hora) não tinha como medir os números: encaixa ao aparecer
    const mostrar = () => { $('#tela-login').hidden = true; $('#tela-app').hidden = false; aoRolar(); encaixar($('#view')); };
    if (window.SUP_ABERTURA) window.SUP_ABERTURA.sair(mostrar); else { $('#tela-carregando').hidden = true; mostrar(); }
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
      if ($('#alerta-versao')) { if (!(appNovo && appNovo.obrigatoria)) fecharAlertaVersao(); return; }
      if (!$('#folha').hidden) { fecharFolha(); return; }
      if (!$('#tela-app').hidden) {
        if (S.pilha.length) { voltar(); return; }
        if (S.tab !== 'resumo') { irAba('resumo'); return; }
      }
      if (P.App.minimizeApp) P.App.minimizeApp(); else if (P.App.exitApp) P.App.exitApp();
    });
  }
  // versão nova do APK: o site publica versao-app.json; quem tem um número de build menor recebe o ALERTA.
  // O APK 1.0 (que só abria o site) não tem o plugin App: conta como build 1.
  // Confere ao abrir e de novo quando o app volta para a frente (30 min depois da última conferência).
  const minhaBuild = P.App && P.App.getInfo ? P.App.getInfo().then(i => Number(i && i.build) || 1).catch(() => 1) : Promise.resolve(1);
  let conferidaEm = 0;
  const conferirVersao = () => {
    conferidaEm = Date.now();
    minhaBuild.then(build => fetch(CFG.site + '/versao-app.json', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(v => { if (v && Number(v.versionCode) > build && v.apk) novaVersao(v); }))
      .catch(() => { /* sem rede: confere na próxima abertura */ });
  };
  conferirVersao();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - conferidaEm > 30 * 60e3) conferirVersao(); });

  // 1.11 (Júlio: "atualizou e já mudou", sem baixar APK): as telas novas chegam sozinhas. O site publica
  // telas/versao.json e o .zip (app/gerar-telas.js); o plugin baixa, confere o SHA-256 e troca. Logo depois de
  // abrir (ou de voltar para o app) troca na hora; no meio do uso, deixa para quando o app sair e voltar.
  // Se a tela nova não chamar o notifyAppReady em 10 s, o plugin volta sozinho para a anterior.
  const U = P.CapacitorUpdater;
  if (U && U.notifyAppReady) {
    U.notifyAppReady().catch(() => { /* sem o plugin pronto: segue com as telas de dentro do APK */ });
    let telasEm = 0, abriuEm = Date.now(), baixandoTelas = false;
    const quieto = () => !S.pilha.length && $('#folha').hidden && !$('#alerta-versao');
    const conferirTelas = () => {
      if (baixandoTelas) return;
      baixandoTelas = true; telasEm = Date.now();
      minhaBuild.then(build => fetch(CFG.site + '/telas/versao.json', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null)
        .then(v => {
          if (!v || !(Number(v.telas) > (CFG.telas || 0)) || build < Number(v.minNativo || 0) || !v.url || !v.sha256) return null;
          return U.download({ url: CFG.site + v.url, version: 'telas-' + v.telas, checksum: v.sha256 }).then(b => {
            if (Date.now() - abriuEm < 15e3 && quieto()) return U.set({ id: b.id });   // recarrega já com as telas novas
            return U.next({ id: b.id }).then(() => toast('Telas novas prontas: entram quando você sair e voltar ao app.'));
          });
        }))
        .catch(() => { /* sem rede ou pacote recusado: confere de novo na próxima abertura */ })
        .finally(() => { baixandoTelas = false; });
    };
    conferirTelas();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      abriuEm = Date.now();
      if (Date.now() - telasEm > 10 * 60e3) conferirTelas();
    });
  }
} catch (e) { /* recurso nativo indisponível nesta versão: o app segue normal */ }
// prévia nesta máquina: localhost:3104/?previa=gerente&aviso=1 simula uma versão nova (para ver o alerta)
if (!CFG.nativo && location.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).has('aviso')) {
  setTimeout(() => novaVersao({ versionCode: 99, versao: '1.3', apk: '/baixar/supervisor-lube.apk', notas: 'Exemplo de novidade: o aviso de versão nova agora aparece como alerta.' }), 1500);
}
// carretel do "puxar para atualizar" (12 raios, como o do iPhone)
$('#puxar').innerHTML = '<svg viewBox="0 0 30 30" aria-hidden="true"><g stroke="currentColor" stroke-width="2.6" stroke-linecap="round">' +
  Array.from({ length: 12 }, (_, i) => `<line x1="15" y1="3.5" x2="15" y2="8.2" opacity="${(1 - i / 12 * .85).toFixed(2)}" transform="rotate(${-i * 30} 15 15)"/>`).join('') + '</g></svg>';
A.iniciar();
})();
