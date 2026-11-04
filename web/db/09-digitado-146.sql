-- 09-digitado-146.sql — o DIGITADO do app = a venda do Relatório 146, e o custo para a margem do dia.
--
-- Pedido do Júlio (2026-11-04): "precisa ser FATURAMENTO REAL sem devolução e avaria. se a 146 traz isso, tá tudo certo
-- então" e "também precisamos ter margem do dia tanto no painel RESUMO e VENDAS". Até aqui o digitado era o
-- PCPEDC.VLTOTAL (com ST, frete e outras despesas; sem bonificação; filiais 1, 7, 10, 11 e 12), R$ 16.151,66 acima da 146
-- nos mesmos 433 pedidos de 04/11.
--
-- O que muda: os pedidos do app vêm da própria tabela do [[RELATÓRIO 146]] (relatorio146.pedido, que o AGENTE LUBE lê
-- de 30 em 30 s), com a regra dela:
--   venda   = VLATEND − VLOUTRASDESP − VLFRETE − ST dos itens vendidos (condição 5, 6, 11 e 12 = 0)
--   pedidos = posições L, M, B, P, F e C, sem cancelado, sem as condições 4, 8, 10, 13, 20, 98 e 99, todas as filiais
--   região  = o supervisor do pedido (PCPEDC.CODSUPERVISOR), como na aba "Por supervisor" da 146
--   custo   = Σ VLCUSTOFIN × QT − ST dos itens: vai no fim de cada pedido ([9]); a margem do dia da 1.8 é
--             (venda − custo) ÷ venda, o "% lucro" da 146 (lucro só dos pedidos com custo)
-- O app 1.7 instalado ignora o campo a mais e já mostra o digitado novo. O supervisor.pedido segue sendo lido pelo
-- agente, mas o app não usa mais.
--
-- Roda no DATA WAREHOUSE (ivcnotrynogaljrvvyes). Aplicado em 2026-11-04 pela migração `supervisor_v8_digitado_146`.
-- Depois: update supervisor.hoje set marca = null; select supervisor.atualizar_hoje(); e sync_supervisor.py --so-pacote.
-- Conferido: hoje e ontem, 31 de 31 região × dia iguais à 146 em pedidos, valor e lucro.
-- Este arquivo é o estado final (as funções lidas do banco).

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
  select f.dtmov, f.numped, f.codcli, f.codusur, sum(f.venda) as venda, sum(f.cmv_venda) as cmv,
         -- 1.6: a conta do Central Comercial (comercial.mv_comissao_rca_mes)
         sum(f.venda) - sum(f.devolucao_sem_st) as tl,
         sum(f.venda) - sum(f.devolucao_sem_st) as tls,
         (sum(f.venda) - sum(f.devolucao_sem_st))
           - (sum(f.cmv_venda) - sum(f.cmv_devolucao) + sum(f.desc_financeiro) + sum(f.cmv_bonificacao) - sum(f.st)) as massa
    from comercial.fato_comissao_nf f, par
   where f.codsupervisor = p_sup and f.dtmov >= par.ini
   group by f.dtmov, f.numped, f.codcli, f.codusur
),
ped as (
  select p.numped, p.data, p.hora, p.minuto, p.codcli, p.codusur, p.posicao, p.origemped as origem, p.dtfat, p.venda as vltotal, p.custo_liq from relatorio146.pedido p, par where p.codsupervisor = p_sup and p.data >= par.ini
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
                                                   round(venda, 4), round(cmv, 4),
                                                   -- [6] FATURADO = total liquido da aba ST (venda - devolucao sem ST, desde 2026-10-30), [7] o mesmo total (denominador do % liquido), [8] massa de margem
                                                   round(tl, 6), round(tls, 6), round(massa, 6)) order by dtmov, numped) from nf), '[]'),
  'ped', coalesce((select json_agg(json_build_array(data - date '1970-01-01', coalesce(hora, 0) * 60 + coalesce(minuto, 0),
                                                    numped, codcli, codusur, round(vltotal, 6), posicao, origem,
                                                    dtfat - date '1970-01-01', round(custo_liq, 6)) order by data, numped) from ped), '[]'),
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
         sum(f.venda) - sum(f.devolucao_sem_st) as tl,
         sum(f.venda) - sum(f.devolucao_sem_st) as tls,
         (sum(f.venda) - sum(f.devolucao_sem_st))
           - (sum(f.cmv_venda) - sum(f.cmv_devolucao) + sum(f.desc_financeiro) + sum(f.cmv_bonificacao) - sum(f.st)) as massa
    from comercial.fato_comissao_nf f, par
   where f.codsupervisor = p_sup and f.dtmov >= par.ini_nf
   group by f.dtmov, f.numped, f.codcli, f.codusur
),
ped as (
  select p.numped, p.data, p.hora, p.minuto, p.codcli, p.codusur, p.posicao, p.origemped as origem, p.dtfat, p.venda as vltotal, p.custo_liq from relatorio146.pedido p, par where p.codsupervisor = p_sup and p.data >= par.ini
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
                                                   round(venda, 4), round(cmv, 4), round(tl, 6), round(tls, 6), round(massa, 6))
                                  order by dtmov, numped) from nf), '[]'),
  'ped', coalesce((select json_agg(json_build_array(data - date '1970-01-01', coalesce(hora, 0) * 60 + coalesce(minuto, 0),
                                                    numped, codcli, codusur, round(vltotal, 6), posicao, origem,
                                                    dtfat - date '1970-01-01', round(custo_liq, 6)) order by data, numped) from ped), '[]'),
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
         hashtextextended(concat_ws('|', p.numped, p.data, p.hora, p.minuto, p.codcli, p.codusur, p.posicao, p.origemped,
                                    p.venda, p.custo_liq, p.dtfat), 2)
    from relatorio146.pedido p, par where p.data >= par.ini
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

-- o agente refaz o pacote do dia depois de gravar os pedidos da 146 (como já faz no comercial)
update agente.sistema
   set apos_gravar = 'select relatorio146.atualizar_painel(); select supervisor.atualizar_hoje()'
 where sistema = 'relatorio146' and apos_gravar = 'select relatorio146.atualizar_painel()';
