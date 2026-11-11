-- =============================================================================
-- 12-estados-gestor.sql — 1.11.6 (2026-11-11): o gestor vê TODAS as regiões ou SÓ OS ESTADOS escolhidos
-- (Júlio: "a visão do gestor seja geral ou em estados específicos, por exemplo: BA, ES só e o outro só RJ").
--
-- Banco do PAINEL (login). Migração supervisor_lube_estados_gestor.
--   sup_usuarios.estados / sup_convites.estados  text[]: nulo = todas as regiões (o de sempre);
--     'ES', 'BA', 'RJ' = as regiões com esse estado no nome ("ES - NORTE", "BA - SUL", "RJ - FARMA"...);
--     'OUTRAS' = as regiões sem estado no nome (LUBE DISTRIBUIDORA, ADMINISTRAÇÃO, VENDA INTERNA, INATIVO).
--   Só vale para o gestor (tipo 'gerente'); supervisor e RCA continuam presos à região/rota deles.
--   Quem é gestor pelo Painel (administrador ou "Todos os sistemas") continua vendo tudo.
--   Quem decide o que cada região é (o nome do WinThor) é a API do app (api/_estados.js); aqui só se guarda a escolha.
-- =============================================================================

alter table public.sup_usuarios add column if not exists estados text[];
alter table public.sup_convites add column if not exists estados text[];

alter table public.sup_usuarios drop constraint if exists sup_usuarios_estados_check;
alter table public.sup_usuarios add constraint sup_usuarios_estados_check
  check (estados is null or (cardinality(estados) between 1 and 4 and estados <@ array['ES', 'BA', 'RJ', 'OUTRAS']::text[]));
alter table public.sup_convites drop constraint if exists sup_convites_estados_check;
alter table public.sup_convites add constraint sup_convites_estados_check
  check (estados is null or (cardinality(estados) between 1 and 4 and estados <@ array['ES', 'BA', 'RJ', 'OUTRAS']::text[]));

comment on column public.sup_usuarios.estados is
  'Supervisor Lube 1.11.6: estados que o GESTOR vê (ES, BA, RJ, OUTRAS = regiões sem estado no nome). Nulo = todas as regiões.';
comment on column public.sup_convites.estados is
  'Supervisor Lube 1.11.6: estados do gestor convidado; vão para sup_usuarios.estados no Primeiro acesso. Nulo = todas.';

-- estados limpos: maiúsculos, sem repetição, em ordem fixa; vazio ou "todos" = nulo
create or replace function public.sup_estados_limpos(p text[])
returns text[]
language sql
immutable
set search_path to 'public'
as $$
  select case when count(*) = 0 then null
              else array_agg(e order by array_position(array['ES', 'BA', 'RJ', 'OUTRAS']::text[], e)) end
    from (select distinct upper(btrim(x)) as e from unnest(coalesce(p, '{}'::text[])) x where coalesce(btrim(x), '') <> '') s;
$$;
revoke execute on function public.sup_estados_limpos(text[]) from public, anon;
grant execute on function public.sup_estados_limpos(text[]) to authenticated, service_role;

-- --------------------------------------------------------------------------- quem sou eu (o app e a API leem daqui)
create or replace function public.sup_meu_acesso()
returns json
language plpgsql
stable security definer
set search_path to 'public'
as $function$
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
    -- gestor pelo Painel: todas as regiões
    return json_build_object('situacao', 'liberado', 'tipo', 'gerente', 'nome', v_perfil.nome, 'email', v_perfil.email,
                             'admin', coalesce(v_perfil.is_admin, false), 'origem', 'painel', 'estados', null);
  end if;
  if v_conta.id is not null then
    return json_build_object('situacao', v_conta.situacao, 'tipo', v_conta.tipo, 'nome', v_conta.nome, 'email', v_conta.email,
                             'codusur', v_conta.codusur, 'codsupervisor', v_conta.codsupervisor,
                             'estados', case when v_conta.tipo = 'gerente' then v_conta.estados end,
                             'admin', false, 'origem', 'app');
  end if;
  return json_build_object('situacao', 'sem_cadastro', 'corporativo', v_perfil.id is not null);
end;
$function$;

-- --------------------------------------------------------------------------- convite leva os estados do gestor
create or replace function public.sup_aplicar_convite(p_user uuid, p_email text, p_codigo text, p_conferir boolean default true)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  insert into public.sup_usuarios (id, email, nome, tipo, codusur, codsupervisor, estados, situacao, decidido_em, decidido_por)
  values (p_user, v.email, v.nome, v.tipo, null, case when v.tipo = 'supervisor' then v.codsupervisor end,
          case when v.tipo = 'gerente' then v.estados end, 'liberado', now(), v.criado_por)
  on conflict (id) do update
     set tipo = excluded.tipo, codusur = null, codsupervisor = excluded.codsupervisor, estados = excluded.estados,
         situacao = 'liberado', decidido_em = now(), decidido_por = excluded.decidido_por,
         nome = coalesce(nullif(public.sup_usuarios.nome, ''), excluded.nome);
  update public.sup_convites set situacao = 'usado', usado_em = now(), usado_por = p_user where email = v.email;
  insert into public.sup_acessos (user_id, email, acao, detalhe)
  values (p_user, v.email, 'convite', 'liberado: ' || v.tipo || coalesce(' setor ' || v.codsupervisor, '')
                                       || case when v.tipo = 'gerente' then ' ' || coalesce(array_to_string(v.estados, ','), 'todas') else '' end);
  return true;
end;
$function$;

-- a assinatura muda (p_estados): sai a antiga para o PostgREST não ficar com duas
drop function if exists public.sup_convidar(text, text, integer, text);
create function public.sup_convidar(p_email text, p_nome text, p_codsupervisor integer, p_tipo text default 'supervisor',
                                    p_estados text[] default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_tipo    text := case when p_tipo = 'gerente' then 'gerente' else 'supervisor' end;
  v_estados text[] := case when p_tipo = 'gerente' then public.sup_estados_limpos(p_estados) end;
  v_codigo  text := lpad((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0');
  v_user    uuid;
  v_lib     boolean := false;
begin
  if not public.is_admin() then
    raise exception 'Só o administrador do Painel cadastra supervisores.' using errcode = '42501';
  end if;
  if v_tipo = 'supervisor' and p_codsupervisor is null then
    raise exception 'Escolha a região do supervisor.' using errcode = '22023';
  end if;
  if v_estados is not null and not (v_estados <@ array['ES', 'BA', 'RJ', 'OUTRAS']::text[]) then
    raise exception 'Estado inválido: use ES, BA, RJ ou OUTRAS.' using errcode = '22023';
  end if;
  insert into public.sup_convites (email, nome, tipo, codsupervisor, estados, codigo_hash, criado_por)
  values (v_email, left(btrim(p_nome), 120), v_tipo, case when v_tipo = 'supervisor' then p_codsupervisor end, v_estados,
          extensions.crypt(v_codigo, extensions.gen_salt('bf', 8)), auth.uid())
  on conflict (email) do update
     set nome = excluded.nome, tipo = excluded.tipo, codsupervisor = excluded.codsupervisor, estados = excluded.estados,
         codigo_hash = excluded.codigo_hash, tentativas = 0, situacao = 'aguardando',
         criado_em = now(), criado_por = excluded.criado_por, usado_em = null, usado_por = null;
  insert into public.sup_acessos (user_id, email, acao, detalhe)
  select auth.uid(), lower(u.email), 'convite',
         left(v_email || ': ' || v_tipo || coalesce(' setor ' || p_codsupervisor, '')
              || case when v_tipo = 'gerente' then ' ' || coalesce(array_to_string(v_estados, ','), 'todas') else '' end, 300)
    from auth.users u where u.id = auth.uid();
  select u.id into v_user from auth.users u where lower(u.email) = v_email;
  if v_user is not null then
    v_lib := public.sup_aplicar_convite(v_user, v_email, null, false);
  end if;
  return json_build_object('ok', true, 'liberou', v_lib, 'codigo', case when v_lib then null else v_codigo end);
end;
$function$;
revoke execute on function public.sup_convidar(text, text, integer, text, text[]) from public, anon;
grant execute on function public.sup_convidar(text, text, integer, text, text[]) to authenticated, service_role;
