# ComplyFlow

AI-powered requirements traceability system for linking standards documents to SOW/template sections.

## Architecture

GrantComply provides compliance checking with three validation types:
- **Official PAPPG Checks**: Rule-based validation (page limits, required content)
- **Internal Quality Checks**: Team-specific standards and best practices
- **AI Semantic Checks**: LangChain-powered analysis of writing quality and technical depth

## 🏗️ Monorepo Structure

```
GrantComply/
├── apps/
│   ├── frontend/            # Next.js web application
│   ├── backend/             # FastAPI Python backend
│   └── addon/               # Google Apps Script add-on
├── packages/                # Shared libraries (future)
├── tools/
│   ├── scripts/             # Deployment and utility scripts
│   └── configs/             # Configuration files (Supabase, etc.)
├── docs/                    # All documentation
└── package.json             # Workspace manager
├── ai-api/                  # FastAPI AI service
│   ├── src/agent_api/       # Core AI agent system
│   │   ├── agents/          # LangChain AI agents
│   │   ├── checks/          # Compliance check functions
│   │   ├── services/        # LangChain AI service and PDF processing
│   │   ├── prompts/         # LangChain prompt templates
│   │   └── routers/         # API endpoints
│   └── pyproject.toml       # Python dependencies
```

## Setup

### Prerequisites
- Node.js 18+ with npm
- Python 3.11+ with Poetry
- Supabase account (database & auth)
- OpenAI API key (for AI features)
- Doppler CLI (for environment management)

### Quick Start
```bash
git clone <repo>
cd GrantComply
npm run setup          # Install dependencies
doppler login          # Login to Doppler (one-time)
npm run env:pull       # Pull environment variables
npm run dev            # Start both services
```

**New team members**: See [ONBOARDING.md](ONBOARDING.md) for detailed setup instructions.

Services:
- Frontend: http://localhost:3000 (or 3001 if 3000 is busy)
- AI-API: http://localhost:8002/docs (FastAPI docs)

## AI Architecture

### LangChain-Based System

#### LangChain AI Service (`services/langchain_ai_service.py`)
- Unified AI service using LangChain framework
- Structured outputs with Pydantic models
- Methods: `analyze_compliance_structured()`, `analyze_writing_quality()`, `analyze_technical_depth()`

#### Semantic Checker Agent (`agents/semantic_checker.py`)
- Stateful AI behavior with memory and reasoning
- Cross-section intelligence and dynamic learning
- Generates new checks from feedback

#### Check Registry (`checks/registry.py`)
- Central registry for all compliance check functions
- Dynamic function registration and parameter handling

#### Prompt Templates (`prompts/compliance_prompts.py`)
- LangChain prompt templates for consistent AI interactions
- Structured prompts for compliance analysis, writing quality, and technical depth

### Data Flow
```
1. User uploads PDF → PDF processor extracts text
2. Frontend calls /run-checks-pdf → Requirements service loads checks from DB
3. For each check → Registry executes function with CheckContext
4. AI checks → Agent uses LangChain service for analysis
5. Results saved → Database stores CheckResults
6. Frontend displays → Three expandable cards with results
```

## Database Schema

Core 4-table schema:

```sql
-- Grant sections (project-summary, budget, etc.)
section_descriptions (section_key, name, description, grant_type)

-- Compliance checks
requirements (id, section_key, requirement_type, name, description, check_function, parameters)

-- Check execution results
check_results (id, project_id, requirement_id, status, message, details, confidence)

-- AI feedback and suggestions
ai_feedback (id, project_id, section_key, content, suggestions, confidence_score)
```

Key features:
- JSONB parameters for flexible check configuration
- Versioned results tracking compliance over time
- Multi-tenant with Row Level Security (RLS)

## Development

### Adding New Compliance Checks

1. Write the check function:
```python
# ai-api/src/agent_api/checks/minimal_checks.py
def check_budget_consistency(context: CheckContext, max_variance: float = 0.1) -> CheckResult:
    """Check if budget totals are consistent across sections."""
    # Your validation logic here
    return CheckResult(
        status='passed',
        message='Budget totals are consistent',
        confidence=0.95
    )
```

2. Register the function:
```python
registry.register('check_budget_consistency', check_budget_consistency,
                 'Validate budget consistency across sections')
```

3. Add to database:
```sql
INSERT INTO requirements (section_key, requirement_type, name, description, check_function, parameters)
VALUES ('budget', 'internal', 'Budget Consistency', 'Check budget totals match', 'check_budget_consistency', '{"max_variance": 0.1}');
```

### Adding New AI Analysis
```python
# ai-api/src/agent_api/services/langchain_ai_service.py
def analyze_budget_feasibility(self, document_text: str) -> Dict[str, Any]:
    """Analyze if the budget is realistic for the proposed work."""
    # Use LangChain structured output
    return structured_analysis
```

### Key Files

#### Frontend (`frontend/`)
- `app/(protected)/app/grant/`: Main grant application interface
- `components/requirements/`: Compliance checking UI components
- `lib/api/`: API client functions for backend communication
- `lib/types/`: TypeScript type definitions
- `lib/supabase/`: Database client configuration

#### AI-API (`ai-api/`)
- `src/agent_api/main.py`: FastAPI application entry point
- `src/agent_api/requirements_api.py`: Core API endpoints
- `src/agent_api/config.py`: Environment configuration
- `src/agent_api/supabase_client.py`: Database client wrapper

#### Core Components
- `checks/types.py`: Core data structures (CheckResult, CheckContext, RequirementDefinition)
- `checks/registry.py`: Function registry for dynamic check execution
- `checks/service.py`: Business logic for requirements management
- `services/langchain_ai_service.py`: LangChain AI service and analysis functions
- `agents/semantic_checker.py`: AI agent with memory and reasoning
- `prompts/compliance_prompts.py`: LangChain prompt templates

## Testing

### Run Compliance Checks
```bash
# Test individual check functions
cd ai-api && poetry run python -c "
from src.agent_api.checks.registry import registry
from src.agent_api.checks.types import CheckContext
context = CheckContext(project_id='test', section_key='project-summary', document_text='Test content')
result = registry.run_check('check_page_limit', context, {'max_pages': 1})
print(result.to_dict())
"
```

### Test AI Analysis
```bash
# Test Google Docs AI comments endpoint
curl -X POST "http://localhost:8002/v1/google/document/{doc_id}/ai-comments" \
  -H "Content-Type: application/json" \
  -d '{"user_id": "test", "project_id": "test", "section_key": "project-summary"}'
```

## Security

### Environment Variables
- Frontend: Only `NEXT_PUBLIC_*` variables (safe for browser)
- AI-API: Sensitive keys (OpenAI, Supabase service role)
- Doppler: Centralized secret management with automatic distribution

### Database Security
- Row Level Security (RLS): Users can only access their own data
- Service Role: AI-API uses service role for full database access
- Anon Role: Frontend uses anonymous role with RLS restrictions

## Deployment

### Production Checklist
- [ ] Set up Doppler production environment
- [ ] Configure Supabase production database
- [ ] Set up OpenAI API key with usage limits
- [ ] Deploy frontend to Vercel/Netlify
- [ ] Deploy AI-API to Railway/Render
- [ ] Configure CORS for production domains
- [ ] Set up monitoring and logging

## Database Management

- To pull new db changes into `apps/frontend/types/database.ts`, run:
  - `SUPABASE_PROJECT_ID=<your-project-id> npm run gen:db:types`
- For blank-project bootstrap commands and seed flow, see `docs/defense-demo-database-setup.md`.

### Organizations
- User Roles: Administrators (org creators) and members (invited users)
- Projects are tied to organizations, visible to all org members
- Administrators can invite users by email address; invitees can join or decline