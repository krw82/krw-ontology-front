"""Run KRW Ontology MCP over Docker-internal HTTP."""

from __future__ import annotations

import os
from pathlib import Path

from mcp.server.transport_security import TransportSecuritySettings

from krw_ontology.mcp_server.http_server import serve
from krw_ontology.mcp_server.server import mcp


def _csv_env(name: str, default: list[str]) -> list[str]:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    return [item.strip() for item in raw.split(",") if item.strip()]


def main() -> None:
    mcp.settings.transport_security = TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=_csv_env(
            "MCP_ALLOWED_HOSTS",
            ["127.0.0.1:*", "localhost:*", "[::1]:*", "mcp:*"],
        ),
        allowed_origins=_csv_env(
            "MCP_ALLOWED_ORIGINS",
            [
                "http://127.0.0.1:*",
                "http://localhost:*",
                "http://[::1]:*",
                "http://web:3000",
            ],
        ),
    )

    serve(
        host=os.environ.get("MCP_HOST", "0.0.0.0"),
        port=int(os.environ.get("MCP_PORT", "8000")),
        root=Path(os.environ.get("KRW_ONTOLOGY_ROOT", "/srv/krw-ontology-data/current")),
        mcp_path=os.environ.get("MCP_PATH", "/mcp"),
        stateless=os.environ.get("MCP_STATEFUL", "").strip().lower() not in {"1", "true", "yes"},
        json_response=os.environ.get("MCP_JSON_RESPONSE", "").strip().lower()
        in {"1", "true", "yes"},
        log_level=os.environ.get("MCP_LOG_LEVEL", "INFO"),
    )


if __name__ == "__main__":
    main()
