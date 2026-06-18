"""
Healthcare Claims Processing Pipeline Orchestrator

Sequential pipeline: ClaimParser -> Eligibility -> Adjudication -> DenialReasoning -> RemittancePosting -> RevenueAudit

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
            "persona": meta.get("persona", ""),
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
            continue

        # Emit a handoff signal describing what this agent is passing to the next
        handoff = _build_handoff(agent_name, result, all_results)
        if handoff:
            yield {
                "event": "agent_handoff",
                "from_agent": agent_name,
                "to_agent": handoff["to"],
                "message": handoff["message"],
                "flags": handoff.get("flags", []),
                "escalate": handoff.get("escalate", False),
            }

    # Emit final result
    yield {
        "event": "pipeline_complete",
        "results": all_results,
    }


def _build_handoff(agent_name: str, result: dict, all_results: dict) -> dict | None:
    """Derive an agent-to-agent handoff message from what the agent just decided."""

    if agent_name == "ClaimParserAgent":
        flags = result.get("flags", [])
        errors = [f for f in flags if f.get("severity") == "ERROR"]
        warnings = [f for f in flags if f.get("severity") == "WARNING"]
        service_count = len(result.get("service_lines", []))
        if errors:
            msg = (
                f"Sofia flagged {len(errors)} ERROR(s) on {service_count} service line(s) -- "
                f"handing to David (Eligibility) with priority review. Errors: "
                + "; ".join(f['flag_code'] for f in errors[:3])
            )
            return {"to": "EligibilityAgent", "message": msg, "flags": [f['flag_code'] for f in errors], "escalate": True}
        elif warnings:
            msg = (
                f"Sofia extracted {service_count} service line(s) with {len(warnings)} warning(s). "
                f"Passing structured claim to David (Eligibility) for coverage check."
            )
            return {"to": "EligibilityAgent", "message": msg, "flags": [f['flag_code'] for f in warnings]}
        else:
            msg = (
                f"Sofia confirmed clean parse: {service_count} service line(s), "
                f"no flags. Passing to David (Eligibility) for coverage validation."
            )
            return {"to": "EligibilityAgent", "message": msg, "flags": []}

    elif agent_name == "EligibilityAgent":
        is_eligible = result.get("is_eligible", True)
        cob = result.get("coordination_of_benefits", {})
        has_cob = bool(cob and cob.get("primary_payer"))
        flags = result.get("flags", [])
        auth_flags = [f for f in flags if "AUTH" in f.get("flag_code", "").upper()]
        if not is_eligible:
            msg = (
                "David determined patient is NOT eligible on date of service. "
                "Escalating to Maria (Adjudication) to calculate zero-payment adjudication and flag for denial."
            )
            return {"to": "AdjudicationAgent", "message": msg, "flags": ["PATIENT_INELIGIBLE"], "escalate": True}
        elif auth_flags:
            msg = (
                f"David found {len(auth_flags)} prior authorization issue(s). "
                "Escalating to Maria (Adjudication) -- auth gaps may trigger line-level denials."
            )
            return {"to": "AdjudicationAgent", "message": msg, "flags": [f['flag_code'] for f in auth_flags], "escalate": True}
        elif has_cob:
            msg = (
                "David confirmed COB: patient has dual coverage. "
                "Passing primary payer share to Maria (Adjudication); secondary coordination will follow in Posting."
            )
            return {"to": "AdjudicationAgent", "message": msg, "flags": ["COB_DETECTED"]}
        else:
            plan = result.get("patient", {}).get("plan_name", "plan")
            msg = (
                f"David confirmed eligibility on date of service under {plan}. "
                "Passing cost-sharing terms to Maria (Adjudication) for fee schedule application."
            )
            return {"to": "AdjudicationAgent", "message": msg, "flags": []}

    elif agent_name == "AdjudicationAgent":
        status = result.get("adjudication_status", "")
        lines = result.get("service_lines", [])
        bundling_flags = [l for l in lines if l.get("bundling_violation")]
        denied_lines = [l for l in lines if (l.get("insurance_pays") or 0) == 0 and l.get("allowed_amount", 1) == 0]
        totals = result.get("claim_totals", {})
        ins_pays = totals.get("total_insurance_pays", 0)
        if bundling_flags:
            msg = (
                f"Maria detected {len(bundling_flags)} NCCI bundling violation(s) on {len(lines)} line(s). "
                "Escalating to James (Denial Prevention) -- bundled lines require recode before resubmission."
            )
            return {"to": "DenialReasoningAgent", "message": msg, "flags": ["NCCI_VIOLATION"], "escalate": True}
        elif denied_lines or "DENIED" in status.upper():
            msg = (
                f"Maria calculated $0 allowable on {len(denied_lines)} line(s) (status: {status}). "
                "Passing denial details to James (Denial Prevention) for root-cause classification."
            )
            return {"to": "DenialReasoningAgent", "message": msg, "flags": ["ZERO_ALLOWABLE"], "escalate": True}
        else:
            msg = (
                f"Maria approved adjudication: insurance pays ${ins_pays:.2f}. "
                "Passing approved amounts to James (Denial Prevention) for final clearance check."
            )
            return {"to": "DenialReasoningAgent", "message": msg, "flags": []}

    elif agent_name == "DenialReasoningAgent":
        count = result.get("total_denial_count", 0)
        denials = result.get("denials", [])
        correctable = [d for d in denials if d.get("is_correctable")]
        hard = [d for d in denials if not d.get("is_correctable", True)]
        if hard:
            msg = (
                f"James classified {len(hard)} hard denial(s) and {len(correctable)} correctable denial(s). "
                "Passing to Priya (Payment Posting) -- hard denials will be posted as zero-pay with denial codes."
            )
            return {"to": "RemittancePostingAgent", "message": msg, "flags": ["HARD_DENIAL"], "escalate": True}
        elif correctable:
            msg = (
                f"James identified {len(correctable)} correctable denial(s) with resubmission guidance. "
                "Passing to Priya (Payment Posting) to post partial payment and queue appeals."
            )
            return {"to": "RemittancePostingAgent", "message": msg, "flags": ["CORRECTABLE_DENIAL"]}
        elif count == 0:
            msg = (
                "James confirmed no denials. "
                "Releasing clean claim to Priya (Payment Posting) for ERA generation and GL posting."
            )
            return {"to": "RemittancePostingAgent", "message": msg, "flags": []}
        else:
            msg = (
                f"James flagged {count} denial(s). Passing to Priya (Payment Posting) for posting."
            )
            return {"to": "RemittancePostingAgent", "message": msg, "flags": ["DENIAL_PRESENT"]}

    elif agent_name == "RemittancePostingAgent":
        totals = result.get("claim_totals", {})
        ins = totals.get("total_insurance_pays", 0)
        patient = totals.get("total_patient_responsibility", 0)
        gl_count = len(result.get("gl_entries", []))
        msg = (
            f"Priya posted {gl_count} GL entries: insurance ${ins:.2f}, patient responsibility ${patient:.2f}. "
            "Passing full claim ledger to Alex (Revenue Integrity) for KPI analysis and underpayment detection."
        )
        return {"to": "RevenueAuditAgent", "message": msg, "flags": []}

    return None
