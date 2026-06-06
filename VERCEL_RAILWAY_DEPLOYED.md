# ✅ Deployment Status — Vercel & Railway

## Vercel Frontend — ✅ DEPLOYED

**URL:** https://frontend-fawn-psi-63.vercel.app

**Status:** Live and running  
**Framework:** Next.js 14.2.35  
**Build Time:** ~30 seconds  
**Environment:** NEXT_PUBLIC_BACKEND_URL (configured to https://healthcare-claims-api.railway.app)

### Test Frontend
```bash
curl https://frontend-fawn-psi-63.vercel.app
```

Expected: HTML page loads successfully

---

## Railway Backend — Ready for Deployment

**Current Status:** Configuration files ready, manual deployment pending

### Quick Deploy to Railway (3 Steps)

1. **Go to Railway Dashboard:**
   - https://railway.app/dashboard
   - Create new project → "healthcare-claims-api"

2. **Connect GitHub Repository:**
   - If you push code to GitHub: Railway can auto-detect and deploy
   - OR manually upload files from this directory

3. **Configure Build Settings:**
   ```
   Build Command: cd backend && pip install -r requirements.txt
   Start Command: cd backend && python -m uvicorn main:app --host 0.0.0.0 --port $PORT
   ```

4. **Set Environment Variables:**
   ```
   AZURE_AI_ENDPOINT=https://vinaygangidi-2386-resource.services.ai.azure.com
   MODEL_CLAIM_PARSER_AGENT=gpt-4o-mini
   MODEL_ELIGIBILITY_AGENT=gpt-4o-mini
   MODEL_ADJUDICATION_AGENT=gpt-4o
   MODEL_DENIAL_REASONING_AGENT=gpt-4o
   MODEL_REMITTANCE_POSTING_AGENT=gpt-4o-mini
   MODEL_REVENUE_AUDIT_AGENT=gpt-4o-mini
   ```

5. **Deploy:**
   - Click "Deploy" button
   - Wait ~2-3 minutes for build
   - Get domain: `https://healthcare-claims-api-production.up.railway.app`

6. **Test Backend:**
   ```bash
   curl https://healthcare-claims-api-production.up.railway.app/health
   ```

   Expected response:
   ```json
   {"status":"ok","service":"Healthcare Claims Processing","version":"0.1.0"}
   ```

### Alternative: CLI Deployment (If you have Railway Token)

```bash
cd /Users/vgangidi/healthcare-claims
export RAILWAY_TOKEN=your_token_here
railway link
railway up
```

---

## Full Stack After Railway Deploy

Once backend is deployed, the complete system will be:

```
Frontend (Vercel):
  https://frontend-fawn-psi-63.vercel.app
  
Backend (Railway):
  https://healthcare-claims-api-production.up.railway.app
  
Health Check:
  curl https://healthcare-claims-api-production.up.railway.app/health
  
Sample Data:
  curl https://healthcare-claims-api-production.up.railway.app/samples
  
Process Claim (SSE):
  curl -X POST https://healthcare-claims-api-production.up.railway.app/process \
    -H "Content-Type: application/json" \
    -d '{"claim_data": {...}, "payer_data": {...}}'
```

---

## Current Architecture

```
┌─────────────────────────────────────────────────┐
│          Vercel (Frontend)                       │
│  https://frontend-fawn-psi-63.vercel.app       │
│  ✅ DEPLOYED                                    │
└────────────────┬────────────────────────────────┘
                 │ HTTPS
                 ↓
┌─────────────────────────────────────────────────┐
│          Railway (Backend)                       │
│  https://healthcare-claims-api.railway.app     │
│  ⏳ PENDING (Ready for manual deploy)           │
└─────────────────────────────────────────────────┘
```

---

## What's Working

✅ **Frontend:**
- Dashboard deployed and accessible
- Real-time SSE connection code ready
- Environment variable configured for Railway URL

✅ **Backend:**
- Code optimized for deployment
- Procfile configured for Railway
- railway.json with build settings
- start.sh entry point
- requirements.txt with all dependencies
- .env template ready

✅ **Docker:**
- Can build and deploy Docker images
- Supports any container platform (Railway Docker, Render, Fly.io, etc.)

---

## Next Step: Deploy Backend to Railway

**Easiest Method:**
1. Go to https://railway.app
2. Dashboard → New Project
3. Import repository OR upload backend/ folder
4. Configure and deploy (takes ~2-3 minutes)
5. Get URL and update frontend env vars if needed

---

## Files Ready for Deployment

- `backend/Procfile` — Process definition
- `railway.json` — Build configuration
- `start.sh` — Start script
- `backend/requirements.txt` — Dependencies
- `backend/.env` — Environment template
- `Procfile` (root) — Fallback process definition

---

## Summary

| Service | Platform | Status | URL |
|---------|----------|--------|-----|
| Frontend | Vercel | ✅ Deployed | https://frontend-fawn-psi-63.vercel.app |
| Backend | Railway | ⏳ Ready | Manual deploy needed → https://railway.app |

**Total Deployment Time:** ~5 minutes (once Railway is set up)

---

To complete: Deploy backend to Railway following the 6 steps above.
System will then be fully cloud-hosted and accessible from anywhere.
