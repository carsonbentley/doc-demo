-- Optional seed data for defense demo setup.
-- Replace UUIDs/emails as needed after creating users in Supabase Auth.

-- Example assumes one authenticated user already exists in auth.users.
-- Substitute :user_id in your SQL client before running.

-- Team + user profile
insert into public.teams (id, name, owner_id, username)
values (gen_random_uuid(), 'Demo Team', :user_id, 'demo-team')
on conflict (username) do nothing;

insert into public.users (id, email, team_id, role)
select
  :user_id,
  au.email,
  t.id,
  'administrator'
from auth.users au
join public.teams t on t.username = 'demo-team'
where au.id = :user_id
on conflict (id) do update
set team_id = excluded.team_id,
    role = excluded.role;

insert into public.organizations (team_id, user_id, name, description, status)
select
  u.team_id,
  u.id,
  'Falcon Demo Organization',
  'Initial org for requirements-to-SOW traceability demo',
  'draft'
from public.users u
where u.id = :user_id
on conflict do nothing;
