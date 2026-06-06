# Healthcare Claims Processing — Deployment & Testing Guide

## Project Status

✅ **Complete MVP** with backend + frontend, tested with real Azure OpenAI.

## Running Locally

### Prerequisites

- Python 3.10+
- Node.js 18+
- Azure AI Foundry credentials (AZURE_AI_ENDPOINT, DefaultAzureCredential auth)

### Backend Setup

```bash
cd /Users/vgangidi/healthcare-claims/backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# .env already configured with Azure credentials
python -m uvicorn main:app --port 8002
```

Verify:
```bash
curl http://localhost:8002/health
```

### Frontend Setup

```bash
cd /Users/vgangidi/healthcare-claims/frontend
npm install
npm run dev -- -p 3001
```

Navigate to: **http://localhost:3001**

## Testing the Pipeline

### Test 1: Clean Claim (Sample 01)

1. Open dashboard at http://localhost:3001
2. Select "Sample 01: Clean Claims"
3. Click "Process Claim"
4. Watch agents stream in real-time:
   - 🔹 Claim Parser — 0 flags
   - 🔹 Eligibility — Eligible
   - 🔹 Adjudication — APPROVED
   - 🔹 Denial Reasoning — 0 denials
   - 🔹 Remittance Posting — Payment calculated
   - 🔹 Revenue Audit — 100% clean rate

**Expected:** All 6 agents complete successfully, final result shows clean claim metrics.

### Test 2: Denial Heavy (Sample 02)

1. Select "Sample 02: Denial Heavy"
2. Click "Process Claim"
3. Review "Denial" tab for classified reasons (CO-4, PR-1, etc.)
4. Check "Posting" tab for payment blocking logic

**Expected:** Multiple denials detected, resubmission guidance provided.

### Test 3: COB (Sample 03)

1. Select "Sample 03: COB"
2. Review "Audit" tab for primary/secondary payer split

**Expected:** Claims processed by both primary and secondary, ERA entries generated.

### Test 4: Medicare/NCCI (Sample 04)

1. Select "Sample 04: NCCI"
2. Check "Adjudication" tab for unbundling detection
3. Review "Parser" tab for missing modifier flags

**Expected:** Bundling violations detected, fee schedule recalculated.

### Test 5: Underpayment (Sample 05)

1. Select "Sample 05: Underpayment"
2. Review "Adjudication" tab for variance alerts
3. Check "Posting" tab for contractual write-offs

**Expected:** Large variance detected, write-off posted.

## API Reference

### Endpoints

#### `GET /health`
Service status check.

**Response:**
```json
{
  "status": "ok",
  "service": "Healthcare Claims Processing",
  "version": "0.1.0"
}
```

#### `GET /samples`
List available test scenarios.

**Response:**
```json
{
  "samples": [
    {
      "sample_id": "01",
      "label": "Clean Claims — Single Payer, No Issues",
      "claim_count": 5,
      "theme": "CLEAN"
    },
    ...
  ]
}
```

#### `GET /demo-data?sample=01`
Load test claim and payer data.

**Response:**
```json
{
  "sample": "01",
  "claim_data": { ... },
  "payer_data": { ... }
}
```

#### `POST /process`
Process a claim through the 6-agent pipeline.

**Request:**
```json
{
  "claim_data": { ... },
  "payer_data": { ... }
}
```

**Response:** Server-Sent Events (SSE) stream

```
data: {"event": "agent_start", "agent": "ClaimParserAgent", "label": "Claim Parser", "model": "gpt-4o-mini"}
data: {"event": "agent_token", "agent": "ClaimParserAgent", "token": "{"}
...
data: {"event": "agent_complete", "agent": "ClaimParserAgent", "output": {...}}
...
data: {"event": "pipeline_complete", "results": {...}}
```

## Architecture Overview

### Backend (Python/FastAPI)

```
backend/
├── main.py                          # FastAPI app, routes
├── agents/
│   ├── claim_parser_agent.py        # Parse + validate claim
│   ├── eligibility_agent.py         # Check coverage
│   ├── adjudication_agent.py        # Fee schedule + allowed amounts
│   ├── denial_reasoning_agent.py    # Classify denials
│   ├── remittance_posting_agent.py  # Generate ERA/payment
│   ├── revenue_audit_agent.py       # KPI calculation
│   └── claims_pipeline.py           # Orchestrator
├── data/samples/                    # Test scenarios
└── requirements.txt
```

### Frontend (React/Next.js)

```
frontend/
├── app/
│   ├── page.js              # Main dashboard
│   ├── layout.js            # Root layout
│   └── globals.css          # Styles
├── next.config.js           # API proxy config
└── package.json
```

## Data Flow

```
User Input (Sample)
        ↓
   Demo-Data API
        ↓
Process Endpoint (SSE)
        ↓
Orchestrator Loop:
    Agent 1 → results[1]
    Agent 2 → results[2] (uses results[1])
    Agent 3 → results[3] (uses results[1,2])
    ... (Agent 4, 5, 6)
        ↓
Frontend (SSE Listener)
        ↓
Update UI (Agent Status + Results)
```

## Performance

### Latency (Per Claim)

- ClaimParserAgent: ~5-8 sec
- EligibilityAgent: ~5-8 sec
- AdjudicationAgent: ~8-12 sec (complex)
- DenialReasoningAgent: ~6-10 sec
- RemittancePostingAgent: ~5-8 sec
- RevenueAuditAgent: ~4-7 sec

**Total:** 30-50 seconds per claim (all LLM calls serial, not parallel)

### Optimization Opportunities

1. **Parallel agents** (agents 2-6 don't depend on each other; only agent 1 is blocking)
2. **Agent batching** (process multiple claims in parallel)
3. **Response caching** (for identical patient/payer combinations)
4. **Prompt optimization** (reduce token count per agent)

## Troubleshooting

### Backend won't start

```bash
# Check Azure credentials
echo $AZURE_AI_ENDPOINT

# Test API connection
curl http://localhost:8002/health
```

### Frontend won't connect to backend

```bash
# Check proxy config in next.config.js
# Verify backend is running on 8002
curl http://localhost:8002/samples
```

### Agent processing stalls

1. Check backend logs: `tail /tmp/hc_backend.log`
2. Verify Azure OpenAI model is available: `gpt-4o`, `gpt-4o-mini`
3. Check rate limits on Azure account

### Claims fail to parse

1. Verify claim_data.json matches schema (see DATA_DICTIONARY.md)
2. Check LLM response: Add debug prints to `_extract_json()`

## Production Deployment

### Recommended Stack

- **Backend:** Azure App Service + Azure Database for PostgreSQL
- **Frontend:** Azure Static Web Apps + Azure CDN
- **Database:** PostgreSQL (claim history, audit trail)
- **Auth:** Azure AD / Entra ID
- **Monitoring:** Azure Application Insights

### Before Production

- [ ] Set `USE_FIXTURES=false` in backend .env
- [ ] Add database migrations for claim persistence
- [ ] Implement user authentication
- [ ] Add rate limiting and request validation
- [ ] Enable HTTPS/TLS
- [ ] Set up automated backups
- [ ] Add comprehensive error handling
- [ ] Implement claim history retention policies
- [ ] HIPAA compliance audit (if handling real patient data)

## Testing Checklist

- [ ] All 5 sample scenarios process without error
- [ ] Agent pipeline completes in <60 seconds per claim
- [ ] JSON schemas validate for all agents
- [ ] Frontend displays results correctly for all tabs
- [ ] No console errors in browser DevTools
- [ ] SSE connection remains open during streaming
- [ ] Backend logs show proper error handling
- [ ] Database transactions are atomic (when added)

## Next Steps

1. **Phase 2:** Add database backend + claim history
2. **Phase 3:** Real payer integrations (CMS RVS, NCCI)
3. **Phase 4:** User dashboard + multi-tenancy
4. **Phase 5:** Mobile app / API for integrations

---

**Support:** Check README.md, SYSTEM_DESIGN.md, TEST_SCENARIOS.md for more details.
