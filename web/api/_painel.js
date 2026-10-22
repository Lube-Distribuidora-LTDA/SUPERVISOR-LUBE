/**
 * _painel.js — endereço e chave PÚBLICA (anon) da base de login do Painel Lube,
 * a mesma que o portal, o SAC e o app usam no navegador. Não é segredo: sem um token
 * de usuário ela não lê nada (RLS). Pode ser trocada pelas variáveis
 * PAINEL_SUPABASE_URL / PAINEL_SUPABASE_ANON na Vercel.
 */
module.exports = {
  URL: process.env.PAINEL_SUPABASE_URL || "https://wkkdcsqwlxjxorutrbnx.supabase.co",
  ANON: process.env.PAINEL_SUPABASE_ANON || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indra2Rjc3F3bHhqeG9ydXRyYm54Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0MDQzNjksImV4cCI6MjEwNDk4MDM2OX0.ux4O88v6PEcyyIxacr-d3Nykdl-XOC9hejC0itef798",
};
