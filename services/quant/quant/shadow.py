"""
Shadow Execution: "Was waere passiert?" fuer jede Handelsidee.

Beim Signal wird die GEPLANTE Order unveraenderlich festgehalten (Einstieg,
Stop, Ziel, Groesse, Risk-Entscheidung, Ablehnungsgrund). Die hypothetische
Ausfuehrung rechnet der Resolver erst, wenn die Kurse tatsaechlich vorliegen -
mit demselben Kosten- und Exitmodell wie Paper Trading:
  Einstieg = erste Kerze ab eligible_at (Handelsverzoegerung), Eroeffnung +
  halber Spread + Slippage + Gebuehr; Exit ueber paper.check_exit.
Das Paper-Konto bleibt davon unberuehrt.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from psycopg.types.json import Jsonb

from .db import Conn
from .domain import RiskAssessment, StrategyEvaluation
from .execution import ExecutionModel
from .paper import CostModel, check_exit, exit_fill, session_open
from .repo import load_bars

CALC_VERSION = "shadow-0.1.0"
NO_ENTRY_AFTER = {"1m": timedelta(hours=1), "1d": timedelta(days=7)}


def _cost_dict(c: CostModel) -> dict:
    return {"fee_bps": c.fee_bps, "slippage_bps": c.slippage_bps, "half_spread_bps": c.half_spread_bps, "delay_s": c.delay.total_seconds()}


def _cost_from(d: dict) -> CostModel:
    return CostModel(d["fee_bps"], d["slippage_bps"], d["half_spread_bps"], timedelta(seconds=d["delay_s"]))


def record_shadow(conn: Conn, *, signal_id: uuid.UUID, ev: StrategyEvaluation, risk: RiskAssessment, now: datetime,
                  asset_group: str, snapshot_id: uuid.UUID | None, execution: ExecutionModel | None = None,
                  vol_1m_bps: float | None = None) -> uuid.UUID | None:
    if ev.exit_plan is None or ev.reference_price is None or ev.direction not in ("long", "short"):
        return None
    ex = execution or ExecutionModel()
    # Die konkreten Kosten werden MIT gespeichert: die spaetere Aufloesung ist reproduzierbar, auch wenn sich die Konfiguration aendert
    cost = ex.cost(asset_group, vol_1m_bps=vol_1m_bps)
    model = {"mode": ex.mode, "slippage_model": ex.slippage_model, "entry": _cost_dict(cost),
             "exit_taker": _cost_dict(ex.cost(asset_group, vol_1m_bps=vol_1m_bps)),
             "exit_maker": _cost_dict(ex.cost(asset_group, liquidity="maker", vol_1m_bps=vol_1m_bps))}
    shadow_id = uuid.uuid4()
    conn.execute(
        """INSERT INTO shadow_executions (shadow_id, signal_id, created_at, instrument_id, strategy_id, direction, score, confidence,
                 feature_snapshot_id, planned_side, planned_order_type, planned_reference, planned_stop, planned_target, planned_time_exit,
                 planned_quantity, planned_notional, eligible_at, risk_approved, rejection_reasons, execution_model, timeframe)
           VALUES (%s,%s,%s,%s,%s,%s,%s,NULL,%s,%s,'market',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (shadow_id, signal_id, now, ev.instrument_id, ev.strategy_id, ev.direction, round(ev.strength, 2), snapshot_id,
         "buy" if ev.direction == "long" else "sell", ev.reference_price, ev.exit_plan.stop_price, ev.exit_plan.target_price,
         now + ev.exit_plan.max_holding, risk.proposed_quantity, risk.proposed_notional, now + cost.delay, risk.approved,
         Jsonb([{"check": c.name, "detail": c.detail} for c in risk.failed]), Jsonb(model),
         "1m" if asset_group == "crypto" else "1d"),
    )
    return shadow_id


def _entry_fill(bar, side: str, cost: CostModel, is_equity: bool) -> tuple[float, float, float, datetime]:
    adverse = (cost.half_spread_bps + cost.slippage_bps) / 1e4
    price = bar.open * (1 + adverse) if side == "buy" else bar.open * (1 - adverse)
    return price, adverse * 1e4, cost.fee_bps / 1e4, session_open(bar) if is_equity else bar.ts


def resolve_shadows(conn: Conn, now: datetime) -> int:
    """Loest offene Shadow-Ausfuehrungen auf, sobald Einstieg und Exit in den Kursdaten belegt sind."""
    rows = conn.execute(
        """SELECT s.* FROM shadow_executions s LEFT JOIN shadow_outcomes o USING (shadow_id)
           WHERE o.shadow_id IS NULL AND s.eligible_at <= %s ORDER BY s.created_at""", (now,)).fetchall()
    done = 0
    for s in rows:
        is_equity = s["timeframe"] == "1d"
        length = timedelta(days=1) if is_equity else timedelta(minutes=1)
        em = s["execution_model"]
        cost = _cost_from(em["entry"])
        bars = [b for b in load_bars(conn, s["instrument_id"], s["timeframe"], s["eligible_at"] - length, now, known_at=now)
                if b.ts + length <= now]
        entry_bar = next((b for b in bars if (session_open(b) if is_equity else b.ts) >= s["eligible_at"]), None)
        if entry_bar is None:
            if now - s["eligible_at"] > NO_ENTRY_AFTER[s["timeframe"]]:
                conn.execute("""INSERT INTO shadow_outcomes (shadow_id, resolved_at, exit_reason, calc_version)
                                VALUES (%s,%s,'no_entry',%s)""", (s["shadow_id"], now, CALC_VERSION))
                done += 1
            continue
        side = s["planned_side"]
        entry_price, entry_slip, fee_rate, entry_time = _entry_fill(entry_bar, side, cost, is_equity)
        pos_side = "long" if side == "buy" else "short"
        path = [b for b in bars if b.ts >= entry_bar.ts]
        ev = check_exit(pos_side, s["planned_stop"], s["planned_target"], s["planned_time_exit"], path, length, is_equity)
        if ev is None:
            continue  # noch offen
        qty = s["planned_quantity"] or 1.0
        fill = exit_fill(pos_side, qty, ev, _cost_from(em["exit_maker"] if ev.reason == "target" else em["exit_taker"]))
        sign = 1 if pos_side == "long" else -1
        entry_fee = entry_price * qty * fee_rate
        pnl = sign * (fill.price - entry_price) * qty - entry_fee - fill.fee
        held = [b for b in path if b.ts <= ev.at]
        hi = max(b.high for b in held) / entry_price - 1
        lo = min(b.low for b in held) / entry_price - 1
        mfe, mae = (hi * 100, lo * 100) if sign > 0 else (-lo * 100, -hi * 100)
        conn.execute(
            """INSERT INTO shadow_outcomes (shadow_id, resolved_at, entry_time, entry_price, entry_fee, entry_slippage_bps, exit_time,
                   exit_price, exit_fee, exit_reason, gap, quantity, pnl, pnl_pct, mfe_pct, mae_pct, calc_version)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (s["shadow_id"], now, entry_time, entry_price, entry_fee, entry_slip, ev.at, fill.price, fill.fee, ev.reason, ev.gap,
             qty, pnl, pnl / (entry_price * qty) * 100, mfe, mae, CALC_VERSION))
        done += 1
    return done
