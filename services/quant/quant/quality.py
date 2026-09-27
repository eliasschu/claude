"""
Data Quality Layer (§53): prueft Rohdaten, bevor sie gespeichert werden.
Fehlerhafte Datensaetze werden verworfen und mit Grund gemeldet - nie
repariert oder geschaetzt.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Sequence

from .providers.base import Bar

MAX_FUTURE = timedelta(minutes=2)


@dataclass(frozen=True)
class Rejected:
    ts: datetime | None
    reason: str


def validate_bars(bars: Sequence[Bar], now: datetime, *, max_jump: float = 0.5) -> tuple[list[Bar], list[Rejected]]:
    """
    Schema- und Plausibilitaetspruefung: endliche, positive Preise, OHLC-Ordnung,
    Volumen >= 0, kein Zeitstempel in der Zukunft, keine Duplikate, und kein
    Sprung von mehr als `max_jump` (50 %) gegenueber dem vorigen Schluss
    (Ausreisser; echte Splits kommen bei bereinigten Reihen nicht als Sprung vor).
    """
    ok: list[Bar] = []
    bad: list[Rejected] = []
    seen: set[datetime] = set()
    prev_close: float | None = None
    for b in sorted(bars, key=lambda x: x.ts):
        prices = (b.open, b.high, b.low, b.close)
        if not all(isinstance(p, (int, float)) and math.isfinite(p) and p > 0 for p in prices):
            bad.append(Rejected(b.ts, "Preis fehlt, ist nicht endlich oder nicht positiv"))
            continue
        if not (b.high >= max(b.open, b.close) and b.low <= min(b.open, b.close) and b.high >= b.low):
            bad.append(Rejected(b.ts, "OHLC-Werte widersprüchlich"))
            continue
        if not math.isfinite(b.volume) or b.volume < 0:
            bad.append(Rejected(b.ts, "Volumen negativ oder nicht endlich"))
            continue
        if b.taker_buy_volume is not None and not (0 <= b.taker_buy_volume <= b.volume * (1 + 1e-9)):
            bad.append(Rejected(b.ts, "Aggressor-Kaufvolumen außerhalb [0, Volumen]"))
            continue
        if b.ts > now + MAX_FUTURE:
            bad.append(Rejected(b.ts, "Zeitstempel in der Zukunft"))
            continue
        if b.ts in seen:
            bad.append(Rejected(b.ts, "Doppelter Zeitstempel"))
            continue
        if prev_close is not None and abs(b.close / prev_close - 1) > max_jump:
            bad.append(Rejected(b.ts, f"Sprung um mehr als {max_jump:.0%} gegenüber dem Vorwert"))
            continue
        seen.add(b.ts)
        prev_close = b.close
        ok.append(b)
    return ok, bad
