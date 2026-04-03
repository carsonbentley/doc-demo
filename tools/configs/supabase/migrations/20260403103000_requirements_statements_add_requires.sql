-- Add 'requires' as a deterministic requirements modal verb.

alter table if exists public.requirements_statements
drop constraint if exists requirements_statements_modal_verb_check;

alter table if exists public.requirements_statements
add constraint requirements_statements_modal_verb_check
check (modal_verb in ('shall', 'requires', 'should', 'may', 'can'));
