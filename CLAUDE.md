# Project Instructions

## Default workflow

For any non-trivial coding task (new feature, bug fix affecting more than a
few lines, or anything touching production paths), follow this pipeline in
order. Skip stages only when the task is genuinely too small to warrant them,
and say so explicitly rather than silently skipping.

1. **Plan** — use the `planner` agent (or `/plan`) to break the task into
   steps before writing code.
2. **Architect** — for anything introducing a new service, schema, API
   contract, or cross-system integration, use the `architect` agent against
   `.claude/rules/architecture.md` before implementation.
3. **Develop with TDD** — use the `tdd-guide` agent (or `/tdd`). Failing
   test first, then minimal code, then refactor.
4. **Code Review** — use the `code-reviewer` agent (or `/code-review`)
   before considering the change done.
5. **Test** — run the full suite, not just new tests. Report coverage
   against `.claude/rules/testing.md`. Note: this repo currently has **no
   test suite and no test runner installed** (`backend/requirements.txt` has
   no pytest). The first task that touches backend logic should stand up
   pytest rather than report coverage against nothing — say so instead of
   quietly skipping stage 3.
6. **Deploy** — use the `deploy-checker` agent (or `/deploy`) before
   anything goes to a shared or production environment.

## Always-on rules

Read `.claude/rules/security.md`, `testing.md`, `git-workflow.md`, and
`architecture.md` before writing code — these are global and already in
`~/.claude/rules/`.

## Project context

- **What this repo does:** Demo/workshop app for a 6-agent healthcare
  revenue-cycle pipeline. A claim runs sequentially through ClaimParser →
  Eligibility → Adjudication → DenialReasoning → RemittancePosting →
  RevenueAudit, streamed to the browser over SSE so each agent's reasoning
  and handoff is visible live. Each agent has one responsibility and a
  persona: Sofia parses/validates codes, David checks coverage and prior
  auth, Maria applies fee schedules and NCCI bundling rules, James
  classifies denials and resubmission paths, Priya generates ERA/GL
  entries, Alex computes KPIs (clean claim rate, denial rate, days-in-AR,
  underpayments). Agents are stateless; the orchestrator in
  `backend/agents/claims_pipeline.py` holds all state in `all_results` and
  cherry-picks which prior outputs each agent sees.
- **Stack:** Python 3 + FastAPI + uvicorn backend (`backend/`), Next.js 14 /
  React 18 frontend (`frontend/`, single-page `app/page.js`). LLM calls via
  `AsyncAzureOpenAI` against Azure AI Foundry, per-agent model overrides by
  env var (gpt-4o for adjudication and denial reasoning, gpt-4o-mini for the
  rest). No test suite and no linter config beyond `next lint` — see the
  testing note below. Deployed backend on Railway (Dockerfile/Procfile),
  frontend on Vercel.
- **Key integrations / external services:** Azure AI Foundry chat
  completions is the only live outbound call — claim and payer JSON is sent
  in the prompt body of every agent step. Auth prefers `AZURE_API_KEY` and
  falls back to `DefaultAzureCredential` (managed identity). Optional and
  currently unwired: Azure Blob Storage for an audit trail and Application
  Insights. Sample fixtures live in `backend/data/samples/sample_01..05`.
- **Anything unusual about this repo's data sensitivity:** The data is
  PHI-shaped but entirely synthetic — the committed samples use fabricated
  patients ("John Smith"), member IDs, NPIs, and tax IDs. Treat the shape as
  real PHI even though the values aren't: patient name, DOB, gender,
  member ID, diagnosis (ICD-10), and procedure (CPT) codes are exactly the
  fields that make a record PHI under HIPAA, and the `/process` endpoint
  forwards all of it to Azure. Two things to know before touching
  production paths:
  - `POST /process` accepts arbitrary `claim_data` / `payer_data` dicts with
    no schema validation, and CORS is `allow_origins=["*"]` with
    `allow_credentials=True`. Fine for a demo, not fine if real claims ever
    flow through.
  - Pipeline errors `print()` a full traceback and echo `str(e)` to the
    browser in an SSE `error` event, which can surface prompt/claim content.
    Redact before this handles anything real.
  If this repo ever moves from synthetic to real claims, it needs a BAA
  covering the Azure resource, input validation, an origin allowlist, and
  redacted logging — flag that rather than assuming demo rules still apply.

## What NOT to do automatically

- Do not install or enable new MCP servers without asking first.
- Do not run destructive git commands (force-push, hard reset, history
  rewrite) without explicit confirmation.
- Do not add new third-party dependencies without flagging them first.
