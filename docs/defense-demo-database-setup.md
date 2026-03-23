# Defense Demo Database Setup

Use these commands after creating a new blank Supabase project.

## 1) Authenticate and link project

```bash
supabase login
supabase link --project-ref <NEW_SUPABASE_PROJECT_ID>
```

## 2) Apply the baseline schema

From repo root:

```bash
cd tools/configs
supabase db push
```

This applies `supabase/migrations/20260323100000_defense_demo_baseline.sql`.

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

From repo root:

```bash
SUPABASE_PROJECT_ID=<NEW_SUPABASE_PROJECT_ID> npm run gen:db:types
```

