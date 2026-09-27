"""
DataFreshnessService - Python-Gegenstueck zu src/lib/core/freshness.ts.
Gleiche Klassen, gleiche Grenzen: LIVE nur bei Streaming, Alter immer vom
Datenzeitpunkt (nicht vom Abruf) gemessen.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

LIVE_MAX = timedelta(seconds=5)
UNDER_1_MIN_MAX = timedelta(seconds=60)
DELAYED_15_MAX = timedelta(minutes=15)
FUTURE_TOLERANCE = timedelta(minutes=2)

FIXED_CADENCE = {"end_of_day", "daily", "weekly", "quarterly", "annual", "event"}


@dataclass(frozen=True)
class Freshness:
    cls: str  # live | under_1_min | delayed_15_min | end_of_day | daily | weekly | quarterly | annual | event | stale | unknown
    age_seconds: float | None
    reason: str

    def as_dict(self) -> dict:
        return {"class": self.cls, "age_seconds": self.age_seconds, "reason": self.reason}


def classify(observed_at: datetime | None, cadence: str, now: datetime, *, session_closed: bool | None = None,
             max_age: timedelta | None = None) -> Freshness:
    """`max_age`: ab welchem Alter auch Werte mit festem Takt als veraltet gelten (z. B. EOD > 4 Tage)."""
    if observed_at is None:
        return Freshness("unknown", None, "Datenzeitpunkt nicht belegt.")
    age = now - observed_at
    secs = age.total_seconds()
    if age < -FUTURE_TOLERANCE:
        return Freshness("unknown", secs, "Datenzeitpunkt liegt in der Zukunft - Uhrabweichung pruefen.")
    if max_age is not None and age > max_age:
        return Freshness("stale", secs, f"Aelter als erlaubt ({max_age}).")
    if cadence in FIXED_CADENCE:
        return Freshness(cadence, secs, f"Quelle mit Takt '{cadence}'.")
    if cadence == "stream" and age <= LIVE_MAX:
        return Freshness("live", secs, "Laufender Datenstrom.")
    if session_closed:
        return Freshness("end_of_day", secs, "Handel geschlossen; letzter Kurs.")
    if age <= UNDER_1_MIN_MAX:
        return Freshness("under_1_min", secs, "Juenger als eine Minute.")
    if age <= DELAYED_15_MAX:
        return Freshness("delayed_15_min", secs, "Zwischen 1 und 15 Minuten alt.")
    return Freshness("stale", secs, "Intraday-Wert aelter als 15 Minuten.")


# Welche Klassen darf eine Strategie mit gegebenem Horizont verwenden?
ACCEPTABLE = {
    # "event": periodisch veroeffentlichte Werte wie Funding (alle 1-8 h); ihr Hoechstalter prueft classify(max_age=...)
    "intraday": {"live", "under_1_min", "delayed_15_min", "event"},
    "swing": {"live", "under_1_min", "delayed_15_min", "end_of_day", "daily"},
    "position": {"live", "under_1_min", "delayed_15_min", "end_of_day", "daily", "weekly", "quarterly", "annual", "event"},
}


def usable_for(horizon: str, freshness: Freshness) -> bool:
    return freshness.cls in ACCEPTABLE[horizon]
