-- RPC-based org password handling using Postgres pgcrypto

create extension if not exists pgcrypto;

alter table if exists public.organizations
  add column if not exists username text unique,
  add column if not exists password_hash text;

-- Create organization and assign current user (uses Supabase Auth session)
create or replace function public.org_create(p_name text, p_username text, p_password text)
returns uuid
language plpgsql
security definer
as $$
declare
  v_org_id uuid;
begin
  insert into public.organizations (name, username, password_hash, owner_id)
  values (p_name, p_username, crypt(p_password, gen_salt('bf')), auth.uid())
  returning id into v_org_id;

  update public.users
    set organization_id = v_org_id
  where id = auth.uid();

  return v_org_id;
end;
$$;

revoke all on function public.org_create(text, text, text) from public;
grant execute on function public.org_create(text, text, text) to authenticated;

-- Join organization by username+password
create or replace function public.org_join(p_username text, p_password text)
returns uuid
language plpgsql
security definer
as $$
declare
  v_org_id uuid;
  v_hash text;
begin
  select id, password_hash into v_org_id, v_hash
  from public.organizations
  where username = p_username;

  if v_org_id is null then
    raise exception 'organization not found' using errcode = '22000';
  end if;

  if v_hash is null or crypt(p_password, v_hash) <> v_hash then
    raise exception 'invalid organization password' using errcode = '28000';
  end if;

  update public.users
    set organization_id = v_org_id
  where id = auth.uid();

  return v_org_id;
end;
$$;

revoke all on function public.org_join(text, text) from public;
grant execute on function public.org_join(text, text) to authenticated;


