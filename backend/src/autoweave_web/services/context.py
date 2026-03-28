from __future__ import annotations

import re

from sqlalchemy.orm import Session

from autoweave_web.models.entities import ContextProjection, ProductEvent

FILE_REFERENCE_PATTERN = re.compile(r"\b[\w./-]+\.(?:py|ts|tsx|js|jsx|json|md|yml|yaml|css|html)\b")
ISSUE_PR_PATTERN = re.compile(r"#(\d+)")
URL_PATTERN = re.compile(r"https?://[^\s)]+")
DECISION_PATTERN = re.compile(r"\b(decide|decision|ship|approved|reject|rejected|use|choose)\b", re.IGNORECASE)
MENTION_PATTERN = re.compile(r"@([A-Za-z0-9_-]+)")


def derive_context_summary(body: str) -> tuple[str, dict]:
    summary = " ".join(body.strip().split())
    references = {
        "files": sorted(set(FILE_REFERENCE_PATTERN.findall(body))),
        "numbers": sorted(set(ISSUE_PR_PATTERN.findall(body))),
        "urls": sorted(set(URL_PATTERN.findall(body))),
        "mentions": sorted(set(MENTION_PATTERN.findall(body))),
        "has_decision_signal": bool(DECISION_PATTERN.search(body)),
    }
    if len(summary) > 220:
        summary = summary[:217] + "..."
    return summary, references


def ingest_product_event(
    db: Session,
    *,
    orbit_id: str,
    source_kind: str,
    source_id: str,
    event_type: str,
    body: str,
    payload_json: dict,
) -> ContextProjection:
    summary, references = derive_context_summary(body)
    db.add(
        ProductEvent(
            orbit_id=orbit_id,
            event_type=event_type,
            payload_json=payload_json,
        )
    )
    projection = ContextProjection(
        orbit_id=orbit_id,
        source_kind=source_kind,
        source_id=source_id,
        summary=summary,
        references_json=references,
    )
    db.add(projection)
    return projection
