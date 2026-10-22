-- =========================================================
-- 03-acesso-painel.sql — contas do app SUPERVISOR LUBE, 2026-10-22
-- ATENÇÃO: roda no projeto PAINEL LUBE DISTRIBUIDORA (wkkdcsqwlxjxorutrbnx),
-- não no DATA WAREHOUSE. Cópia em "1. PAINEL LUBE DISTRIBUIDORA\db\11_supervisor_acesso.sql".
--
-- O app tem login próprio na mesma base de login do Painel (Supabase Auth), no
-- mesmo desenho do SAC (03_sac_acesso.sql). Três perfis (decisão do Júlio):
--   gerente     vê tudo, todos os setores. É quem tem o sistema "supervisor-lube"
--               liberado no Painel (ou é administrador), ou uma conta do app
--               marcada como gerente pelo TI.
--   supervisor  vê só o setor dele (codsupervisor, ligado pelo TI).
--   rca         vê só a rota dele (codusur).
--
-- Regras (as mesmas do SAC):
--  - Conta do app NUNCA vira usuário do painel: não ganha linha em profiles.
--  - Nasce "pendente"; só o TI libera (aba "Acessos" do próprio app).
--  - O cadastro aceita e-mail de fora de @lube.com.br (RCA usa Gmail/Hotmail).
--    A marca raw_user_meta_data->>'sistema' = 'supervisor' vem do navegador: dá
--    direito só a uma conta PENDENTE do app.
-- =========================================================

-- ---------------------------------------------------------
-- 1. Contas do app
-- ---------------------------------------------------------
create table if not exists public.sup_usuarios (
  id             uuid primary key references auth.users(id) on delete cascade,
  email          text not null unique check (email = lower(email)),
  nome           text not null default '',
  tipo           text not null default 'rca' check (tipo in ('rca', 'supervisor', 'gerente')),
  codusur        integer,        -- RCA no WinThor (tipo rca)
  codsupervisor  integer,        -- setor no WinThor (tipo supervisor)
  situacao       text not null default 'pendente'
                 check (situacao in ('pendente', 'liberado', 'recusado', 'bloqueado')),
  criado_em      timestamptz not null default now(),
  decidido_em    timestamptz,
  decidido_por   uuid references public.profiles(id) on delete set null
);

comment on table public.sup_usuarios is
  'Contas do app SUPERVISOR LUBE (RCA, supervisor e gerente de fora do painel). Separadas de profiles. Nascem pendentes; o TI libera na aba Acessos do app.';

create index if not exists sup_usuarios_pendentes_idx on public.sup_usuarios (criado_em) where situacao = 'pendente';

create table if not exists public.sup_acessos (
  id         bigserial primary key,
  user_id    uuid references auth.users(id) on delete set null,
  email      text,
  acao       text not null check (acao in ('cadastro', 'pedido', 'login', 'logout', 'decisao')),
  detalhe    text not null default '',
  criado_em  timestamptz not null default now()
);
create index if not exists sup_acessos_data_idx on public.sup_acessos (criado_em desc);

-- ---------------------------------------------------------
-- 2. Sistema no catálogo do Painel (cartão do portal para o gerente)
-- ---------------------------------------------------------
insert into public.sistemas (slug, nome, categoria, descricao, url, badge, ordem, ativo)
values ('supervisor-lube', 'SUPERVISOR LUBE', 'COMERCIAL',
        'App do supervisor, do RCA e do gerente: venda do dia, carteira, cliente, curva ABC, inadimplência e devolução.',
        'https://supervisor-lube.vercel.app/', 'comercial', 12, false)
on conflict (slug) do nothing;

-- ---------------------------------------------------------
-- 3. Gatilho de novo usuário: conta do app desvia antes do SAC e da regra do domínio
--    (o resto da função é o mesmo de 03_sac_acesso.sql, sem mudança)
-- ---------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo text;
  v_cod  text;
begin
  -- Conta do app SUPERVISOR LUBE: fila do TI, sem perfil do painel.
  if coalesce(new.raw_user_meta_data->>'sistema', '') = 'supervisor' then
    v_tipo := case when new.raw_user_meta_data->>'tipo' = 'supervisor' then 'supervisor' else 'rca' end;
    v_cod  := new.raw_user_meta_data->>'codigo';
    insert into public.sup_usuarios (id, email, nome, tipo, codusur, codsupervisor)
    values (
      new.id,
      lower(new.email),
      left(btrim(coalesce(new.raw_user_meta_data->>'nome', '')), 120),
      v_tipo,
      case when v_tipo = 'rca' and v_cod ~ '^[0-9]{1,6}$' then v_cod::integer end,
      case when v_tipo = 'supervisor' and v_cod ~ '^[0-9]{1,6}$' then v_cod::integer end
    )
    on conflict (id) do nothing;
    insert into public.sup_acessos (user_id, email, acao, detalhe)
    values (new.id, lower(new.email), 'cadastro', v_tipo || coalesce(' ' || v_cod, ''));
    return new;
  end if;

  -- Conta do SAC: fila do TI, sem perfil do painel.
  if coalesce(new.raw_user_meta_data->>'sistema', '') = 'sac' then
    v_tipo := case when new.raw_user_meta_data->>'tipo' = 'supervisor' then 'supervisor' else 'rca' end;
    v_cod  := new.raw_user_meta_data->>'codusur';
    insert into public.sac_usuarios (id, email, nome, tipo, codusur)
    values (
      new.id,
      lower(new.email),
      left(btrim(coalesce(new.raw_user_meta_data->>'nome', '')), 120),
      v_tipo,
      case when v_tipo = 'rca' and v_cod ~ '^[0-9]{1,6}$' then v_cod::integer end
    )
    on conflict (id) do nothing;
    insert into public.sac_acessos (user_id, email, acao, detalhe)
    values (new.id, lower(new.email), 'cadastro', v_tipo);
    return new;
  end if;

  -- Painel: só @lube.com.br ou e-mail liberado um a um.
  if lower(new.email) not like '%@lube.com.br'
     and not exists (select 1 from public.emails_externos e where e.email = lower(new.email)) then
    raise exception 'Acesso restrito: use um e-mail @lube.com.br';
  end if;

  insert into public.profiles (id, email, nome, cargo)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data->>'nome', ''),
    coalesce(new.raw_user_meta_data->>'cargo', '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------
-- 4. Funções que o app chama (com o token de quem está logado)
-- ---------------------------------------------------------
-- Quem é a pessoa no app. Gerente do Painel (sistema liberado ou administrador)
-- vem primeiro; depois a conta do app; sem nada: 'sem_cadastro'.
create or replace function public.sup_meu_acesso()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_perfil public.profiles;
  v_sis    public.sistemas;
  v_conta  public.sup_usuarios;
  v_gerente boolean := false;
begin
  if auth.uid() is null then
    return json_build_object('situacao', 'sem_sessao');
  end if;
  select * into v_perfil from public.profiles p where p.id = auth.uid();
  select * into v_sis from public.sistemas s where s.slug = 'supervisor-lube';
  select * into v_conta from public.sup_usuarios u where u.id = auth.uid();

  if v_perfil.id is not null and v_perfil.ativo then
    if v_perfil.is_admin then
      v_gerente := true;
    elsif v_sis.id is not null and v_perfil.acesso_total then
      v_gerente := not exists (select 1 from public.permissoes_excecao x where x.user_id = v_perfil.id and x.sistema_id = v_sis.id);
    elsif v_sis.id is not null then
      v_gerente := exists (select 1 from public.permissoes x where x.user_id = v_perfil.id and x.sistema_id = v_sis.id);
    end if;
  end if;

  if v_gerente then
    return json_build_object('situacao', 'liberado', 'tipo', 'gerente', 'nome', v_perfil.nome, 'email', v_perfil.email,
                             'admin', coalesce(v_perfil.is_admin, false), 'origem', 'painel');
  end if;
  if v_conta.id is not null then
    return json_build_object('situacao', v_conta.situacao, 'tipo', v_conta.tipo, 'nome', v_conta.nome, 'email', v_conta.email,
                             'codusur', v_conta.codusur, 'codsupervisor', v_conta.codsupervisor,
                             'admin', false, 'origem', 'app');
  end if;
  return json_build_object('situacao', 'sem_cadastro', 'corporativo', v_perfil.id is not null);
end;
$$;

-- Quem já tem conta na base (do Painel ou do SAC) e quer usar o app: entra na fila.
create or replace function public.sup_pedir_acesso(p_tipo text, p_codigo integer, p_nome text default '')
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_nome  text;
  v_tipo  text := case when p_tipo = 'supervisor' then 'supervisor' else 'rca' end;
begin
  if auth.uid() is null then
    raise exception 'sem sessão';
  end if;
  select lower(u.email), coalesce(nullif(btrim(p_nome), ''), p.nome, s.nome, '')
    into v_email, v_nome
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join public.sac_usuarios s on s.id = u.id
   where u.id = auth.uid();
  insert into public.sup_usuarios (id, email, nome, tipo, codusur, codsupervisor)
  values (auth.uid(), v_email, left(v_nome, 120), v_tipo,
          case when v_tipo = 'rca' then p_codigo end, case when v_tipo = 'supervisor' then p_codigo end)
  on conflict (id) do update
     set tipo = excluded.tipo, codusur = excluded.codusur, codsupervisor = excluded.codsupervisor,
         nome = case when excluded.nome <> '' then excluded.nome else public.sup_usuarios.nome end
   where public.sup_usuarios.situacao = 'pendente';
  insert into public.sup_acessos (user_id, email, acao, detalhe)
  values (auth.uid(), v_email, 'pedido', v_tipo || coalesce(' ' || p_codigo, ''));
  return public.sup_meu_acesso();
end;
$$;

-- Registro de entrada e saída (rastreabilidade: quem e quando).
create or replace function public.sup_registrar(p_acao text, p_detalhe text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_acao not in ('login', 'logout', 'decisao') or auth.uid() is null then
    return;
  end if;
  if p_acao = 'decisao' and not public.is_admin() then
    return;
  end if;
  insert into public.sup_acessos (user_id, email, acao, detalhe)
  select auth.uid(), lower(u.email), p_acao, left(coalesce(p_detalhe, ''), 300) from auth.users u where u.id = auth.uid();
end;
$$;

revoke all on function public.sup_meu_acesso()                       from public, anon;
revoke all on function public.sup_pedir_acesso(text, integer, text)  from public, anon;
revoke all on function public.sup_registrar(text, text)              from public, anon;
grant execute on function public.sup_meu_acesso()                       to authenticated;
grant execute on function public.sup_pedir_acesso(text, integer, text)  to authenticated;
grant execute on function public.sup_registrar(text, text)              to authenticated;

-- ---------------------------------------------------------
-- 5. RLS: a pessoa vê a própria conta; o administrador vê e decide tudo
-- ---------------------------------------------------------
alter table public.sup_usuarios enable row level security;
alter table public.sup_acessos  enable row level security;

drop policy if exists sup_usuarios_self  on public.sup_usuarios;
drop policy if exists sup_usuarios_admin on public.sup_usuarios;
create policy sup_usuarios_self on public.sup_usuarios
  for select to authenticated using (id = auth.uid());
create policy sup_usuarios_admin on public.sup_usuarios
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists sup_acessos_admin on public.sup_acessos;
create policy sup_acessos_admin on public.sup_acessos
  for select to authenticated using (public.is_admin());

revoke all on public.sup_usuarios from anon;
revoke all on public.sup_acessos  from anon;
revoke insert, update, delete on public.sup_acessos from authenticated;
