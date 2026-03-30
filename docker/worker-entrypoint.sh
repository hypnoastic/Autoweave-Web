#!/bin/sh
set -eu

RUNTIME_ROOT="${RUNTIME_ROOT:-/srv/autoweave/runtime}"
RUNTIME_CONTROL_PLANE="${RUNTIME_CONTROL_PLANE:-/srv/autoweave/runtime/control-plane}"
VERTEX_FILE="${RUNTIME_VERTEX_SERVICE_ACCOUNT_FILE:-/srv/autoweave/runtime/control-plane/config/secrets/vertex_service_account.json}"
VERTEX_PROJECT="${RUNTIME_VERTEX_PROJECT:-}"

mkdir -p "${RUNTIME_ROOT}" "${RUNTIME_CONTROL_PLANE}/config/secrets"

if [ ! -f "${VERTEX_FILE}" ]; then
  echo "warning: Vertex service-account file is missing at ${VERTEX_FILE}" >&2
else
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
      export RUNTIME_VERTEX_PROJECT="${DERIVED_VERTEX_PROJECT}"
      export VERTEXAI_PROJECT="${DERIVED_VERTEX_PROJECT}"
    fi
  else
    export VERTEXAI_PROJECT="${VERTEX_PROJECT}"
  fi
fi

python -m apps.cli.main bootstrap --root "${RUNTIME_CONTROL_PLANE}" >/tmp/autoweave-worker-bootstrap.log 2>&1 || true

exec autoweave worker \
  --root "${RUNTIME_CONTROL_PLANE}" \
  --concurrency "${AUTOWEAVE_WORKER_CONCURRENCY:-1}" \
  --loglevel "${AUTOWEAVE_WORKER_LOGLEVEL:-info}"
