"""ProviderHealthService (§83) und Kill Switch (§45)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

import psycopg

MAX_CLOCK_SKEW = timedelta(seconds=5)


class ProviderHealthService:
    def __init__(self, conn: psycopg.Connection):
        self._conn = conn

    def record(self, source_id: str, status: str, *, checked_at: datetime, latency_ms: float | None = None,
               last_data_at: datetime | None = None, source_time: datetime | None = None, message: str | None = None) -> str:
        """Speichert eine Messung. `source_time` = Uhrzeit laut Quelle (Date-Header) -> Uhrabweichung."""
        skew = (checked_at - source_time).total_seconds() * 1000 if source_time else None
        if status == "ok" and skew is not None and abs(skew) > MAX_CLOCK_SKEW.total_seconds() * 1000:
            status, message = "degraded", f"Uhrabweichung {skew:.0f} ms gegenueber der Quelle"
        self._conn.execute(
            """INSERT INTO provider_health (source_id, checked_at, status, latency_ms, last_data_at, clock_skew_ms, message)
               VALUES (%s,%s,%s,%s,%s,%s,%s)""",
            (source_id, checked_at, status, latency_ms, last_data_at, skew, message),
        )
        return status

    def latest(self) -> list[dict]:
        return self._conn.execute(
            """SELECT DISTINCT ON (source_id) source_id, checked_at, status, latency_ms, last_data_at, clock_skew_ms, message
               FROM provider_health ORDER BY source_id, checked_at DESC"""
        ).fetchall()


@dataclass(frozen=True)
class KillSwitchLimits:
    daily_loss_pct: float = 2.0
    max_drawdown_pct: float = 10.0
    max_abnormal_slippage_bps: float = 50.0


def kill_switch_reason(*, equity: float, starting_cash: float, day_start_equity: float | None, core_data_stale: list[str],
                       providers_down: list[str], recent_slippage_bps: list[float], limits: KillSwitchLimits = KillSwitchLimits()) -> str | None:
    """Liefert den ersten verletzten Grund oder None. Aktiv -> keine neuen Orders (bestehende Exits laufen weiter)."""
    if day_start_equity and (equity / day_start_equity - 1) * 100 <= -limits.daily_loss_pct:
        return f"Tagesverlustlimit ({limits.daily_loss_pct} %) erreicht"
    if (equity / starting_cash - 1) * 100 <= -limits.max_drawdown_pct:
        return f"Drawdown-Limit ({limits.max_drawdown_pct} % vom Startkapital) erreicht"
    if providers_down:
        return "Datenquelle ausgefallen: " + ", ".join(providers_down)
    if core_data_stale:
        return "Veraltete Kerndaten: " + ", ".join(core_data_stale)
    if recent_slippage_bps and max(recent_slippage_bps) > limits.max_abnormal_slippage_bps:
        return f"Ungewoehnliche Slippage ({max(recent_slippage_bps):.0f} bps)"
    return None
