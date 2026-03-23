-- Org invites, remove org passwords, add user roles

-- Drop org password fields
alter table if exists public.organizations
  drop column if exists password_hash,
  drop column if exists username;

-- Add org_role enum and users.role column
do $$
begin
  if not exists (select 1 from pg_type where typname = 'org_role') then
    create type org_role as enum ('member','administrator');
  end if;
end$$;

alter table if exists public.users
  add column if not exists role org_role;

-- Invitations table
create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  status text not null default 'pending', -- pending | accepted | declined | cancelled
  invited_by uuid not null,
  created_at timestamp with time zone default now()
);

alter table if exists public.organization_invitations enable row level security;

-- Policies
drop policy if exists organization_invitations_org_admins_select on public.organization_invitations;
create policy organization_invitations_org_admins_select
on public.organization_invitations for select to authenticated
using (exists (
  select 1
  from public.users u_inviter
  join public.users u_self on u_self.id = auth.uid()
  where u_inviter.id = organization_invitations.invited_by
    and u_inviter.organization_id = u_self.organization_id
    and u_self.role = 'administrator'
));

drop policy if exists organization_invitations_invited_user_select on public.organization_invitations;
create policy organization_invitations_invited_user_select
on public.organization_invitations for select to authenticated
using (lower(email) = lower((select email from public.users where id = auth.uid())));

drop policy if exists organization_invitations_org_admins_insert on public.organization_invitations;
create policy organization_invitations_org_admins_insert
on public.organization_invitations for insert to authenticated
with check (exists (
  select 1 from public.users u_self
  where u_self.id = auth.uid()
    and u_self.organization_id = organization_invitations.organization_id
    and u_self.role = 'administrator'
));

drop policy if exists organization_invitations_invited_user_update on public.organization_invitations;
create policy organization_invitations_invited_user_update
on public.organization_invitations for update to authenticated
using (lower(email) = lower((select email from public.users where id = auth.uid())))
with check (lower(email) = lower((select email from public.users where id = auth.uid())));

drop policy if exists organization_invitations_org_admins_update on public.organization_invitations;
create policy organization_invitations_org_admins_update
on public.organization_invitations for update to authenticated
using (exists (
  select 1
  from public.users u_inviter
  join public.users u_self on u_self.id = auth.uid()
  where u_inviter.id = organization_invitations.invited_by
    and u_inviter.organization_id = u_self.organization_id
    and u_self.role = 'administrator'
))
with check (true);

create index if not exists idx_org_invitations_email on public.organization_invitations(lower(email));
create index if not exists idx_org_invitations_org on public.organization_invitations(organization_id);

-- RPCs (no password flows)
create or replace function public.org_create_no_password(p_name text)
returns uuid language plpgsql security definer as $$
declare v_org_id uuid;
begin
  insert into public.organizations (name, owner_id)
  values (p_name, auth.uid())
  returning id into v_org_id;

  update public.users
    set organization_id = v_org_id, role = 'administrator'
  where id = auth.uid();

  return v_org_id;
end; $$;
revoke all on function public.org_create_no_password(text) from public;
grant execute on function public.org_create_no_password(text) to authenticated;

create or replace function public.org_invite(p_organization uuid, p_email text)
returns uuid language plpgsql security definer as $$
declare v_id uuid;
begin
  insert into public.organization_invitations (organization_id, email, invited_by)
  values (p_organization, lower(p_email), auth.uid())
  returning id into v_id;
  return v_id;
end; $$;
revoke all on function public.org_invite(uuid, text) from public;
grant execute on function public.org_invite(uuid, text) to authenticated;

create or replace function public.org_accept_invite(p_invite_id uuid)
returns uuid language plpgsql security definer as $$
declare v_org uuid; v_email text;
begin
  select organization_id, email into v_org, v_email
  from public.organization_invitations
  where id = p_invite_id and status = 'pending';

  if v_org is null then
    raise exception 'invalid or non-pending invite';
  end if;

  if lower(v_email) <> lower((select email from public.users where id = auth.uid())) then
    raise exception 'invite email does not match current user';
  end if;

  update public.users set organization_id = v_org, role = coalesce(role, 'member')
  where id = auth.uid();

  update public.organization_invitations set status = 'accepted'
  where id = p_invite_id;

  return v_org;
end; $$;
revoke all on function public.org_accept_invite(uuid) from public;
grant execute on function public.org_accept_invite(uuid) to authenticated;

create or replace function public.org_decline_invite(p_invite_id uuid)
returns boolean language plpgsql security definer as $$
declare v_email text;
begin
  select email into v_email from public.organization_invitations where id = p_invite_id and status = 'pending';
  if v_email is null then
    return false;
  end if;
  if lower(v_email) <> lower((select email from public.users where id = auth.uid())) then
    raise exception 'invite email does not match current user';
  end if;
  update public.organization_invitations set status = 'declined' where id = p_invite_id;
  return true;
end; $$;
revoke all on function public.org_decline_invite(uuid) from public;
grant execute on function public.org_decline_invite(uuid) to authenticated;


