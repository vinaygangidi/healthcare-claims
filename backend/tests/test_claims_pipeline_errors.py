"""Tests for SSE error redaction in agents/claims_pipeline.py.

These tests mock the Azure OpenAI client entirely (via the `client` param
injected into run_claims_pipeline) -- no real Azure call is ever made. A
separate, opt-in integration suite would be needed to validate against the
live Azure OpenAI service.
"""

import re
import uuid

import httpx
import openai
import pytest

from agents.claims_pipeline import run_claims_pipeline

FAKE_PHI_MARKER = "member_id: FAKE123"
UUID4_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


async def _run_and_collect(claim_data, payer_data, client):
    events = []
    async for event in run_claims_pipeline(claim_data, payer_data, client=client):
        events.append(event)
    return events


@pytest.mark.anyio
async def test_llm_stream_error_is_redacted_from_client_event_and_logs(
    fake_azure_client, caplog
):
    """LLM-streaming exception path: str(e) must never reach the browser or logs."""
    error = RuntimeError(f"upstream failure, request body was: {FAKE_PHI_MARKER}")
    client = fake_azure_client(error=error)

    with caplog.at_level("ERROR"):
        events = await _run_and_collect({"claims": [{}]}, {}, client=client)

    error_events = [e for e in events if e["event"] == "error"]
    assert error_events, "expected at least one error event"
    first_error = error_events[0]

    assert FAKE_PHI_MARKER not in first_error["message"]
    assert "request_id" in first_error
    assert UUID4_RE.match(first_error["request_id"])

    # No log record anywhere should contain the PHI marker.
    for record in caplog.records:
        assert FAKE_PHI_MARKER not in record.getMessage()
        assert FAKE_PHI_MARKER not in str(record.exc_info)


@pytest.mark.anyio
async def test_json_parse_error_is_redacted_from_client_event_and_logs(
    fake_azure_client, caplog, monkeypatch
):
    """JSON-parse exception path: full_response content must never leak."""
    # Force the JSON extraction to fail so the except block in the parse
    # path is exercised, while the streamed tokens themselves carry the
    # marker (simulating PHI-shaped content in the raw response).
    # NOTE: this relies on _extract_json's rfind("}") fallback re-raising
    # rather than swallowing the error and returning {} -- if that fallback
    # is ever changed to return {} on failure, this test would pass
    # vacuously (no exception, no error event) and must be revisited.
    client = fake_azure_client(tokens=[f"{{not valid json}} {FAKE_PHI_MARKER} }}"])

    with caplog.at_level("ERROR"):
        events = await _run_and_collect({"claims": [{}]}, {}, client=client)

    error_events = [e for e in events if e["event"] == "error"]
    assert error_events, "expected at least one error event"
    first_error = error_events[0]

    assert FAKE_PHI_MARKER not in first_error["message"]
    assert "request_id" in first_error
    assert UUID4_RE.match(first_error["request_id"])

    for record in caplog.records:
        assert FAKE_PHI_MARKER not in record.getMessage()
        assert FAKE_PHI_MARKER not in str(record.exc_info)


@pytest.mark.anyio
async def test_happy_path_agent_complete_still_yields_parsed_result(fake_azure_client):
    """Regression: normal JSON responses still flow through as agent_complete."""
    tokens = ['{"claim_id": "C1", "service_lines": [], "flags": []}']
    client = fake_azure_client(tokens=tokens)

    events = await _run_and_collect({"claims": [{}]}, {}, client=client)

    complete_events = [e for e in events if e["event"] == "agent_complete"]
    assert complete_events, "expected at least one agent_complete event"
    assert complete_events[0]["output"]["claim_id"] == "C1"


@pytest.mark.anyio
async def test_chunks_without_choices_are_skipped(fake_azure_client):
    """Azure emits choice-less chunks (content-filter/usage); they must not crash."""
    tokens = ['{"claim_id": "C1"', fake_azure_client.NO_CHOICES, ', "flags": []}']
    client = fake_azure_client(tokens=tokens)

    events = await _run_and_collect({"claims": [{}]}, {}, client=client)

    assert not [e for e in events if e["event"] == "error"]
    complete_events = [e for e in events if e["event"] == "agent_complete"]
    assert complete_events, "expected at least one agent_complete event"
    assert complete_events[0]["output"]["claim_id"] == "C1"


def _azure_error_with_body(body):
    """Build a real openai.BadRequestError carrying the given response body.

    Azure content-filter 400s can echo prompt fragments into body fields, and
    the SDK surfaces body["code"] on the exception without coercing it to a
    string -- so this is the realistic shape of a PHI-carrying SDK exception.
    """
    request = httpx.Request("POST", "https://example.invalid/v1/chat")
    response = httpx.Response(400, request=request)
    return openai.BadRequestError("bad request", response=response, body=body)


@pytest.mark.anyio
async def test_structured_sdk_exception_does_not_leak_code_body_into_logs(
    fake_azure_client, caplog
):
    """A real SDK exception whose `code` carries body content must be redacted.

    openai's APIStatusError builds `.code` from the response body without
    coercing to str, so a nested dict passes straight through. Logging it
    verbatim would defeat the redaction, so only str-shaped codes are logged.
    """
    error = _azure_error_with_body(
        {"code": {"nested": FAKE_PHI_MARKER}, "message": FAKE_PHI_MARKER}
    )
    client = fake_azure_client(error=error)

    with caplog.at_level("ERROR"):
        events = await _run_and_collect({"claims": [{}]}, {}, client=client)

    error_events = [e for e in events if e["event"] == "error"]
    assert error_events, "expected at least one error event"
    assert FAKE_PHI_MARKER not in error_events[0]["message"]

    for record in caplog.records:
        assert FAKE_PHI_MARKER not in record.getMessage()
        assert FAKE_PHI_MARKER not in str(record.exc_info)


@pytest.mark.anyio
async def test_structured_sdk_exception_still_logs_safe_scalar_fields(
    fake_azure_client, caplog
):
    """Redaction must not blind the logs: safe status_code/code still recorded."""
    error = _azure_error_with_body({"code": "content_filter", "message": FAKE_PHI_MARKER})
    client = fake_azure_client(error=error)

    with caplog.at_level("ERROR"):
        await _run_and_collect({"claims": [{}]}, {}, client=client)

    logged = " ".join(record.getMessage() for record in caplog.records)
    assert "status_code=400" in logged
    assert "content_filter" in logged
    assert "BadRequestError" in logged
    assert FAKE_PHI_MARKER not in logged
