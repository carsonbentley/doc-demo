-- Remove password_hash column and add members list functionality

-- 1) Drop password_hash column (if it exists)
alter table if exists public.organizations drop column if exists password_hash;

-- 2) Update org_leave to handle invitations cleanup properly
create or replace function public.org_leave()
returns boolean language plpgsql security definer as $$
declare v_org uuid; v_is_admin boolean; v_projects int;
begin
  select organization_id, (role = 'administrator') into v_org, v_is_admin
  from public.users where id = auth.uid();

  if v_org is null then
    return true; -- already not in org
  end if;

  if v_is_admin then
    -- Check for dependent projects; if none, delete org (invites cascade on org delete)
    select count(*) into v_projects from public.projects where organization_id = v_org;
    if v_projects = 0 then
      -- remove admin from org first to avoid FK issues
      update public.users set organization_id = null, role = null where id = auth.uid();
      delete from public.organizations where id = v_org;
      return true;
    end if;
    -- If projects exist, keep org; just remove admin's membership and role
    update public.users set organization_id = null, role = null where id = auth.uid();
    return true;
  else
    -- Non-admin: just leave org
    update public.users set organization_id = null, role = null where id = auth.uid();
    return true;
  end if;
end; $$;

-- 3) Function to get organization members
create or replace function public.get_org_members()
returns table (
  user_id uuid,
  email text,
  role org_role,
  created_at timestamp with time zone
) language plpgsql security definer as $$
declare v_org_id uuid;
begin
  select organization_id into v_org_id from public.users where id = auth.uid();
  
  if v_org_id is null then
    return; -- user not in org
  end if;

  return query
  select u.id, u.email, u.role, u.created_at
  from public.users u
  where u.organization_id = v_org_id
  order by u.created_at;
end; $$;

revoke all on function public.get_org_members() from public;
grant execute on function public.get_org_members() to authenticated;
