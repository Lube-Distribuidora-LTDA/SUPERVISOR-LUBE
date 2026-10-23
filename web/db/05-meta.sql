-- =============================================================================
-- 05-meta.sql — meta mensal no Resumo do app (versão 1.5), 2026-10-23
-- Roda no DATA WAREHOUSE (ivcnotrynogaljrvvyes), migração `supervisor_v2_meta`. Aplicada em 2026-10-23.
--
-- Pedido do Júlio (2026-10-23): "No resumo do aplicativo, eu preciso que você coloque as informações da meta mensal
-- mais o faturamento atual. [...] se a gente já conseguiu bater a meta ou se já está próximo de bater."
--
-- De onde vem a meta: WinThor, PCMETASUP (meta de venda da região, uma linha por supervisor e dia útil,
-- VLVENDAPREV). A PCMETARCA tem a mesma meta dividida por RCA (out/2026: as duas somam R$ 14.690.800, 16 regiões,
-- 22 dias úteis). A PCMETA é outra coisa (meta por fornecedor) e não entra.
-- Carga: consulta `meta` do etl/consultas_supervisor.py (grupo completo, 4x ao dia), conferida contra a PCMETASUP
-- a cada carga (passo `conferencia_meta` do sync_supervisor.py).
--
-- O que muda nos pacotes:
--   pacote_setor(p) ganha 'meta': [[dia (dias desde 1970-01-01), meta do dia], ...] da janela do pacote.
--   pacote_resumo() ganha, em cada setor, [9] meta do mês e [10] meta até ontem, alinhadas com 'meses'
--   (0 = sem meta cadastrada). "Meta até ontem" = soma dos dias úteis que já terminaram: é o ritmo esperado
--   (o dia de hoje ainda está faturando; contar a meta dele deixaria todo mundo "abaixo do ritmo" de manhã).
--   Primeira versão (supervisor_v2_meta) mandava "até hoje"; trocada no mesmo dia (supervisor_v2_meta_ate_ontem),
--   antes de o app usar o campo.
-- =============================================================================

create table if not exists supervisor.meta (
  codsupervisor integer not null,
  data          date    not null,
  meta          numeric(15,2) not null,
  primary key (codsupervisor, data)
);
alter table supervisor.meta enable row level security;
revoke all on supervisor.meta from anon, authenticated;

CREATE OR REPLACE FUNCTION supervisor.pacote_setor(p_sup integer)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'supervisor', 'pg_temp'
AS $function$
with par as (
  select (now() at time zone 'America/Sao_Paulo')::date as hoje,
         (date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date) - interval '3 months')::date as ini
),
nf as (
  select f.dtmov, f.numped, f.codcli, f.codusur, sum(f.venda) as venda, sum(f.cmv_venda) as cmv
    from comercial.fato_comissao_nf f, par
   where f.codsupervisor = p_sup and f.dtmov >= par.ini
   group by f.dtmov, f.numped, f.codcli, f.codusur
),
ped as (
  select p.* from supervisor.pedido p, par where p.codsupervisor = p_sup and p.data >= par.ini
),
tit as (
  select t.* from supervisor.titulo t where t.codsupervisor = p_sup
),
item as (
  select i.mes, i.codcli, i.codprod, i.codusur, sum(i.qt) as qt, sum(i.venda) as venda, sum(i.cmv) as cmv,
         max(i.ultima) as ultima, sum(i.pedidos) as pedidos
    from supervisor.venda_item_mes i where i.codsupervisor = p_sup
   group by i.mes, i.codcli, i.codprod, i.codusur
),
dev as (
  select d.dtmov, d.codcli, d.codusur, d.numnota, d.coddevol, sum(d.valor_devolucao - coalesce(d.st, 0)) as valor
    from comercial.fato_devolucao d join core.dim_rca r on r.codusur = d.codusur, par
   where r.codsupervisor = p_sup and d.dtmov >= par.ini
   group by d.dtmov, d.codcli, d.codusur, d.numnota, d.coddevol
),
carteira as (
  select c.codcli from supervisor.cliente c where c.codsupervisor = p_sup
),
clis as (
  select codcli from carteira
  union select codcli from nf union select codcli from ped union select codcli from tit
  union select codcli from item union select codcli from dev
),
rcas as (
  select r.codusur, r.nome, (r.dttermino is null and coalesce(r.bloqueio, 'N') <> 'S') as ativo
    from core.dim_rca r
   where r.codsupervisor = p_sup
     and (   (r.dttermino is null and coalesce(r.bloqueio, 'N') <> 'S')
          or r.codusur in (select codusur from nf union select codusur from ped union select codusur from tit
                           union select codusur from item union select codusur from dev
                           union select codusur1 from supervisor.cliente where codsupervisor = p_sup))
),
prods as (select distinct codprod from item),
cargas as (
  select consulta, max(executado_em) as em from supervisor.controle_carga where status in ('OK', 'AVISO') group by consulta
  union all
  select 'faturado', max(executado_em) from comercial.controle_carga where consulta = 'comissao_nf' and status = 'OK'
  union all
  select 'devolucao', max(executado_em) from comercial.controle_carga where consulta = 'devolucao' and status = 'OK'
)
select json_build_object(
  'tipo', 'setor',
  'setor', json_build_object('cod', p_sup, 'nome', (select s.nome from core.dim_supervisor s where s.codsupervisor = p_sup)),
  'hoje', (select hoje - date '1970-01-01' from par),
  'ini',  (select ini  - date '1970-01-01' from par),
  'gerado_em', now(),
  'cargas', (select json_object_agg(consulta, em) from cargas),
  'rcas', coalesce((select json_agg(json_build_array(codusur, nome, ativo) order by ativo desc, nome) from rcas), '[]'),
  'nf', coalesce((select json_agg(json_build_array(dtmov - date '1970-01-01', numped, codcli, codusur,
                                                   round(venda, 4), round(cmv, 4)) order by dtmov, numped) from nf), '[]'),
  'ped', coalesce((select json_agg(json_build_array(data - date '1970-01-01', coalesce(hora, 0) * 60 + coalesce(minuto, 0),
                                                    numped, codcli, codusur, round(vltotal, 4), posicao, origem,
                                                    dtfat - date '1970-01-01') order by data, numped) from ped), '[]'),
  'tit', coalesce((select json_agg(json_build_array(codcli, codusur, duplic, prest, dtvenc - date '1970-01-01',
                                                    round(valor, 4), codcob, grupo, codfilial,
                                                    dtemissao - date '1970-01-01') order by dtvenc) from tit), '[]'),
  'cob', coalesce((select json_object_agg(codcob, cobranca) from (select distinct codcob, cobranca from tit where codcob is not null) x), '{}'),
  'item', coalesce((select json_agg(json_build_array(mes - date '1970-01-01', codcli, codprod, codusur, round(qt, 3),
                                                     round(venda, 4), round(cmv, 4), ultima - date '1970-01-01', pedidos)) from item), '[]'),
  'prod', coalesce((select json_object_agg(p.codprod, json_build_array(coalesce(d.descricao, 'PRODUTO ' || p.codprod), d.codfornec))
                      from prods p left join core.dim_produto d on d.codprod = p.codprod), '{}'),
  'forn', coalesce((select json_object_agg(f.codfornec, f.fornecedor) from core.dim_fornecedor f
                     where f.codfornec in (select d.codfornec from prods p join core.dim_produto d on d.codprod = p.codprod)), '{}'),
  'dev', coalesce((select json_agg(json_build_array(dtmov - date '1970-01-01', codcli, codusur, numnota, coddevol, round(valor, 4))
                                   order by dtmov) from dev), '[]'),
  'mot', coalesce((select json_object_agg(m.coddevol, json_build_array(m.motivo, m.responsabilidade_rca))
                     from comercial.dim_motivo_devolucao m where m.coddevol in (select coddevol from dev)), '{}'),
  'cli', coalesce((select json_agg(json_build_array(
                      k.codcli, coalesce(c.fantasia, dc.cliente), coalesce(c.razao, dc.cliente), c.cnpj, c.ramo,
                      coalesce(c.cidade, dc.cidade), c.bairro, c.endereco, c.telefone, c.celular, c.codusur1,
                      c.plano, c.prazo_dias, round(c.limite, 2), case when c.bloqueio then 1 else 0 end,
                      c.dtultcomp - date '1970-01-01', c.dtcadastro - date '1970-01-01', c.codsupervisor))
                     from clis k left join supervisor.cliente c on c.codcli = k.codcli
                     left join core.dim_cliente dc on dc.codcli = k.codcli), '[]'),
  -- meta de venda da região por dia útil (WinThor PCMETASUP), da janela do pacote
  'meta', coalesce((select json_agg(json_build_array(m.data - date '1970-01-01', round(m.meta, 2)) order by m.data)
                      from supervisor.meta m, par where m.codsupervisor = p_sup and m.data >= par.ini), '[]')
);
$function$;

CREATE OR REPLACE FUNCTION supervisor.pacote_resumo()
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'supervisor', 'pg_temp'
AS $function$
with par as (
  select (now() at time zone 'America/Sao_Paulo')::date as hoje,
         (date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date) - interval '3 months')::date as ini
),
setores as (
  select s.codsupervisor as cod, s.nome
    from core.dim_supervisor s
   where exists (select 1 from core.dim_rca r where r.codsupervisor = s.codsupervisor
                    and r.dttermino is null and coalesce(r.bloqueio, 'N') <> 'S')
),
venda as (
  select f.codsupervisor as cod, date_trunc('month', f.dtmov)::date as mes, sum(f.venda) as v, sum(f.cmv_venda) as c,
         count(distinct f.codcli) filter (where f.venda > 0) as pos
    from comercial.fato_comissao_nf f, par where f.dtmov >= par.ini group by 1, 2
),
dev as (
  select r.codsupervisor as cod, date_trunc('month', d.dtmov)::date as mes, sum(d.valor_devolucao - coalesce(d.st, 0)) as v
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
       (select json_agg(coalesce(v.pos, 0) order by m.mes) from meses m left join venda v on v.cod = s.cod and v.mes = m.mes),
       -- [9] meta do mês e [10] meta até ontem, alinhadas com "meses" (0 = sem meta cadastrada)
       (select json_agg(round(coalesce(x.v, 0), 2) order by m.mes) from meses m left join meta x on x.cod = s.cod and x.mes = m.mes),
       (select json_agg(round(coalesce(x.ate_ontem, 0), 2) order by m.mes) from meses m left join meta x on x.cod = s.cod and x.mes = m.mes)
     ) order by s.nome)
     from setores s left join tit t on t.cod = s.cod), '[]')
);
$function$;

revoke execute on function supervisor.pacote_setor(integer) from public, anon, authenticated;
revoke execute on function supervisor.pacote_resumo() from public, anon, authenticated;
