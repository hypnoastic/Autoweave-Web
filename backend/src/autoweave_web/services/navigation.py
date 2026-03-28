from __future__ import annotations

import json

from redis import Redis


class NavigationStore:
    def __init__(self, redis_url: str, *, ttl_seconds: int | None = None) -> None:
        self.client = Redis.from_url(redis_url, decode_responses=True)
        self.ttl_seconds = ttl_seconds

    def get_state(self, user_id: str) -> dict | None:
        value = self.client.get(f"autoweave:web:navigation:{user_id}")
        return json.loads(value) if value else None

    def set_state(self, user_id: str, payload: dict) -> dict:
        self.client.set(
            f"autoweave:web:navigation:{user_id}",
            json.dumps(payload, sort_keys=True),
            ex=self.ttl_seconds,
        )
        return payload
