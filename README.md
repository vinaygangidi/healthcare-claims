# Healthcare Claims Processing - Multi-Agent Pipeline

A 6-agent AI system for automating healthcare claims submission, eligibility verification, adjudication, and denial management.

![Language](https://img.shields.io/badge/language-Python-blue?style=flat-square)
![Last Commit](https://img.shields.io/github/last-commit/vinaygangidi/healthcare-claims?style=flat-square)
![Tests](https://img.shields.io/badge/tests-14%20passing-brightgreen?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

## Architecture

```
ClaimParser -> Eligibility -> Adjudication -> DenialReasoning -> RemittancePosting -> RevenueAudit
```

### Agents

Each agent represents a role on a healthcare revenue-cycle team, with a persona that frames how it reasons.

1. **ClaimParserAgent** (Sofia, Claims Intake Specialist): Parse raw claims, validate CPT/ICD-10 codes, flag missing/invalid data
2. **EligibilityAgent** (David, Coverage and Benefits Analyst): Validate patient coverage, check prior auth, calculate cost-sharing
3. **AdjudicationAgent** (Maria, Senior Claims Adjudicator): Apply fee schedules, detect unbundling/upcoding, calculate allowed amounts
4. **DenialReasoningAgent** (James, Denials Management Specialist): Classify denials, recommend resubmission strategies
5. **RemittancePostingAgent** (Priya, Payment Posting Specialist): Generate ERA entries, post payments, calculate patient balance
6. **RevenueAuditAgent** (Alex, Revenue Cycle Analyst): Calculate KPIs such as clean claim rate, denial rate, days-in-AR, underpayments

## Getting Started

### Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# Edit .env with your Azure AI Foundry credentials
```

### Run Backend

```bash
python -m uvicorn main:app --reload --port 8001
```

### API Endpoints

- `GET /health`: Service status
- `GET /samples`: List sample datasets
- `GET /demo-data?sample=01`: Load sample claim and payer data
- `POST /process`: Submit claim for processing (SSE stream response)

### Environment Variables

Backend, set in `backend/.env` locally and in the hosting environment for a
deployment. See `backend/.env.example` for the full list.

| Variable | Required | Purpose |
|---|---|---|
| `AZURE_AI_ENDPOINT` | yes | Azure AI Foundry endpoint. |
| `AZURE_API_KEY` | no | API key auth. When omitted, falls back to `DefaultAzureCredential` (managed identity). |
| `ALLOWED_ORIGINS` | recommended | Comma-separated list of exact browser origins allowed to call this API (CORS). |
| `MODEL_*_AGENT` | no | Per-agent model override; see `.env.example`. |
| `AZURE_OPENAI_API_VERSION` | no | Azure OpenAI API version. Defaults to `2024-12-01-preview` in code. |
| `NEXT_PUBLIC_BACKEND_URL` | no | Frontend only. Backend URL for the browser; defaults to `http://localhost:8002`. |

Three variables in `backend/.env.example` are **not read by any code**:
`USE_FIXTURES`, `AZURE_STORAGE_ACCOUNT_URL`, and
`APPLICATIONINSIGHTS_CONNECTION_STRING`. They are aspirational — there is no
fixture-replay mode, no audit-trail persistence, and no telemetry. Setting them
has no effect.

`ALLOWED_ORIGINS` controls a security boundary, so it is worth setting
explicitly rather than relying on the default:

- Exact origins only — no wildcards and no suffix matching, so Vercel
  preview deploys are not covered and need their own entry or a local
  backend.
- Unset or blank falls back to `http://localhost:3000` plus the production
  frontend origin. That default is closed, never `*`.
- It is read once at startup, so changing it requires a restart or redeploy,
  not just an edit to the variable.

Example: `ALLOWED_ORIGINS=http://localhost:3000,https://your-frontend.vercel.app`

### Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

## Test Data

Sample datasets in `backend/data/samples/`:

- **sample_01**: Clean claims (baseline)
- **sample_02**: Denial heavy
- **sample_03**: Coordination of benefits (COB)
- **sample_04**: Medicare/NCCI edits
- **sample_05**: Underpayment and writeoff

## Design

See [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) for detailed architecture, data flow, and compliance notes.

## Development

### Running Tests

```bash
pip install -r backend/requirements.txt -r backend/requirements-dev.txt
python -m pytest        # from the repo root; config lives in pyproject.toml
```

Tests mock Azure OpenAI and never call the live service. There is no
integration suite against real Azure yet; that would be a separate opt-in
target.

### Adding a New Test Scenario

1. Create `backend/data/samples/sample_NN/`
2. Add `meta.json`, `claim_data.json`, `payer_data.json`
3. Restart backend and test via `/demo-data?sample=NN`

### Modifying Agent Logic

1. Edit agent prompt in `backend/agents/<agent>_agent.py`
2. Update `PROMPT` constant with new rules/flags
3. Backend automatically picks up changes on next request

## Technology Stack

- **Backend:** FastAPI, Python
- **LLM:** Azure OpenAI GPT-4o / GPT-4o-mini
- **Frontend:** Next.js, React
- **Orchestration:** Python async/await, SSE streaming

## Status

Working: 6 agents with prompts, SSE-streaming orchestrator, 5 sample datasets,
Next.js dashboard, 14 passing tests.

Not built: audit-trail persistence, telemetry, real payer integrations (Medicare
API, EDI), authentication.

## Limitations

- **No audit trail is persisted.** `AZURE_STORAGE_ACCOUNT_URL` appears in
  `.env.example` but nothing reads it. Agent outputs live only in the SSE stream and
  the response — nothing is written to durable storage. For a claims system this is
  the most significant gap: there is no record of how a given adjudication was reached.
- **No telemetry.** `APPLICATIONINSIGHTS_CONNECTION_STRING` is likewise unread. There
  is no tracing, no metrics, and no structured logging pipeline.
- **Adjudication is model output, not a rules engine.** Fee schedules, unbundling and
  upcoding detection, and allowed-amount math are produced by GPT-4o from a prompt.
  There is no deterministic validation of the arithmetic and no code-verified check
  against a real fee schedule, so figures should be treated as illustrative.
- **No real payer integration.** No Medicare API, no X12 EDI (837/835), no
  clearinghouse. Input is JSON supplied by the caller.
- **Synthetic sample data only.** Five scenarios in `backend/data/samples/`. No real
  claims have been processed.
- **Test coverage is uneven.** 14 tests pass and cover the pipeline orchestrator and
  CORS parsing well, including error-redaction assertions. The `/samples`,
  `/demo-data`, and `/process` endpoints have no direct tests, and the six agent
  modules are only exercised incidentally.
- **PHI is sent to Azure OpenAI.** Every claim and payer record in a request is
  transmitted to the Azure OpenAI service. This repository has no BAA, no
  de-identification step, and no PHI-handling controls — do not process real patient
  data without addressing HIPAA obligations first.
- **No authentication.** Any caller who can reach the API can submit claims and read
  results. `ALLOWED_ORIGINS` restricts browsers via CORS; it is not an auth boundary
  and does not stop direct HTTP calls.
- **Dependencies are unpinned lower bounds.** `requirements.txt` uses `>=` throughout,
  so two installs weeks apart can resolve to different versions.
- **Deploy config is contradictory.** The root `railway.json` specifies the
  `DOCKERFILE` builder while `backend/railway.json` specifies `NIXPACKS` with its own
  start command. Only one applies depending on the configured root directory.
- **Single-process only.** Pipeline state is per-request and held in memory; there is
  no queue or worker model, so a long claim occupies a request slot for its duration.

## License

MIT — see [LICENSE](LICENSE).
