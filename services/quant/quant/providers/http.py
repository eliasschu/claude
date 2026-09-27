"""Gemeinsamer HTTP-Abruf: Timeout, begrenzte Wiederholung, Fehler als ProviderError."""

from __future__ import annotations

import random
import time
from collections.abc import Callable
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any

import httpx

from .base import ProviderError

Transport = Callable[[str, dict[str, Any] | None, dict[str, str] | None], httpx.Response]


def default_transport(timeout: float = 6.0) -> Transport:
    # Verbindungsaufbau kurz: ein haengender Anbieter darf den Zyklus nicht blockieren
    client = httpx.Client(timeout=httpx.Timeout(timeout, connect=3.0), headers={"Accept": "application/json, text/csv, */*"})

    def send(url: str, params: dict[str, Any] | None, headers: dict[str, str] | None) -> httpx.Response:
        return client.get(url, params=params, headers=headers)

    return send


class HttpSource:
    def __init__(self, source_id: str, transport: Transport | None = None, retries: int = 2, min_interval_s: float = 0.0):
        self.source_id = source_id
        self._send = transport or default_transport()
        self._retries = retries
        self._min_interval = min_interval_s
        self._next_slot = 0.0

    def get(self, url: str, params: dict[str, Any] | None = None, headers: dict[str, str] | None = None) -> tuple[httpx.Response, datetime]:
        last: ProviderError | None = None
        for attempt in range(self._retries + 1):
            wait = self._next_slot - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self._next_slot = time.monotonic() + self._min_interval
            try:
                resp = self._send(url, params, headers)
            except httpx.HTTPError as exc:
                last = ProviderError(self.source_id, "unavailable", f"Netzwerkfehler: {exc.__class__.__name__}")
                if attempt < self._retries:
                    time.sleep(_jitter(attempt))
                continue
            if resp.status_code == 404:
                raise ProviderError(self.source_id, "not_found", "Eintrag nicht gefunden")
            if resp.status_code in (401, 403, 451):
                # 451: Binance sperrt bestimmte Regionen - kein Wiederholen
                raise ProviderError(self.source_id, "not_configured", f"Zugriff verweigert ({resp.status_code})")
            if resp.status_code in (418, 429) or resp.status_code >= 500:
                last = ProviderError(self.source_id, "rate_limited" if resp.status_code in (418, 429) else "unavailable", f"Quelle antwortete mit {resp.status_code}")
                if resp.status_code == 418:  # Binance: IP gesperrt - Wiederholen verlaengert die Sperre
                    break
                if attempt < self._retries:
                    time.sleep(_retry_after(resp) or _jitter(attempt))
                continue
            if resp.status_code >= 400:
                raise ProviderError(self.source_id, "invalid", f"Quelle antwortete mit {resp.status_code}")
            return resp, response_time(resp)
        raise last or ProviderError(self.source_id, "unavailable", "Quelle nicht erreichbar")


def _jitter(attempt: int, base: float = 0.25, cap: float = 2.0) -> float:
    """Exponentieller Backoff mit Full Jitter; kurz gehalten, damit ein Zyklus nicht blockiert."""
    return random.uniform(0, min(cap, base * 2 ** attempt))


def _retry_after(resp: httpx.Response, cap: float = 5.0) -> float | None:
    value = resp.headers.get("retry-after")
    try:
        return min(float(value), cap) if value else None
    except ValueError:
        return None


def response_time(resp: httpx.Response) -> datetime:
    """Zeitpunkt laut Date-Header der Quelle, sonst lokale Uhr (UTC)."""
    header = resp.headers.get("date")
    if header:
        try:
            return parsedate_to_datetime(header).astimezone(timezone.utc)
        except (TypeError, ValueError):
            pass
    return datetime.now(timezone.utc)


def ms_to_dt(ms: int | float | str) -> datetime:
    return datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc)
