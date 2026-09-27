"""
SignalAuditService (§59/60). Jedes Signal wird genau einmal geschrieben:
  * Die Datenbank verbietet UPDATE/DELETE/TRUNCATE (Trigger).
  * Jede Zeile enthaelt sha256(kanonischer Inhalt + Hash des Vorgaengers).
    Eine nachtraegliche Manipulation am Datenbankinhalt faellt bei verify_chain() auf.
Ergebnisse (price_1h ... benchmark_return) kommen als eigene, ebenfalls
unveraenderliche Zeilen in signal_outcomes.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from psycopg.types.json import Jsonb

from . import BOT_VERSION
from .db import Conn
from .domain import DATASET_VERSION, FEATURE_VERSION, MODEL_VERSION, Decision, RegimeState, RiskAssessment, StrategyEvaluation

# Bis zur rechtlichen Pruefung: nichts wird veroeffentlicht.
INTERNAL_DISCLOSURE = {
    "audience": "internal",
    "published": False,
    "purpose": "research_and_paper_trading",
    "conflicts_of_interest": "not_recorded",
    "disclaimer_version": None,
}

HASHED_FIELDS = (
    "signal_id", "created_at", "cycle_id", "mode", "instrument_id", "strategy_id", "strategy_version", "direction", "decision",
    "signal_strength", "price_at_signal", "price_basis", "market_regime", "positive_evidence", "negative_evidence",
    "invalidation", "exit_plan", "risk_assessment", "time_horizon", "data_sources", "data_freshness", "feature_snapshot_id",
    "bot_version", "strategy_registry_version", "feature_version", "model_version", "risk_version", "dataset_version",
    "disclosure", "prev_hash",
)


def _canon(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, float):
        return round(value, 10)
    if isinstance(value, dict):
        return {k: _canon(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_canon(v) for v in value]
    return value


def content_hash(record: dict[str, Any]) -> str:
    payload = {k: _canon(record.get(k)) for k in HASHED_FIELDS}
    # signal_strength aus der DB kommt als Decimal zurueck
    if payload["signal_strength"] is not None:
        payload["signal_strength"] = f"{float(payload['signal_strength']):.2f}"
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class SignalContext:
    cycle_id: uuid.UUID
    mode: str
    created_at: datetime
    regime: RegimeState
    data_sources: list[dict[str, Any]]
    data_freshness: dict[str, Any]
    feature_snapshot_id: uuid.UUID | None
    strategy_registry_version: str
    price_basis: str


class SignalAuditService:
    def __init__(self, conn: Conn):
        self._conn = conn

    def record(self, ev: StrategyEvaluation, final_decision: Decision, risk: RiskAssessment, ctx: SignalContext) -> uuid.UUID:
        if ctx.mode not in ("research", "paper", "backtest"):
            raise ValueError("Nur research/paper/backtest erlaubt - kein Live-Handel")
        if final_decision == Decision.REJECTED_BY_RISK and risk.approved:
            raise ValueError("REJECTED_BY_RISK trotz Freigabe der Risk Engine")
        signal_id = uuid.uuid4()
        record: dict[str, Any] = {
            "signal_id": signal_id, "created_at": ctx.created_at, "cycle_id": ctx.cycle_id, "mode": ctx.mode,
            "instrument_id": ev.instrument_id, "strategy_id": ev.strategy_id, "strategy_version": ev.strategy_version,
            "direction": ev.direction, "decision": final_decision.value, "signal_strength": round(ev.strength, 2),
            "price_at_signal": ev.reference_price, "price_basis": ctx.price_basis if ev.reference_price is not None else None,
            "market_regime": ctx.regime.as_dict(),
            "positive_evidence": [e.as_dict() for e in ev.positive],
            "negative_evidence": [e.as_dict() for e in ev.negative],
            "invalidation": ev.invalidation.as_dict() if ev.invalidation else {"rule": None, "text": "; ".join(ev.reasons) or ev.summary},
            "exit_plan": ev.exit_plan.as_dict() if ev.exit_plan else {},
            "risk_assessment": {**risk.as_dict(), "summary": ev.summary, "reasons": list(ev.reasons),
                                "upside_to_target_pct": ev.upside_to_target_pct, "downside_to_stop_pct": ev.downside_to_stop_pct},
            "time_horizon": ev.horizon, "data_sources": ctx.data_sources, "data_freshness": ctx.data_freshness,
            "feature_snapshot_id": ctx.feature_snapshot_id, "bot_version": BOT_VERSION,
            "strategy_registry_version": ctx.strategy_registry_version, "feature_version": FEATURE_VERSION,
            "model_version": MODEL_VERSION, "risk_version": risk.version, "dataset_version": DATASET_VERSION,
            "disclosure": INTERNAL_DISCLOSURE,
        }
        with self._conn.transaction():
            # Serialisiert die Hash-Kette auch bei mehreren Workern
            self._conn.execute("SELECT pg_advisory_xact_lock(515151)")
            prev = self._conn.execute("SELECT content_hash FROM signals ORDER BY seq DESC LIMIT 1").fetchone()
            record["prev_hash"] = prev["content_hash"] if prev else None
            record["content_hash"] = content_hash(record)
            cols = list(HASHED_FIELDS) + ["content_hash"]
            json_cols = {"market_regime", "positive_evidence", "negative_evidence", "invalidation", "exit_plan", "risk_assessment",
                         "data_sources", "data_freshness", "disclosure"}
            values = [Jsonb(_canon(record[c])) if c in json_cols else record[c] for c in cols]
            self._conn.execute(
                f"INSERT INTO signals ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))})", values
            )
        return signal_id

    def record_outcome(self, signal_id: uuid.UUID, horizon: str, observed_at: datetime, price: float, return_pct: float,
                       *, mfe_pct: float | None = None, mae_pct: float | None = None, benchmark_return_pct: float | None = None,
                       exit_price: float | None = None, result: str | None = None, calc_version: str = "outcomes-0.1.0") -> bool:
        cur = self._conn.execute(
            """INSERT INTO signal_outcomes (signal_id, horizon, observed_at, price, return_pct, mfe_pct, mae_pct,
                                            benchmark_return_pct, exit_price, result, calc_version)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (signal_id, horizon) DO NOTHING""",
            (signal_id, horizon, observed_at, price, return_pct, mfe_pct, mae_pct, benchmark_return_pct, exit_price, result, calc_version),
        )
        return cur.rowcount == 1

    def verify_chain(self) -> tuple[bool, list[str]]:
        """Rechnet alle Hashes nach. Rueckgabe (ok, Liste der Abweichungen)."""
        problems: list[str] = []
        prev: str | None = None
        for row in self._conn.execute(f"SELECT {', '.join(HASHED_FIELDS)}, content_hash FROM signals ORDER BY seq").fetchall():
            if row["prev_hash"] != prev:
                problems.append(f"{row['signal_id']}: Kette unterbrochen")
            if content_hash(dict(row)) != row["content_hash"]:
                problems.append(f"{row['signal_id']}: Inhalt passt nicht zum Hash")
            prev = row["content_hash"]
        return (not problems, problems)
