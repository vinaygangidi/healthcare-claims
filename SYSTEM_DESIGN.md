# Healthcare Claims Processing - System Design

## Architecture

**6-agent sequential pipeline** processing healthcare claims through eligibility, adjudication, and denial management.

```
ClaimParser -> Eligibility -> Adjudication -> DenialReasoning -> RemittancePosting -> RevenueAudit
    ↓            ↓              ↓               ↓                  ↓                 ↓
Parse & flag   Check coverage  Fee schedule   Classify denials   Post payment    KPI summary
```

## Data Flow

**Input:**
- `claim_data` - raw claim (patient, provider, service lines with CPT/ICD-10, charges)
- `payer_data` - insurance plan (coverage rules, fee schedules, prior auth records, eligibility snapshot)

**Flow:**
1. Agent 1 parses claim, extracts structured data, flags missing/invalid fields
2. Agent 2 validates eligibility as of DOS, checks coverage, prior auth, cost-sharing rules
3. Agent 3 applies payer fee schedule, calculates allowed amount vs billed, flags unbundling/upcoding
4. Agent 4 analyzes any denials/flags, classifies reason codes, recommends resubmission strategy
5. Agent 5 generates ERA/payment entries, posts to patient/provider accounts
6. Agent 6 calculates denial rate, days-in-AR, clean claim %, underpayment detection

**State:** Each agent stores its output in `all_results[agent_name]`. Next agent cherry-picks needed fields.

## Error Handling & Flags

**Flag propagation:** FLAGS from each agent feed directly into next agent's decision logic.
- Agent 1 -> flags parse errors, invalid codes
- Agent 2 -> blocks processing if patient inactive or coverage denied
- Agent 3 -> detects unbundling, upcoding, zero-allowed amounts
- Agent 4 -> classifies which errors are correctable vs hard denials
- Agent 5 -> skips posting if any ERROR-severity flags present

**Backpressure:** If Agent 2 flags "PATIENT_INACTIVE", agents 3+ should still complete analysis (for auditing) but mark claim status as "HOLD".

## Test Data Requirements

**Scale:** 50-100 claims across 5 scenarios

**Scenario 1: Clean Claims** (20 claims)
- Valid patient, active coverage, single payer
- All CPT/ICD-10 codes valid, DOS in past
- Exact allowed amount match or minor variance
- No denials

**Scenario 2: Denial Heavy** (15 claims)
- Missing prior auth (flag from Agent 2, denial from Agent 4)
- Coverage terminated before DOS
- Service excluded from plan
- Medical necessity mismatch

**Scenario 3: Coordination of Benefits (COB)** (10 claims)
- Patient has primary + secondary insurance
- Agent 2 flags COB requirement
- Agent 3 calculates primary responsibility, flags secondary coordination

**Scenario 4: Medicare/NCCI Edits** (10 claims)
- Medicare-specific bundling rules
- National Correct Coding Initiative edits detect unbundling
- Agent 3 detects violations

**Scenario 5: Underpayment & Writeoff** (10 claims)
- Billed amount > allowed amount by >50%
- Agent 3 calculates contractual adjustment
- Agent 5 posts insurance payment and write-off

**Data format:**
```json
{
  "claim_data": {
    "claim_id": "CLM-001",
    "patient": {...},
    "provider": {...},
    "service_lines": [...]
  },
  "payer_data": {
    "plan_name": "",
    "coverage_rules": {...},
    "fee_schedule": {...},
    "eligibility_snapshot": {...}
  }
}
```

## Access & Integration Points

**Payer data sources:**
- CMS RVS (Medicare fee schedule) - publicly available JSON/CSV
- NCCI Edits (Medicare bundling rules) - publicly available, parsed into rule engine
- Synthetic payer rules (United/Anthem/Blue Cross patterns) - hardcoded rule templates

**Real payer connections:** Optional. Phase 2 would integrate:
- Medicare.gov API for real eligibility checks
- Payer portals via OAuth for prior auth status, EOB retrieval
- EDI 270/271 for real-time eligibility (via third-party clearinghouse)

**For MVP:** All data is pre-loaded in `backend/data/samples/` as JSON.

## Compliance & Audit Trail

**Logging:**
- Each agent execution: input, output, execution time, model used, token count
- All flags and decisions logged to claim record
- No PII in logs (hash patient names, mask MRNs)

**Retention:** All claim processing records retained for 7 years (HIPAA requirement).

**Decision explainability:** Each denial/flag includes reasoning and rule reference so provider can understand the decision.

## Phase 1 (MVP)

1. Define agent prompts (5 agents core)
2. Build orchestrator with SSE streaming
3. 50-100 synthetic claims with 5 scenarios
4. FastAPI backend + Next.js frontend (mirrors Cash App)
5. Demo mode with `USE_FIXTURES=true`

## Phase 2 (Future)

1. RevenueAuditAgent (agent 6) - KPI dashboards, payer performance scoring
2. Real payer integrations (Medicare API, EDI 270/271)
3. Database backend (claim history, provider performance, trending)
4. Appeal workflow automation
