"""
In-Prozess-Event-Bus (asyncio). Jeder Abonnent hat eine begrenzte Queue; ist sie voll,
wird das AELTESTE Ereignis verworfen und gezaehlt - ein langsamer Abnehmer darf nie den
Empfang blockieren oder den Speicher sprengen. Fuer mehrere Prozesse spaeter austauschbar
(z. B. Redis Streams), die Schnittstelle bleibt publish/subscribe.
"""

from __future__ import annotations

import asyncio

from ..metrics import METRICS
from .events import MarketEvent


class EventBus:
    def __init__(self, maxsize: int = 50_000):
        self._subs: list[asyncio.Queue] = []
        self._maxsize = maxsize
        self.dropped = 0

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(self._maxsize)
        self._subs.append(q)
        return q

    def publish(self, ev: MarketEvent) -> None:
        for q in self._subs:
            if q.full():
                q.get_nowait()
                self.dropped += 1
                METRICS.inc("event_bus_dropped_total")
            q.put_nowait(ev)
