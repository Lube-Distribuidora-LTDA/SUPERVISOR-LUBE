-- =============================================================================
-- 15-editar-convite.sql — 1.11.9 (2026-11-12): editar o convite pendente (Júlio: "eu gostaria de editar as regiões
-- que eu enviei o convite e que estão pendentes").
--
-- Banco do PAINEL (login). Migração supervisor_lube_editar_convite.
--   sup_convites só se escreve por função (04-convites-painel.sql). sup_editar_convite troca o perfil, a região do
--   supervisor ou o que o gestor vê de um convite AINDA AGUARDANDO, sem gerar código novo: o código que a pessoa
--   recebeu no WhatsApp continua valendo, e as tentativas e a data do convite ficam como estão. Só o administrador.
--   Convite já usado não muda aqui: a conta se muda em Contas › Liberados (sup_usuarios).
-- =============================================================================

create or replace function public.sup_editar_convite(p_email text, p_tipo text, p_codsupervisor integer,
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
  v_cod     integer := case when p_tipo = 'gerente' then null else p_codsupervisor end;
  v         public.sup_convites;
begin
  if not public.is_admin() then
    raise exception 'Só o administrador do Painel muda o convite.' using errcode = '42501';
  end if;
  if v_tipo = 'supervisor' and v_cod is null then
    return json_build_object('ok', false, 'mensagem', 'Escolha a região do supervisor.');
  end if;
  if v_estados is not null and (cardinality(v_estados) > 40
     or array_to_string(v_estados, ',') !~ '^(ES|BA|RJ|OUTRAS|S[0-9]{1,6})(,(ES|BA|RJ|OUTRAS|S[0-9]{1,6}))*$') then
    return json_build_object('ok', false, 'mensagem', 'Estado ou região inválida: use ES, BA, RJ ou a região sem estado.');
  end if;
  select * into v from public.sup_convites where email = v_email for update;
  if not found or v.situacao <> 'aguardando' then
    return json_build_object('ok', false, 'mensagem',
      case when found and v.situacao = 'usado'
           then 'Esse convite já foi usado: a conta já existe. Mude em Contas › Liberados.'
           else 'Convite não encontrado (foi cancelado?). Atualize a tela.' end);
  end if;
  if v.tipo = v_tipo and v.codsupervisor is not distinct from v_cod and v.estados is not distinct from v_estados then
    return json_build_object('ok', true, 'mudou', false);
  end if;
  update public.sup_convites set tipo = v_tipo, codsupervisor = v_cod, estados = v_estados where email = v_email;
  insert into public.sup_acessos (user_id, email, acao, detalhe)
  select auth.uid(), lower(u.email), 'convite',
         left(v_email || ': convite alterado, era ' || v.tipo || coalesce(' setor ' || v.codsupervisor, '')
              || case when v.tipo = 'gerente' then ' ' || coalesce(array_to_string(v.estados, ','), 'todas') else '' end
              || ', agora ' || v_tipo || coalesce(' setor ' || v_cod, '')
              || case when v_tipo = 'gerente' then ' ' || coalesce(array_to_string(v_estados, ','), 'todas') else '' end
              || ' (mesmo código)', 300)
    from auth.users u where u.id = auth.uid();
  return json_build_object('ok', true, 'mudou', true);
end;
$function$;
revoke execute on function public.sup_editar_convite(text, text, integer, text[]) from public, anon;
grant execute on function public.sup_editar_convite(text, text, integer, text[]) to authenticated, service_role;
comment on function public.sup_editar_convite(text, text, integer, text[]) is
  'Supervisor Lube 1.11.9: muda perfil, região ou estados de um convite aguardando, mantendo o código. Só administrador.';
