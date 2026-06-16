# Quick Start - Healthcare Claims Processing

## 30-Second Setup

```bash
# Terminal 1: Backend
cd /Users/vgangidi/healthcare-claims/backend
source venv/bin/activate
python -m uvicorn main:app --port 8002

# Terminal 2: Frontend
cd /Users/vgangidi/healthcare-claims/frontend
npm run dev -- -p 3001
```

**Open:** http://localhost:3001

## What You'll See

1. Dashboard with 5 test scenarios
2. Select "Sample 01: Clean Claims"
3. Click "Process Claim"
4. Watch 6 agents stream in real-time:
   -  Claim Parser
   -  Eligibility
   -  Adjudication
   -  Denial Reasoning
   -  Remittance Posting
   -  Revenue Audit

## Files to Know

- `backend/agents/*.py` - Agent implementations
- `backend/main.py` - FastAPI server
- `frontend/app/page.js` - React dashboard
- `TEST_SCENARIOS.md` - What each scenario tests
- `DEPLOYMENT_GUIDE.md` - Full setup & testing

## Key Endpoints

- `GET http://localhost:8002/health` - Service status
- `GET http://localhost:8002/samples` - Available scenarios
- `POST http://localhost:8002/process` - Process claim (SSE stream)

## Troubleshooting

**Backend won't start:**
- Check venv is activated
- Verify `backend/requirements.txt` installed
- Ensure port 8002 is free

**Frontend won't load:**
- Check npm installed dependencies
- Ensure port 3001 is free
- Verify backend running on 8002

**Agents fail:**
- Check Azure credentials in `backend/.env`
- Verify Azure OpenAI models available (gpt-4o, gpt-4o-mini)

## Next Steps

1. Test all 5 scenarios (samples 01-05)
2. Explore `SYSTEM_DESIGN.md` for architecture
3. Read `TEST_SCENARIOS.md` for edge cases
4. See `DEPLOYMENT_GUIDE.md` for production setup

**That's it!** You now have a working multi-agent healthcare claims system.
