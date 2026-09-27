"""
SEC Form 4 (und 4/A, 3, 5): Parsing und Klassifikation von Insidertransaktionen.

Nicht jeder Eintrag ist ein Kauf oder Verkauf. Das primaere Alpha-Signal ist der
DISKRETIONAERE Kauf am offenen Markt (Code P ohne Plan-/Programm-Kontext).
Fussnoten werden ausgewertet, weil sie den Kontext tragen: Verkauf zur
Steuerdeckung nach Vesting, 10b5-1-Plan, Dividendenreinvestition, Schenkung,
Uebertrag in einen Trust ...

Klassifikationen: OPEN_MARKET_BUY, OPEN_MARKET_SELL, OPTION_EXERCISE, AWARD, GRANT,
GIFT, TAX_WITHHOLDING, TRANSFER, CONVERSION, OTHER.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from datetime import date

from .xml import SecParseError, child, children, flag, footnote_ids, local, num, parse, path, text, value

CLASSIFICATION_VERSION = "form4-class-0.1.0"

# SEC-Transaktionscodes (Form 4, General Instructions 8)
CODE_LABELS = {
    "P": "Kauf am offenen Markt oder privat", "S": "Verkauf am offenen Markt oder privat",
    "V": "freiwillig frueher gemeldet", "A": "Zuteilung/Award (Rule 16b-3(d))", "D": "Rueckgabe an den Emittenten",
    "F": "Zahlung von Ausuebungspreis/Steuern durch Abgabe von Aktien", "I": "diskretionaere Transaktion (16b-3(f))",
    "M": "Ausuebung/Wandlung eines Derivats (befreit)", "C": "Wandlung eines Derivats", "E": "Verfall kurzer Derivateposition",
    "H": "Verfall/Aufhebung langer Derivateposition", "O": "Ausuebung aus dem Geld", "X": "Ausuebung im/am Geld",
    "G": "Schenkung", "L": "kleiner Erwerb (Rule 16a-6)", "W": "Erwerb/Abgabe durch Erbfall", "Z": "Einlage/Entnahme Stimmrechtstreuhand",
    "J": "sonstiger Erwerb/sonstige Abgabe", "K": "Equity Swap", "U": "Andienung bei Kontrollwechsel",
}

_PATTERNS = {
    "plan_10b5_1": re.compile(r"10b5-?1", re.I),
    "sell_to_cover_tax": re.compile(r"(sell[- ]to[- ]cover|(satisfy|cover|pay)\w*\s.{0,60}tax|tax\s+withholding|withholding\s+tax)", re.I),
    "vesting": re.compile(r"\bvest(ed|ing)?\b|restricted stock unit|\bRSU", re.I),
    "drip": re.compile(r"dividend reinvest|\bDRIP\b", re.I),
    "espp": re.compile(r"employee stock purchase|\bESPP\b", re.I),
    "trust_transfer": re.compile(r"\btrust\b|family (limited )?partnership|transfer(red)? (to|from)", re.I),
    "gift": re.compile(r"\bgift", re.I),
    "weighted_average": re.compile(r"weighted average", re.I),
    "option_exercise": re.compile(r"exercise of (stock )?option", re.I),
}


@dataclass(frozen=True)
class ReportingOwner:
    cik: str | None
    name: str
    is_director: bool
    is_officer: bool
    officer_title: str | None
    is_ten_percent_owner: bool
    is_other: bool

    @property
    def roles(self) -> tuple[str, ...]:
        r = []
        title = (self.officer_title or "").upper()
        if self.is_officer:
            if re.search(r"\bC\.?E\.?O\b|CHIEF EXECUTIVE", title):
                r.append("CEO")
            if re.search(r"\bC\.?F\.?O\b|CHIEF FINANCIAL", title):
                r.append("CFO")
            r.append("OFFICER")
        if self.is_director:
            r.append("DIRECTOR")
        if self.is_ten_percent_owner:
            r.append("TEN_PERCENT_OWNER")
        if self.is_other:
            r.append("OTHER")
        return tuple(r)


@dataclass(frozen=True)
class InsiderTx:
    seq: int
    table: str  # non_derivative | derivative | holding
    security_title: str | None
    transaction_date: date | None
    code: str | None
    shares: float | None
    price: float | None
    acquired_disposed: str | None  # A | D
    shares_after: float | None
    ownership: str | None  # D | I
    nature_of_ownership: str | None
    footnotes: tuple[str, ...]
    classification: str
    classification_confidence: float
    context: tuple[str, ...]
    discretionary: bool
    plan_10b5_1: bool
    equity_swap: bool | None = None
    underlying_security: str | None = None
    exercise_price: float | None = None

    @property
    def value(self) -> float | None:
        return self.shares * self.price if self.shares is not None and self.price is not None else None

    def as_row(self) -> dict:
        d = asdict(self)
        d["value"] = self.value
        return d


@dataclass(frozen=True)
class Form4:
    document_type: str
    period_of_report: date | None
    issuer_cik: str
    issuer_name: str | None
    issuer_ticker: str | None
    owners: tuple[ReportingOwner, ...]
    plan_10b5_1_flag: bool | None  # Pflicht-Checkbox seit 2023 (aff10b5One)
    transactions: tuple[InsiderTx, ...]
    footnotes: dict[str, str] = field(default_factory=dict)
    remarks: str | None = None


def _date(s: str | None) -> date | None:
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        return None


def _context(notes: list[str], remarks: str | None) -> set[str]:
    blob = " ".join(notes) + " " + (remarks or "")
    return {k for k, rx in _PATTERNS.items() if rx.search(blob)}


def classify(code: str | None, table: str, acquired: str | None, ctx: set[str], doc_10b5_1: bool | None) -> tuple[str, float, bool, bool]:
    """
    Rueckgabe: (Klasse, Konfidenz 0..1, diskretionaer, 10b5-1-Plan).
    Konfidenz sinkt, wenn Fussnoten der reinen Code-Deutung widersprechen oder sie ergaenzen muessen.
    """
    plan = bool(doc_10b5_1) or "plan_10b5_1" in ctx
    c = (code or "").upper()
    if c == "P":
        if ctx & {"drip", "espp"}:
            return "OPEN_MARKET_BUY", 0.6, False, plan  # Kauf, aber aus Programm - kein diskretionaerer Entschluss
        return "OPEN_MARKET_BUY", 0.8 if plan else 0.95, not plan, plan
    if c == "S":
        if "sell_to_cover_tax" in ctx:
            return "TAX_WITHHOLDING", 0.8, False, plan   # Verkauf zur Steuerdeckung nach Vesting
        return "OPEN_MARKET_SELL", 0.85 if plan else 0.9, not plan, plan
    if c == "F":
        return "TAX_WITHHOLDING", 0.95, False, plan
    if c in ("M", "X", "O"):
        return "OPTION_EXERCISE", 0.95, False, plan
    if c == "C":
        return "CONVERSION", 0.9, False, plan
    if c == "A":
        return ("GRANT", 0.9, False, plan) if table == "derivative" else ("AWARD", 0.95, False, plan)
    if c == "G":
        return "GIFT", 0.95, False, plan
    if c in ("W", "Z"):
        return "TRANSFER", 0.9, False, plan
    if c == "J":
        if "gift" in ctx:
            return "GIFT", 0.6, False, plan
        if "trust_transfer" in ctx:
            return "TRANSFER", 0.6, False, plan
        return "OTHER", 0.5, False, plan
    if c == "D" and "trust_transfer" in ctx:
        return "TRANSFER", 0.6, False, plan
    return "OTHER", 0.7 if c else 0.3, False, plan


def parse_form4(xml_text: str) -> Form4:
    root = parse(xml_text)
    if local(root.tag) != "ownershipDocument":
        raise SecParseError(f"kein ownershipDocument, sondern {local(root.tag)}")
    footnotes = {fid: " ".join(f.itertext()).strip() for f in children(child(root, "footnotes"), "footnote") if (fid := f.get("id"))}
    remarks = text(child(root, "remarks"))
    issuer = child(root, "issuer")
    issuer_cik = text(child(issuer, "issuerCik"))
    if not issuer_cik:
        raise SecParseError("issuerCik fehlt")
    owners = []
    for o in children(root, "reportingOwner"):
        rel = child(o, "reportingOwnerRelationship")
        owners.append(ReportingOwner(
            cik=text(path(o, "reportingOwnerId", "rptOwnerCik")), name=text(path(o, "reportingOwnerId", "rptOwnerName")) or "Unbekannt",
            is_director=bool(flag(text(child(rel, "isDirector")))), is_officer=bool(flag(text(child(rel, "isOfficer")))),
            officer_title=text(child(rel, "officerTitle")), is_ten_percent_owner=bool(flag(text(child(rel, "isTenPercentOwner")))),
            is_other=bool(flag(text(child(rel, "isOther"))))))
    doc_plan = flag(text(child(root, "aff10b5One")))
    txs: list[InsiderTx] = []
    seq = 0
    for table_name, row_name, table in (("nonDerivativeTable", "nonDerivativeTransaction", "non_derivative"),
                                        ("derivativeTable", "derivativeTransaction", "derivative")):
        for row in children(child(root, table_name), row_name):
            ids = footnote_ids(row)
            notes = [footnotes[i] for i in ids if i in footnotes]
            ctx = _context(notes, remarks)
            code = text(path(row, "transactionCoding", "transactionCode"))
            acq = value(row, "transactionAmounts", "transactionAcquiredDisposedCode")
            cls, conf, disc, plan = classify(code, table, acq, ctx, doc_plan)
            txs.append(InsiderTx(
                seq=seq, table=table, security_title=value(row, "securityTitle"),
                transaction_date=_date(value(row, "transactionDate")), code=code,
                shares=num(value(row, "transactionAmounts", "transactionShares")),
                price=num(value(row, "transactionAmounts", "transactionPricePerShare")),
                acquired_disposed=acq, shares_after=num(value(row, "postTransactionAmounts", "sharesOwnedFollowingTransaction")),
                ownership=value(row, "ownershipNature", "directOrIndirectOwnership"),
                nature_of_ownership=value(row, "ownershipNature", "natureOfOwnership"),
                footnotes=tuple(notes), classification=cls, classification_confidence=conf, context=tuple(sorted(ctx)),
                discretionary=disc, plan_10b5_1=plan, equity_swap=flag(text(path(row, "transactionCoding", "equitySwapInvolved"))),
                underlying_security=value(row, "underlyingSecurity", "underlyingSecurityTitle"),
                exercise_price=num(value(row, "conversionOrExercisePrice"))))
            seq += 1
    return Form4(document_type=text(child(root, "documentType")) or "4", period_of_report=_date(text(child(root, "periodOfReport"))),
                 issuer_cik=issuer_cik.lstrip("0") or "0", issuer_name=text(child(issuer, "issuerName")),
                 issuer_ticker=(text(child(issuer, "issuerTradingSymbol")) or "").upper() or None,
                 owners=tuple(owners), plan_10b5_1_flag=doc_plan, transactions=tuple(txs), footnotes=footnotes, remarks=remarks)
