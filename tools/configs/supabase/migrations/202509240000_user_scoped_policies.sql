-- User-scoped RLS policies and supporting triggers/indexes
-- Apply in staging first. Requires Supabase Auth.

-- PROJECTS: only owner can select/modify
alter table if exists public.projects enable row level security;

drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own"
on public.projects for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "projects_modify_own" on public.projects;
create policy "projects_modify_own"
on public.projects for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Optional trigger to default user_id to auth.uid() when not provided
create or replace function public.set_project_owner()
returns trigger language plpgsql as $$
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_project_owner on public.projects;
create trigger trg_set_project_owner
before insert on public.projects
for each row execute function public.set_project_owner();

-- GRANT_SECTIONS: restricted by parent project ownership
alter table if exists public.grant_sections enable row level security;

drop policy if exists "grant_sections_project_owner_select" on public.grant_sections;
create policy "grant_sections_project_owner_select"
on public.grant_sections for select
to authenticated
using (exists (
  select 1 from public.projects p
  where p.id = grant_sections.project_id
    and p.user_id = auth.uid()
));

drop policy if exists "grant_sections_project_owner_modify" on public.grant_sections;
create policy "grant_sections_project_owner_modify"
on public.grant_sections for all
to authenticated
using (exists (
  select 1 from public.projects p
  where p.id = grant_sections.project_id
    and p.user_id = auth.uid()
))
with check (exists (
  select 1 from public.projects p
  where p.id = grant_sections.project_id
    and p.user_id = auth.uid()
));

-- VALIDATION_HISTORY: restricted via grant_sections -> projects
alter table if exists public.validation_history enable row level security;

drop policy if exists "validation_history_project_owner_all" on public.validation_history;
create policy "validation_history_project_owner_all"
on public.validation_history for all
to authenticated
using (exists (
  select 1
  from public.grant_sections gs
  join public.projects p on p.id = gs.project_id
  where gs.id = validation_history.section_id
    and p.user_id = auth.uid()
))
with check (exists (
  select 1
  from public.grant_sections gs
  join public.projects p on p.id = gs.project_id
  where gs.id = validation_history.section_id
    and p.user_id = auth.uid()
));

-- REQUIREMENT_RESULTS: restricted by project ownership
alter table if exists public.requirement_results enable row level security;

drop policy if exists "requirement_results_project_owner_all" on public.requirement_results;
create policy "requirement_results_project_owner_all"
on public.requirement_results for all
to authenticated
using (exists (
  select 1 from public.projects p
  where p.id = requirement_results.project_id
    and p.user_id = auth.uid()
))
with check (exists (
  select 1 from public.projects p
  where p.id = requirement_results.project_id
    and p.user_id = auth.uid()
));

-- AI_FEEDBACK: restricted by project ownership
alter table if exists public.ai_feedback enable row level security;

drop policy if exists "ai_feedback_project_owner_all" on public.ai_feedback;
create policy "ai_feedback_project_owner_all"
on public.ai_feedback for all
to authenticated
using (exists (
  select 1 from public.projects p
  where p.id = ai_feedback.project_id
    and p.user_id = auth.uid()
))
with check (exists (
  select 1 from public.projects p
  where p.id = ai_feedback.project_id
    and p.user_id = auth.uid()
));

-- READABLE GLOBAL TABLES
alter table if exists public.requirements enable row level security;
drop policy if exists "requirements_read_all" on public.requirements;
create policy "requirements_read_all"
on public.requirements for select to authenticated using (true);

alter table if exists public.section_descriptions enable row level security;
drop policy if exists "section_descriptions_read_all" on public.section_descriptions;
create policy "section_descriptions_read_all"
on public.section_descriptions for select to authenticated using (true);

-- EMAIL_WAITLIST: allow public insert, auth read
alter table if exists public.email_waitlist enable row level security;
drop policy if exists "email_waitlist_public_insert" on public.email_waitlist;
create policy "email_waitlist_public_insert"
on public.email_waitlist for insert
to anon
with check (true);

drop policy if exists "email_waitlist_read_auth" on public.email_waitlist;
create policy "email_waitlist_read_auth"
on public.email_waitlist for select
to authenticated using (true);

-- PERFORMANCE INDEXES (safe if they already exist)
create index if not exists idx_projects_user_id on public.projects(user_id);
create index if not exists idx_grant_sections_project_id on public.grant_sections(project_id);
create index if not exists idx_validation_history_section_id on public.validation_history(section_id);
create index if not exists idx_requirement_results_project_id on public.requirement_results(project_id);
create index if not exists idx_ai_feedback_project_id on public.ai_feedback(project_id);


