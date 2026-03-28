FROM python:3.12-slim AS autoweave-wheel

ENV PIP_NO_CACHE_DIR=1

WORKDIR /build
COPY ["Autoweave Library", "/build/autoweave-library"]
RUN python -m pip wheel --no-deps --wheel-dir /dist /build/autoweave-library


FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=autoweave-wheel /dist /tmp/wheels
COPY ["Autoweave Web/docker/worker-entrypoint.sh", "/app/worker-entrypoint.sh"]

RUN chmod +x /app/worker-entrypoint.sh \
    && python -m pip install --upgrade pip \
    && python -m pip install /tmp/wheels/autoweave-*.whl

ENTRYPOINT ["/app/worker-entrypoint.sh"]
