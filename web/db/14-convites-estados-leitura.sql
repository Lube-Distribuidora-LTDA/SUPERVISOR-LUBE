-- =============================================================================
-- 14-convites-estados-leitura.sql — 2026-11-11 (depois da 1.11.8). Migração supervisor_lube_convites_estados_leitura.
--
-- public.sup_convites dá SELECT POR COLUNA ao authenticated (o codigo_hash fica de fora de propósito). A coluna
-- estados (12-estados-gestor.sql) não entrou nessa lista: a leitura dos convites da tela Acessos falhava, a API
-- engolia o erro e o app mostrava "Pendentes (0)" com 3 convites aguardando (print do Júlio).
-- Coluna nova em sup_convites: lembrar de liberar a leitura dela aqui. O RLS (sup_convites_admin) continua.
-- =============================================================================

grant select (estados) on public.sup_convites to authenticated;
