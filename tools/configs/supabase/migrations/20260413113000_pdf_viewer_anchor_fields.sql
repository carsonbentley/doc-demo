-- Add explicit PDF reference and text-anchor fields for in-app viewer linking.

alter table if exists public.requirements_documents
  add column if not exists source_pdf_path text,
  add column if not exists source_pdf_url text;

alter table if exists public.work_documents
  add column if not exists source_pdf_path text,
  add column if not exists source_pdf_url text;

alter table if exists public.requirements_statements
  add column if not exists text_anchor jsonb;

create index if not exists idx_requirements_documents_source_pdf_url
on public.requirements_documents(source_pdf_url)
where source_pdf_url is not null;

create index if not exists idx_work_documents_source_pdf_url
on public.work_documents(source_pdf_url)
where source_pdf_url is not null;
