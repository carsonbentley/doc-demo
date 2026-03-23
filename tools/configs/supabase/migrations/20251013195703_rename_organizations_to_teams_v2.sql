-- Rename organizations table to teams and update all references
-- This migration renames the organizations table to teams and updates all foreign key references

-- 1. Rename the organizations table to teams
ALTER TABLE public.organizations RENAME TO teams;

-- 2. Update foreign key constraints and column names
-- Rename organization_id columns to team_id in all tables that reference organizations

-- Update users table
ALTER TABLE public.users RENAME COLUMN organization_id TO team_id;

-- Update projects table  
ALTER TABLE public.projects RENAME COLUMN organization_id TO team_id;

-- Update organization_invitations table (rename to team_invitations)
ALTER TABLE public.organization_invitations RENAME TO team_invitations;
ALTER TABLE public.team_invitations RENAME COLUMN organization_id TO team_id;

-- 3. Update foreign key constraint names and references
-- Drop existing foreign key constraints
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_organization_id_fkey;
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_organization_id_fkey;
ALTER TABLE public.team_invitations DROP CONSTRAINT IF EXISTS organization_invitations_organization_id_fkey;

-- Add new foreign key constraints
ALTER TABLE public.users 
  ADD CONSTRAINT users_team_id_fkey 
  FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE SET NULL;

ALTER TABLE public.projects 
  ADD CONSTRAINT projects_team_id_fkey 
  FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE public.team_invitations 
  ADD CONSTRAINT team_invitations_team_id_fkey 
  FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

-- 4. Update RLS policies to reference teams instead of organizations
-- Drop existing policies
DROP POLICY IF EXISTS "projects_org_members_select" ON public.projects;
DROP POLICY IF EXISTS "projects_org_members_modify" ON public.projects;
DROP POLICY IF EXISTS "grant_sections_org_members_select" ON public.grant_sections;
DROP POLICY IF EXISTS "grant_sections_org_members_modify" ON public.grant_sections;
DROP POLICY IF EXISTS "organization_invitations_org_admins_select" ON public.team_invitations;
DROP POLICY IF EXISTS "organization_invitations_invited_user_select" ON public.team_invitations;
DROP POLICY IF EXISTS "organization_invitations_org_admins_insert" ON public.team_invitations;
DROP POLICY IF EXISTS "organization_invitations_org_admins_update" ON public.team_invitations;
DROP POLICY IF EXISTS "organization_invitations_org_admins_delete" ON public.team_invitations;

-- Create new policies for teams
CREATE POLICY "projects_team_members_select"
ON public.projects FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.users u
  WHERE u.id = auth.uid() AND u.team_id = projects.team_id
));

CREATE POLICY "projects_team_members_modify"
ON public.projects FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.users u
  WHERE u.id = auth.uid() AND u.team_id = projects.team_id
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.users u
  WHERE u.id = auth.uid() AND u.team_id = projects.team_id
));

CREATE POLICY "grant_sections_team_members_select"
ON public.grant_sections FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.users u
  JOIN public.projects p ON p.team_id = u.team_id
  WHERE u.id = auth.uid() AND p.id = grant_sections.project_id
));

CREATE POLICY "grant_sections_team_members_modify"
ON public.grant_sections FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.users u
  JOIN public.projects p ON p.team_id = u.team_id
  WHERE u.id = auth.uid() AND p.id = grant_sections.project_id
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.users u
  JOIN public.projects p ON p.team_id = u.team_id
  WHERE u.id = auth.uid() AND p.id = grant_sections.project_id
));

-- Team invitations policies
CREATE POLICY "team_invitations_team_admins_select"
ON public.team_invitations FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1
  FROM public.users u_inviter
  JOIN public.users u_self ON u_self.id = auth.uid()
  WHERE u_inviter.id = team_invitations.invited_by
    AND u_inviter.team_id = u_self.team_id
    AND u_self.role = 'administrator'
));

CREATE POLICY "team_invitations_invited_user_select"
ON public.team_invitations FOR SELECT TO authenticated
USING (LOWER(email) = LOWER((SELECT email FROM public.users WHERE id = auth.uid())));

CREATE POLICY "team_invitations_team_admins_insert"
ON public.team_invitations FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1
  FROM public.users u_inviter
  JOIN public.users u_self ON u_self.id = auth.uid()
  WHERE u_inviter.id = team_invitations.invited_by
    AND u_inviter.team_id = u_self.team_id
    AND u_self.role = 'administrator'
));

CREATE POLICY "team_invitations_team_admins_update"
ON public.team_invitations FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1
  FROM public.users u_inviter
  JOIN public.users u_self ON u_self.id = auth.uid()
  WHERE u_inviter.id = team_invitations.invited_by
    AND u_inviter.team_id = u_self.team_id
    AND u_self.role = 'administrator'
));

CREATE POLICY "team_invitations_team_admins_delete"
ON public.team_invitations FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1
  FROM public.users u_inviter
  JOIN public.users u_self ON u_self.id = auth.uid()
  WHERE u_inviter.id = team_invitations.invited_by
    AND u_inviter.team_id = u_self.team_id
    AND u_self.role = 'administrator'
));

-- 5. Update RPC functions to use teams instead of organizations
-- Drop existing functions
DROP FUNCTION IF EXISTS public.org_create(text, text, text);
DROP FUNCTION IF EXISTS public.org_join(text, text);
DROP FUNCTION IF EXISTS public.org_create_no_password(text);
DROP FUNCTION IF EXISTS public.org_invite(text, text);
DROP FUNCTION IF EXISTS public.org_accept_invite(text);
DROP FUNCTION IF EXISTS public.org_decline_invite(text);
DROP FUNCTION IF EXISTS public.org_leave();
DROP FUNCTION IF EXISTS public.get_org_members();

-- Create team-based functions
CREATE OR REPLACE FUNCTION public.team_create(p_name text, p_username text, p_password text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_team_id uuid;
BEGIN
  INSERT INTO public.teams (name, username, password_hash, owner_id)
  VALUES (p_name, p_username, crypt(p_password, gen_salt('bf')), auth.uid())
  RETURNING id INTO v_team_id;

  UPDATE public.users
    SET team_id = v_team_id
  WHERE id = auth.uid();

  RETURN v_team_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.team_join(p_username text, p_password text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_team_id uuid;
  v_hash text;
BEGIN
  SELECT id, password_hash INTO v_team_id, v_hash
  FROM public.teams
  WHERE username = p_username;

  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'team not found' USING ERRCODE = '22000';
  END IF;

  IF v_hash IS NULL OR crypt(p_password, v_hash) <> v_hash THEN
    RAISE EXCEPTION 'invalid team password' USING ERRCODE = '28000';
  END IF;

  UPDATE public.users
    SET team_id = v_team_id
  WHERE id = auth.uid();

  RETURN v_team_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.team_create_no_password(p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_team_id uuid;
BEGIN
  INSERT INTO public.teams (name, owner_id)
  VALUES (p_name, auth.uid())
  RETURNING id INTO v_team_id;

  UPDATE public.users
    SET team_id = v_team_id
  WHERE id = auth.uid();

  RETURN v_team_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.team_invite(p_email text, p_team text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_team_id uuid;
  v_invite_id text;
BEGIN
  -- Get team ID by name
  SELECT id INTO v_team_id
  FROM public.teams
  WHERE name = p_team;

  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'team not found' USING ERRCODE = '22000';
  END IF;

  -- Create invitation
  INSERT INTO public.team_invitations (team_id, email, invited_by)
  VALUES (v_team_id, p_email, auth.uid())
  RETURNING id INTO v_invite_id;

  RETURN v_invite_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.team_accept_invite(p_invite_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_team_id uuid;
  v_user_email text;
BEGIN
  -- Get user email
  SELECT email INTO v_user_email
  FROM public.users
  WHERE id = auth.uid();

  -- Get team ID from invitation
  SELECT team_id INTO v_team_id
  FROM public.team_invitations
  WHERE id = p_invite_id AND email = v_user_email AND status = 'pending';

  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'invitation not found or already processed' USING ERRCODE = '22000';
  END IF;

  -- Update user's team
  UPDATE public.users
    SET team_id = v_team_id
  WHERE id = auth.uid();

  -- Update invitation status
  UPDATE public.team_invitations
    SET status = 'accepted'
  WHERE id = p_invite_id;

  RETURN v_team_id::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.team_decline_invite(p_invite_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_email text;
BEGIN
  -- Get user email
  SELECT email INTO v_user_email
  FROM public.users
  WHERE id = auth.uid();

  -- Update invitation status
  UPDATE public.team_invitations
    SET status = 'declined'
  WHERE id = p_invite_id AND email = v_user_email AND status = 'pending';

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.team_leave()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.users
    SET team_id = NULL
  WHERE id = auth.uid();

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_team_members()
RETURNS TABLE(
  user_id text,
  email text,
  first_name text,
  last_name text,
  role org_role,
  created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    u.id::text,
    u.email,
    u.first_name,
    u.last_name,
    u.role,
    u.created_at
  FROM public.users u
  WHERE u.team_id = (SELECT team_id FROM public.users WHERE id = auth.uid());
END;
$$;

-- Grant permissions
REVOKE ALL ON FUNCTION public.team_create(text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.team_create(text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.team_join(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.team_join(text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.team_create_no_password(text) FROM public;
GRANT EXECUTE ON FUNCTION public.team_create_no_password(text) TO authenticated;

REVOKE ALL ON FUNCTION public.team_invite(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.team_invite(text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.team_accept_invite(text) FROM public;
GRANT EXECUTE ON FUNCTION public.team_accept_invite(text) TO authenticated;

REVOKE ALL ON FUNCTION public.team_decline_invite(text) FROM public;
GRANT EXECUTE ON FUNCTION public.team_decline_invite(text) TO authenticated;

REVOKE ALL ON FUNCTION public.team_leave() FROM public;
GRANT EXECUTE ON FUNCTION public.team_leave() TO authenticated;

REVOKE ALL ON FUNCTION public.get_team_members() FROM public;
GRANT EXECUTE ON FUNCTION public.get_team_members() TO authenticated;
