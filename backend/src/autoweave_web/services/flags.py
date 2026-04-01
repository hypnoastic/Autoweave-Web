from __future__ import annotations

from autoweave_web.core.settings import Settings


def flag_enabled(settings: Settings, flag_name: str) -> bool:
    return settings.feature_enabled(flag_name)
