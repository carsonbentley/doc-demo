-- Team / invite RPCs aligned with defense_demo_baseline schema (teams + team_invitations).
-- Supersedes legacy migrations that assumed an older org/team rename path.

create extension if not exists pgcrypto;

alter table if exists public.teams
  add column if not exists password_hash text;

-- Optional team password join flow (username on public.teams.username)
create or replace function public.team_join(p_username text, p_password text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_hash text;
begin
  select id, password_hash into v_team_id, v_hash
  from public.teams
  where username = p_username;

  if v_team_id is null then
    raise exception 'team not found' using errcode = '22000';
  end if;

  if v_hash is null or crypt(p_password, v_hash) is distinct from v_hash then
    raise exception 'invalid team password' using errcode = '28000';
  end if;

  update public.users
    set team_id = v_team_id
  where id = auth.uid();

  return json_build_object('team_id', v_team_id);
end;
$$;

revoke all on function public.team_join(text, text) from public;
grant execute on function public.team_join(text, text) to authenticated;

create or replace function public.team_create_no_password(p_name text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
begin
  insert into public.teams (name, owner_id)
  values (p_name, auth.uid())
  returning id into v_team_id;

  update public.users
    set team_id = v_team_id
  where id = auth.uid();

  return json_build_object('team_id', v_team_id);
end;
$$;

revoke all on function public.team_create_no_password(text) from public;
grant execute on function public.team_create_no_password(text) to authenticated;

create or replace function public.team_invite(p_email text, p_team text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_invite_id uuid;
begin
  select t.id into v_team_id
  from public.teams t
  join public.users u on u.team_id = t.id and u.id = auth.uid()
  where t.name = p_team;

  if v_team_id is null then
    raise exception 'team not found' using errcode = '22000';
  end if;

  insert into public.team_invitations (team_id, email)
  values (v_team_id, lower(p_email))
  returning id into v_invite_id;

  return json_build_object('invite_id', v_invite_id);
end;
$$;

revoke all on function public.team_invite(text, text) from public;
grant execute on function public.team_invite(text, text) to authenticated;

create or replace function public.team_accept_invite(p_invite_id text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv uuid;
  v_team_id uuid;
  v_user_email text;
begin
  v_inv := p_invite_id::uuid;

  select email into v_user_email
  from public.users
  where id = auth.uid();

  select team_id into v_team_id
  from public.team_invitations
  where id = v_inv
    and lower(email) = lower(v_user_email)
    and status = 'pending';

  if v_team_id is null then
    raise exception 'invitation not found or already processed' using errcode = '22000';
  end if;

  update public.users
    set team_id = v_team_id
  where id = auth.uid();

  update public.team_invitations
    set status = 'accepted'
  where id = v_inv;

  return json_build_object('team_id', v_team_id);
end;
$$;

revoke all on function public.team_accept_invite(text) from public;
grant execute on function public.team_accept_invite(text) to authenticated;

create or replace function public.team_leave()
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users
    set team_id = null
  where id = auth.uid();

  return json_build_object('ok', true);
end;
$$;

revoke all on function public.team_leave() from public;
grant execute on function public.team_leave() to authenticated;

-- Kept for API compatibility with older clients (maps to team invitation decline).
create or replace function public.org_decline_invite(p_invite_id text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv uuid;
  v_user_email text;
  n int;
begin
  v_inv := p_invite_id::uuid;

  select email into v_user_email
  from public.users
  where id = auth.uid();

  update public.team_invitations
  set status = 'declined'
  where id = v_inv
    and lower(email) = lower(v_user_email)
    and status = 'pending';

  get diagnostics n = row_count;
  return json_build_object('ok', n > 0);
end;
$$;

revoke all on function public.org_decline_invite(text) from public;
grant execute on function public.org_decline_invite(text) to authenticated;
