"""
SEC 13F-HR: Bestaende institutioneller Manager (Quartalsstichtag, Meldung bis 45 Tage danach).

WICHTIG: 13F ist KEIN Live-Portfolio. Jede Auswertung nennt Stichtag (report_period)
und Veroeffentlichung (available_at). Seit Einreichungen ab 03.01.2023 steht `value`
in ganzen US-Dollar, davor in Tausend (Formularaenderung der SEC).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from .xml import SecParseError, child, children, local, num, parse, path, text

VALUE_IN_DOLLARS_SINCE = date(2023, 1, 3)
CHANGE_THRESHOLD = 0.02  # < 2 % Stueckzahlaenderung gilt als unveraendert


@dataclass(frozen=True)
class Holding:
    row_no: int
    issuer_name: str
    title_of_class: str | None
    cusip: str
    value_usd: float
    shares: float | None
    share_type: str | None  # SH | PRN
    put_call: str | None
    investment_discretion: str | None
    voting_sole: float | None
    voting_shared: float | None
    voting_none: float | None


@dataclass(frozen=True)
class CoverPage:
    report_period: date | None
    is_amendment: bool
    amendment_type: str | None  # RESTATEMENT | NEW HOLDINGS
    manager_name: str | None


def parse_info_table(xml_text: str, filing_date: date) -> list[Holding]:
    root = parse(xml_text)
    if local(root.tag) != "informationTable":
        raise SecParseError(f"keine informationTable, sondern {local(root.tag)}")
    mult = 1.0 if filing_date >= VALUE_IN_DOLLARS_SINCE else 1000.0
    out = []
    for i, e in enumerate(children(root, "infoTable")):
        cusip = (text(child(e, "cusip")) or "").strip().upper()
        val = num(text(child(e, "value")))
        name = text(child(e, "nameOfIssuer"))
        if not cusip or val is None or not name:
            continue  # unvollstaendige Zeile wird verworfen, nicht ergaenzt
        amt = child(e, "shrsOrPrnAmt")
        va = child(e, "votingAuthority")
        out.append(Holding(i, " ".join(name.split()), text(child(e, "titleOfClass")), cusip, val * mult,
                           num(text(child(amt, "sshPrnamt"))), text(child(amt, "sshPrnamtType")), text(child(e, "putCall")),
                           text(child(e, "investmentDiscretion")), num(text(child(va, "Sole"))), num(text(child(va, "Shared"))),
                           num(text(child(va, "None")))))
    return out


def parse_cover(xml_text: str) -> CoverPage:
    root = parse(xml_text)
    form = path(root, "formData", "coverPage")
    period = text(child(form, "reportCalendarOrQuarter"))
    rp = None
    if period:
        try:
            m, d, y = period.split("-") if "-" in period and len(period.split("-")[0]) == 2 else (None, None, None)
            rp = date(int(y), int(m), int(d)) if m else date.fromisoformat(period[:10])
        except ValueError:
            rp = None
    return CoverPage(rp, (text(child(form, "isAmendment")) or "").lower() == "true", text(path(form, "amendmentInfo", "amendmentType")),
                     text(path(form, "filingManager", "name")))


def aggregate(holdings: list[Holding]) -> dict[tuple[str, str], dict]:
    """Je (CUSIP, Put/Call) zusammengefasst - ein Manager meldet dieselbe Aktie oft in mehreren Zeilen."""
    agg: dict[tuple[str, str], dict] = {}
    for h in holdings:
        key = (h.cusip, (h.put_call or "").upper())
        a = agg.setdefault(key, {"cusip": h.cusip, "put_call": key[1] or None, "issuer_name": h.issuer_name, "shares": 0.0, "value_usd": 0.0})
        a["shares"] += h.shares or 0.0
        a["value_usd"] += h.value_usd
    return agg


def position_changes(previous: list[Holding] | None, current: list[Holding]) -> list[dict]:
    """NEW_POSITION, INCREASE, REDUCTION, EXIT, UNCHANGED - nach Stueckzahl (der Wert haengt am Kurs)."""
    cur = aggregate(current)
    prev = aggregate(previous or [])
    out = []
    for key in sorted(set(cur) | set(prev)):
        c, p = cur.get(key), prev.get(key)
        cs, ps = (c or {}).get("shares", 0.0), (p or {}).get("shares", 0.0)
        if not p or ps == 0:
            change = "NEW_POSITION"
        elif not c or cs == 0:
            change = "EXIT"
        elif cs > ps * (1 + CHANGE_THRESHOLD):
            change = "INCREASE"
        elif cs < ps * (1 - CHANGE_THRESHOLD):
            change = "REDUCTION"
        else:
            change = "UNCHANGED"
        base = c or p
        out.append({"cusip": key[0], "put_call": key[1] or None, "issuer_name": base["issuer_name"], "change": change,
                    "shares": cs, "previous_shares": ps if p else None, "value_usd": (c or {}).get("value_usd", 0.0),
                    "share_change_pct": ((cs / ps - 1) * 100) if p and ps else None})
    return out
