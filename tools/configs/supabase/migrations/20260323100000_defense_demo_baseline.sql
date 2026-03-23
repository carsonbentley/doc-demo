-- Defense demo baseline schema for a fresh Supabase project.
-- Keeps minimal team/org shell and adds requirement-to-work linking tables.

create extension if not exists vector;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Core tenancy and profile model
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  username text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  team_id uuid references public.teams(id) on delete set null,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'draft',
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Optional project container retained for compatibility with existing paths.
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  email text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists public.email_waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  source text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- Requirements corpus uploaded by the user (DO-160, FAR clauses, etc.)
create table if not exists public.requirements_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  uploaded_by uuid not null references public.users(id) on delete cascade,
  title text not null,
  source_type text not null default 'text',
  source_name text,
  raw_text text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.requirements_chunks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requirements_document_id uuid not null references public.requirements_documents(id) on delete cascade,
  chunk_index integer not null,
  chunk_text text not null,
  embedding vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requirements_document_id, chunk_index)
);

-- Work document (SOW/template) and extracted sections for citation linking.
create table if not exists public.work_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  uploaded_by uuid not null references public.users(id) on delete cascade,
  title text not null,
  raw_text text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.work_sections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  work_document_id uuid not null references public.work_documents(id) on delete cascade,
  section_key text not null,
  section_title text not null,
  content text not null,
  section_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (work_document_id, section_key)
);

create table if not exists public.section_requirement_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  work_section_id uuid not null references public.work_sections(id) on delete cascade,
  requirements_chunk_id uuid not null references public.requirements_chunks(id) on delete cascade,
  similarity double precision not null,
  rationale text,
  created_at timestamptz not null default now(),
  unique (work_section_id, requirements_chunk_id)
);

create or replace function public.get_team_members()
returns table (
  user_id uuid,
  email text,
  role text
)
language sql
security definer
as $$
  select u.id as user_id, u.email, u.role
  from public.users u
  where u.team_id = (
    select team_id from public.users where id = auth.uid()
  );
$$;

-- Vector similarity lookup scoped to organization.
create or replace function public.match_requirements_chunks(
  query_embedding vector(1536),
  query_organization_id uuid,
  min_similarity float default 0.65,
  match_count int default 8
)
returns table (
  id uuid,
  requirements_document_id uuid,
  chunk_index integer,
  chunk_text text,
  metadata jsonb,
  similarity float
)
language sql
security definer
as $$
  select
    rc.id,
    rc.requirements_document_id,
    rc.chunk_index,
    rc.chunk_text,
    rc.metadata,
    1 - (rc.embedding <=> query_embedding) as similarity
  from public.requirements_chunks rc
  where rc.organization_id = query_organization_id
    and rc.embedding is not null
    and 1 - (rc.embedding <=> query_embedding) >= min_similarity
  order by rc.embedding <=> query_embedding
  limit match_count;
$$;

create index if not exists idx_users_team_id on public.users(team_id);
create index if not exists idx_org_team_id on public.organizations(team_id);
create index if not exists idx_projects_org_id on public.projects(organization_id);
create index if not exists idx_team_invitations_team_id on public.team_invitations(team_id);
create index if not exists idx_req_docs_org on public.requirements_documents(organization_id);
create index if not exists idx_req_chunks_org on public.requirements_chunks(organization_id);
create index if not exists idx_req_chunks_doc on public.requirements_chunks(requirements_document_id);
create index if not exists idx_work_docs_org on public.work_documents(organization_id);
create index if not exists idx_work_sections_doc on public.work_sections(work_document_id);
create index if not exists idx_links_work_section on public.section_requirement_links(work_section_id);
create index if not exists idx_requirements_chunks_embedding_cosine
on public.requirements_chunks
using ivfflat (embedding vector_cosine_ops)
with (lists = 100);

drop trigger if exists trg_teams_updated_at on public.teams;
create trigger trg_teams_updated_at before update on public.teams
for each row execute function public.set_updated_at();

drop trigger if exists trg_users_updated_at on public.users;
create trigger trg_users_updated_at before update on public.users
for each row execute function public.set_updated_at();

drop trigger if exists trg_organizations_updated_at on public.organizations;
create trigger trg_organizations_updated_at before update on public.organizations
for each row execute function public.set_updated_at();

drop trigger if exists trg_projects_updated_at on public.projects;
create trigger trg_projects_updated_at before update on public.projects
for each row execute function public.set_updated_at();

drop trigger if exists trg_requirements_documents_updated_at on public.requirements_documents;
create trigger trg_requirements_documents_updated_at before update on public.requirements_documents
for each row execute function public.set_updated_at();

drop trigger if exists trg_requirements_chunks_updated_at on public.requirements_chunks;
create trigger trg_requirements_chunks_updated_at before update on public.requirements_chunks
for each row execute function public.set_updated_at();

drop trigger if exists trg_work_documents_updated_at on public.work_documents;
create trigger trg_work_documents_updated_at before update on public.work_documents
for each row execute function public.set_updated_at();

drop trigger if exists trg_work_sections_updated_at on public.work_sections;
create trigger trg_work_sections_updated_at before update on public.work_sections
for each row execute function public.set_updated_at();

-- RLS: authenticated users can access rows in their team/org boundary.
alter table public.teams enable row level security;
alter table public.users enable row level security;
alter table public.organizations enable row level security;
alter table public.projects enable row level security;
alter table public.team_invitations enable row level security;
alter table public.requirements_documents enable row level security;
alter table public.requirements_chunks enable row level security;
alter table public.work_documents enable row level security;
alter table public.work_sections enable row level security;
alter table public.section_requirement_links enable row level security;

drop policy if exists "teams_member_read" on public.teams;
create policy "teams_member_read" on public.teams
for select to authenticated
using (
  id in (select u.team_id from public.users u where u.id = auth.uid())
);

drop policy if exists "teams_owner_modify" on public.teams;
create policy "teams_owner_modify" on public.teams
for all to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "users_self_read" on public.users;
create policy "users_self_read" on public.users
for select to authenticated
using (id = auth.uid());

drop policy if exists "users_self_modify" on public.users;
create policy "users_self_modify" on public.users
for all to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "organizations_team_access" on public.organizations;
create policy "organizations_team_access" on public.organizations
for all to authenticated
using (
  team_id in (select u.team_id from public.users u where u.id = auth.uid())
)
with check (
  team_id in (select u.team_id from public.users u where u.id = auth.uid())
);

drop policy if exists "projects_org_access" on public.projects;
create policy "projects_org_access" on public.projects
for all to authenticated
using (
  organization_id in (
    select o.id
    from public.organizations o
    join public.users u on u.team_id = o.team_id
    where u.id = auth.uid()
  )
)
with check (
  organization_id in (
    select o.id
    from public.organizations o
    join public.users u on u.team_id = o.team_id
    where u.id = auth.uid()
  )
);

drop policy if exists "team_invitations_team_access" on public.team_invitations;
create policy "team_invitations_team_access" on public.team_invitations
for all to authenticated
using (
  team_id in (select u.team_id from public.users u where u.id = auth.uid())
)
with check (
  team_id in (select u.team_id from public.users u where u.id = auth.uid())
);

drop policy if exists "requirements_documents_org_access" on public.requirements_documents;
create policy "requirements_documents_org_access" on public.requirements_documents
for all to authenticated
using (
  organization_id in (
    select o.id
    from public.organizations o
    join public.users u on u.team_id = o.team_id
    where u.id = auth.uid()
  )
)
with check (
  organization_id in (
    select o.id
    from public.organizations o
    join public.users u on u.team_id = o.team_id
    where u.id = auth.uid()
  )
);

drop policy if exists "requirements_chunks_org_access" on public.requirements_chunks;
create policy "requirements_chunks_org_access" on public.requirements_chunks
for all to authenticated
using (
  organization_id in (
    select o.id
    from public.organizations o
    join public.users u on u.team_id = o.team_id
    where u.id = auth.uid()
  )
)
with check (
  organization_id in (
    select o.id
    from public.organizations o
    join public.users u on u.team_id = o.team_id
    where u.id = auth.uid()
  )
);

drop policy if exists "work_documents_org_access" on public.work_documents;
create policy "work_documents_org_access" on public.work_documents
for all to authenticated
using (
  organization_id in (
    select o.id
    from public.organizations o
    join public.users u on u.team_id = o.team_id
    where u.id = auth.uid()
  )
)
with check (
  organization_id in (
    select o.id
    from public.organizations o
    join public.users u on u.team_id = o.team_id
    where u.id = auth.uid()
  )
);

drop policy if exists "work_sections_org_access" on public.work_sections;
create policy "work_sections_org_access" on public.work_sections
for all to authenticated
using (
  organization_id in (
    select o.id
    from public.organizations o
    join public.users u on u.team_id = o.team_id
    where u.id = auth.uid()
  )
)
with check (
  organization_id in (
    select o.id
    from public.organizations o
    join public.users u on u.team_id = o.team_id
    where u.id = auth.uid()
  )
);

drop policy if exists "section_requirement_links_org_access" on public.section_requirement_links;
create policy "section_requirement_links_org_access" on public.section_requirement_links
for all to authenticated
using (
  organization_id in (
    select o.id
    from public.organizations o
    join public.users u on u.team_id = o.team_id
    where u.id = auth.uid()
  )
)
with check (
  organization_id in (
    select o.id
    from public.organizations o
    join public.users u on u.team_id = o.team_id
    where u.id = auth.uid()
  )
);

grant execute on function public.match_requirements_chunks(vector, uuid, float, int) to authenticated;
grant execute on function public.get_team_members() to authenticated;
