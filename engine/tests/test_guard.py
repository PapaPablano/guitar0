"""Tests for the engine wrapper's guard. Run with: python -m pytest engine/tests"""

import sys
from pathlib import Path

import pytest
from starlette.applications import Starlette
from starlette.responses import PlainTextResponse
from starlette.routing import Route
from starlette.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "wrapper"))

from guard import guard  # noqa: E402

ORIGIN = "http://tauri.localhost"
SECRET = "s3cret"


def build() -> TestClient:
    inner = Starlette(routes=[Route("/api/jobs", lambda r: PlainTextResponse("reached"), methods=["GET", "POST"])])
    return TestClient(guard(inner, secret=SECRET, origins=[ORIGIN]))


def test_request_with_secret_and_origin_passes_and_names_only_that_origin():
    r = build().get("/api/jobs", headers={"X-TabHighway-Secret": SECRET, "Origin": ORIGIN})
    assert r.status_code == 200
    assert r.text == "reached"
    assert r.headers["access-control-allow-origin"] == ORIGIN


def test_request_without_secret_is_rejected_before_the_app():
    r = build().get("/api/jobs", headers={"Origin": ORIGIN})
    assert r.status_code == 403
    assert r.text != "reached"


def test_wrong_secret_is_rejected():
    r = build().post("/api/jobs", headers={"X-TabHighway-Secret": "nope"})
    assert r.status_code == 403


def test_other_origin_gets_no_cross_origin_allowance():
    r = build().get("/api/jobs", headers={"X-TabHighway-Secret": SECRET, "Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in r.headers


def test_preflight_is_answered_without_the_secret():
    r = build().options(
        "/api/jobs",
        headers={
            "Origin": ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "x-tabhighway-secret",
        },
    )
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == ORIGIN
    assert "x-tabhighway-secret" in r.headers["access-control-allow-headers"].lower()


def test_preflight_from_another_origin_is_refused():
    r = build().options(
        "/api/jobs",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
    )
    assert r.status_code == 400


def test_empty_secret_refuses_to_build():
    with pytest.raises(ValueError):
        guard(Starlette(), secret="", origins=[ORIGIN])
