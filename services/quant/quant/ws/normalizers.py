"""
Anbieterspezifische Nachrichten -> normalisierte Ereignisse.

Kaputte oder unvollstaendige Nachrichten loesen NormalizeError aus; der
Aufrufer zaehlt und verwirft sie - sie gelangen nie in den Market State.
Formate laut Anbieterdokumentation (nicht gegen Live-Verbindungen geprueft,
siehe docs/architektur/02-*.md).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from .events import LiquidationEvent, MarketEvent, OrderBookEvent, TradeEvent


class NormalizeError(ValueError):
    pass


def _ms(v: Any) -> datetime:
    return datetime.fromtimestamp(int(v) / 1000, tz=timezone.utc)


def _levels(raw: Any) -> tuple[tuple[float, float], ...]:
    out = []
    for lvl in raw:
        p, q = float(lvl[0]), float(lvl[1])
        if p <= 0 or q < 0:
            raise NormalizeError("Orderbuchstufe mit ungueltigem Preis/Menge")
        out.append((p, q))
    return tuple(out)


def _positive(*values: float) -> None:
    if any(not (v > 0) for v in values):
        raise NormalizeError("Preis/Menge nicht positiv")


def parse_json(raw: str | bytes) -> Any:
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise NormalizeError("kein gueltiges JSON") from exc


def binance(message: Any, received_at: datetime) -> MarketEvent | None:
    """
    Binance Spot/USD-M (kombinierter Stream {"stream":..., "data":...} oder Rohnachricht).
      trade        {"e":"trade","E","s","t","p","q","T","m"}  m=True: Kaeufer ist Maker -> Aggressor verkauft
      aggTrade     {"e":"aggTrade","E","s","a","p","q","T","m"}
      depthUpdate  {"e":"depthUpdate","E","s","U","u","b","a"} (+ "pu" bei Futures)
      forceOrder   {"e":"forceOrder","E","o":{"s","S","q","p","ap","X","T",...}}
    Rueckgabe None fuer Steuer-Nachrichten (z. B. Antwort auf SUBSCRIBE).
    """
    data = message.get("data", message) if isinstance(message, dict) else None
    if not isinstance(data, dict):
        raise NormalizeError("unerwartete Struktur")
    etype = data.get("e")
    if etype is None:
        if "result" in data and "id" in data:
            return None  # Bestaetigung einer (Un)Subscribe-Anfrage
        raise NormalizeError("Ereignistyp fehlt")
    try:
        if etype in ("trade", "aggTrade"):
            price, qty = float(data["p"]), float(data["q"])
            _positive(price, qty)
            return TradeEvent("binance", data["s"], price, qty, "sell" if data["m"] else "buy", _ms(data["T"]), received_at,
                              str(data.get("t", data.get("a"))))
        if etype == "depthUpdate":
            return OrderBookEvent("binance", data["s"], "delta", _levels(data["b"]), _levels(data["a"]), _ms(data["E"]), received_at,
                                  int(data["U"]), int(data["u"]), int(data["pu"]) if "pu" in data else None)
        if etype == "forceOrder":
            o = data["o"]
            price = float(o.get("ap") or o["p"])  # durchschnittlicher Ausfuehrungspreis, sonst Orderpreis
            qty = float(o.get("z") or o["q"])      # kumuliert gefuellte Menge, sonst Ordermenge
            _positive(price, qty)
            side = o["S"].lower()
            if side not in ("buy", "sell"):
                raise NormalizeError("unbekannte Seite")
            return LiquidationEvent("binance", o["s"], side, price, qty, _ms(o["T"]), received_at, {"status": o.get("X")})
    except (KeyError, TypeError, ValueError) as exc:
        if isinstance(exc, NormalizeError):
            raise
        raise NormalizeError(f"Feld fehlt oder ungueltig: {exc}") from exc
    return None  # andere Ereignistypen ignorieren


def coinbase(message: Any, received_at: datetime) -> MarketEvent | None:
    """
    Coinbase Exchange Feed, Kanal "matches":
      {"type":"match"|"last_match","trade_id","sequence","time","product_id","size","price","side"}
    "side" ist die Seite der MAKER-Order -> Aggressor ist die Gegenseite.
    """
    if not isinstance(message, dict):
        raise NormalizeError("unerwartete Struktur")
    t = message.get("type")
    if t in ("subscriptions", "heartbeat"):
        return None
    if t == "error":
        raise NormalizeError(f"Anbieterfehler: {message.get('message')}")
    if t not in ("match", "last_match"):
        return None
    try:
        price, qty = float(message["price"]), float(message["size"])
        _positive(price, qty)
        maker = message["side"]
        if maker not in ("buy", "sell"):
            raise NormalizeError("unbekannte Seite")
        symbol = message["product_id"].replace("-", "")
        exch = datetime.fromisoformat(message["time"].replace("Z", "+00:00"))
        return TradeEvent("coinbase", symbol, price, qty, "sell" if maker == "buy" else "buy", exch, received_at, str(message["trade_id"]))
    except (KeyError, TypeError, ValueError) as exc:
        if isinstance(exc, NormalizeError):
            raise
        raise NormalizeError(f"Feld fehlt oder ungueltig: {exc}") from exc
