"""Tests for CORS configuration (backend/main.py).

Covers:
- get_allowed_origins() env-var parsing (happy path + edge cases)
- Preflight OPTIONS /process behavior for allowed vs disallowed origins
"""

import importlib

from fastapi.testclient import TestClient

import main as main_module


def test_get_allowed_origins_parses_comma_separated_list(monkeypatch):
    monkeypatch.setenv(
        "ALLOWED_ORIGINS",
        "http://localhost:3000,https://healthcare-claims.vercel.app",
    )
    origins = main_module.get_allowed_origins()
    assert origins == [
        "http://localhost:3000",
        "https://healthcare-claims.vercel.app",
    ]


def test_get_allowed_origins_strips_whitespace_and_trailing_commas(monkeypatch):
    monkeypatch.setenv(
        "ALLOWED_ORIGINS",
        " http://localhost:3000 , https://healthcare-claims.vercel.app ,,",
    )
    origins = main_module.get_allowed_origins()
    assert origins == [
        "http://localhost:3000",
        "https://healthcare-claims.vercel.app",
    ]


def test_get_allowed_origins_falls_back_to_known_defaults_when_unset(monkeypatch):
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    origins = main_module.get_allowed_origins()
    assert origins == [
        "http://localhost:3000",
        "https://healthcare-claims.vercel.app",
    ]


def test_get_allowed_origins_falls_back_to_known_defaults_when_blank(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "   ")
    origins = main_module.get_allowed_origins()
    assert origins == [
        "http://localhost:3000",
        "https://healthcare-claims.vercel.app",
    ]


def test_get_allowed_origins_never_returns_wildcard_or_blank_entries(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", ",,,")
    origins = main_module.get_allowed_origins()
    assert "*" not in origins
    assert "" not in origins
    assert origins == [
        "http://localhost:3000",
        "https://healthcare-claims.vercel.app",
    ]


def test_middleware_honors_allowed_origins_env(monkeypatch):
    """The middleware must be wired to the env var, not just to the defaults.

    The other parsing tests call get_allowed_origins() directly, which would
    still pass if the middleware were hardcoded to DEFAULT_ALLOWED_ORIGINS.
    This reloads the module with ALLOWED_ORIGINS set so a regression in that
    wiring actually fails a test.
    """
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://staging.example.com")
    reloaded = importlib.reload(main_module)
    try:
        reloaded_client = TestClient(reloaded.app)
        allowed = reloaded_client.options(
            "/process",
            headers={
                "Origin": "https://staging.example.com",
                "Access-Control-Request-Method": "POST",
            },
        )
        assert (
            allowed.headers.get("access-control-allow-origin")
            == "https://staging.example.com"
        )

        # A default origin must NOT be allowed once the env var overrides it.
        default_origin = reloaded_client.options(
            "/process",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST",
            },
        )
        assert "access-control-allow-origin" not in default_origin.headers
    finally:
        # Restore module state so later tests see the unpatched app.
        monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
        importlib.reload(main_module)


def test_preflight_allowed_origin_is_echoed_back(client):
    response = client.options(
        "/process",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )
    assert response.headers.get("access-control-allow-origin") == "http://localhost:3000"


def test_preflight_disallowed_origin_gets_no_cors_header(client):
    response = client.options(
        "/process",
        headers={
            "Origin": "https://evil.example.com",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )
    assert "access-control-allow-origin" not in response.headers
