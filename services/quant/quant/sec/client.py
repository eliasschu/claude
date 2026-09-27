"""EDGAR-Zugriff. Fair-Access-Regel der SEC: hoechstens 10 Anfragen je Sekunde, User-Agent mit Kontakt."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from ..providers.base import NotConfiguredError, ProviderError
from ..providers.http import HttpSource, Transport

NEW_YORK = ZoneInfo("America/New_York")


@dataclass(frozen=True)
class FilingRef:
    accession: str
    form: str
    filing_date: date
    report_date: date | None
    accepted_at: datetime | None
    primary_document: str
    filer_cik: str

    @property
    def folder(self) -> str:
        return f"https://www.sec.gov/Archives/edgar/data/{int(self.filer_cik)}/{self.accession.replace('-', '')}"

    @property
    def raw_primary(self) -> str:
        """Form 4 verweist oft auf die gerenderte Fassung ('xslF345X05/...xml') - das Roh-XML liegt ohne Praefix daneben."""
        doc = self.primary_document.split("/", 1)[1] if self.primary_document.startswith("xsl") else self.primary_document
        return f"{self.folder}/{doc}"


def accepted_time(raw: str | None) -> datetime | None:
    """
    EDGAR-Annahmezeitpunkt. Die Angabe ist Eastern Time (trotz Z-Suffix in manchen Quellen) - wir lesen sie
    KONSERVATIV als New-Yorker Zeit: im Zweifel ist die Meldung spaeter nutzbar, nie frueher als real.
    """
    if not raw:
        return None
    try:
        naive = datetime.fromisoformat(raw.replace("Z", "").split(".")[0])
    except ValueError:
        return None
    return naive.replace(tzinfo=NEW_YORK).astimezone(timezone.utc)


def available_at(ref: FilingRef) -> datetime:
    """Ohne Annahmezeit: Ende des Einreichungstags (New York) - ebenfalls konservativ."""
    if ref.accepted_at is not None:
        return ref.accepted_at
    return datetime.combine(ref.filing_date, datetime.max.time().replace(microsecond=0), tzinfo=NEW_YORK).astimezone(timezone.utc)


def parse_submissions(raw: dict[str, Any], cik: str) -> list[FilingRef]:
    recent = (raw.get("filings") or {}).get("recent") or {}
    acc = recent.get("accessionNumber") or []
    out = []
    for i, a in enumerate(acc):
        def col(name, i=i):
            v = recent.get(name) or []
            return v[i] if i < len(v) else None
        try:
            fd = date.fromisoformat(col("filingDate"))
        except (TypeError, ValueError):
            continue
        rd = col("reportDate")
        out.append(FilingRef(a, col("form") or "", fd, date.fromisoformat(rd) if rd else None, accepted_time(col("acceptanceDateTime")),
                             col("primaryDocument") or "", str(int(cik))))
    return out


class SecClient:
    source_id = "sec"

    def __init__(self, user_agent: str | None, transport: Transport | None = None):
        if not user_agent or "@" not in user_agent:
            raise NotConfiguredError("sec", "SEC_EDGAR_USER_AGENT fehlt oder enthaelt keine E-Mail-Adresse.")
        self._headers = {"User-Agent": user_agent, "Accept-Encoding": "gzip, deflate"}
        self._http = HttpSource("sec", transport, min_interval_s=0.125)

    def _get(self, url: str):
        resp, fetched = self._http.get(url, None, self._headers)
        return resp, fetched

    def ticker_map(self) -> dict[str, str]:
        resp, _ = self._get("https://www.sec.gov/files/company_tickers.json")
        try:
            return {v["ticker"].upper(): str(v["cik_str"]) for v in resp.json().values()}
        except (ValueError, KeyError, AttributeError) as exc:
            raise ProviderError("sec", "invalid", "Tickerverzeichnis unbrauchbar") from exc

    def submissions(self, cik: str) -> list[FilingRef]:
        resp, _ = self._get(f"https://data.sec.gov/submissions/CIK{int(cik):010d}.json")
        try:
            return parse_submissions(resp.json(), cik)
        except ValueError as exc:
            raise ProviderError("sec", "invalid", "Submissions unbrauchbar") from exc

    def text(self, url: str) -> str:
        return self._get(url)[0].text

    def filing_index(self, ref: FilingRef) -> list[str]:
        resp, _ = self._get(f"{ref.folder}/index.json")
        try:
            return [i["name"] for i in resp.json()["directory"]["item"]]
        except (ValueError, KeyError, TypeError) as exc:
            raise ProviderError("sec", "invalid", "Ordnerindex unbrauchbar") from exc
