/* =========================================================
   SUPERVISOR LUBE — configuração pública.
   Base de login do Painel Lube (Supabase Auth do projeto PAINEL LUBE
   DISTRIBUIDORA): a mesma do portal e do SAC. A chave é a "anon", feita para
   ficar no navegador; quem manda são as regras do banco (RLS e as funções
   sup_*): conta do app nasce pendente e só o TI libera.

   App nativo (APK/iPhone): as telas vêm de dentro do aparelho (origem
   https://localhost ou capacitor://localhost) e os dados vêm do site publicado
   — por isso "api" aponta para lá. No navegador, "api" fica vazio (mesmo endereço).
   VERSAO é trocada a cada publicação (o menu da conta mostra qual está no ar).
   ========================================================= */
(function () {
  var cap = window.Capacitor;
  var nativo = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()) ||
               location.protocol === 'capacitor:' || location.origin === 'https://localhost';
  window.SUP_CFG = {
    url: 'https://wkkdcsqwlxjxorutrbnx.supabase.co',
    key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indra2Rjc3F3bHhqeG9ydXRyYm54Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0MDQzNjksImV4cCI6MjEwNDk4MDM2OX0.ux4O88v6PEcyyIxacr-d3Nykdl-XOC9hejC0itef798',
    site: 'https://supervisor-lube.vercel.app',
    api: nativo ? 'https://supervisor-lube.vercel.app' : '',
    nativo: nativo,
    versao: '2026-10-22b',
  };
})();
