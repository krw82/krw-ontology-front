#!/bin/sh

load_expected_mcp_runtime_fingerprint() {
  : "${KRW_ONTOLOGY_SOURCE_DIR:?Missing KRW_ONTOLOGY_SOURCE_DIR}"
  : "${KRW_ONTOLOGY_RELEASE_ROOT:?Missing KRW_ONTOLOGY_RELEASE_ROOT}"

  fingerprint_exports=$(
    uv --directory "$KRW_ONTOLOGY_SOURCE_DIR" run python - "$KRW_ONTOLOGY_RELEASE_ROOT" <<'PY'
import os
import shlex
import sys

from krw_ontology.mcp_server.server import runtime_fingerprint_payload

payload = runtime_fingerprint_payload(root=sys.argv[1])
fields = {
    "KRW_MCP_EXPECTED_CONTRACT_VERSION": "mcp_contract_version",
    "KRW_MCP_EXPECTED_BUILD_ID": "build_id",
    "KRW_MCP_EXPECTED_BACKEND_GIT_SHA": "backend_git_sha",
    "KRW_MCP_EXPECTED_TOOL_SCHEMA_SHA256": "tool_schema_sha256",
    "KRW_MCP_EXPECTED_BUILD_FINGERPRINT_SHA256": "build_fingerprint_sha256",
    "KRW_MCP_EXPECTED_RELEASE_MANIFEST_SHA256": "release_manifest_sha256",
    "KRW_MCP_EXPECTED_SERVICE_FINGERPRINT_SHA256": "service_fingerprint_sha256",
}
for env_name, field in fields.items():
    value = payload.get(field)
    if not isinstance(value, str) or not value:
        raise SystemExit(f"runtime fingerprint field is missing: {field}")
    configured = os.environ.get(env_name)
    if configured and configured != value:
        raise SystemExit(
            f"configured {env_name} does not match current source/release {field}"
        )
    print(f"export {env_name}={shlex.quote(value)}")
PY
  )
  eval "$fingerprint_exports"
}
