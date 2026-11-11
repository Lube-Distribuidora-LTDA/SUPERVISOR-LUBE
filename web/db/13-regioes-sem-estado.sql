-- =============================================================================
-- 13-regioes-sem-estado.sql — 1.11.7 (2026-11-11): as regiões SEM estado no nome se escolhem uma por uma
-- (Júlio: "a que é outras precisa aparecer pra selecionar elas").
--
-- Banco do PAINEL (login). Migração supervisor_lube_regioes_sem_estado.
--   sup_usuarios.estados / sup_convites.estados passam a aceitar, além de ES, BA, RJ e OUTRAS, a região pelo código
--   ("S3" = LUBE DISTRIBUIDORA, "S2" = ADMINISTRAÇÃO...). Quem decide o que cada item libera é a API (api/_estados.js).
-- =============================================================================

alter table public.sup_usuarios drop constraint if exists sup_usuarios_estados_check;
alter table public.sup_usuarios add constraint sup_usuarios_estados_check
  check (estados is null or (cardinality(estados) between 1 and 40
         and array_to_string(estados, ',') ~ '^(ES|BA|RJ|OUTRAS|S[0-9]{1,6})(,(ES|BA|RJ|OUTRAS|S[0-9]{1,6}))*$'));
alter table public.sup_convites drop constraint if exists sup_convites_estados_check;
alter table public.sup_convites add constraint sup_convites_estados_check
  check (estados is null or (cardinality(estados) between 1 and 40
         and array_to_string(estados, ',') ~ '^(ES|BA|RJ|OUTRAS|S[0-9]{1,6})(,(ES|BA|RJ|OUTRAS|S[0-9]{1,6}))*$'));

comment on column public.sup_usuarios.estados is
  'Supervisor Lube 1.11.6/1.11.7: o que o GESTOR vê: ES, BA, RJ (regiões com o estado no nome), S<código> (uma região sem estado, ex. S3 = LUBE DISTRIBUIDORA) ou OUTRAS (todas as sem estado). Nulo = todas as regiões.';
comment on column public.sup_convites.estados is
  'Supervisor Lube 1.11.6/1.11.7: o que o gestor convidado vai ver (mesmos valores de sup_usuarios.estados). Nulo = todas.';

-- limpa: maiúsculos, sem repetição; ES, BA, RJ, OUTRAS primeiro e as regiões S<cód> em ordem de código; vazio = nulo
create or replace function public.sup_estados_limpos(p text[])
returns text[]
language sql
immutable
set search_path to 'public'
as $$
  select case when count(*) = 0 then null
              else array_agg(e order by coalesce(array_position(array['ES', 'BA', 'RJ', 'OUTRAS']::text[], e), 9),
                                        case when e ~ '^S[0-9]{1,6}$' then substr(e, 2)::integer end, e) end
    from (select distinct upper(btrim(x)) as e from unnest(coalesce(p, '{}'::text[])) x where coalesce(btrim(x), '') <> '') s;
$$;

-- o convite confere os itens com a mesma regra da tabela (a mensagem fala das duas formas)
create or replace function public.sup_convidar(p_email text, p_nome text, p_codsupervisor integer, p_tipo text default 'supervisor',
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
  if v_estados is not null and (cardinality(v_estados) > 40
     or array_to_string(v_estados, ',') !~ '^(ES|BA|RJ|OUTRAS|S[0-9]{1,6})(,(ES|BA|RJ|OUTRAS|S[0-9]{1,6}))*$') then
    raise exception 'Estado ou região inválida: use ES, BA, RJ ou a região sem estado.' using errcode = '22023';
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
