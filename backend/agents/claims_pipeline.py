"""
Healthcare Claims Processing Pipeline Orchestrator

Sequential pipeline: ClaimParser → Eligibility → Adjudication → DenialReasoning → RemittancePosting → RevenueAudit

Each agent is stateless; outputs stored in all_results dict and selectively passed to next agent.
"""

import json
import asyncio
from typing import AsyncGenerator
from openai import AsyncAzureOpenAI
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
import os

from . import (
    claim_parser_agent,
    eligibility_agent,
    adjudication_agent,
    denial_reasoning_agent,
    remittance_posting_agent,
    revenue_audit_agent,
)

AGENT_MODULES = {
    "ClaimParserAgent": claim_parser_agent,
    "EligibilityAgent": eligibility_agent,
    "AdjudicationAgent": adjudication_agent,
    "DenialReasoningAgent": denial_reasoning_agent,
    "RemittancePostingAgent": remittance_posting_agent,
    "RevenueAuditAgent": revenue_audit_agent,
}

AGENT_ORDER = [
    "ClaimParserAgent",
    "EligibilityAgent",
    "AdjudicationAgent",
    "DenialReasoningAgent",
    "RemittancePostingAgent",
    "RevenueAuditAgent",
]


def _extract_json(text: str) -> dict:
    """Extract the first complete JSON object from an LLM response.

    Handles markdown fences and any trailing text the model appends after the
    JSON (e.g. a "NEXT: AgentName" line or commentary), which would otherwise
    raise "Extra data" from json.loads.
    """
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
    start = text.find("{")
    if start < 0:
        return {}
    # Use raw_decode so parsing stops at the end of the first complete object
    # and any trailing content is ignored.
    decoder = json.JSONDecoder()
    try:
        obj, _ = decoder.raw_decode(text[start:])
        return obj
    except json.JSONDecodeError:
        # Fallback: try the widest brace span
        end = text.rfind("}") + 1
        if end > start:
            return json.loads(text[start:end])
        return {}


def _user_content(agent_name: str, all_results: dict, claim_data: dict, payer_data: dict) -> str:
    """Build user content for each agent by cherry-picking relevant prior outputs."""

    if agent_name == "ClaimParserAgent":
        return json.dumps(claim_data, indent=2)

    elif agent_name == "EligibilityAgent":
        claim = all_results.get("ClaimParserAgent", {})
        return json.dumps({
            "parsed_claim": claim,
            "payer_data": payer_data,
        }, indent=2)

    elif agent_name == "AdjudicationAgent":
        claim = all_results.get("ClaimParserAgent", {})
        eligibility = all_results.get("EligibilityAgent", {})
        return json.dumps({
            "parsed_claim": claim,
            "eligibility_result": eligibility,
            "fee_schedule": payer_data.get("fee_schedule", {}),
            "bundling_rules": payer_data.get("bundling_rules", []),
        }, indent=2)

    elif agent_name == "DenialReasoningAgent":
        claim = all_results.get("ClaimParserAgent", {})
        adjudication = all_results.get("AdjudicationAgent", {})
        return json.dumps({
            "parsed_claim": claim,
            "adjudication_result": adjudication,
        }, indent=2)

    elif agent_name == "RemittancePostingAgent":
        claim = all_results.get("ClaimParserAgent", {})
        eligibility = all_results.get("EligibilityAgent", {})
        adjudication = all_results.get("AdjudicationAgent", {})
        denial = all_results.get("DenialReasoningAgent", {})
        return json.dumps({
            "parsed_claim": claim,
            "eligibility_result": eligibility,
            "adjudication_result": adjudication,
            "denial_analysis": denial,
        }, indent=2)

    elif agent_name == "RevenueAuditAgent":
        return json.dumps({
            "all_results": all_results,
        }, indent=2)

    return ""


async def run_claims_pipeline(
    claim_data: dict,
    payer_data: dict,
) -> AsyncGenerator[dict, None]:
    """
    Run the healthcare claims pipeline, yielding SSE events.

    Yields:
        dict with keys: event, agent, ... (agent-specific fields)
    """

    # Use API key if available, otherwise use DefaultAzureCredential
    api_key = os.environ.get("AZURE_API_KEY")

    if api_key:
        client = AsyncAzureOpenAI(
            azure_endpoint=os.environ.get("AZURE_AI_ENDPOINT"),
            api_key=api_key,
            api_version=os.environ.get("AZURE_OPENAI_API_VERSION", "2024-12-01-preview"),
        )
    else:
        # Use DefaultAzureCredential for managed identity auth
        token_provider = get_bearer_token_provider(
            DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"
        )
        client = AsyncAzureOpenAI(
            azure_endpoint=os.environ.get("AZURE_AI_ENDPOINT"),
            azure_ad_token_provider=token_provider,
            api_version=os.environ.get("AZURE_OPENAI_API_VERSION", "2024-12-01-preview"),
        )

    all_results = {}

    for agent_name in AGENT_ORDER:
        agent_module = AGENT_MODULES[agent_name]
        prompt = agent_module.PROMPT
        meta = agent_module.META
        model_env_key = agent_module.MODEL_ENV_KEY
        default_model = agent_module.DEFAULT_MODEL
        max_tokens = agent_module.MAX_TOKENS

        model = os.environ.get(model_env_key, default_model)

        # Emit agent start event
        yield {
            "event": "agent_start",
            "agent": agent_name,
            "label": meta["label"],
            "icon": meta["icon"],
            "color": meta["color"],
            "model": model,
        }

        # Build user content
        user_content = _user_content(agent_name, all_results, claim_data, payer_data)

        # Call LLM
        full_response = ""
        try:
            stream = await client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": user_content},
                ],
                stream=True,
                max_tokens=max_tokens,
                temperature=0,
                timeout=300,
            )

            async for chunk in stream:
                if chunk.choices and len(chunk.choices) > 0 and chunk.choices[0].delta.content:
                    token = chunk.choices[0].delta.content
                    full_response += token
                    yield {
                        "event": "agent_token",
                        "agent": agent_name,
                        "token": token,
                    }

        except Exception as e:
            import traceback
            error_msg = f"Error calling {agent_name}: {str(e)}\n{traceback.format_exc()}"
            print(error_msg, flush=True)
            yield {
                "event": "error",
                "agent": agent_name,
                "message": f"Error calling {agent_name}: {str(e)}",
            }
            continue

        # Extract and store JSON result
        try:
            result = _extract_json(full_response)
            all_results[agent_name] = result
            yield {
                "event": "agent_complete",
                "agent": agent_name,
                "output": result,
            }
        except Exception as e:
            yield {
                "event": "error",
                "agent": agent_name,
                "message": f"Failed to parse {agent_name} output: {str(e)}",
            }

    # Emit final result
    yield {
        "event": "pipeline_complete",
        "results": all_results,
    }
