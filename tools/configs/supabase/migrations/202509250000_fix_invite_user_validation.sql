-- Fix org_invite to validate user exists before creating invitation

create or replace function public.org_invite(p_organization uuid, p_email text)
returns uuid language plpgsql security definer as $$
declare v_id uuid; v_user_exists boolean;
begin
  -- Check if user with this email exists
  select exists(select 1 from public.users where lower(email) = lower(p_email)) into v_user_exists;
  
  if not v_user_exists then
    raise exception 'User does not exist' using errcode = 'P0001';
  end if;
  
  insert into public.organization_invitations (organization_id, email, invited_by)
  values (p_organization, lower(p_email), auth.uid())
  returning id into v_id;
  return v_id;
end; $$;
revoke all on function public.org_invite(uuid, text) from public;
grant execute on function public.org_invite(uuid, text) to authenticated;

