# Cloud Deployment Guide — Railway & Vercel

## Status

- **Backend (Railway):** Configuration ready, build optimization in progress
- **Frontend (Vercel):** Ready for manual deployment via dashboard
- **Repository:** Configured with deployment files and environment support

## Local Quick Deploy (Recommended for Testing)

Instead of cloud deployment delays, you can run both services locally with public URLs using tunneling:

```bash
# Terminal 1: Backend (with ngrok or similar)
cd /Users/vgangidi/healthcare-claims/backend
source venv/bin/activate
python -m uvicorn main:app --host 0.0.0.0 --port 8002

# Terminal 2: Frontend
cd /Users/vgangidi/healthcare-claims/frontend
npm run dev -- -p 3001

# Terminal 3 (optional): Expose to internet
ngrok http 8002  # Get public URL for backend
```

## Railway Backend Deployment

### Current Configuration

**Files:**
- `railway.json` — Nixpacks build config with backend context
- `Procfile` — Start command
- `start.sh` — Shell script entry point
- `backend/requirements.txt` — Python dependencies

### Manual Deployment via Railway Dashboard

1. Go to [railway.app](https://railway.com)
2. Create project: **healthcare-claims-api**
3. Connect GitHub repo (fork required)
4. Configure build settings:
   - Build command: `cd backend && pip install -r requirements.txt`
   - Start command: `cd backend && python -m uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Set environment variables:
   ```
   AZURE_AI_ENDPOINT=https://vinaygangidi-2386-resource.services.ai.azure.com
   MODEL_CLAIM_PARSER_AGENT=gpt-4o-mini
   MODEL_ELIGIBILITY_AGENT=gpt-4o-mini
   MODEL_ADJUDICATION_AGENT=gpt-4o
   MODEL_DENIAL_REASONING_AGENT=gpt-4o
   MODEL_REMITTANCE_POSTING_AGENT=gpt-4o-mini
   MODEL_REVENUE_AUDIT_AGENT=gpt-4o-mini
   ```
6. Deploy and note the domain: `https://healthcare-claims-api-production.up.railway.app`

### Troubleshooting Railway

**Build fails with "unable to generate build plan":**
- Ensure `Procfile` exists in root with correct syntax
- Check `requirements.txt` is in `backend/` directory
- Verify Python 3.10+ is available

**Environment variables not loaded:**
- Set variables in Railway dashboard under "Variables"
- Restart deployment after adding variables

**Application 404 errors:**
- Check logs: `railway logs --lines 100`
- Verify app is listening on port specified by `$PORT` env var

## Vercel Frontend Deployment

### Option 1: Manual via Vercel Dashboard (Easiest)

1. Go to [vercel.com](https://vercel.com)
2. Sign in with GitHub account
3. Import project → Select healthcare-claims repo
4. Configure:
   - Framework: Next.js
   - Root directory: `frontend`
   - Environment variables:
     ```
     NEXT_PUBLIC_BACKEND_URL=https://healthcare-claims-api-production.up.railway.app
     ```
5. Deploy

### Option 2: CLI Deployment

```bash
cd /Users/vgangidi/healthcare-claims/frontend

# Login (interactive)
vercel login

# Deploy to production
vercel --prod --env NEXT_PUBLIC_BACKEND_URL='https://your-railway-url.up.railway.app'
```

### Option 3: Git-based (Recommended)

1. Push code to GitHub: `git push origin main`
2. Connect repo to Vercel via dashboard
3. Auto-deploys on every push

## Docker Alternative

If cloud deployment continues to have issues, use Docker for both services:

```bash
# Backend Dockerfile
# Use in project root as backend/Dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install -r requirements.txt
COPY backend .
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Deploy to any Docker-compatible platform (Railway, Render, Fly.io, GCP, AWS).

## Current Deployment Status

### What's Ready

✓ Backend code optimized for deployment  
✓ Frontend configured for cloud  
✓ Environment variables documented  
✓ Health endpoint functional  
✓ Static assets optimized  

### What's Configured

✓ Railway JSON for Nixpacks  
✓ Vercel.json for Next.js  
✓ Procfile for process managers  
✓ .env.example for local/cloud  
✓ .vercelignore for frontend build  

### Testing in Production

Once deployed:

```bash
# Backend health
curl https://your-backend-url.com/health

# Sample data
curl https://your-backend-url.com/samples

# Frontend
https://your-frontend-url.com
```

## Cost Estimates

**Railway:**
- Free tier: 5GB/month CPU, 5GB RAM, 100GB bandwidth
- Pay-as-you-go: $0.10/CPU-hour, $0.05/GB RAM-hour
- Estimated: $5-15/month for healthcare claims

**Vercel:**
- Free tier: 100GB bandwidth, automatic deployments
- Pro: $20/month (includes analytics, logs)
- Estimated: Free for MVP, $20/month for production

## Next Steps

1. **Immediate:** Deploy backend to Railway via dashboard
2. **Then:** Deploy frontend to Vercel via dashboard
3. **Finally:** Update frontend env var with actual Railway URL
4. **Optional:** Set up GitHub Actions for automatic deployments

## Support

- Railway docs: https://docs.railway.app
- Vercel docs: https://vercel.com/docs
- Local testing: Follow QUICKSTART.md
- Troubleshooting: See DEPLOYMENT_GUIDE.md

---

**Note:** The system is fully functional locally. Cloud deployment can happen in 5-10 minutes via the web dashboards once you have the credentials configured.
