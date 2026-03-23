-- Organization-based access: add org credentials and switch RLS from user to organization

-- 1) Organizations: add username and password_hash for join/create flows
alter table if exists public.organizations
  add column if not exists username text unique,
  add column if not exists password_hash text;

-- 2) Ensure projects are scoped to organizations (keep user_id nullable for authorship)
alter table if exists public.projects
  alter column organization_id set not null;

-- 3) RLS changes: switch to organization-based visibility

-- Projects
alter table if exists public.projects enable row level security;
drop policy if exists "projects_select_own" on public.projects;
drop policy if exists "projects_modify_own" on public.projects;
drop policy if exists "projects_org_members_select" on public.projects;
drop policy if exists "projects_org_members_modify" on public.projects;

create policy "projects_org_members_select"
on public.projects for select to authenticated
using (exists (
  select 1 from public.users u
  where u.id = auth.uid() and u.organization_id = projects.organization_id
));

create policy "projects_org_members_modify"
on public.projects for all to authenticated
using (exists (
  select 1 from public.users u
  where u.id = auth.uid() and u.organization_id = projects.organization_id
))
with check (exists (
  select 1 from public.users u
  where u.id = auth.uid() and u.organization_id = projects.organization_id
));

-- grant_sections (via project.organization_id)
alter table if exists public.grant_sections enable row level security;
drop policy if exists "grant_sections_project_owner_select" on public.grant_sections;
drop policy if exists "grant_sections_project_owner_modify" on public.grant_sections;
drop policy if exists "grant_sections_org_members_select" on public.grant_sections;
drop policy if exists "grant_sections_org_members_modify" on public.grant_sections;

create policy "grant_sections_org_members_select"
on public.grant_sections for select to authenticated
using (exists (
  select 1 from public.projects p
  join public.users u on u.organization_id = p.organization_id and u.id = auth.uid()
  where p.id = grant_sections.project_id
));

create policy "grant_sections_org_members_modify"
on public.grant_sections for all to authenticated
using (exists (
  select 1 from public.projects p
  join public.users u on u.organization_id = p.organization_id and u.id = auth.uid()
  where p.id = grant_sections.project_id
))
with check (exists (
  select 1 from public.projects p
  join public.users u on u.organization_id = p.organization_id and u.id = auth.uid()
  where p.id = grant_sections.project_id
));

-- validation_history (via grant_sections -> projects)
alter table if exists public.validation_history enable row level security;
drop policy if exists "validation_history_project_owner_all" on public.validation_history;
drop policy if exists "validation_history_org_members_all" on public.validation_history;

create policy "validation_history_org_members_all"
on public.validation_history for all to authenticated
using (exists (
  select 1 from public.grant_sections gs
  join public.projects p on p.id = gs.project_id
  join public.users u on u.organization_id = p.organization_id and u.id = auth.uid()
  where gs.id = validation_history.section_id
))
with check (exists (
  select 1 from public.grant_sections gs
  join public.projects p on p.id = gs.project_id
  join public.users u on u.organization_id = p.organization_id and u.id = auth.uid()
  where gs.id = validation_history.section_id
));

-- requirement_results (via project)
alter table if exists public.requirement_results enable row level security;
drop policy if exists "requirement_results_project_owner_all" on public.requirement_results;
drop policy if exists "requirement_results_org_members_all" on public.requirement_results;

create policy "requirement_results_org_members_all"
on public.requirement_results for all to authenticated
using (exists (
  select 1 from public.projects p
  join public.users u on u.organization_id = p.organization_id and u.id = auth.uid()
  where p.id = requirement_results.project_id
))
with check (exists (
  select 1 from public.projects p
  join public.users u on u.organization_id = p.organization_id and u.id = auth.uid()
  where p.id = requirement_results.project_id
));

-- ai_feedback (via project)
alter table if exists public.ai_feedback enable row level security;
drop policy if exists "ai_feedback_project_owner_all" on public.ai_feedback;
drop policy if exists "ai_feedback_org_members_all" on public.ai_feedback;

create policy "ai_feedback_org_members_all"
on public.ai_feedback for all to authenticated
using (exists (
  select 1 from public.projects p
  join public.users u on u.organization_id = p.organization_id and u.id = auth.uid()
  where p.id = ai_feedback.project_id
))
with check (exists (
  select 1 from public.projects p
  join public.users u on u.organization_id = p.organization_id and u.id = auth.uid()
  where p.id = ai_feedback.project_id
));

-- organizations table policies
alter table if exists public.organizations enable row level security;
drop policy if exists "organizations_read_auth" on public.organizations;
drop policy if exists "organizations_insert_auth" on public.organizations;

create policy "organizations_read_auth"
on public.organizations for select to authenticated using (true);

create policy "organizations_insert_auth"
on public.organizations for insert to authenticated with check (true);

-- helpful indexes
create index if not exists idx_users_organization_id on public.users(organization_id);
create index if not exists idx_projects_organization_id on public.projects(organization_id);

