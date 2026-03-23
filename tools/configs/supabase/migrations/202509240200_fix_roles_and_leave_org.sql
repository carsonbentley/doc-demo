-- Force invite acceptors to be members; add org_leave safeguard

-- 1) Ensure invite accept sets role = 'member'
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

  update public.users
    set organization_id = v_org,
        role = 'member'
  where id = auth.uid();

  update public.organization_invitations set status = 'accepted'
  where id = p_invite_id;

  return v_org;
end; $$;
revoke all on function public.org_accept_invite(uuid) from public;
grant execute on function public.org_accept_invite(uuid) to authenticated;

-- 2) org_leave: if admin leaves, attempt to delete org (and all invites) safely
-- Will delete the organization only if the caller is an administrator AND there are no projects tied to the org.
-- Otherwise, it will just remove the user from the org (set organization_id null, role null).
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
revoke all on function public.org_leave() from public;
grant execute on function public.org_leave() to authenticated;


