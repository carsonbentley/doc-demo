-- Add metadata support for multi-file SOW batches.

alter table if exists public.work_sections
add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists idx_work_sections_metadata_source_name
on public.work_sections ((metadata ->> 'source_document_name'));
