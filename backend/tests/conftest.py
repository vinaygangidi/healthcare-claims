"""Shared pytest fixtures for the backend test suite.

All Azure OpenAI calls are mocked here -- no test in this suite should ever
reach a real Azure endpoint. A separate, opt-in integration suite (not
included here) would be needed to validate against the live service.
"""

import pytest
from fastapi.testclient import TestClient

from main import app


@pytest.fixture
def anyio_backend():
    """Restrict anyio-marked async tests to the asyncio backend (no trio dep)."""
    return "asyncio"


@pytest.fixture
def client():
    """TestClient wrapping the FastAPI app, with CORS middleware attached."""
    return TestClient(app)


#: Sentinel token that produces a chunk with an empty `choices` list. Azure
#: emits these for content-filter annotations and the trailing usage chunk,
#: which is what the `chunk.choices and len(...)` guard in the pipeline
#: defends against.
NO_CHOICES = object()


class FakeStreamChunk:
    """Mimics a single chunk yielded by the Azure OpenAI streaming API."""

    def __init__(self, content):
        if content is NO_CHOICES:
            self.choices = []
            return
        delta = type("Delta", (), {"content": content})()
        choice = type("Choice", (), {"delta": delta})()
        self.choices = [choice]


class FakeStream:
    """Async iterator mimicking the streaming response from chat.completions.create."""

    def __init__(self, tokens):
        self._tokens = list(tokens)

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._tokens:
            raise StopAsyncIteration
        token = self._tokens.pop(0)
        return FakeStreamChunk(token)


class FakeAzureClient:
    """Mocked AsyncAzureOpenAI client.

    Configure `tokens` to control the streamed response, or `error` to make
    the call raise instead of streaming.
    """

    def __init__(self, tokens=None, error=None):
        self._tokens = tokens or []
        self._error = error
        self.chat = type("Chat", (), {})()
        self.chat.completions = type("Completions", (), {})()

        async def create(**kwargs):
            if self._error is not None:
                raise self._error
            return FakeStream(self._tokens)

        self.chat.completions.create = create


@pytest.fixture
def fake_azure_client():
    """Factory fixture: call with tokens=[...] or error=Exception(...) to build a fake client.

    Pass the factory's `NO_CHOICES` attribute as a token to emit a chunk with
    an empty `choices` list, mimicking Azure's content-filter/usage chunks.
    """

    def _make(tokens=None, error=None):
        return FakeAzureClient(tokens=tokens, error=error)

    _make.NO_CHOICES = NO_CHOICES
    return _make
