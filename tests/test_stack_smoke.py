from __future__ import annotations

import os

import httpx
import pytest


pytestmark = pytest.mark.skipif(
    os.getenv("AUTOWEAVE_WEB_STACK_SMOKE") != "1",
    reason="Set AUTOWEAVE_WEB_STACK_SMOKE=1 to run against the live Docker stack.",
)


def test_backend_health_reports_installed_autoweave_package() -> None:
    backend_base_url = os.getenv("AUTOWEAVE_WEB_BACKEND_URL", "http://127.0.0.1:8000")

    response = httpx.get(f"{backend_base_url}/api/health", timeout=10.0)

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["package"]["installed_package"] is True
    assert payload["package"]["source_tree_bypassed"] is True


def test_frontend_landing_page_loads() -> None:
    frontend_base_url = os.getenv("AUTOWEAVE_WEB_FRONTEND_URL", "http://127.0.0.1:3000")

    response = httpx.get(frontend_base_url, timeout=20.0, follow_redirects=True)

    assert response.status_code == 200
    assert "ERGO-powered collaborative engineering" in response.text
