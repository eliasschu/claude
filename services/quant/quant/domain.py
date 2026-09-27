"""
Signal- und Feature-Schema (§36, §59). Reine Datentypen ohne I/O.

Wichtig: `signal_strength` ist KEINE Wahrscheinlichkeit (§39). Eine
Wahrscheinlichkeit darf erst mit kalibriertem Out-of-Sample-Modell,
Brier Score und Stichprobengroesse angezeigt werden (§40) - dafuer gibt es
bewusst noch kein Feld.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Literal

FEATURE_VERSION = "features-0.1.0"
MODEL_VERSION = "rules-0.1.0"  # regelbasiert, kein ML-Modell
DATASET_VERSION = "live-pit-0.1"  # Live-Daten mit Point-in-Time-Speicherung


class Decision(str, Enum):
    LONG_CANDIDATE = "LONG_CANDIDATE"
    SHORT_CANDIDATE = "SHORT_CANDIDATE"
    WATCH = "WATCH"
    NO_TRADE = "NO_TRADE"
    REJECTED_BY_RISK = "REJECTED_BY_RISK"


Direction = Literal["long", "short", "none"]
Horizon = Literal["intraday", "swing", "position"]
AssetClass = Literal["equity", "crypto"]


@dataclass(frozen=True)
class FeatureValue:
    name: str
    raw: float | None
    as_of: datetime
    source_ids: tuple[str, ...]
    freshness: str
    # Einordnung relativ zur eigenen Historie des Instruments, falls berechenbar
    percentile: float | None = None
    zscore: float | None = None
    direction: Literal["bullish", "bearish", "neutral"] = "neutral"
    # 0..1: wie ausgepraegt ist das Merkmal (nicht: wie wahrscheinlich ist ein Gewinn)
    strength: float = 0.0
    reliability: Literal["high", "medium", "low"] = "medium"
    note: str | None = None
    # Datenklasse, nach deren Regel die Aktualitaet bestimmt wurde (freshness.POLICIES)
    data_class: str | None = None

    @property
    def usable(self) -> bool:
        return self.freshness not in ("stale", "unknown")

    def as_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["as_of"] = self.as_of.isoformat()
        d["source_ids"] = list(self.source_ids)
        return d


class MissingFeature(KeyError):
    pass


@dataclass
class FeatureSet:
    instrument_id: str
    as_of: datetime
    values: dict[str, FeatureValue] = field(default_factory=dict)
    version: str = FEATURE_VERSION
    # Nicht berechenbare Merkmale mit Grund (DATA UNAVAILABLE statt raten, §88)
    unavailable: dict[str, str] = field(default_factory=dict)

    def add(self, fv: FeatureValue) -> None:
        self.values[fv.name] = fv

    def mark_unavailable(self, name: str, reason: str) -> None:
        self.unavailable[name] = reason

    def raw(self, name: str) -> float:
        fv = self.values.get(name)
        if fv is None or fv.raw is None:
            raise MissingFeature(name)
        return fv.raw

    def has(self, *names: str) -> bool:
        return all(n in self.values and self.values[n].raw is not None for n in names)

    def as_dict(self) -> dict[str, Any]:
        return {
            "version": self.version, "as_of": self.as_of.isoformat(),
            "values": {k: v.as_dict() for k, v in self.values.items()}, "unavailable": self.unavailable,
        }


@dataclass(frozen=True)
class Evidence:
    """Ein Argument fuer oder gegen ein Setup, mit Bezug auf konkrete Merkmale."""

    key: str
    text: str  # deutsch, verstaendlich
    features: tuple[str, ...] = ()
    # Beitrag zur Signalstaerke in Punkten; nur gesetzt, wenn er exakt so in die Berechnung eingeht (§79)
    points: float | None = None

    def as_dict(self) -> dict[str, Any]:
        return {"key": self.key, "text": self.text, "features": list(self.features), "points": self.points}


@dataclass(frozen=True)
class Invalidation:
    """Wann ist die urspruengliche Hypothese falsch? (§95)"""

    rule: Literal["close_below", "close_above", "time_elapsed", "feature_reverts"]
    level: float | None
    text: str
    timeframe: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class ExitPlan:
    stop_price: float
    target_price: float | None
    max_holding: timedelta
    text: str

    def as_dict(self) -> dict[str, Any]:
        return {"stop_price": self.stop_price, "target_price": self.target_price,
                "max_holding_hours": self.max_holding.total_seconds() / 3600, "text": self.text}


@dataclass(frozen=True)
class RegimeState:
    scope: str
    labels: tuple[str, ...]
    explanation: str
    features: dict[str, float | None]
    version: str
    as_of: datetime

    def as_dict(self) -> dict[str, Any]:
        return {"scope": self.scope, "labels": list(self.labels), "explanation": self.explanation,
                "features": self.features, "version": self.version, "as_of": self.as_of.isoformat()}


@dataclass(frozen=True)
class StrategyEvaluation:
    """Ergebnis einer Strategie - noch VOR der Risk Engine."""

    strategy_id: str
    strategy_version: str
    instrument_id: str
    horizon: Horizon
    direction: Direction
    decision: Decision  # LONG_CANDIDATE | SHORT_CANDIDATE | WATCH | NO_TRADE
    strength: float  # 0..100
    summary: str
    positive: tuple[Evidence, ...]
    negative: tuple[Evidence, ...]
    invalidation: Invalidation | None
    exit_plan: ExitPlan | None
    reference_price: float | None
    # Abstand zu Ziel und Stop laut Regel der Strategie - KEINE statistische Erwartung
    upside_to_target_pct: float | None
    downside_to_stop_pct: float | None
    # Gruende fuer NO_TRADE/WATCH (z. B. fehlende Daten, Regime unpassend)
    reasons: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not 0 <= self.strength <= 100:
            raise ValueError("Signalstaerke muss zwischen 0 und 100 liegen")
        if self.decision == Decision.REJECTED_BY_RISK:
            raise ValueError("REJECTED_BY_RISK vergibt nur die Risk Engine")
        if self.decision == Decision.LONG_CANDIDATE and self.direction != "long":
            raise ValueError("LONG_CANDIDATE braucht Richtung long")
        if self.decision == Decision.SHORT_CANDIDATE and self.direction != "short":
            raise ValueError("SHORT_CANDIDATE braucht Richtung short")
        if self.decision in (Decision.LONG_CANDIDATE, Decision.SHORT_CANDIDATE) and (self.invalidation is None or self.exit_plan is None):
            raise ValueError("Ein Kandidat braucht Invalidierung und Exit-Plan")


@dataclass(frozen=True)
class RiskCheck:
    name: str
    passed: bool
    detail: str


@dataclass(frozen=True)
class RiskAssessment:
    approved: bool
    checks: tuple[RiskCheck, ...]
    risk_reward: float | None
    position_quantity: float | None
    position_notional: float | None
    risk_amount: float | None
    version: str

    @property
    def failed(self) -> list[RiskCheck]:
        return [c for c in self.checks if not c.passed]

    def as_dict(self) -> dict[str, Any]:
        return {
            "approved": self.approved, "risk_reward": self.risk_reward, "position_quantity": self.position_quantity,
            "position_notional": self.position_notional, "risk_amount": self.risk_amount, "version": self.version,
            "checks": [asdict(c) for c in self.checks],
        }


STRENGTH_DISCLAIMER = (
    "Die Signalstaerke beschreibt, wie stark und konsistent die fuer dieses Setup relevanten Datenpunkte "
    "aktuell ausgepraegt sind. Sie ist keine Wahrscheinlichkeit fuer einen Kursanstieg oder -rueckgang."
)
