-- Deterministic ISO statement extraction storage.

create table if not exists public.requirements_statements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requirements_document_id uuid not null references public.requirements_documents(id) on delete cascade,
  statement_order integer not null,
  section_title text not null,
  modal_verb text not null check (modal_verb in ('shall', 'requires', 'should', 'may', 'can')),
  statement_text text not null,
  statement_text_normalized text not null,
  note_text text,
  source_page integer,
  source_block_type text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requirements_document_id, statement_order)
);

create index if not exists idx_requirements_statements_doc
on public.requirements_statements(requirements_document_id);

create index if not exists idx_requirements_statements_doc_verb
on public.requirements_statements(requirements_document_id, modal_verb);

create index if not exists idx_requirements_statements_org
on public.requirements_statements(organization_id);

drop trigger if exists trg_requirements_statements_updated_at on public.requirements_statements;
create trigger trg_requirements_statements_updated_at before update on public.requirements_statements
for each row execute function public.set_updated_at();

alter table public.requirements_statements enable row level security;

drop policy if exists "requirements_statements_org_access" on public.requirements_statements;
create policy "requirements_statements_org_access" on public.requirements_statements
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
