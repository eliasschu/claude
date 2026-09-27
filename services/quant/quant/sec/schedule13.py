"""
Schedule 13D / 13G (Beteiligungen ueber 5 %).

Seit dem 18.12.2024 reicht die SEC diese Meldungen strukturiert (XML) ein. Aeltere
Meldungen sind Freitext (HTML/TXT). Erfasst werden immer die Metadaten (Melder,
Emittent, Formular, Datum, Nachtrag); Anteil und Stueckzahl nur, wenn sie
strukturiert vorliegen - sonst parse_status='metadata_only' statt geschaetzter Werte.
Die Elementnamen werden tolerant gesucht (Namensraum, Gross/Klein) und sind gegen
Live-Einreichungen noch zu verifizieren.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .xml import SecParseError, iter_local, num, parse, text

PERCENT_TAGS = ("percentOfClass", "classPercent", "percentOfClassRepresentedByAmountInRow11", "percentOfClassRepresented")
AMOUNT_TAGS = ("aggregateAmountOwned", "aggregateAmountBeneficiallyOwned", "amountBeneficiallyOwned")
NAME_TAGS = ("reportingPersonName", "nameOfReportingPerson", "reportingPersonNames")


@dataclass(frozen=True)
class Schedule13:
    schedule: str            # "D" (aktivistisch moeglich) | "G" (passiv)
    is_amendment: bool
    parse_status: str        # structured | metadata_only
    reporting_persons: list[dict] = field(default_factory=list)
    percent_of_class: float | None = None
    shares_owned: float | None = None


def schedule_of(form: str) -> tuple[str, bool]:
    f = form.upper().replace("SCHEDULE", "SC").strip()
    if "13D" in f:
        return "D", "/A" in f
    if "13G" in f:
        return "G", "/A" in f
    raise ValueError(f"kein Schedule 13D/G: {form}")


def _first(node, tags) -> str | None:  # noqa: D103
    for t in tags:
        for el in iter_local(node, t):
            v = text(el)
            if v:
                return v
    return None


def parse_schedule13(form: str, document: str) -> Schedule13:
    schedule, amendment = schedule_of(form)
    stripped = document.lstrip()
    if not stripped.startswith("<") or stripped[:200].lower().startswith(("<html", "<!doctype html")):
        return Schedule13(schedule, amendment, "metadata_only")
    try:
        root = parse(document)
    except SecParseError:
        return Schedule13(schedule, amendment, "metadata_only")
    persons: list[dict[str, Any]] = []
    # Je meldender Person ein Block mit eigenem Anteil (gemeinsame Meldungen mehrerer Personen)
    blocks = [b for t in ("reportingPersonInfo", "reportingPersons", "coverPageHeaderReportingPersonDetails") for b in iter_local(root, t)]
    for b in blocks or [root]:
        name = _first(b, NAME_TAGS)
        pct = num((_first(b, PERCENT_TAGS) or "").replace("%", "") or None)
        amt = num(_first(b, AMOUNT_TAGS))
        if name or pct is not None or amt is not None:
            persons.append({"name": name, "percent_of_class": pct, "shares_owned": amt})
    pcts = [p["percent_of_class"] for p in persons if p["percent_of_class"] is not None]
    amts = [p["shares_owned"] for p in persons if p["shares_owned"] is not None]
    if not pcts and not amts:
        return Schedule13(schedule, amendment, "metadata_only", persons)
    # Gemeinsame Melder halten meist dieselben Aktien - das Maximum, nicht die Summe, vermeidet Doppelzaehlung
    return Schedule13(schedule, amendment, "structured", persons, max(pcts) if pcts else None, max(amts) if amts else None)


def stake_change(previous_pct: float | None, current_pct: float | None, schedule: str) -> str:
    if current_pct is None:
        return "UNKNOWN"
    if previous_pct is None:
        return "NEW_LARGE_STAKE"
    if current_pct >= previous_pct + 0.5:
        return "STAKE_INCREASE"
    if current_pct <= previous_pct - 0.5:
        return "STAKE_REDUCTION"
    return "UNCHANGED"
