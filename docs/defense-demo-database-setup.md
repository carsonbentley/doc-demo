# Defense Demo Database Setup

Use these commands after creating a new blank Supabase project.

## Migration layout (greenfield)

`supabase db push` applies **every** file in `tools/configs/supabase/migrations/` in filename order.

- Migrations dated **before** `20260323100000_defense_demo_baseline.sql` are **no-ops** (`select 1`). They are kept so older environments that already ran the historical SQL keep the same migration filenames and checksum history.
- **Effective schema** for a new database comes from:
  - `20260323100000_defense_demo_baseline.sql` (core tables, RLS, `match_requirements_chunks`, `get_team_members`)
  - `20260403100000`–`20260413113000` (requirements statements, work metadata, PDF anchor columns)
  - `20260415120000_team_and_invite_rpcs.sql` (team join/create/invite/leave RPCs aligned with the baseline model)

If you need legacy tables from the old product (for example Google Docs–related tables), restore them from a **database backup** or the previous migration bodies in git history—they are intentionally not applied on greenfield installs.

## 1) Authenticate and link project

```bash
supabase login
supabase link --project-ref <NEW_SUPABASE_PROJECT_ID>
```

## 2) Apply migrations

From repo root:

```bash
cd tools/configs
supabase db push
```

This runs the full chain above, not only the baseline file.

## 3) Optional: seed a demo team/user/org

1. Create a user in Supabase Auth (Dashboard -> Authentication -> Users).
2. Copy that user's UUID.
3. In SQL editor, run:

```sql
\set user_id '00000000-0000-0000-0000-000000000000'
\i tools/configs/supabase/seed/defense_demo_seed.sql
```

If your SQL editor does not support `\set`, replace `:user_id` in the seed file manually.

## 4) Configure local env vars

Frontend (`apps/frontend/.env.local`):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<NEW_SUPABASE_PROJECT_ID>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<YOUR_ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<YOUR_SERVICE_ROLE_KEY>
NEXT_PUBLIC_AGENT_API_URL=http://localhost:8002
```

Backend (`apps/backend/.env`):

```bash
SUPABASE_URL=https://<NEW_SUPABASE_PROJECT_ID>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<YOUR_SERVICE_ROLE_KEY>
OPENAI_API_KEY=<optional_for_real_embeddings>
```

## 5) Regenerate frontend DB types

From repo root (point at the **new** project):

```bash
SUPABASE_PROJECT_ID=<NEW_SUPABASE_PROJECT_ID> npm run gen:db:types
```

The committed `apps/frontend/types/database.ts` is updated manually when migrations change; regenerating overwrites it with the live project and is the source of truth after a new deploy.
