-- =============================================================================
-- 16-geral-do-gestor.sql — 1.12 (2026-11-12): o GERAL do gestor (Júlio: "onde eu seleciono a região para olhar,
-- gostaria de colocar um GERAL pra quem é gestor, será contabilizado o acumulado daquele momento de todas as regiões
-- que ele tem a visualização"; "ele precisa ficar no topo de todas as regiões em destaque dourado").
--
-- Banco DATA WAREHOUSE. Migração supervisor_v12_geral_do_gestor.
--   O resumo entre setores (supervisor.pacote_resumo: o pacote 'G' da manhã e o 'G' do ao vivo, refeito pelo
--   supervisor.atualizar_hoje a cada mudança) ganha, por região, os números do Resumo que ainda não tinha, com as MESMAS
--   regras da tela da região (app.js: vResumo, rcasSemPedido, miniBarras, metaDoMes):
--     [14] [digitado hoje, pedidos hoje, digitado no mesmo dia da semana passada, digitado no mês, pedidos no mês,
--           RCAs ativos sem pedido hoje]   (pedido = relatorio146.pedido, como a 146)
--     [15] faturado do mês anterior até o mesmo dia (a comparação "vs. out no mesmo período")
--     [16] faturado por dia do mês, de 1 até hoje (as barrinhas)
--     [17] dias úteis da meta que faltam, com hoje
--   e, fora das regiões, 'geral': clientes contados UMA VEZ SÓ mesmo que apareçam em duas regiões (para bater com a 146
--   com vários supervisores): para cada conjunto de regiões, quantos clientes têm exatamente esse conjunto.
--     cli_hoje  clientes com pedido hoje          cli_mes   positivados do mês (pedido no mês)
--     cli_cart  carteira da 146 (RCA 1 ou RCA 2 da região, cadastrado antes de hoje)
--     cli_venc  clientes com título de cobrança vencido
--   O gestor soma as regiões dele no aparelho; a API tira as regiões de fora dos conjuntos (api/_estados.js).
--   Os índices 0 a 13 não mudaram: o app antigo continua lendo igual.
-- =============================================================================

create or replace function supervisor.pacote_resumo()
returns json
language sql
stable
set search_path to 'supervisor', 'pg_temp'
as $function$
with par as (
  select (now() at time zone 'America/Sao_Paulo')::date as hoje,
         (date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date) - interval '3 months')::date as ini,
         date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date as m0
),
par2 as (
  -- mês anterior com o mesmo número de dias corridos (a comparação justa da tela da região)
  select par.*, (par.m0 - interval '1 month')::date as a0,
         least(par.m0 - 1, (par.m0 - interval '1 month')::date + (par.hoje - par.m0)) as a1
    from par
),
setores as (
  select s.codsupervisor as cod, s.nome
    from core.dim_supervisor s
   where exists (select 1 from core.dim_rca r where r.codsupervisor = s.codsupervisor
                    and r.dttermino is null and coalesce(r.bloqueio, 'N') <> 'S')
),
venda as (
  select f.codsupervisor as cod, date_trunc('month', f.dtmov)::date as mes, sum(f.venda) as v, sum(f.cmv_venda) as c,
         count(distinct f.codcli) filter (where f.venda > 0) as pos,
         sum(f.venda) - sum(f.devolucao_sem_st) as tl,
         sum(f.venda) - sum(f.devolucao_sem_st) as tls,
         (sum(f.venda) - sum(f.devolucao_sem_st))
           - (sum(f.cmv_venda) - sum(f.cmv_devolucao) + sum(f.desc_financeiro) + sum(f.cmv_bonificacao) - sum(f.st)) as massa
    from comercial.fato_comissao_nf f, par where f.dtmov >= par.ini group by 1, 2
),
-- 1.9: positivados = clientes com pedido no mes, como a 146
pos146 as (
  select p.codsupervisor as cod, date_trunc('month', p.data)::date as mes, count(distinct p.codcli) as pos
    from relatorio146.pedido p, par where p.data >= par.ini group by 1, 2
),
dev as (
  select r.codsupervisor as cod, date_trunc('month', d.dtmov)::date as mes, sum(d.valor_devolucao) as v
    from comercial.fato_devolucao d join core.dim_rca r on r.codusur = d.codusur, par
   where d.dtmov >= par.ini group by 1, 2
),
tit as (
  select t.codsupervisor as cod,
         sum(t.valor) filter (where t.grupo = 'cobranca' and t.dtvenc < par.hoje) as vencido,
         sum(t.valor) filter (where t.grupo = 'juridico') as juridico,
         count(distinct t.codcli) filter (where t.grupo = 'cobranca' and t.dtvenc < par.hoje) as clientes
    from supervisor.titulo t, par group by 1
),
meta as (
  select m.codsupervisor as cod, date_trunc('month', m.data)::date as mes, sum(m.meta) as v,
         sum(m.meta) filter (where m.data < par.hoje) as ate_ontem
    from supervisor.meta m, par where m.data >= par.ini group by 1, 2
),
meses as (
  select generate_series(par.ini, date_trunc('month', par.hoje)::date, interval '1 month')::date as mes from par
),
-- 1.12 (GERAL): o digitado de hoje, da semana passada e do mês, por região (pedido da 146, como a tela da região)
dig as (
  select p.codsupervisor as cod,
         sum(p.venda) filter (where p.data = par.hoje) as vh, count(*) filter (where p.data = par.hoje) as nh,
         sum(p.venda) filter (where p.data = par.hoje - 7) as v7,
         sum(p.venda) filter (where p.data >= par.m0) as vm, count(*) filter (where p.data >= par.m0) as nm
    from relatorio146.pedido p, par
   where p.data >= least(par.m0, par.hoje - 7) and p.data <= par.hoje
   group by 1
),
-- RCA ativo com pedido nos últimos 30 dias e nenhum hoje; domingo não conta (a regra do Resumo, 1.11.2)
sem as (
  select r.codsupervisor as cod, count(*) as n
    from core.dim_rca r, par
   where r.dttermino is null and coalesce(r.bloqueio, 'N') <> 'S' and extract(dow from par.hoje) <> 0
     and exists (select 1 from relatorio146.pedido p where p.codusur = r.codusur and p.codsupervisor = r.codsupervisor
                    and p.data >= par.hoje - 30 and p.data < par.hoje)
     and not exists (select 1 from relatorio146.pedido p where p.codusur = r.codusur and p.codsupervisor = r.codsupervisor
                        and p.data = par.hoje)
   group by 1
),
fat_ant as (
  select f.codsupervisor as cod, sum(f.venda) - sum(f.devolucao_sem_st) as tl
    from comercial.fato_comissao_nf f, par2 where f.dtmov between par2.a0 and par2.a1 group by 1
),
fat_dia as (
  select f.codsupervisor as cod, f.dtmov as d, sum(f.venda) - sum(f.devolucao_sem_st) as tl
    from comercial.fato_comissao_nf f, par where f.dtmov >= par.m0 and f.dtmov <= par.hoje group by 1, 2
),
dias as (select generate_series(par.m0, par.hoje, interval '1 day')::date as d from par),
uteis as (
  select m.codsupervisor as cod, count(*) as n
    from supervisor.meta m, par where m.data >= par.hoje and m.data < (par.m0 + interval '1 month')::date group by 1
),
-- clientes contados uma vez só: o conjunto de regiões de cada cliente e quantos clientes têm cada conjunto
c_hoje as (
  select array_agg(distinct p.codsupervisor order by p.codsupervisor) as regs
    from relatorio146.pedido p, par where p.data = par.hoje and p.codsupervisor is not null group by p.codcli
),
c_mes as (
  select array_agg(distinct p.codsupervisor order by p.codsupervisor) as regs
    from relatorio146.pedido p, par where p.data >= par.m0 and p.data <= par.hoje and p.codsupervisor is not null group by p.codcli
),
c_cart as (
  select array(select distinct x from unnest(array[r1.codsupervisor, r2.codsupervisor]) x where x is not null order by x) as regs
    from relatorio146.cliente k
    left join core.dim_rca r1 on r1.codusur = k.codusur1
    left join core.dim_rca r2 on r2.codusur = k.codusur2, par
   where (k.dtcadastro is null or k.dtcadastro < par.hoje)
     and (r1.codsupervisor is not null or r2.codsupervisor is not null)
),
c_venc as (
  select array_agg(distinct t.codsupervisor order by t.codsupervisor) as regs
    from supervisor.titulo t, par
   where t.grupo = 'cobranca' and t.dtvenc < par.hoje and t.codsupervisor is not null group by t.codcli
)
select json_build_object(
  'tipo', 'resumo',
  'hoje', (select hoje - date '1970-01-01' from par),
  'meses', (select json_agg(mes - date '1970-01-01' order by mes) from meses),
  'gerado_em', now(),
  'setores', coalesce((select json_agg(json_build_array(
       s.cod, s.nome,
       (select json_agg(round(coalesce(v.v, 0), 2) order by m.mes) from meses m left join venda v on v.cod = s.cod and v.mes = m.mes),
       (select json_agg(round(coalesce(v.c, 0), 2) order by m.mes) from meses m left join venda v on v.cod = s.cod and v.mes = m.mes),
       (select json_agg(round(coalesce(d.v, 0), 2) order by m.mes) from meses m left join dev d on d.cod = s.cod and d.mes = m.mes),
       round(coalesce(t.vencido, 0), 2), round(coalesce(t.juridico, 0), 2), coalesce(t.clientes, 0),
       (select json_agg(coalesce(x.pos, 0) order by m.mes) from meses m left join pos146 x on x.cod = s.cod and x.mes = m.mes),
       -- [9] meta do mês e [10] meta até ontem, alinhadas com "meses" (0 = sem meta cadastrada)
       (select json_agg(round(coalesce(x.v, 0), 2) order by m.mes) from meses m left join meta x on x.cod = s.cod and x.mes = m.mes),
       (select json_agg(round(coalesce(x.ate_ontem, 0), 2) order by m.mes) from meses m left join meta x on x.cod = s.cod and x.mes = m.mes),
       -- [11] FATURADO = total liquido da aba ST (venda - devolucao sem ST, desde 2026-10-30), [12] o mesmo total e [13] massa de margem, alinhados com "meses"
       (select json_agg(round(coalesce(v.tl, 0), 6) order by m.mes) from meses m left join venda v on v.cod = s.cod and v.mes = m.mes),
       (select json_agg(round(coalesce(v.tls, 0), 6) order by m.mes) from meses m left join venda v on v.cod = s.cod and v.mes = m.mes),
       (select json_agg(round(coalesce(v.massa, 0), 6) order by m.mes) from meses m left join venda v on v.cod = s.cod and v.mes = m.mes),
       -- 1.12 (GERAL): [14] digitado de hoje e do mês, [15] faturado do mês anterior até o mesmo dia, [16] faturado por dia
       -- do mês, [17] dias úteis da meta que faltam (com hoje)
       json_build_array(round(coalesce(g.vh, 0), 6), coalesce(g.nh, 0), round(coalesce(g.v7, 0), 6),
                        round(coalesce(g.vm, 0), 6), coalesce(g.nm, 0), coalesce(z.n, 0)),
       round(coalesce(fa.tl, 0), 6),
       (select json_agg(round(coalesce(x.tl, 0), 6) order by dd.d) from dias dd left join fat_dia x on x.cod = s.cod and x.d = dd.d),
       coalesce(u.n, 0)
     ) order by s.nome)
     from setores s left join tit t on t.cod = s.cod left join dig g on g.cod = s.cod left join sem z on z.cod = s.cod
                    left join fat_ant fa on fa.cod = s.cod left join uteis u on u.cod = s.cod), '[]'),
  'geral', json_build_object(
     'cli_hoje', coalesce((select json_agg(json_build_array(regs, n)) from (select regs, count(*) as n from c_hoje group by regs) x), '[]'),
     'cli_mes',  coalesce((select json_agg(json_build_array(regs, n)) from (select regs, count(*) as n from c_mes group by regs) x), '[]'),
     'cli_cart', coalesce((select json_agg(json_build_array(regs, n)) from (select regs, count(*) as n from c_cart group by regs) x), '[]'),
     'cli_venc', coalesce((select json_agg(json_build_array(regs, n)) from (select regs, count(*) as n from c_venc group by regs) x), '[]'))
);
$function$;
