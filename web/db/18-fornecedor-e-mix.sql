-- =============================================================================
-- 18-fornecedor-e-mix.sql — 1.14 (2026-11-16): Vendas › Fornecedor e Carteira › Mix/SKU (Júlio: "preciso colocar uma aba
-- de fornecedor, onde eu escolho os fornecedores que eu quero visualizar as vendas" e "em Carteira ... um 'MIX/SKU' onde
-- aparece o número de SKU vendido naquele período da carteira, podendo filtrar também por fornecedor dentro da aba mix.
-- (O número mix precisa sair do mesmo lugar que a Análise Comercial)").
--
-- Banco DATA WAREHOUSE. Migração supervisor_v14_fornecedor_e_mix.
--   supervisor.itens_periodo lê a MESMA base e a MESMA regra da [[ANÁLISE COMERCIAL]] (analise_comercial.consulta_fornecedores
--   e consulta_distintos), só que num intervalo de datas qualquer (o período da tela do app), não no mês comercial:
--     venda/custo  analise_comercial.venda (pedido faturado da 146, sem ST, por item); devolução analise_comercial.devolucao
--     supervisor   coalesce(analise_comercial.ajuste_rca, o do pedido) — a Solange (RCA 41) conta em Televendas, como lá
--     mix          SKUs distintos com venda > 0; positivação = clientes distintos com venda > 0
--     fornecedor   analise_comercial.produto.codfornec (0 = sem fornecedor)
--   Entrada: regiões (supervisores), RCA (ou nulo), de/até, fornecedores escolhidos (ou nulo = todos) e um fornecedor
--   para abrir os produtos (ou nulo). A API /api/itens escolhe as regiões pelo perfil de quem pede.
-- =============================================================================

create or replace function supervisor.itens_periodo(p_sups integer[], p_rca integer, p_de date, p_ate date,
                                                    p_forns integer[] default null, p_prod_forn integer default null)
returns json
language sql
stable
set search_path to 'supervisor', 'pg_temp'
as $function$
with v as (
  select v.codprod, v.codcli, v.venda, v.custo, v.qt, coalesce(p.codfornec, 0) as forn
    from analise_comercial.venda v
    left join analise_comercial.ajuste_rca aj on aj.codusur = v.codusur
    left join analise_comercial.produto p on p.codprod = v.codprod
   where v.data between p_de and p_ate
     and coalesce(aj.codsupervisor, v.codsupervisor) = any (p_sups)
     and (p_rca is null or v.codusur = p_rca)
),
x as (
  select coalesce(p.codfornec, 0) as forn, x.codprod, x.dev
    from analise_comercial.devolucao x
    left join analise_comercial.ajuste_rca aj on aj.codusur = x.codusur
    left join analise_comercial.produto p on p.codprod = x.codprod
   where x.data between p_de and p_ate
     and coalesce(aj.codsupervisor, x.codsupervisor, 0) = any (p_sups)
     and (p_rca is null or x.codusur = p_rca)
),
fv as (
  select forn, sum(venda) as venda, sum(custo) as custo,
         count(distinct codcli) filter (where venda > 0) as posit, count(distinct codprod) filter (where venda > 0) as mix
    from v group by forn
),
fx as (select forn, sum(dev) as dev from x group by forn),
f as (
  select k.forn, coalesce(fv.venda, 0) as venda, coalesce(fx.dev, 0) as dev, coalesce(fv.custo, 0) as custo,
         coalesce(fv.posit, 0) as posit, coalesce(fv.mix, 0) as mix
    from (select forn from fv union select forn from fx) k left join fv using (forn) left join fx using (forn)
),
-- o total da escolha: positivação e mix contados uma vez (cliente ou SKU de dois fornecedores conta uma vez)
tv as (
  select sum(venda) as venda, sum(custo) as custo,
         count(distinct codcli) filter (where venda > 0) as posit, count(distinct codprod) filter (where venda > 0) as mix
    from v where p_forns is null or forn = any (p_forns)
),
tx as (select sum(dev) as dev from x where p_forns is null or forn = any (p_forns)),
pr as (
  select v.codprod, sum(v.venda) as venda, sum(v.qt) as qt, count(distinct v.codcli) filter (where v.venda > 0) as posit
    from v where p_prod_forn is not null and v.forn = p_prod_forn
   group by v.codprod having sum(v.venda) > 0
)
select json_build_object(
  'de', p_de - date '1970-01-01', 'ate', p_ate - date '1970-01-01', 'gerado_em', now(),
  -- [cód, nome, venda, devolução, custo, positivação, mix], do que mais vendeu (venda − devolução) para o que menos
  'forn', coalesce((select json_agg(json_build_array(f.forn, coalesce(af.fornecedor, case when f.forn = 0 then 'SEM FORNECEDOR' else 'FORNECEDOR ' || f.forn end),
                                                     round(f.venda, 2), round(f.dev, 2), round(f.custo, 2), f.posit, f.mix)
                                   order by f.venda - f.dev desc)
                      from f left join analise_comercial.fornecedor af on af.codfornec = f.forn), '[]'),
  'tot', (select json_build_object('venda', round(coalesce(tv.venda, 0), 2), 'dev', round(coalesce(tx.dev, 0), 2),
                                   'custo', round(coalesce(tv.custo, 0), 2), 'posit', coalesce(tv.posit, 0), 'mix', coalesce(tv.mix, 0))
            from tv, tx),
  -- produtos do fornecedor aberto: [cód, descrição, venda, quantidade, clientes]
  'prod', coalesce((select json_agg(json_build_array(pr.codprod, coalesce(ap.descricao, 'PRODUTO ' || pr.codprod), round(pr.venda, 2), round(pr.qt, 3), pr.posit)
                                    order by pr.venda desc)
                      from (select * from pr order by venda desc limit 300) pr left join analise_comercial.produto ap on ap.codprod = pr.codprod), '[]')
);
$function$;

comment on function supervisor.itens_periodo(integer[], integer, date, date, integer[], integer) is
  'Supervisor Lube 1.14: venda, positivação e mix (SKU) por fornecedor num período, com a regra da Análise Comercial.';
