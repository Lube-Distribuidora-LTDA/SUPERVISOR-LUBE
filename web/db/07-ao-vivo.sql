-- =============================================================================
-- 07-ao-vivo.sql — o app ao vivo pelo AGENTE LUBE (versão 1.7), 2026-10-29
-- Roda no DATA WAREHOUSE (ivcnotrynogaljrvvyes). Aplicado em 2026-10-29 pelas migrações `supervisor_v5_titulo_chave`,
-- `supervisor_v6_ao_vivo`, `supervisor_v6_ao_vivo_marcas`, `supervisor_v6_ao_vivo_agente` e
-- `supervisor_v6_ao_vivo_nf_do_mes`; este arquivo é o estado final (as funções lidas do banco).
--
-- Pedido do Júlio (2026-10-29): "coloque nosso agente de atualização instantânea dentro do aplicativo, o app
-- precisa atualizar toda vez que tiver alguma mudança e tirar esses scripts de atualização o tempo todo".
-- Decisões dele: saem as cargas de 30 em 30 min (fica só a completa das 06:20) e o ao vivo é "ontem e hoje" + a
-- inadimplência.
--
-- Como fica:
--   - o AGENTE LUBE lê o WinThor e grava supervisor.pedido (ontem e hoje, 30 s) e supervisor.titulo (60 s), fluxos
--     em Desktop\BI\22. AGENTE LUBE\2 - AGENTE\fluxos\supervisor.toml; o faturado e a devolução já vêm ao vivo dos
--     fluxos do comercial;
--   - depois de gravar (supervisor OU comercial), o agente roda supervisor.atualizar_hoje(): o PACOTE DO DIA de cada
--     setor (pedidos, notas e devoluções de ontem e hoje + os títulos em aberto, ~0,1 s todos) e o resumo do gestor
--     (~0,2 s), em supervisor.hoje. A versão só muda quando o conteúdo muda;
--   - o app pergunta de 15 em 15 s (/api/hoje) e põe o pacote do dia por cima do pacote grande, que continua sendo
--     montado pela carga completa (06:20). O botão Atualizar pede ao agente uma leitura na hora (/api/atualizar).
-- =============================================================================

-- a chave do WinThor do título (transação + prestação): o agente grava só o que mudou
create unique index if not exists titulo_chave_uidx on supervisor.titulo (numtransvenda, prest);

create table if not exists supervisor.hoje (
  escopo    text primary key,            -- S<setor> ou G (o resumo do gestor)
  versao    text not null,               -- só muda quando o conteúdo muda
  hash      text not null,               -- md5 do conteúdo
  gerado_em timestamptz not null default now(),
  bytes     integer not null,
  payload   text not null,               -- JSON pronto; a API comprime
  marca     text                         -- resumo barato das linhas de origem: sem mudança, nem remonta
);
alter table supervisor.hoje enable row level security;
revoke all on supervisor.hoje from anon, authenticated;

create table if not exists supervisor.hoje_estado (
  id       integer primary key default 1 check (id = 1),
  em       timestamptz,
  ms       integer,
  mudaram  integer,                      -- escopos remontados na rodada
  erro     text
);
alter table supervisor.hoje_estado enable row level security;
revoke all on supervisor.hoje_estado from anon, authenticated;

-- O pacote do dia de um setor, no MESMO formato do pacote_setor: notas do MÊS (o comercial corrige nota antiga de 15 em
-- 15 min; com só ontem e hoje o cartão da meta ficava atrás do resumo do gestor), pedidos e devoluções de ontem e hoje,
-- os títulos em aberto inteiros e o cadastro de quem aparece hoje.
CREATE OR REPLACE FUNCTION supervisor.pacote_hoje(p_sup integer)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'supervisor', 'pg_temp'
AS $function$
with par as (
  select (now() at time zone 'America/Sao_Paulo')::date as hoje,
         (now() at time zone 'America/Sao_Paulo')::date - 1 as ini,
         least(date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date,
               (now() at time zone 'America/Sao_Paulo')::date - 1) as ini_nf
),
nf as (
  select f.dtmov, f.numped, f.codcli, f.codusur, sum(f.venda) as venda, sum(f.cmv_venda) as cmv,
         sum(f.venda) - sum(f.devolucao_com_st) as tl,
         sum(f.venda) - sum(f.devolucao_sem_st) as tls,
         (sum(f.venda) - sum(f.devolucao_sem_st))
           - (sum(f.cmv_venda) - sum(f.cmv_devolucao) + sum(f.desc_financeiro) + sum(f.cmv_bonificacao) - sum(f.st)) as massa
    from comercial.fato_comissao_nf f, par
   where f.codsupervisor = p_sup and f.dtmov >= par.ini_nf
   group by f.dtmov, f.numped, f.codcli, f.codusur
),
ped as (
  select p.* from supervisor.pedido p, par where p.codsupervisor = p_sup and p.data >= par.ini
),
dev as (
  select d.dtmov, d.codcli, d.codusur, d.numnota, d.coddevol, sum(d.valor_devolucao - coalesce(d.st, 0)) as valor
    from comercial.fato_devolucao d join core.dim_rca r on r.codusur = d.codusur, par
   where r.codsupervisor = p_sup and d.dtmov >= par.ini
   group by d.dtmov, d.codcli, d.codusur, d.numnota, d.coddevol
),
tit as (
  select t.* from supervisor.titulo t where t.codsupervisor = p_sup
),
clis as (
  select codcli from nf, par where nf.dtmov >= par.ini union select codcli from ped union select codcli from dev
)
select json_build_object(
  'tipo', 'hoje',
  'setor', p_sup,
  'hoje', (select hoje - date '1970-01-01' from par),
  'ini',  (select ini  - date '1970-01-01' from par),
  'ini_nf', (select ini_nf - date '1970-01-01' from par),
  'nf', coalesce((select json_agg(json_build_array(dtmov - date '1970-01-01', numped, codcli, codusur,
                                                   round(venda, 4), round(cmv, 4), round(tl, 4), round(tls, 4), round(massa, 4))
                                  order by dtmov, numped) from nf), '[]'),
  'ped', coalesce((select json_agg(json_build_array(data - date '1970-01-01', coalesce(hora, 0) * 60 + coalesce(minuto, 0),
                                                    numped, codcli, codusur, round(vltotal, 4), posicao, origem,
                                                    dtfat - date '1970-01-01') order by data, numped) from ped), '[]'),
  'dev', coalesce((select json_agg(json_build_array(dtmov - date '1970-01-01', codcli, codusur, numnota, coddevol, round(valor, 4))
                                   order by dtmov) from dev), '[]'),
  'mot', coalesce((select json_object_agg(m.coddevol, json_build_array(m.motivo, m.responsabilidade_rca))
                     from comercial.dim_motivo_devolucao m where m.coddevol in (select coddevol from dev)), '{}'),
  'tit', coalesce((select json_agg(json_build_array(codcli, codusur, duplic, prest, dtvenc - date '1970-01-01',
                                                    round(valor, 4), codcob, grupo, codfilial,
                                                    dtemissao - date '1970-01-01') order by dtvenc, numtransvenda, prest) from tit), '[]'),
  'cob', coalesce((select json_object_agg(codcob, cobranca) from (select distinct codcob, cobranca from tit where codcob is not null) x), '{}'),
  'cli', coalesce((select json_agg(json_build_array(
                      k.codcli, coalesce(c.fantasia, dc.cliente), coalesce(c.razao, dc.cliente), c.cnpj, c.ramo,
                      coalesce(c.cidade, dc.cidade), c.bairro, c.endereco, c.telefone, c.celular, c.codusur1,
                      c.plano, c.prazo_dias, round(c.limite, 2), case when c.bloqueio then 1 else 0 end,
                      c.dtultcomp - date '1970-01-01', c.dtcadastro - date '1970-01-01', c.codsupervisor) order by k.codcli)
                     from clis k left join supervisor.cliente c on c.codcli = k.codcli
                     left join core.dim_cliente dc on dc.codcli = k.codcli), '[]')
);
$function$;

-- A marca de cada setor: as colunas de valor das linhas de origem (não a data_carga, que a janela do agente regrava
-- inteira quando uma nota muda). O resumo do gestor muda com o comercial, os títulos, a meta e o dia.
CREATE OR REPLACE FUNCTION supervisor.marcas_hoje()
 RETURNS TABLE(escopo text, marca text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'supervisor', 'pg_temp'
AS $function$
with par as (select (now() at time zone 'America/Sao_Paulo')::date - 1 as ini,
                    least(date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date,
                          (now() at time zone 'America/Sao_Paulo')::date - 1) as ini_nf),
x as (
  select f.codsupervisor as cod,
         hashtextextended(concat_ws('|', f.dtmov, f.numped, f.codcli, f.codusur, f.venda, f.cmv_venda, f.devolucao_com_st,
                                    f.devolucao_sem_st, f.cmv_devolucao, f.desc_financeiro, f.cmv_bonificacao, f.st), 1) as h
    from comercial.fato_comissao_nf f, par where f.dtmov >= par.ini_nf
  union all
  select p.codsupervisor,
         hashtextextended(concat_ws('|', p.numped, p.data, p.hora, p.minuto, p.codcli, p.codusur, p.posicao, p.origem,
                                    p.vltotal, p.dtfat), 2)
    from supervisor.pedido p, par where p.data >= par.ini
  union all
  select r.codsupervisor,
         hashtextextended(concat_ws('|', d.dtmov, d.codcli, d.codusur, d.numnota, d.coddevol, d.valor_devolucao, d.st), 3)
    from comercial.fato_devolucao d join core.dim_rca r on r.codusur = d.codusur, par where d.dtmov >= par.ini
  union all
  select t.codsupervisor,
         hashtextextended(concat_ws('|', t.numtransvenda, t.prest, t.codcli, t.codusur, t.duplic, t.dtvenc, t.valor,
                                    t.codcob, t.cobranca, t.grupo, t.codfilial, t.dtemissao), 4)
    from supervisor.titulo t
),
m as (select cod, count(*) as n, sum(h) as s from x where cod is not null group by cod)
select 'S' || a.cod, (select ini from par)::text || ':' || coalesce(m.n, 0) || ':' || coalesce(m.s, 0)
  from supervisor.setores_ativos() as a(cod) left join m on m.cod = a.cod
union all
select 'G', concat_ws('|', (select ini from par),
                      (select versao from agente.sistema where sistema = 'comercial'),
                      (select max(executado_em) from comercial.controle_carga),
                      (select mudou_em from agente.estado where fluxo = 'supervisor.titulo'),
                      (select max(data_carga) from supervisor.titulo),
                      (select count(*) || ':' || sum(meta) from supervisor.meta),
                      (select count(*) from supervisor.setores_ativos()));
$function$;

-- Remonta só o que mudou (pela marca) e só troca a versão se o conteúdo mudou. Chamada pelo agente depois de gravar
-- no supervisor e no comercial. NUNCA levanta erro: no comercial vem depois do painel do Central Comercial, no mesmo
-- comando, e um erro aqui desfaria o de lá. O erro fica em supervisor.hoje_estado.
CREATE OR REPLACE FUNCTION supervisor.atualizar_hoje()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'supervisor', 'pg_temp'
AS $function$
declare
  t0 timestamptz := clock_timestamp();
  v text := to_char(now() at time zone 'America/Sao_Paulo', 'YYYYMMDD-HH24MISS-MS');
  n integer := 0; r record; txt text; h text;
begin
  begin
    for r in select m.escopo, m.marca from supervisor.marcas_hoje() m
               left join supervisor.hoje x on x.escopo = m.escopo
              where x.marca is distinct from m.marca loop
      if r.escopo = 'G' then
        txt := supervisor.pacote_resumo()::text;
        h := md5((txt::jsonb - 'gerado_em')::text);
      else
        txt := supervisor.pacote_hoje(substr(r.escopo, 2)::integer)::text;
        h := md5(txt);
      end if;
      insert into supervisor.hoje as x (escopo, versao, hash, gerado_em, bytes, payload, marca)
      values (r.escopo, v, h, now(), length(txt), txt, r.marca)
      on conflict (escopo) do update
         set versao    = case when x.hash is distinct from excluded.hash then excluded.versao else x.versao end,
             gerado_em = case when x.hash is distinct from excluded.hash then excluded.gerado_em else x.gerado_em end,
             payload   = case when x.hash is distinct from excluded.hash then excluded.payload else x.payload end,
             bytes     = excluded.bytes, hash = excluded.hash, marca = excluded.marca;
      n := n + 1;
    end loop;
    delete from supervisor.hoje
     where escopo ~ '^S[0-9]+$' and substr(escopo, 2)::integer not in (select supervisor.setores_ativos());
    insert into supervisor.hoje_estado (id, em, ms, mudaram, erro)
    values (1, now(), (extract(epoch from clock_timestamp() - t0) * 1000)::integer, n, null)
    on conflict (id) do update set em = excluded.em, ms = excluded.ms, mudaram = excluded.mudaram, erro = null;
  exception when others then
    insert into supervisor.hoje_estado (id, em, ms, mudaram, erro)
    values (1, now(), (extract(epoch from clock_timestamp() - t0) * 1000)::integer, null, sqlstate || ': ' || sqlerrm)
    on conflict (id) do update set em = excluded.em, ms = excluded.ms, mudaram = null, erro = excluded.erro;
    return -1;
  end;
  return n;
end;
$function$;

revoke execute on function supervisor.pacote_hoje(integer) from public, anon, authenticated;
revoke execute on function supervisor.marcas_hoje() from public, anon, authenticated;
revoke execute on function supervisor.atualizar_hoje() from public, anon, authenticated;

-- o agente roda o pacote do dia depois de gravar no supervisor (no máximo de 10 em 10 s)...
insert into agente.sistema (sistema, apos_gravar, apos_gravar_s)
values ('supervisor', 'select supervisor.atualizar_hoje()', 10)
on conflict (sistema) do update set apos_gravar = excluded.apos_gravar, apos_gravar_s = excluded.apos_gravar_s;

-- ...e no comercial, depois do painel do Central Comercial (o faturado e a devolução do app mudam lá)
update agente.sistema
   set apos_gravar = 'select comercial.atualizar_ao_vivo(); select supervisor.atualizar_hoje()'
 where sistema = 'comercial' and apos_gravar = 'select comercial.atualizar_ao_vivo()';
