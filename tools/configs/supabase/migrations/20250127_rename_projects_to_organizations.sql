-- Rename projects table to organizations and update all references

-- 1. Rename the projects table to organizations
ALTER TABLE public.projects RENAME TO organizations;

-- 2. Update foreign key constraints and column names
-- Rename project_id columns to organization_id in all tables that reference projects

-- Update grant_sections table
ALTER TABLE public.grant_sections RENAME COLUMN project_id TO organization_id;

-- Update project_check_settings table
ALTER TABLE public.project_check_settings RENAME COLUMN project_id TO organization_id;

-- Update requirement_results table  
ALTER TABLE public.requirement_results RENAME COLUMN project_id TO organization_id;

-- Update ai_feedback table
ALTER TABLE public.ai_feedback RENAME COLUMN project_id TO organization_id;

-- 3. Update foreign key constraint names and references
-- Drop existing foreign key constraints
ALTER TABLE public.grant_sections DROP CONSTRAINT IF EXISTS grant_sections_project_id_fkey;
ALTER TABLE public.project_check_settings DROP CONSTRAINT IF EXISTS project_check_settings_project_id_fkey;
ALTER TABLE public.requirement_results DROP CONSTRAINT IF EXISTS requirement_results_project_id_fkey;
ALTER TABLE public.ai_feedback DROP CONSTRAINT IF EXISTS ai_feedback_project_id_fkey;

-- Add new foreign key constraints
ALTER TABLE public.grant_sections 
  ADD CONSTRAINT grant_sections_organization_id_fkey 
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.project_check_settings 
  ADD CONSTRAINT project_check_settings_organization_id_fkey 
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.requirement_results 
  ADD CONSTRAINT requirement_results_organization_id_fkey 
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.ai_feedback 
  ADD CONSTRAINT ai_feedback_organization_id_fkey 
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- 4. Update RLS policies to reference organizations instead of projects
-- Drop existing policies
DROP POLICY IF EXISTS "grant_sections_org_members_select" ON public.grant_sections;
DROP POLICY IF EXISTS "grant_sections_org_members_modify" ON public.grant_sections;
DROP POLICY IF EXISTS "project_check_settings_org_members_select" ON public.project_check_settings;
DROP POLICY IF EXISTS "project_check_settings_org_members_modify" ON public.project_check_settings;
DROP POLICY IF EXISTS "requirement_results_org_members_select" ON public.requirement_results;
DROP POLICY IF EXISTS "requirement_results_org_members_modify" ON public.requirement_results;
DROP POLICY IF EXISTS "ai_feedback_org_members_select" ON public.ai_feedback;
DROP POLICY IF EXISTS "ai_feedback_org_members_modify" ON public.ai_feedback;

-- Create new policies for organizations
CREATE POLICY "grant_sections_org_members_select"
ON public.grant_sections FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.users u
  WHERE u.id = auth.uid() AND u.team_id = (
    SELECT o.team_id FROM public.organizations o WHERE o.id = grant_sections.organization_id
  )
));

CREATE POLICY "grant_sections_org_members_modify"
ON public.grant_sections FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.users u
  WHERE u.id = auth.uid() AND u.team_id = (
    SELECT o.team_id FROM public.organizations o WHERE o.id = grant_sections.organization_id
  )
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.users u
  WHERE u.id = auth.uid() AND u.team_id = (
    SELECT o.team_id FROM public.organizations o WHERE o.id = grant_sections.organization_id
  )
));

CREATE POLICY "project_check_settings_org_members_select"
ON public.project_check_settings FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.users u
  WHERE u.id = auth.uid() AND u.team_id = (
    SELECT o.team_id FROM public.organizations o WHERE o.id = project_check_settings.organization_id
  )
));

CREATE POLICY "project_check_settings_org_members_modify"
ON public.project_check_settings FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.users u
  WHERE u.id = auth.uid() AND u.team_id = (
    SELECT o.team_id FROM public.organizations o WHERE o.id = project_check_settings.organization_id
  )
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.users u
  WHERE u.id = auth.uid() AND u.team_id = (
    SELECT o.team_id FROM public.organizations o WHERE o.id = project_check_settings.organization_id
  )
));

CREATE POLICY "requirement_results_org_members_select"
ON public.requirement_results FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.users u
  WHERE u.id = auth.uid() AND u.team_id = (
    SELECT o.team_id FROM public.organizations o WHERE o.id = requirement_results.organization_id
  )
));

CREATE POLICY "requirement_results_org_members_modify"
ON public.requirement_results FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.users u
  WHERE u.id = auth.uid() AND u.team_id = (
    SELECT o.team_id FROM public.organizations o WHERE o.id = requirement_results.organization_id
  )
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.users u
  WHERE u.id = auth.uid() AND u.team_id = (
    SELECT o.team_id FROM public.organizations o WHERE o.id = requirement_results.organization_id
  )
));

CREATE POLICY "ai_feedback_org_members_select"
ON public.ai_feedback FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.users u
  WHERE u.id = auth.uid() AND u.team_id = (
    SELECT o.team_id FROM public.organizations o WHERE o.id = ai_feedback.organization_id
  )
));

CREATE POLICY "ai_feedback_org_members_modify"
ON public.ai_feedback FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.users u
  WHERE u.id = auth.uid() AND u.team_id = (
    SELECT o.team_id FROM public.organizations o WHERE o.id = ai_feedback.organization_id
  )
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.users u
  WHERE u.id = auth.uid() AND u.team_id = (
    SELECT o.team_id FROM public.organizations o WHERE o.id = ai_feedback.organization_id
  )
));
