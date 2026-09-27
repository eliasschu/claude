"""
Robuste WebSocket-Verbindung je Datenstrom.

  * automatischer Reconnect mit exponentiellem Backoff + Full Jitter
  * Ping/Pong-Heartbeat (websockets: ping_interval/ping_timeout), Verbindungs-Timeout
  * Stale-Erkennung: keine Nachricht innerhalb `stale_after` -> Verbindung neu aufbauen
    (fuer Stroeme, die nur bei Ereignissen senden - z. B. Liquidationen - wird stale_after=None gesetzt;
    dort reicht der Ping/Pong-Heartbeat)
  * Subscription Recovery: Abo-Nachricht wird nach JEDEM Verbindungsaufbau erneut gesendet
  * on_connect-Rueckruf: z. B. Orderbuch invalidieren -> neuer Snapshot (Sequence Recovery)
  * Bremse gegen aggressive Endlosschleifen: hoechstens `max_reconnects` in `window`,
    danach lange Pause (cooldown)
Die Verbindung kennt keine Strategien: sie normalisiert und publiziert nur.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable

from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed, InvalidHandshake, InvalidURI

from ..metrics import METRICS
from .bus import EventBus
from .normalizers import NormalizeError, parse_json

log = logging.getLogger("quant.ws")
POLL_S = 0.25
Clock = Callable[[], datetime]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class StreamSpec:
    name: str                      # z. B. "binance:trades:BTCUSDT"
    url: str
    normalize: Callable[[Any, datetime], Any]
    subscribe: dict | None = None  # wird nach jedem Connect gesendet
    stale_after: float | None = 30.0
    on_connect: Callable[[], Awaitable[None] | None] | None = None


@dataclass
class StreamStatus:
    state: str = "idle"            # idle | connecting | live | reconnecting | cooldown | stopped
    connected_at: datetime | None = None
    last_message_at: datetime | None = None
    reconnects: int = 0
    messages: int = 0
    bad_messages: int = 0
    last_error: str | None = None
    recent_reconnects: list[datetime] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"state": self.state, "connected_at": self.connected_at.isoformat() if self.connected_at else None,
                "last_message_at": self.last_message_at.isoformat() if self.last_message_at else None,
                "reconnects": self.reconnects, "messages": self.messages, "bad_messages": self.bad_messages, "last_error": self.last_error}


class WsStream:
    def __init__(self, spec: StreamSpec, bus: EventBus, *, clock: Clock = utc_now, base_backoff: float = 1.0,
                 max_backoff: float = 60.0, max_reconnects: int = 10, window: timedelta = timedelta(minutes=10),
                 cooldown: float = 300.0, open_timeout: float = 10.0, ping_interval: float = 20.0, ping_timeout: float = 20.0,
                 connector: Callable[..., Any] = connect, rng: random.Random | None = None):
        self.spec, self.bus, self.clock = spec, bus, clock
        self.status = StreamStatus()
        self._base, self._max, self._max_rc, self._window, self._cooldown = base_backoff, max_backoff, max_reconnects, window, cooldown
        self._open_timeout, self._ping_interval, self._ping_timeout = open_timeout, ping_interval, ping_timeout
        self._connector = connector
        self._rng = rng or random.Random()

    def _delay(self, attempt: int) -> float:
        return self._rng.uniform(0, min(self._max, self._base * 2 ** attempt))

    async def run(self, stop: asyncio.Event) -> None:
        attempt = 0
        while not stop.is_set():
            self.status.state = "connecting" if self.status.reconnects == 0 else "reconnecting"
            stable = False
            try:
                async with self._connector(self.spec.url, open_timeout=self._open_timeout, ping_interval=self._ping_interval,
                                           ping_timeout=self._ping_timeout, close_timeout=5, max_size=2**22) as ws:
                    if self.spec.subscribe is not None:
                        await ws.send(json.dumps(self.spec.subscribe))  # Subscription Recovery
                    self.status.state, self.status.connected_at = "live", self.clock()
                    if self.spec.on_connect is not None:
                        res = self.spec.on_connect()
                        if asyncio.iscoroutine(res):
                            await res
                    stable = await self._receive(ws, stop)
            except (OSError, asyncio.TimeoutError, ConnectionClosed, InvalidHandshake, InvalidURI) as exc:
                self.status.last_error = f"{type(exc).__name__}: {exc}"[:200]
            if stop.is_set():
                break
            # Verbindung beendet -> Reconnect planen
            self.status.reconnects += 1
            METRICS.inc("websocket_disconnects_total", stream=self.spec.name)
            now = self.clock()
            self.status.recent_reconnects = [t for t in self.status.recent_reconnects if now - t < self._window] + [now]
            attempt = 0 if stable else attempt + 1
            if len(self.status.recent_reconnects) > self._max_rc:
                self.status.state = "cooldown"
                log.warning("WebSocket pausiert nach zu vielen Reconnects", extra={
                    "event": "ws_cooldown", "stream": self.spec.name, "pause_s": self._cooldown, "error_type": self.status.last_error})
                await _sleep(stop, self._cooldown)
                self.status.recent_reconnects = []
                continue
            self.status.state = "reconnecting"
            delay = self._delay(attempt)
            log.info("WebSocket-Reconnect", extra={"event": "ws_reconnect", "stream": self.spec.name, "retry_in_s": round(delay, 2),
                                                  "error_type": self.status.last_error})
            await _sleep(stop, delay)
        self.status.state = "stopped"

    async def _receive(self, ws, stop: asyncio.Event) -> bool:
        """Liest bis zum Abbruch. Rueckgabe True, wenn die Verbindung laenger stabil war (Backoff zuruecksetzen)."""
        started = self.clock()
        idle = 0.0
        while not stop.is_set():
            try:
                # Kurzer Takt: Stop-Signal wird spaetestens nach 1 s bemerkt (sauberes Herunterfahren bei SIGTERM).
                # recv() abzubrechen ist in websockets verlustfrei.
                raw = await asyncio.wait_for(ws.recv(), timeout=POLL_S)
            except asyncio.TimeoutError:
                idle += POLL_S
                if self.spec.stale_after is not None and idle >= self.spec.stale_after:
                    self.status.last_error = f"keine Nachricht seit {self.spec.stale_after} s (stale)"
                    METRICS.inc("websocket_stale_total", stream=self.spec.name)
                    await ws.close()
                    break
                continue
            idle = 0.0
            received_at = self.clock()
            self.status.last_message_at = received_at
            self.status.messages += 1
            METRICS.inc("websocket_messages_total", stream=self.spec.name)
            try:
                ev = self.spec.normalize(parse_json(raw), received_at)
            except NormalizeError as exc:
                self.status.bad_messages += 1
                self.status.last_error = f"ungueltige Nachricht: {exc}"[:200]
                METRICS.inc("websocket_bad_messages_total", stream=self.spec.name)
                continue
            if ev is not None:
                self.bus.publish(ev)
        if stop.is_set():
            await ws.close()
        return self.clock() - started > timedelta(seconds=30)


async def _sleep(stop: asyncio.Event, seconds: float) -> None:
    try:
        await asyncio.wait_for(stop.wait(), timeout=seconds)
    except asyncio.TimeoutError:
        pass
