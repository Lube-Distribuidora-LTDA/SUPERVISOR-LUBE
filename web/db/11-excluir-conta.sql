-- 11-excluir-conta.sql — botão Excluir da tela Acessos (app 1.11.5), no Supabase do PAINEL LUBE DISTRIBUIDORA.
--
-- Pedido do Júlio (2026-11-11): depois de pedir para apagar uma conta recusada ("preciso excluir essa ai"), aceitou o
-- botão Excluir na tela Acessos para contas recusadas e bloqueadas ("show pode fazer então").
-- Migração: supervisor_lube_excluir_conta.
--
-- Regras:
--   * só o administrador do Painel (public.is_admin());
--   * só conta RECUSADA ou BLOQUEADA (pendente: recusar antes; liberada: bloquear antes);
--   * o LOGIN (auth.users) só sai se for só do app: sem perfil no Painel (profiles) e sem conta no SAC (sac_usuarios).
--     Com perfil ou SAC, sai só a conta do app (sup_usuarios) e a pessoa continua entrando no Painel/SAC;
--   * o histórico fica: as linhas de sup_acessos da pessoa perdem o user_id (ficam com o e-mail) e entra uma linha
--     'decisao' de quem excluiu ("<email>: excluída (...)"), no formato do sup_registrar;
--   * se a pessoa fizer o Primeiro acesso de novo, nasce outra conta pendente.

create or replace function public.sup_excluir_conta(p_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v       public.sup_usuarios;
  v_login boolean;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Só o administrador do Painel exclui contas do app.' using errcode = '42501';
  end if;
  select * into v from public.sup_usuarios where id = p_id;
  if v.id is null then
    return json_build_object('ok', false, 'mensagem', 'Conta não encontrada (já foi excluída?).');
  end if;
  if v.situacao not in ('recusado', 'bloqueado') then
    return json_build_object('ok', false, 'mensagem', 'Só conta recusada ou bloqueada pode ser excluída. Recuse ou bloqueie antes.');
  end if;

  v_login := not exists (select 1 from public.profiles p where p.id = p_id)
         and not exists (select 1 from public.sac_usuarios s where s.id = p_id);

  insert into public.sup_acessos (user_id, email, acao, detalhe)
  select auth.uid(), lower(u.email), 'decisao',
         left(v.email || ': excluída (' ||
              case when v_login then 'conta do app e login' else 'só a conta do app; o login fica, é usado no Painel ou no SAC' end ||
              '); estava ' || v.situacao, 300)
    from auth.users u where u.id = auth.uid();

  if v_login then
    -- referências sem cascata: o histórico fica, sem o vínculo com o login apagado
    update public.sup_acessos  set user_id   = null where user_id   = p_id;
    update public.sac_acessos  set user_id   = null where user_id   = p_id;
    update public.sup_convites set usado_por = null where usado_por = p_id;
    delete from auth.users where id = p_id;          -- leva sup_usuarios junto (cascata)
  else
    delete from public.sup_usuarios where id = p_id;
  end if;

  return json_build_object('ok', true, 'email', v.email, 'login', v_login);
end;
$$;

revoke all on function public.sup_excluir_conta(uuid) from public, anon;
grant execute on function public.sup_excluir_conta(uuid) to authenticated;

comment on function public.sup_excluir_conta(uuid) is
  'App SUPERVISOR LUBE 1.11.5: o administrador exclui conta recusada ou bloqueada; o login só sai se for só do app.';
