-- =============================================================================
-- 17-geral-nao-compram.sql — 1.13 (2026-11-13): Carteira › "Não compram" no GERAL do gestor (Júlio: "preciso que na aba
-- de Carteiras tenha a aba 'não compram' (quando eu selecionar GERAL)").
--
-- Banco DATA WAREHOUSE. Migração supervisor_v13_geral_nao_compram.
--   supervisor.geral_nao_compram(regiões) é a Carteira › Não compram da tela da região (app.js: vCarteira, no Mês), para
--   as regiões que o gestor vê juntas. A API /api/geral chama só quando a página abre (não entra no resumo ao vivo).
--     carteira   = cliente da 146 com o RCA 1 ou o RCA 2 de uma das regiões, cadastrado antes de hoje
--     não compra = sem pedido (relatorio146.pedido) no mês em nenhuma das regiões; conta UMA vez
--     potencial  = pedidos das regiões nos 3 meses cheios antes do mês ÷ 3; última = último pedido (desde o início do
--                  pacote) ou a última compra do cadastro
--   'regioes' = [cód, não compram, carteira] de cada região, cada uma como na tela dela; 'clientes' = os 300 de maior
--   potencial: [cód, fantasia, cidade, bairro, região, RCA, nome do RCA, potencial/mês, última (dias desde 1970)].
-- =============================================================================

create or replace function supervisor.geral_nao_compram(p_regioes integer[])
returns json
language sql
stable
set search_path to 'supervisor', 'pg_temp'
as $function$
with par as (
  select (now() at time zone 'America/Sao_Paulo')::date as hoje,
         date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date as m0,
         (date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date) - interval '3 months')::date as ini
),
rcas as (select r.codusur, r.codsupervisor as cod from core.dim_rca r where r.codsupervisor = any(p_regioes)),
-- a carteira da 146 de cada região (o RCA 1 vem antes do RCA 2 para dizer de que região o cliente é)
cart_reg as (
  select distinct k.codcli, x.cod, x.ordem
    from relatorio146.cliente k
    join lateral (select r.cod, 1 as ordem from rcas r where r.codusur = k.codusur1
                  union all select r.cod, 2 from rcas r where r.codusur = k.codusur2) x on true, par
   where k.dtcadastro is null or k.dtcadastro < par.hoje
),
ped as (
  select p.codcli, p.codsupervisor as cod, p.data, p.venda from relatorio146.pedido p, par
   where p.data >= par.ini and p.data <= par.hoje and p.codsupervisor = any(p_regioes)
),
comprou_reg as (select distinct p.codcli, p.cod from ped p, par where p.data >= par.m0),
por_reg as (
  select c.cod, count(distinct c.codcli) as cart,
         count(distinct c.codcli) filter (where not exists (select 1 from comprou_reg x where x.codcli = c.codcli and x.cod = c.cod)) as nao
    from cart_reg c group by c.cod
),
cart as (select codcli, (array_agg(cod order by ordem, cod))[1] as cod from cart_reg group by codcli),
nao as (select c.* from cart c where not exists (select 1 from comprou_reg x where x.codcli = c.codcli)),
pot as (select p.codcli, sum(p.venda) / 3 as pot from ped p, par where p.data < par.m0 group by p.codcli),
ult as (select p.codcli, max(p.data) as d from ped p group by p.codcli),
lista as (
  select n.codcli, n.cod, coalesce(pt.pot, 0) as pot,
         coalesce(u.d, case when sc.dtultcomp <= (select hoje from par) then sc.dtultcomp end) as ult,
         coalesce(sc.fantasia, dc.cliente) as fantasia, coalesce(sc.cidade, dc.cidade) as cidade, sc.bairro, sc.codusur1 as rca
    from nao n left join pot pt on pt.codcli = n.codcli left join ult u on u.codcli = n.codcli
    left join supervisor.cliente sc on sc.codcli = n.codcli left join core.dim_cliente dc on dc.codcli = n.codcli
)
select json_build_object(
  'gerado_em', now(),
  'cart', (select count(*) from cart), 'nao', (select count(*) from nao), 'pot', (select round(coalesce(sum(pot), 0), 2) from lista),
  'regioes', coalesce((select json_agg(json_build_array(cod, nao, cart) order by cod) from por_reg), '[]'),
  'clientes', coalesce((select json_agg(json_build_array(l.codcli, l.fantasia, l.cidade, l.bairro, l.cod, l.rca, r.nome, round(l.pot, 2), l.ult - date '1970-01-01')
                                        order by l.pot desc, l.ult desc nulls last)
                         from (select * from lista order by pot desc, ult desc nulls last limit 300) l
                         left join core.dim_rca r on r.codusur = l.rca), '[]')
);
$function$;

comment on function supervisor.geral_nao_compram(integer[]) is
  'Supervisor Lube 1.13: Carteira > Não compram do GERAL do gestor (as regiões dele juntas, cliente contado uma vez), no mês.';
