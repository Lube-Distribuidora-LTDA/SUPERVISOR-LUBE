-- 10-numeros-iguais-aos-bis.sql — todo número do app igual ao do Relatório 146 e ao do Central Comercial.
--
-- Pedido do Júlio (2026-11-04): "passe o pente fino pra saber se todos os números estão batendo com o 146 e o central
-- comercial. Sempre precisam ser os mesmos números" (e a regra no cérebro: todos os sistemas batem os BIs criados).
-- O pente fino achou, e este arquivo corrige no banco (migrações supervisor_v9_devolucao_carteira_146, supervisor_v9_janela,
-- supervisor_v9_janela_atualizar e supervisor_v9_positivados_146):
--   1) DEVOLUÇÃO = a da aba Devoluções do Central Comercial: valor_devolucao COM ST, pelo supervisor do RCA (o app tirava o
--      ST: VITÓRIA NORTE out/2026 56.515,13 × 61.393,21 no BI).
--   2) CARTEIRA = a do Relatório 146 ("Total cadastrado"): cliente com um RCA do supervisor como RCA 1 ou RCA 2
--      (relatorio146.cliente), cadastrado antes do fim do período; POSITIVADO = cliente com pedido (o "Positivados" da 146).
--      O pacote do setor leva esses clientes, 'rcas_sup' e, no fim de cada cliente, [18] RCA 1, [19] RCA 2 e [20] cadastro.
--   3) POSITIVADOS do resumo do gestor (tela Setores) = clientes com pedido no mês (146), não quem teve nota; a marca do
--      resumo olha a 146 também.
--   4) JANELA ('J' || setor em supervisor.hoje): os dias antigos que o agente ainda relê (pedidos e devoluções de hoje-60 a
--      hoje-2, notas de hoje-35 a hoje-2), remontada e baixada só quando um deles muda. Sem ela, um dia antigo corrigido
--      no WinThor mudava na 146 e no Central Comercial na hora e no app só na carga das 06:20.
-- Conferido em 2026-11-04 ~16:20: outubro, 17 de 17 regiões iguais em faturado, margem, devolução, digitado, pedidos e
-- positivados; novembro, as 20 regiões da tela Setores iguais; ES - CENTRAL SUL igual em tudo no Resumo, Dia, Carteira e
-- Devolução. O app 1.8 instalado ignora os campos novos; a janela é pedida só pelo app 1.9 (?janela=1).
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
  select d.dtmov, d.codcli, d.codusur, d.numnota, d.coddevol, sum(d.valor_devolucao) as valor
    from comercial.fato_devolucao d join core.dim_rca r on r.codusur = d.codusur, par
   where r.codsupervisor = p_sup and d.dtmov >= par.ini
   group by d.dtmov, d.codcli, d.codusur, d.numnota, d.coddevol
),
carteira as (
  select c.codcli from supervisor.cliente c where c.codsupervisor = p_sup union select k.codcli from relatorio146.cliente k where k.codusur1 in (select r.codusur from core.dim_rca r where r.codsupervisor = p_sup) or k.codusur2 in (select r.codusur from core.dim_rca r where r.codsupervisor = p_sup)
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
  -- 1.9: todos os RCAs do supervisor (a carteira da 146 conta o RCA 1 ou 2 de qualquer um deles)
  'rcas_sup', coalesce((select json_agg(r.codusur order by r.codusur) from core.dim_rca r where r.codsupervisor = p_sup), '[]'),
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
                      c.dtultcomp - date '1970-01-01', c.dtcadastro - date '1970-01-01', c.codsupervisor, rc.codusur1, rc.codusur2, rc.dtcadastro - date '1970-01-01'))
                     from clis k left join supervisor.cliente c on c.codcli = k.codcli
                     left join core.dim_cliente dc on dc.codcli = k.codcli left join relatorio146.cliente rc on rc.codcli = k.codcli), '[]'),
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
  select d.dtmov, d.codcli, d.codusur, d.numnota, d.coddevol, sum(d.valor_devolucao) as valor
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
                      c.dtultcomp - date '1970-01-01', c.dtcadastro - date '1970-01-01', c.codsupervisor, rc.codusur1, rc.codusur2, rc.dtcadastro - date '1970-01-01') order by k.codcli)
                     from clis k left join supervisor.cliente c on c.codcli = k.codcli
                     left join core.dim_cliente dc on dc.codcli = k.codcli left join relatorio146.cliente rc on rc.codcli = k.codcli), '[]')
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
       (select json_agg(round(coalesce(v.massa, 0), 6) order by m.mes) from meses m left join venda v on v.cod = s.cod and v.mes = m.mes)
     ) order by s.nome)
     from setores s left join tit t on t.cod = s.cod), '[]')
);
$function$;

CREATE OR REPLACE FUNCTION supervisor.pacote_janela(p_sup integer)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'supervisor', 'pg_temp'
AS $function$
with par as (
  select (now() at time zone 'America/Sao_Paulo')::date as hoje,
         (now() at time zone 'America/Sao_Paulo')::date - 60 as ini,
         (now() at time zone 'America/Sao_Paulo')::date - 35 as ini_nf,
         (now() at time zone 'America/Sao_Paulo')::date - 2  as fim
),
nf as (
  select f.dtmov, f.numped, f.codcli, f.codusur, sum(f.venda) as venda, sum(f.cmv_venda) as cmv,
         sum(f.venda) - sum(f.devolucao_sem_st) as tl,
         sum(f.venda) - sum(f.devolucao_sem_st) as tls,
         (sum(f.venda) - sum(f.devolucao_sem_st))
           - (sum(f.cmv_venda) - sum(f.cmv_devolucao) + sum(f.desc_financeiro) + sum(f.cmv_bonificacao) - sum(f.st)) as massa
    from comercial.fato_comissao_nf f, par
   where f.codsupervisor = p_sup and f.dtmov between par.ini_nf and par.fim
   group by f.dtmov, f.numped, f.codcli, f.codusur
),
ped as (
  select p.numped, p.data, p.hora, p.minuto, p.codcli, p.codusur, p.posicao, p.origemped as origem, p.dtfat,
         p.venda as vltotal, p.custo_liq
    from relatorio146.pedido p, par
   where p.codsupervisor = p_sup and p.data between par.ini and par.fim
),
dev as (
  select d.dtmov, d.codcli, d.codusur, d.numnota, d.coddevol, sum(d.valor_devolucao) as valor
    from comercial.fato_devolucao d join core.dim_rca r on r.codusur = d.codusur, par
   where r.codsupervisor = p_sup and d.dtmov between par.ini and par.fim
   group by d.dtmov, d.codcli, d.codusur, d.numnota, d.coddevol
)
select json_build_object(
  'tipo', 'janela',
  'setor', p_sup,
  'hoje', (select hoje - date '1970-01-01' from par),
  'ini',  (select ini  - date '1970-01-01' from par),
  'ini_nf', (select ini_nf - date '1970-01-01' from par),
  'fim',  (select fim - date '1970-01-01' from par),
  -- os mesmos formatos do pacote do dia (supervisor.pacote_hoje)
  'nf', coalesce((select json_agg(json_build_array(dtmov - date '1970-01-01', numped, codcli, codusur,
                                                   round(venda, 4), round(cmv, 4), round(tl, 6), round(tls, 6), round(massa, 6))
                                  order by dtmov, numped) from nf), '[]'),
  'ped', coalesce((select json_agg(json_build_array(data - date '1970-01-01', coalesce(hora, 0) * 60 + coalesce(minuto, 0),
                                                    numped, codcli, codusur, round(vltotal, 6), posicao, origem,
                                                    dtfat - date '1970-01-01', round(custo_liq, 6)) order by data, numped) from ped), '[]'),
  'dev', coalesce((select json_agg(json_build_array(dtmov - date '1970-01-01', codcli, codusur, numnota, coddevol, round(valor, 4))
                                   order by dtmov) from dev), '[]'),
  'mot', coalesce((select json_object_agg(m.coddevol, json_build_array(m.motivo, m.responsabilidade_rca))
                     from comercial.dim_motivo_devolucao m where m.coddevol in (select coddevol from dev)), '{}')
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
                      (select versao from agente.sistema where sistema = 'comercial'), (select versao from agente.sistema where sistema = 'relatorio146'),
                      (select max(executado_em) from comercial.controle_carga),
                      (select mudou_em from agente.estado where fluxo = 'supervisor.titulo'),
                      (select max(data_carga) from supervisor.titulo),
                      (select count(*) || ':' || sum(meta) from supervisor.meta),
                      (select count(*) from supervisor.setores_ativos()));
$function$;

CREATE OR REPLACE FUNCTION supervisor.marcas_janela()
 RETURNS TABLE(escopo text, marca text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'supervisor', 'pg_temp'
AS $function$
with par as (select (now() at time zone 'America/Sao_Paulo')::date - 60 as ini,
                    (now() at time zone 'America/Sao_Paulo')::date - 35 as ini_nf,
                    (now() at time zone 'America/Sao_Paulo')::date - 2  as fim),
x as (
  select f.codsupervisor as cod,
         hashtextextended(concat_ws('|', f.dtmov, f.numped, f.codcli, f.codusur, f.venda, f.cmv_venda, f.devolucao_com_st,
                                    f.devolucao_sem_st, f.cmv_devolucao, f.desc_financeiro, f.cmv_bonificacao, f.st), 1) as h
    from comercial.fato_comissao_nf f, par where f.dtmov between par.ini_nf and par.fim
  union all
  select p.codsupervisor,
         hashtextextended(concat_ws('|', p.numped, p.data, p.hora, p.minuto, p.codcli, p.codusur, p.posicao, p.origemped,
                                    p.venda, p.custo_liq, p.dtfat), 2)
    from relatorio146.pedido p, par where p.data between par.ini and par.fim
  union all
  select r.codsupervisor,
         hashtextextended(concat_ws('|', d.dtmov, d.codcli, d.codusur, d.numnota, d.coddevol, d.valor_devolucao, d.st), 3)
    from comercial.fato_devolucao d join core.dim_rca r on r.codusur = d.codusur, par where d.dtmov between par.ini and par.fim
),
m as (select cod, count(*) as n, sum(h) as s from x where cod is not null group by cod)
select 'J' || a.cod, (select ini from par)::text || ':' || coalesce(m.n, 0) || ':' || coalesce(m.s, 0)
  from supervisor.setores_ativos() as a(cod) left join m on m.cod = a.cod;
$function$;

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
    for r in select m.escopo, m.marca
               from (select * from supervisor.marcas_hoje() union all select * from supervisor.marcas_janela()) m
               left join supervisor.hoje x on x.escopo = m.escopo
              where x.marca is distinct from m.marca loop
      if r.escopo = 'G' then
        txt := supervisor.pacote_resumo()::text;
        h := md5((txt::jsonb - 'gerado_em')::text);
      elsif r.escopo like 'J%' then
        txt := supervisor.pacote_janela(substr(r.escopo, 2)::integer)::text;
        h := md5(txt);
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
     where escopo ~ '^[SJ][0-9]+$' and substr(escopo, 2)::integer not in (select supervisor.setores_ativos());
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

revoke execute on function supervisor.pacote_janela(integer) from public, anon, authenticated;
revoke execute on function supervisor.marcas_janela() from public, anon, authenticated;
