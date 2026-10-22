-- =========================================================
-- 01-schema.sql — SUPERVISOR LUBE (app do supervisor, do RCA e do gerente), 2026-10-22
--
-- Schema `supervisor` no projeto DATA WAREHOUSE. Só o que o BI COMERCIAL ainda
-- não carrega; o resto é lido, sem escrever, de quem é dono:
--   comercial.fato_comissao_nf   venda faturada por nota (filiais 1, 7, 10, 11, 12)
--   comercial.fato_devolucao     devoluções com motivo
--   comercial.dim_motivo_devolucao  motivo e responsabilidade do RCA
--   core.dim_rca / dim_supervisor / dim_produto / dim_fornecedor
--
-- Regras da casa: RLS ligado e sem políticas (a chave pública não lê nada);
-- só o ETL e a API do app (credencial de servidor) enxergam.
-- =========================================================

create schema if not exists supervisor;
revoke all on schema supervisor from public;

-- ---------------------------------------------------------
-- Prova de carga: "a carga entrou?" se responde aqui
-- ---------------------------------------------------------
create table if not exists supervisor.controle_carga (
  id               bigserial primary key,
  consulta         text not null,
  tabela_destino   text,
  status           text not null,
  linhas           integer,
  linhas_esperadas integer,
  segundos         numeric,
  mensagem         text,
  executado_em     timestamptz not null default now()
);
create index if not exists controle_carga_data_idx on supervisor.controle_carga (executado_em desc);

-- ---------------------------------------------------------
-- Cliente (PCCLIENT): cadastro completo do que o app mostra.
-- Só cliente não excluído com compra ou cadastro nos últimos 400 dias, ou com
-- título em aberto. codsupervisor = supervisor ATUAL do RCA da carteira
-- (CODUSUR1 -> PCUSUARI.CODSUPERVISOR), a mesma regra do BI COMERCIAL.
-- ---------------------------------------------------------
create table if not exists supervisor.cliente (
  codcli        integer primary key,
  fantasia      text,
  razao         text,
  cnpj          text,
  tipofj        text,
  codativ       integer,
  ramo          text,
  cidade        text,
  uf            text,
  bairro        text,
  endereco      text,
  telefone      text,
  celular       text,
  codusur1      integer,
  codsupervisor integer,
  codplpag      integer,
  plano         text,
  prazo_dias    integer,
  limite        numeric,
  bloqueio      boolean not null default false,
  dtbloq        date,
  dtcadastro    date,
  dtprimcompra  date,
  dtultcomp     date,
  data_carga    timestamptz not null default now()
);
create index if not exists cliente_sup_idx on supervisor.cliente (codsupervisor);
create index if not exists cliente_rca_idx on supervisor.cliente (codusur1);

-- ---------------------------------------------------------
-- Título em aberto (PCPREST sem DTPAG e sem DTCANCEL), filiais de venda.
-- grupo: 'cobranca' (entra na inadimplência), 'juridico' (ELUS, ELPR, PER1,
-- PERD: aparece à parte, fora da soma) e 'fora' (BNF, DEVT, DEVF, CRED, 0000,
-- TRMS: não é cobrança de cliente). A confirmar com o financeiro.
-- ---------------------------------------------------------
create table if not exists supervisor.titulo (
  codfilial            integer,
  duplic               bigint,
  prest                text,
  numtransvenda        bigint,
  codcli               integer,
  codusur              integer,
  codsupervisor        integer,     -- supervisor ATUAL do RCA do título
  codsupervisor_titulo integer,     -- o que está gravado no título (pode estar velho)
  codcob               text,
  cobranca             text,
  grupo                text not null check (grupo in ('cobranca', 'juridico', 'fora')),
  dtemissao            date,
  dtvenc               date,
  valor                numeric,
  data_carga           timestamptz not null default now()
);
create index if not exists titulo_sup_idx on supervisor.titulo (codsupervisor);
create index if not exists titulo_cli_idx on supervisor.titulo (codcli);

-- ---------------------------------------------------------
-- Pedido digitado (PCPEDC), sem cancelado e sem bonificação (CONDVENDA 5),
-- do 1º dia do mês de 3 meses atrás até agora. É a "venda do dia" antes de faturar.
-- ---------------------------------------------------------
create table if not exists supervisor.pedido (
  numped        bigint primary key,
  data          date not null,
  hora          smallint,
  minuto        smallint,
  codcli        integer,
  codusur       integer,
  codsupervisor integer,            -- supervisor ATUAL do RCA
  codfilial     integer,
  condvenda     smallint,
  posicao       text,
  origem        text,
  vltotal       numeric,
  numitens      integer,
  dtfat         date,
  data_carga    timestamptz not null default now()
);
create index if not exists pedido_sup_data_idx on supervisor.pedido (codsupervisor, data);

-- ---------------------------------------------------------
-- Venda faturada por item, somada por mês x cliente x produto x RCA
-- (PCMOV operação S, mesmos filtros e mesma conta da comercial.fato_comissao_nf:
-- QT x (PUNIT - ST), sem CFOP 1949, filiais 1, 7, 10, 11 e 12).
-- Alimenta a Curva ABC e as últimas compras do cliente.
-- ---------------------------------------------------------
create table if not exists supervisor.venda_item_mes (
  mes           date not null,
  codcli        integer not null,
  codprod       integer not null,
  codusur       integer not null,
  codsupervisor integer,
  qt            numeric,
  venda         numeric,
  cmv           numeric,
  ultima        date,
  pedidos       integer,
  data_carga    timestamptz not null default now()
);
create index if not exists venda_item_sup_idx on supervisor.venda_item_mes (codsupervisor, mes);

-- ---------------------------------------------------------
-- Pacote pronto de cada setor (S<codsupervisor>) e o resumo do gerente (G),
-- montado pela carga (seção 8b: quem abre o app nunca espera o banco calcular).
-- ---------------------------------------------------------
create table if not exists supervisor.pacote (
  escopo      text primary key,
  versao      text not null,
  gerado_em   timestamptz not null default now(),
  hash        text,
  bytes_json  integer,
  bytes_gz    integer,
  payload_gz  bytea not null
);

alter table supervisor.controle_carga enable row level security;
alter table supervisor.cliente        enable row level security;
alter table supervisor.titulo         enable row level security;
alter table supervisor.pedido         enable row level security;
alter table supervisor.venda_item_mes enable row level security;
alter table supervisor.pacote         enable row level security;

revoke all on all tables in schema supervisor from anon, authenticated;
