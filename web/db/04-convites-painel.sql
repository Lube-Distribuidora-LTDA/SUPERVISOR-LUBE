-- =============================================================================
-- 04-convites-painel.sql — cadastro de supervisores pelo administrador (app 1.2), 2026-10-22
-- Roda no Supabase do PAINEL LUBE DISTRIBUIDORA (wkkdcsqwlxjxorutrbnx), migração `supervisor_lube_convites`.
-- O original fica aqui (o repositório do Painel não guarda as migrações do app).
--
-- Pedido do Júlio (2026-10-22): "preciso poder cadastrar meus Supervisores; os RCA por enquanto não vão usar;
-- os supervisores só podem ver a região dele". E depois: "preciso cadastrar gestor e supervisor (o gestor precisa
-- ver tudo)" -> o convite leva o perfil: 'supervisor' (só a região) ou 'gerente' (o gestor: todas as regiões, só
-- consulta; o app mostra "Gestor").
-- Aplicada em 2026-10-22 (~18:10) e testada num bloco desfeito no fim: convite com código certo libera,
-- código errado fica pendente e conta a tentativa, quem já tem conta é liberado na hora, quem não é
-- administrador é recusado.
--
-- O administrador cadastra nome + e-mail + região (setor do WinThor) na tela Supervisores do app. Isso grava um
-- CONVITE com um código de 6 números, que ele manda pelo WhatsApp. Quem faz o Primeiro acesso com esse e-mail E
-- esse código já nasce LIBERADO como supervisor daquela região. Sem o código certo, segue como antes: pendente até
-- o TI liberar.
--
-- Por que o código: o Painel confirma o e-mail na hora (não manda e-mail de confirmação). Sem o código, quem
-- soubesse o e-mail convidado poderia criar a conta antes da pessoa certa e entrar liberado.
--   - O código fica guardado só como hash bcrypt (extensions.crypt); aparece uma vez, para o administrador.
--   - 5 tentativas erradas e o convite para de valer (o administrador gera outro).
--   - A coluna do hash não é legível nem pelo administrador pela API (permissão por coluna).
-- Se a pessoa já tem conta (do Painel, do SAC ou do app), o convite libera na hora, sem código.
-- =============================================================================

-- 1. Convites ------------------------------------------------------------------
create table if not exists public.sup_convites (
  email          text primary key check (email = lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  nome           text not null check (length(btrim(nome)) between 3 and 120),
  tipo           text not null default 'supervisor' check (tipo in ('supervisor', 'gerente')),
  codsupervisor  integer,
  codigo_hash    text not null,
  tentativas     integer not null default 0,
  situacao       text not null default 'aguardando' check (situacao in ('aguardando', 'usado', 'cancelado')),
  criado_em      timestamptz not null default now(),
  criado_por     uuid references public.profiles(id) on delete set null,
  usado_em       timestamptz,
  usado_por      uuid references auth.users(id) on delete set null,
  check (tipo <> 'supervisor' or codsupervisor is not null)
);
comment on table public.sup_convites is
  'Convites do app SUPERVISOR LUBE (1.2): o administrador cadastra nome, e-mail e região; o Primeiro acesso com o código nasce liberado.';

alter table public.sup_convites enable row level security;
drop policy if exists sup_convites_admin on public.sup_convites;
create policy sup_convites_admin on public.sup_convites
  for select to authenticated using (public.is_admin());
-- escrita só pelas funções abaixo; leitura sem o hash
revoke all on public.sup_convites from public, anon, authenticated;
grant select (email, nome, tipo, codsupervisor, tentativas, situacao, criado_em, criado_por, usado_em, usado_por)
  on public.sup_convites to authenticated;

-- 2. Registro: nova ação 'convite' -----------------------------------------------
alter table public.sup_acessos drop constraint if exists sup_acessos_acao_check;
alter table public.sup_acessos add constraint sup_acessos_acao_check
  check (acao in ('cadastro', 'pedido', 'login', 'logout', 'decisao', 'convite'));

-- 3. Aplica o convite a uma conta -------------------------------------------------
-- p_codigo null = sem conferir o código (só quando o próprio administrador convida alguém que já tem conta).
-- Uso interno: ninguém chama direto pela API.
create or replace function public.sup_aplicar_convite(p_user uuid, p_email text, p_codigo text, p_conferir boolean default true)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.sup_convites;
begin
  select * into v from public.sup_convites
   where email = lower(btrim(p_email)) and situacao = 'aguardando'
   for update;
  if not found then return false; end if;
  if p_conferir then
    if v.tentativas >= 5 then return false; end if;
    if p_codigo is null or btrim(p_codigo) !~ '^[0-9]{6}$'
       or extensions.crypt(btrim(p_codigo), v.codigo_hash) <> v.codigo_hash then
      update public.sup_convites set tentativas = tentativas + 1 where email = v.email;
      insert into public.sup_acessos (user_id, email, acao, detalhe) values (p_user, v.email, 'convite', 'código errado');
      return false;
    end if;
  end if;
  insert into public.sup_usuarios (id, email, nome, tipo, codusur, codsupervisor, situacao, decidido_em, decidido_por)
  values (p_user, v.email, v.nome, v.tipo, null, case when v.tipo = 'supervisor' then v.codsupervisor end,
          'liberado', now(), v.criado_por)
  on conflict (id) do update
     set tipo = excluded.tipo, codusur = null, codsupervisor = excluded.codsupervisor, situacao = 'liberado',
         decidido_em = now(), decidido_por = excluded.decidido_por,
         nome = coalesce(nullif(public.sup_usuarios.nome, ''), excluded.nome);
  update public.sup_convites set situacao = 'usado', usado_em = now(), usado_por = p_user where email = v.email;
  insert into public.sup_acessos (user_id, email, acao, detalhe)
  values (p_user, v.email, 'convite', 'liberado: ' || v.tipo || coalesce(' setor ' || v.codsupervisor, ''));
  return true;
end;
$$;
revoke all on function public.sup_aplicar_convite(uuid, text, text, boolean) from public, anon, authenticated;

-- 4. O administrador convida (gera o código; se a pessoa já tem conta, libera na hora) --------------------
create or replace function public.sup_convidar(p_email text, p_nome text, p_codsupervisor integer, p_tipo text default 'supervisor')
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_tipo   text := case when p_tipo = 'gerente' then 'gerente' else 'supervisor' end;
  v_codigo text := lpad((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0');
  v_user   uuid;
  v_lib    boolean := false;
begin
  if not public.is_admin() then
    raise exception 'Só o administrador do Painel cadastra supervisores.' using errcode = '42501';
  end if;
  if v_tipo = 'supervisor' and p_codsupervisor is null then
    raise exception 'Escolha a região do supervisor.' using errcode = '22023';
  end if;
  insert into public.sup_convites (email, nome, tipo, codsupervisor, codigo_hash, criado_por)
  values (v_email, left(btrim(p_nome), 120), v_tipo, case when v_tipo = 'supervisor' then p_codsupervisor end,
          extensions.crypt(v_codigo, extensions.gen_salt('bf', 8)), auth.uid())
  on conflict (email) do update
     set nome = excluded.nome, tipo = excluded.tipo, codsupervisor = excluded.codsupervisor,
         codigo_hash = excluded.codigo_hash, tentativas = 0, situacao = 'aguardando',
         criado_em = now(), criado_por = excluded.criado_por, usado_em = null, usado_por = null;
  insert into public.sup_acessos (user_id, email, acao, detalhe)
  select auth.uid(), lower(u.email), 'convite', left(v_email || ': ' || v_tipo || coalesce(' setor ' || p_codsupervisor, ''), 300)
    from auth.users u where u.id = auth.uid();
  select u.id into v_user from auth.users u where lower(u.email) = v_email;
  if v_user is not null then
    v_lib := public.sup_aplicar_convite(v_user, v_email, null, false);
  end if;
  return json_build_object('ok', true, 'liberou', v_lib, 'codigo', case when v_lib then null else v_codigo end);
end;
$$;
revoke all on function public.sup_convidar(text, text, integer, text) from public, anon;
grant execute on function public.sup_convidar(text, text, integer, text) to authenticated;

-- 5. Primeiro acesso: o código do convite vem em raw_user_meta_data->>'convite' --------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_tipo text;
  v_cod  text;
begin
  -- Conta do app SUPERVISOR LUBE: fila do TI, sem perfil do painel. Com o código do convite, nasce liberada (1.2).
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
    if coalesce(new.raw_user_meta_data->>'convite', '') <> '' then
      perform public.sup_aplicar_convite(new.id, new.email, new.raw_user_meta_data->>'convite', true);
    end if;
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
$function$;

-- 6. Quem já tem conta (Painel ou SAC) pede o acesso com o código do convite ------------------------------
-- A versão antiga (3 parâmetros) sai: com as duas, a chamada do APK 1.1 ficaria ambígua. O APK 1.1 chama com 3
-- parâmetros e cai nesta, com p_convite vazio.
drop function if exists public.sup_pedir_acesso(text, integer, text);
create or replace function public.sup_pedir_acesso(p_tipo text, p_codigo integer, p_nome text default '', p_convite text default null)
returns json
language plpgsql
security definer
set search_path = public
as $function$
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
  if coalesce(btrim(p_convite), '') <> '' then
    perform public.sup_aplicar_convite(auth.uid(), v_email, p_convite, true);
  end if;
  return public.sup_meu_acesso();
end;
$function$;
revoke all on function public.sup_pedir_acesso(text, integer, text, text) from public, anon;
grant execute on function public.sup_pedir_acesso(text, integer, text, text) to authenticated;
