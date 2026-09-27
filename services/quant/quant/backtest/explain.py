"""
"Warum wurde Trade X eroeffnet?" - vollstaendige Rueckverfolgung eines Paper-/Backtest-Trades:
Signal (Begruendung, Gegenargumente, Regime, Versionen), Eingangsmerkmale (Snapshot),
Risk-Entscheidung, Order, Ausfuehrung, Stop/Ziel, Exit, Ergebnis, Gebuehren, Slippage.
"""

from __future__ import annotations

import uuid

from ..db import Conn, one


def explain_trade(conn: Conn, position_id: uuid.UUID | str) -> dict | None:
    p = conn.execute("SELECT * FROM paper_positions WHERE position_id=%s", (str(position_id),)).fetchone()
    if not p:
        return None
    s = one(conn.execute("SELECT * FROM signals WHERE signal_id=%s", (p["signal_id"],)))
    feats = conn.execute("SELECT features FROM feature_snapshots WHERE feature_snapshot_id=%s", (s["feature_snapshot_id"],)).fetchone()
    orders = conn.execute("SELECT * FROM paper_orders WHERE position_id=%s ORDER BY requested_at", (p["position_id"],)).fetchall()
    fills = conn.execute("""SELECT f.*, o.intent FROM paper_fills f JOIN paper_orders o USING (order_id) WHERE o.position_id=%s
                            ORDER BY f.filled_at""", (p["position_id"],)).fetchall()
    used = {e for ev in s["positive_evidence"] + s["negative_evidence"] for e in ev["features"]}
    values = (feats or {}).get("features", {}).get("values", {})
    return {
        "trade": {"position_id": str(p["position_id"]), "instrument_id": p["instrument_id"], "side": p["side"], "quantity": p["quantity"],
                  "entry_time": p["opened_at"], "entry_price": p["entry_price"], "exit_time": p["closed_at"], "exit_price": p["exit_price"],
                  "exit_reason": p["exit_reason"], "pnl": p["realized_pnl"], "stop": p["stop_price"], "target": p["target_price"],
                  "time_exit_at": p["time_exit_at"]},
        "why": {
            "strategy": f"{s['strategy_id']} v{s['strategy_version']}", "decision": s["decision"],
            "signal_strength": float(s["signal_strength"]), "summary": s["risk_assessment"].get("summary"),
            "evidence_for": s["positive_evidence"], "evidence_against": s["negative_evidence"],
            "invalidation": s["invalidation"], "exit_plan": s["exit_plan"], "market_regime": s["market_regime"],
            "signal_time": s["created_at"], "price_at_signal": s["price_at_signal"],
        },
        "input_features": {k: values[k] for k in sorted(used) if k in values},
        "all_features_snapshot_id": str(s["feature_snapshot_id"]) if s["feature_snapshot_id"] else None,
        "data_freshness": s["data_freshness"],
        "risk_decision": s["risk_assessment"],
        "orders": orders,
        "executions": fills,
        "costs": {"fees": sum(f["fee"] for f in fills), "slippage_cost": sum(f["slippage_bps"] / 1e4 * f["price"] * f["quantity"] for f in fills)},
        "versions": {k: s[k] for k in ("bot_version", "strategy_registry_version", "feature_version", "model_version", "risk_version",
                                       "dataset_version")},
        "audit": {"content_hash": s["content_hash"], "mode": s["mode"]},
    }
