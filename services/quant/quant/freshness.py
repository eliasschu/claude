"""
DataFreshnessService - Aktualitaet je DATENKLASSE, nicht global (§55).

Jede Datenklasse hat ihre eigene Regel, weil ihr natuerlicher Takt
verschieden ist: Trades kommen im Sekundentakt, Funding alle 1-8 Stunden,
13F einmal im Quartal. Eine universelle Intraday-Regel wuerde Funding
dauerhaft als "stale" einstufen (behobener Fehler D) und Strategie E nie
ausloesen lassen.

Die Anzeigeklassen sind dieselben wie in src/lib/core/freshness.ts.
Alter wird immer vom Datenzeitpunkt aus gemessen, nie vom Abruf.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

FUTURE_TOLERANCE = timedelta(minutes=2)


@dataclass(frozen=True)
class Freshness:
    cls: str  # live | under_1_min | delayed_15_min | end_of_day | daily | weekly | quarterly | annual | event | stale | unknown
    age_seconds: float | None
    reason: str
    data_class: str | None = None

    @property
    def usable(self) -> bool:
        """Darf ein Wert mit dieser Einstufung in eine Entscheidung einfliessen?"""
        return self.cls not in ("stale", "unknown")

    def as_dict(self) -> dict:
        return {"class": self.cls, "age_seconds": self.age_seconds, "reason": self.reason, "data_class": self.data_class}


@dataclass(frozen=True)
class FreshnessPolicy:
    """
    `label`: Anzeigeklasse bei frischen Daten. "intraday" = nach gemessenem Alter
    (< 1 Min. / bis 15 Min.). `max_age`: ab welchem Alter der Wert veraltet ist -
    fest oder abhaengig vom Kontext (z. B. Funding-Intervall des Kontrakts).
    """

    data_class: str
    label: str
    max_age: timedelta | Callable[[dict], timedelta]
    description: str

    def limit(self, ctx: dict) -> timedelta:
        return self.max_age(ctx) if callable(self.max_age) else self.max_age


def _funding_max_age(ctx: dict) -> timedelta:
    # Zwei Intervalle plus eine Stunde Puffer: ein verpasster Abrechnungstermin ist noch kein Ausfall.
    return timedelta(hours=float(ctx.get("interval_hours", 8.0)) * 2 + 1)


POLICIES: dict[str, FreshnessPolicy] = {p.data_class: p for p in (
    FreshnessPolicy("trade", "intraday", timedelta(seconds=30), "Einzelne Trades / Trade-Flow"),
    FreshnessPolicy("orderbook", "intraday", timedelta(seconds=30), "Orderbuch (Snapshot oder synchronisiertes Buch)"),
    FreshnessPolicy("quote", "intraday", timedelta(seconds=60), "Bester Bid/Ask"),
    FreshnessPolicy("liquidation_feed", "intraday", timedelta(minutes=5), "Liquidations-Strom (Verbindung, nicht Einzelereignis)"),
    FreshnessPolicy("candle_1m", "intraday", timedelta(minutes=3), "Minutenkerzen: Ende der letzten Kerze"),
    FreshnessPolicy("candle_1d_crypto", "end_of_day", timedelta(days=2), "Tageskerzen Krypto (24/7)"),
    # Wochenende + Feiertag + verzoegerte EOD-Lieferung
    FreshnessPolicy("candle_1d_equity", "end_of_day", timedelta(days=5), "Tageskerzen Aktien (EOD)"),
    FreshnessPolicy("premium_index", "intraday", timedelta(minutes=2), "Mark-/Index-Preis Perpetual"),
    FreshnessPolicy("funding", "event", _funding_max_age, "Funding-Rate, Takt je Kontrakt 1-8 h"),
    FreshnessPolicy("open_interest", "intraday", timedelta(minutes=15), "Open Interest (5-Minuten-Raster)"),
    FreshnessPolicy("macro_monthly", "event", timedelta(days=45), "Monatliche Makrodaten (CPI, Jobs ...)"),
    FreshnessPolicy("macro_weekly", "event", timedelta(days=10), "Woechentliche Makrodaten"),
    FreshnessPolicy("macro_quarterly", "event", timedelta(days=120), "Quartalsdaten (BIP ...)"),
    FreshnessPolicy("cftc_cot", "weekly", timedelta(days=12), "CFTC COT (Stichtag Dienstag, Veroeffentlichung Freitag)"),
    FreshnessPolicy("sec_filing", "event", timedelta(days=36500), "Ereignisgetriebene Meldungen (Form 4, 8-K, 13D/G)"),
    FreshnessPolicy("sec_13f", "quarterly", timedelta(days=140), "13F: Quartalsstichtag + bis zu 45 Tage Meldefrist"),
    FreshnessPolicy("fundamentals_annual", "annual", timedelta(days=500), "Jahresabschluss"),
)}

UNDER_1_MIN = timedelta(seconds=60)
DELAYED_15 = timedelta(minutes=15)


def assess(data_class: str, observed_at: datetime | None, now: datetime, *, session_closed: bool | None = None,
           **ctx) -> Freshness:
    """Einstufung eines Werts nach der Regel seiner Datenklasse."""
    policy = POLICIES.get(data_class)
    if policy is None:
        return Freshness("unknown", None, f"Keine Aktualitaetsregel fuer Datenklasse '{data_class}'.", data_class)
    if observed_at is None:
        return Freshness("unknown", None, "Datenzeitpunkt nicht belegt.", data_class)
    age = now - observed_at
    secs = age.total_seconds()
    if age < -FUTURE_TOLERANCE:
        return Freshness("unknown", secs, "Datenzeitpunkt liegt in der Zukunft - Uhrabweichung pruefen.", data_class)
    limit = policy.limit(ctx)
    if age > limit:
        return Freshness("stale", secs, f"{policy.description}: aelter als {limit}.", data_class)
    if policy.label != "intraday":
        return Freshness(policy.label, secs, f"{policy.description}: innerhalb von {limit}.", data_class)
    if session_closed:
        return Freshness("end_of_day", secs, "Handel geschlossen; letzter Kurs.", data_class)
    if age <= UNDER_1_MIN:
        return Freshness("under_1_min", secs, "Juenger als eine Minute.", data_class)
    return Freshness("delayed_15_min", secs, "Zwischen 1 und 15 Minuten alt.", data_class)


# Intraday-Klassen duerfen hoechstens 15 Minuten gueltig sein, sonst waere die Anzeigeklasse falsch.
assert all(p.label != "intraday" or (not callable(p.max_age) and p.max_age <= DELAYED_15) for p in POLICIES.values())
