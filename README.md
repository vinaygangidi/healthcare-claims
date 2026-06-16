# Healthcare Claims Processing - Multi-Agent Pipeline

A 6-agent AI system for automating healthcare claims submission, eligibility verification, adjudication, and denial management.

## Architecture

```
ClaimParser -> Eligibility -> Adjudication -> DenialReasoning -> RemittancePosting -> RevenueAudit
```

### Agents

1. **ClaimParserAgent**: Parse raw claims, validate CPT/ICD-10 codes, flag missing/invalid data
2. **EligibilityAgent**: Validate patient coverage, check prior auth, calculate cost-sharing
3. **AdjudicationAgent**: Apply fee schedules, detect unbundling/upcoding, calculate allowed amounts
4. **DenialReasoningAgent**: Classify denials, recommend resubmission strategies
5. **RemittancePostingAgent**: Generate ERA entries, post payments, calculate patient balance
6. **RevenueAuditAgent**: Calculate KPIs such as clean claim rate, denial rate, days-in-AR, underpayments

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

- 6 agents defined with prompts
- Orchestrator with SSE streaming
- Sample test data (samples 01-05)
- Frontend React dashboard
- Real payer integrations (Medicare API, EDI) planned

## License

MIT
