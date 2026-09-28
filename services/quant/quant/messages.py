"""
Bot-Meldungen: verstaendliche, unveraenderliche Meldungen aus erkannten Ereignissen.

Heute: Insidermeldungen (SEC Form 4) nach festen, offengelegten Regeln - dieselben
Regeln wie auf der Website (src/lib/finance/insider-materiality.ts,
src/lib/services/bot-feed.ts). Jede Erkennung wird genau EINMAL archiviert
(dedup_key); detected_at ist die Bot-Uhr beim ersten Erkennen und wird nie
ueberschrieben. Es gibt keine Kauf- oder Verkaufsempfehlung.

Drei Zeitpunkte werden getrennt gespeichert:
  traded_from/to  Handelstag(e) laut Meldung
  published_at    fruehester oeffentlicher Zeitpunkt (SEC-Annahme)
  detected_at     wann der Bot die Meldung vorliegen hatte und die Regel anschlug
"""

from __future__ import annotations

import hashlib
import json
import logging
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

from psycopg.types.json import Jsonb

from .db import Conn

log = logging.getLogger("quant.messages")

RULE_VERSION = "insider-rules-1.0"
RULES = {
    "max_age_days": 14,          # nur Meldungen, die hoechstens so alt sind (Veroeffentlichung)
    "cluster_min_owners": 2,     # Cluster: mindestens so viele verschiedene Insider ...
    "cluster_window_days": 14,   # ... mit Kaeufen innerhalb so vieler Tage
    "large_sale_usd": 1_000_000,  # Verkauf ohne Plan gilt ab diesem Betrag ...
    "large_sale_share": 0.05,    # ... oder ab diesem Anteil am Bestand als bedeutend
}

UNCERTAINTY = {
    "buy": ("Ein Insiderkauf zeigt, wie eine Person mit Einblick handelt, nicht, wie sich der Kurs entwickelt. Der Grund muss "
            "nicht gemeldet werden. Die Einordnung beruht auf den Formular-Codes und Fußnoten der Meldung."),
    "sale": ("Verkäufe haben häufig persönliche Gründe (Steuern, Streuung, Liquidität) und sind deshalb weniger aussagekräftig "
             "als Käufe. Ein Grund muss nicht gemeldet werden."),
    "cluster": ("Mehrere Käufe in kurzer Zeit sind auffälliger als ein einzelner, belegen aber keine Kursentwicklung. Die Personen "
                "können sich abgesprochen haben oder aus ähnlichen persönlichen Gründen handeln."),
}
COUNTER = {
    "buy": ["Der Kauf kann gemessen am Vermögen der Person klein sein.",
            "Insider irren sich ebenso wie andere Anleger; ein einzelner Kauf ist kein Beleg."],
    "sale": ["Ein Verkauf ist keine Aussage über die Erwartung zum Unternehmen.",
             "Die Person hält danach möglicherweise weiterhin einen großen Bestand."],
    "cluster": ["Auch mehrere Käufe können gemessen am Vermögen der Personen klein sein.",
                "Gleichzeitige Käufe folgen manchmal einem Ereignis (z. B. Ende einer Handelssperre), nicht einer neuen Einschätzung."],
}

ROLE_LABEL = {"CEO": "CEO", "CFO": "Finanzchef(in)", "DIRECTOR": "Aufsichtsrat", "TEN_PERCENT_OWNER": "Großaktionär"}


# ---------------------------------------------------------------------- Hilfen
def format_name(raw: str) -> str:
    """SEC-Namen ("NACHNAME VORNAME [ZWEITNAME]") lesbar machen - Heuristik, nie erfunden."""
    clean = " ".join(raw.split())
    if not clean:
        return "Unbekannt"

    def tc(w: str) -> str:
        return w if (len(w) <= 3 and w.isalpha() and w.isupper()) else w[:1] + w[1:].lower()

    if "," in clean:
        last, *rest = [p.strip() for p in clean.split(",")]
        return " ".join(tc(w) for w in [*" ".join(rest).split(), last] if w)
    parts = clean.split(" ")
    if len(parts) < 2:
        return tc(clean)
    return " ".join(tc(w) for w in [*parts[1:], parts[0]])


def short_role(roles: list[str], officer_title: str | None) -> str:
    for key in ("CEO", "CFO"):
        if key in roles:
            return ROLE_LABEL[key]
    if "OFFICER" in roles:
        return officer_title.strip() if officer_title else "Führungskraft"
    for key in ("DIRECTOR", "TEN_PERCENT_OWNER"):
        if key in roles:
            return ROLE_LABEL[key]
    return "Insider"


def money(v: float) -> str:
    for limit, unit in ((1e9, "Mrd."), (1e6, "Mio."), (1e3, "Tsd.")):
        if abs(v) >= limit:
            return f"{v / limit:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".") + f" {unit} $"
    return f"{v:,.0f}".replace(",", ".") + " $"


def filing_index_url(url: str | None) -> str | None:
    return url.rsplit("/", 1)[0] + "/" if url else None


@dataclass
class Tx:
    """Eine Meldung (accession) einer Person in einer Richtung - Teilausfuehrungen zusammengefasst."""
    accession: str
    issuer_cik: str
    ticker: str | None
    issuer_name: str | None
    owner: str
    role: str
    kind: str                      # buy | sale
    dates: list[date] = field(default_factory=list)
    shares: float = 0.0
    value: float | None = None
    shares_after: float | None = None
    discretionary: bool = True
    plan: bool = False
    published_at: datetime | None = None
    url: str | None = None
    confidence: float = 1.0

    @property
    def share_of_holding(self) -> float | None:
        if self.shares_after is None or not self.shares:
            return None
        before = self.shares_after - self.shares if self.kind == "buy" else self.shares_after + self.shares
        return self.shares / before if before > 0 else None

    def observation(self) -> dict[str, Any]:
        return {"accession": self.accession, "owner": self.owner, "role": self.role, "direction": self.kind,
                "trade_dates": [d.isoformat() for d in sorted(self.dates)], "shares": self.shares, "value_usd": self.value,
                "shares_after": self.shares_after, "share_of_holding": self.share_of_holding, "plan_10b5_1": self.plan,
                "discretionary": self.discretionary, "classification_confidence": self.confidence,
                "published_at": self.published_at.isoformat() if self.published_at else None, "source_url": self.url}


def load_transactions(conn: Conn, now: datetime) -> list[Tx]:
    """Kaeufe/Verkaeufe am offenen Markt, die zum Zeitpunkt `now` bekannt und hoechstens max_age_days alt sind."""
    rows = conn.execute(
        """SELECT t.*, f.url FROM insider_transactions t JOIN sec_filings f USING (accession)
           WHERE t.table_kind = 'non_derivative' AND t.classification IN ('OPEN_MARKET_BUY','OPEN_MARKET_SELL')
             AND t.available_at >= %s AND GREATEST(t.available_at, t.received_at) <= %s
           ORDER BY t.accession, t.seq""",
        (now - timedelta(days=RULES["max_age_days"]), now)).fetchall()
    grouped: dict[tuple[str, str], Tx] = {}
    for r in rows:
        kind = "buy" if r["classification"] == "OPEN_MARKET_BUY" else "sale"
        key = (r["accession"], kind)
        tx = grouped.get(key)
        if tx is None:
            tx = grouped[key] = Tx(
                accession=r["accession"], issuer_cik=r["issuer_cik"], ticker=r["issuer_ticker"], issuer_name=r.get("issuer_name"),
                owner=", ".join(format_name(n) for n in r["owner_names"]) or "Unbekannt",
                role=short_role(list(r["roles"]), r["officer_title"]), kind=kind, published_at=r["available_at"], url=r["url"])
        if r["transaction_date"]:
            tx.dates.append(r["transaction_date"])
        tx.shares += r["shares"] or 0.0
        if r["value"] is not None:
            tx.value = (tx.value or 0.0) + r["value"]
        if r["shares_after"] is not None:
            tx.shares_after = r["shares_after"]
        tx.discretionary = tx.discretionary and r["discretionary"]
        tx.plan = tx.plan or r["plan_10b5_1"]
        tx.confidence = min(tx.confidence, r["classification_confidence"])
    return list(grouped.values())


# ---------------------------------------------------------------------- Regeln
def qualifies(tx: Tx) -> str | None:
    """Aussagekraft nach denselben Regeln wie auf der Website: 'hoch', 'mittel' oder None."""
    if tx.kind == "buy":
        return "hoch" if tx.discretionary and not tx.plan else None
    large = (tx.value is not None and tx.value >= RULES["large_sale_usd"]) or \
            (tx.share_of_holding is not None and tx.share_of_holding >= RULES["large_sale_share"])
    return "mittel" if (not tx.plan and large) else None


def find_clusters(buys: list[Tx]) -> list[list[Tx]]:
    """Kaeufe mehrerer verschiedener Insider derselben Firma innerhalb des Zeitfensters (ab dem fruehesten Kauf)."""
    by_issuer: dict[str, list[Tx]] = defaultdict(list)
    for t in buys:
        if t.dates:
            by_issuer[t.issuer_cik].append(t)
    clusters = []
    for group in by_issuer.values():
        group.sort(key=lambda t: min(t.dates))
        start = min(group[0].dates)
        members = [t for t in group if min(t.dates) <= start + timedelta(days=RULES["cluster_window_days"])]
        if len({t.owner for t in members}) >= RULES["cluster_min_owners"]:
            clusters.append(members)
    return clusters


@dataclass(frozen=True)
class Message:
    dedup_key: str
    kind: str
    ticker: str | None
    issuer_cik: str
    issuer_name: str | None
    title: str
    relevance: str
    uncertainty: str
    counter_arguments: list[str]
    observations: list[dict[str, Any]]
    sources: list[dict[str, str]]
    selection: str
    value_usd: float | None
    traded_from: date | None
    traded_to: date | None
    published_at: datetime


def _sources(txs: list[Tx]) -> list[dict[str, str]]:
    return [{"label": f"SEC Form 4 · {t.owner}", "url": filing_index_url(t.url) or ""} for t in txs if t.url]


def _value(txs: list[Tx]) -> float | None:
    vals = [t.value for t in txs if t.value is not None]
    return sum(vals) if vals else None


def cluster_message(members: list[Tx]) -> Message:
    dates = sorted(d for t in members for d in t.dates)
    owners = list(dict.fromkeys(t.owner for t in members))
    value = _value(members)
    span = (dates[-1] - dates[0]).days
    name = members[0].issuer_name or members[0].ticker or f"CIK {members[0].issuer_cik}"
    return Message(
        dedup_key=f"insider_cluster:{members[0].issuer_cik}:{dates[0].isoformat()}",
        kind="insider_cluster", ticker=members[0].ticker, issuer_cik=members[0].issuer_cik, issuer_name=members[0].issuer_name,
        title=f"{len(owners)} Insider von {name} kaufen innerhalb von {span + 1} {'Tag' if span == 0 else 'Tagen'}"
              + (f" für zusammen {money(value)}" if value is not None else ""),
        relevance=f"Käufe am offenen Markt durch {', '.join(owners)}. Keine der Meldungen verweist auf einen vorab festgelegten Plan. "
                  "Mehrere Personen mit Einblick in dasselbe Unternehmen setzen eigenes Geld ein.",
        uncertainty=UNCERTAINTY["cluster"], counter_arguments=COUNTER["cluster"],
        observations=[t.observation() for t in members], sources=_sources(members),
        selection=f"Mehrere Insider ({len(owners)}) mit Käufen innerhalb von {RULES['cluster_window_days']} Tagen.",
        value_usd=value, traded_from=dates[0], traded_to=dates[-1],
        published_at=max(t.published_at for t in members if t.published_at))


def single_message(tx: Tx, level: str) -> Message:
    buy = tx.kind == "buy"
    dates = sorted(tx.dates)
    rel = ["Kauf am offenen Markt ohne erkennbaren Plan." if buy else
           f"Großer Verkauf ohne erkennbaren Plan (ab {RULES['large_sale_usd'] / 1e6:.0f} Mio. $ oder "
           f"{RULES['large_sale_share'] * 100:.0f} % des Bestands)."]
    share = tx.share_of_holding
    if share is not None and share >= 0.05:
        rel.append(f"Das entspricht {share * 100:.0f} % des zuvor gemeldeten Bestands der Person.")
    return Message(
        dedup_key=f"insider_{tx.kind}:{tx.accession}",
        kind="insider_buy" if buy else "insider_sale", ticker=tx.ticker, issuer_cik=tx.issuer_cik, issuer_name=tx.issuer_name,
        title=f"{tx.owner} ({tx.role}) {'kauft' if buy else 'verkauft'} {tx.ticker or tx.issuer_name}-Aktien"
              + (f" für {money(tx.value)}" if tx.value is not None else ""),
        relevance=" ".join(rel), uncertainty=UNCERTAINTY["buy" if buy else "sale"], counter_arguments=COUNTER["buy" if buy else "sale"],
        observations=[tx.observation()], sources=_sources([tx]), selection=f"Aussagekraft {level} nach den Insider-Regeln.",
        value_usd=tx.value, traded_from=dates[0] if dates else None, traded_to=dates[-1] if dates else None,
        published_at=tx.published_at)  # type: ignore[arg-type]


def build_messages(txs: list[Tx]) -> list[Message]:
    """Cluster ergeben EINE Meldung je Firma; Transaktionen im Cluster erzeugen keine zusaetzliche Einzelmeldung."""
    eligible = [(t, lvl) for t in txs if (lvl := qualifies(t))]
    clusters = find_clusters([t for t, _ in eligible if t.kind == "buy"])
    in_cluster = {id(t) for c in clusters for t in c}
    return [cluster_message(c) for c in clusters] + [single_message(t, lvl) for t, lvl in eligible if id(t) not in in_cluster]


def _hash(m: Message) -> str:
    blob = json.dumps({k: getattr(m, k) for k in Message.__dataclass_fields__}, sort_keys=True, default=str, ensure_ascii=False)
    return hashlib.sha256(f"{RULE_VERSION}|{blob}".encode()).hexdigest()


def archive(conn: Conn, messages: list[Message], *, detected_at: datetime, mode: str = "live") -> int:
    """Speichert neue Meldungen; bereits archivierte (gleicher dedup_key) bleiben unveraendert."""
    new = 0
    for m in messages:
        cur = conn.execute(
            """INSERT INTO bot_messages (message_id, dedup_key, kind, rule_version, ticker, issuer_cik, issuer_name, title, relevance,
                   uncertainty, counter_arguments, observations, sources, selection, value_usd, traded_from, traded_to, published_at,
                   detected_at, mode, content_hash)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (dedup_key) DO NOTHING""",
            (uuid.uuid4(), m.dedup_key, m.kind, RULE_VERSION, m.ticker, m.issuer_cik, m.issuer_name, m.title, m.relevance, m.uncertainty,
             Jsonb(m.counter_arguments), Jsonb(m.observations), Jsonb(m.sources), m.selection, m.value_usd, m.traded_from, m.traded_to,
             m.published_at, detected_at, mode, _hash(m)))
        new += cur.rowcount
    return new


def detect_insider_messages(conn: Conn, now: datetime, mode: str = "live") -> int:
    n = archive(conn, build_messages(load_transactions(conn, now)), detected_at=now, mode=mode)
    conn.commit()
    if n:
        log.info("Neue Bot-Meldungen", extra={"event": "bot_messages_new", "count": n})
    return n
