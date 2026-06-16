"""
FastAPI backend for Healthcare Claims Processing Pipeline

Exposes:
- GET /health — service status
- GET /samples — list available sample datasets
- GET /demo-data — load sample claim and payer data
- POST /process — submit claim for processing, returns SSE stream
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import os
import json
import asyncio
from pathlib import Path
from dotenv import load_dotenv

# Load .env file
load_dotenv()

from agents.claims_pipeline import run_claims_pipeline

app = FastAPI(title="Healthcare Claims Processing", version="0.1.0")

# Allow the frontend (local dev + Vercel) to call this API from the browser
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Paths
DATA_DIR = Path(__file__).parent / "data"
SAMPLES_DIR = DATA_DIR / "samples"


class ClaimsRequest(BaseModel):
    claim_data: dict
    payer_data: dict


@app.get("/health")
async def health_check():
    """Service status check."""
    return {
        "status": "ok",
        "service": "Healthcare Claims Processing",
        "version": "0.1.0",
    }


@app.get("/samples")
async def list_samples():
    """List available sample datasets."""
    samples = []
    for sample_dir in sorted(SAMPLES_DIR.glob("sample_*")):
        meta_file = sample_dir / "meta.json"
        if meta_file.exists():
            with open(meta_file) as f:
                meta = json.load(f)
                samples.append(meta)
    return {"samples": samples}


@app.get("/demo-data")
async def get_demo_data(sample: str = "01"):
    """Load claim and payer data for a sample."""
    sample_dir = SAMPLES_DIR / f"sample_{sample}"
    if not sample_dir.exists():
        raise HTTPException(status_code=404, detail=f"Sample {sample} not found")

    claim_file = sample_dir / "claim_data.json"
    payer_file = sample_dir / "payer_data.json"

    if not claim_file.exists() or not payer_file.exists():
        raise HTTPException(status_code=404, detail="Sample files missing")

    with open(claim_file) as f:
        claim_data = json.load(f)
    with open(payer_file) as f:
        payer_data = json.load(f)

    return {
        "sample": sample,
        "claim_data": claim_data,
        "payer_data": payer_data,
    }


async def event_stream(claim_data: dict, payer_data: dict):
    """SSE event stream generator."""
    keepalive_task = None
    try:
        async def keepalive():
            while True:
                await asyncio.sleep(10)
                yield ": keepalive\n\n"

        async for event in run_claims_pipeline(claim_data, payer_data):
            data = json.dumps(event)
            yield f"data: {data}\n\n"

    finally:
        if keepalive_task:
            keepalive_task.cancel()


@app.post("/process")
async def process_claim(request: ClaimsRequest):
    """Process a healthcare claim, return SSE stream."""
    return StreamingResponse(
        event_stream(request.claim_data, request.payer_data),
        media_type="text/event-stream",
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8001)
