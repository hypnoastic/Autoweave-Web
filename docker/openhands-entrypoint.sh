#!/bin/sh
set -eu

VERTEX_FILE="${VERTEXAI_SERVICE_ACCOUNT_FILE:-/srv/autoweave/runtime/control-plane/config/secrets/vertex_service_account.json}"
VERTEX_PROJECT="${VERTEXAI_PROJECT:-}"

if [ -f "${VERTEX_FILE}" ]; then
  export GOOGLE_APPLICATION_CREDENTIALS="${VERTEX_FILE}"
  if [ -z "${VERTEX_PROJECT}" ] || [ "${VERTEX_PROJECT}" = "autoweave-web-local" ]; then
    DERIVED_VERTEX_PROJECT="$(
      VERTEX_FILE="${VERTEX_FILE}" python - <<'PY'
import json
import os
from pathlib import Path

path = Path(os.environ["VERTEX_FILE"])
try:
    payload = json.loads(path.read_text(encoding="utf-8"))
except (OSError, ValueError, TypeError):
    print("", end="")
else:
    print(str(payload.get("project_id") or "").strip(), end="")
PY
    )"
    if [ -n "${DERIVED_VERTEX_PROJECT}" ]; then
      export VERTEXAI_PROJECT="${DERIVED_VERTEX_PROJECT}"
    fi
  fi
else
  echo "warning: Vertex service-account file is missing at ${VERTEX_FILE}" >&2
fi

exec /usr/local/bin/openhands-agent-server "$@"
