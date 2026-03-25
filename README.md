# ComplyFlow Demo

ComplyFlow is a focused demo for requirements traceability:

- Upload a requirements source document
- Chunk and embed requirements text
- Upload/paste a SOW template
- Link each SOW section to relevant requirement chunks

## Runtime Components

- `apps/frontend`: Next.js UI (auth + organizations + workbench)
- `apps/backend`: FastAPI API (`/v1/workbench/*`) for ingestion and linking
- `tools/configs/supabase`: schema migration + seed assets

## Quick Start

1. Install dependencies:

```bash
npm install
cd apps/backend && poetry install
```

2. Configure env files:

- `apps/frontend/.env.local`
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or publishable key var used by app)
  - `NEXT_PUBLIC_AGENT_API_URL=http://127.0.0.1:8002`
- `apps/backend/.env`
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `OPENAI_API_KEY` (optional; deterministic fallback embeddings exist)

3. Start the app:

```bash
npm run dev
```

Frontend: `http://localhost:3000`  
Backend docs: `http://127.0.0.1:8002/docs`

## Database

- Baseline migration: `tools/configs/supabase/migrations/20260323100000_defense_demo_baseline.sql`
- Setup guide: `docs/defense-demo-database-setup.md`
- Regenerate frontend types:

```bash
npm run gen:db:types
```