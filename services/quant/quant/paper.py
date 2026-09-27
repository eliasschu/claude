"""
PaperPortfolio (§44, §47): realistische Simulation, keine perfekten Mid-Fills.

Kostenmodell
 * Krypto: Market-Order laeuft durch das Orderbuch-Snapshot (Level fuer Level),
   dazu Taker-Gebuehr. Ohne Orderbuch: Ask/Bid plus Slippage-Aufschlag.
 * Aktien (Tagesbasis): Ausfuehrung fruehestens zur naechsten Eroeffnung
   (09:30 New York), Preis = Eroeffnung + halber Spread + Slippage + Gebuehr.
   Wochenenden und Feiertage fuehren automatisch zu keinem Fill (kein Balken).
 * Handelsverzoegerung: eine Order ist erst ab `eligible_at` ausfuehrbar.
Exits
 * Stop: Wird der Stop mit einer Kursluecke uebersprungen, gilt der schlechtere
   Eroeffnungskurs (Gap-Risiko). Stop wird als Market-Order mit Slippage gefuellt.
 * Ziel: Limit-Fill genau am Ziel, ohne positive Slippage.
 * Stop und Ziel im selben Balken: konservativ Stop zuerst.
 * Zeitablauf: Market-Exit zum naechsten verfuegbaren Kurs.
Ausschliesslich Paper - es gibt keinen Pfad zu einer echten Order.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from typing import Iterable, Literal, Sequence
from zoneinfo import ZoneInfo

import psycopg

from .providers.base import Bar, OrderBook
from .risk import OpenPosition, PortfolioView

NEW_YORK = ZoneInfo("America/New_York")
Side = Literal["buy", "sell"]


@dataclass(frozen=True)
class CostModel:
    fee_bps: float
    slippage_bps: float
    half_spread_bps: float  # nur wenn kein Bid/Ask vorliegt
    delay: timedelta


COSTS = {
    # Binance Spot Taker 0,10 %; Slippage-Aufschlag nur, wenn kein Orderbuch vorliegt
    "crypto": CostModel(fee_bps=10.0, slippage_bps=3.0, half_spread_bps=2.0, delay=timedelta(seconds=2)),
    # Liquide US-Aktien, konservativ: Gebuehren/Abgaben 1 bp, Eroeffnungs-Spread 5 bp, Slippage 5 bp
    "equity": CostModel(fee_bps=1.0, slippage_bps=5.0, half_spread_bps=5.0, delay=timedelta(minutes=1)),
}


@dataclass(frozen=True)
class Fill:
    price: float
    quantity: float
    fee: float
    slippage_bps: float  # gegenueber der Mitte (bzw. Referenz), positiv = zu unseren Lasten
    reference_bid: float | None
    reference_ask: float | None
    reference_kind: str
    filled_at: datetime


def walk_book(levels: Sequence[tuple[float, float]], quantity: float) -> tuple[float | None, float]:
    """Durchschnittspreis beim Abarbeiten der Levels; (None, 0) ohne Liquiditaet."""
    remaining, cost = quantity, 0.0
    for price, size in levels:
        take = min(remaining, size)
        cost += take * price
        remaining -= take
        if remaining <= 1e-12:
            break
    filled = quantity - max(remaining, 0.0)
    return (cost / filled if filled > 0 else None), filled


def crypto_market_fill(side: Side, quantity: float, book: OrderBook | None, bid: float | None, ask: float | None,
                       at: datetime, cost: CostModel = COSTS["crypto"], min_fill_ratio: float = 1.0) -> Fill | None:
    """
    min_fill_ratio < 1 erlaubt eine Teilausfuehrung, wenn das Buch nur einen Teil traegt.
    Unterhalb dieser Quote: kein Fill (ehrlich statt geraten).
    """
    if book is not None and book.bids and book.asks:
        levels = book.asks if side == "buy" else book.bids
        avg, filled = walk_book(levels, quantity)
        if avg is None or filled < quantity * min_fill_ratio - 1e-12:
            return None
        quantity = min(quantity, filled)
        mid = (book.bids[0][0] + book.asks[0][0]) / 2
        ref_bid, ref_ask, kind = book.bids[0][0], book.asks[0][0], "quote"
    elif bid is not None and ask is not None:
        mid = (bid + ask) / 2
        base = ask if side == "buy" else bid
        avg = base * (1 + cost.slippage_bps / 1e4) if side == "buy" else base * (1 - cost.slippage_bps / 1e4)
        ref_bid, ref_ask, kind = bid, ask, "quote"
    else:
        return None
    slip = (avg / mid - 1) * 1e4 if side == "buy" else (1 - avg / mid) * 1e4
    return Fill(avg, quantity, avg * quantity * cost.fee_bps / 1e4, slip, ref_bid, ref_ask, kind, at)


def session_open(bar: Bar) -> datetime:
    """Eroeffnungszeitpunkt (09:30 New York, sommerzeitkorrekt) eines Tagesbalkens in UTC."""
    return datetime.combine(bar.ts.date(), time(9, 30), tzinfo=NEW_YORK).astimezone(timezone.utc)


def equity_open_fill(side: Side, quantity: float, bar: Bar, cost: CostModel = COSTS["equity"]) -> Fill:
    adverse = (cost.half_spread_bps + cost.slippage_bps) / 1e4
    price = bar.open * (1 + adverse) if side == "buy" else bar.open * (1 - adverse)
    half = cost.half_spread_bps / 1e4
    return Fill(price, quantity, price * quantity * cost.fee_bps / 1e4, adverse * 1e4, bar.open * (1 - half), bar.open * (1 + half),
                "bar_close_with_spread_model", session_open(bar))


@dataclass(frozen=True)
class ExitEvent:
    reason: Literal["stop", "target", "time"]
    reference_price: float
    at: datetime
    gap: bool = False


def check_exit(side: str, stop: float, target: float | None, time_exit_at: datetime | None, bars: Sequence[Bar],
               bar_length: timedelta, is_equity: bool) -> ExitEvent | None:
    """Erster Exit in den Balken nach Positionseroeffnung (konservativ)."""
    long = side == "long"
    for b in bars:
        start = session_open(b) if is_equity else b.ts
        end = b.ts + bar_length
        if long and b.open <= stop:
            return ExitEvent("stop", b.open, start, gap=True)
        if not long and b.open >= stop:
            return ExitEvent("stop", b.open, start, gap=True)
        hit_stop = b.low <= stop if long else b.high >= stop
        hit_target = target is not None and (b.high >= target if long else b.low <= target)
        if hit_stop:  # auch wenn das Ziel im selben Balken lag
            return ExitEvent("stop", stop, end)
        if hit_target:
            return ExitEvent("target", target, end)  # type: ignore[arg-type]
        if time_exit_at is not None and end >= time_exit_at:
            return ExitEvent("time", b.close, end)
    return None


def exit_fill(side: str, quantity: float, ev: ExitEvent, cost: CostModel) -> Fill:
    """Stop/Zeit = Market (Slippage gegen uns), Ziel = Limit (kein Aufschlag)."""
    closing_side: Side = "sell" if side == "long" else "buy"
    if ev.reason == "target":
        price, slip = ev.reference_price, 0.0
    else:
        adverse = (cost.slippage_bps + cost.half_spread_bps) / 1e4
        price = ev.reference_price * (1 - adverse) if closing_side == "sell" else ev.reference_price * (1 + adverse)
        slip = adverse * 1e4
    return Fill(price, quantity, price * quantity * cost.fee_bps / 1e4, slip, None, None, "bar_close_with_spread_model", ev.at)


# ---------------------------------------------------------------------------
# Datenbankgestuetztes Konto
# ---------------------------------------------------------------------------
class DuplicateEntryError(Exception):
    """Ein zweiter Einstieg in dasselbe Instrument wurde abgewiesen (Order-State-Ebene)."""


class PaperPortfolio:
    def __init__(self, conn: psycopg.Connection, account_id: str, base_currency: str = "USD", starting_cash: float = 100_000.0):
        self._conn = conn
        self.account_id = account_id
        conn.execute(
            "INSERT INTO paper_accounts (account_id, base_currency, starting_cash) VALUES (%s,%s,%s) ON CONFLICT DO NOTHING",
            (account_id, base_currency, starting_cash),
        )

    # -- Zustand ------------------------------------------------------------
    def cash(self) -> float:
        row = self._conn.execute(
            """SELECT a.starting_cash - COALESCE(SUM(CASE WHEN o.side='buy' THEN f.price*f.quantity + f.fee
                                                          ELSE -(f.price*f.quantity) + f.fee END), 0) AS cash
               FROM paper_accounts a LEFT JOIN paper_orders o ON o.account_id=a.account_id
               LEFT JOIN paper_fills f ON f.order_id=o.order_id
               WHERE a.account_id=%s GROUP BY a.starting_cash""",
            (self.account_id,),
        ).fetchone()
        return float(row["cash"])

    def open_positions(self) -> list[dict]:
        return self._conn.execute(
            """SELECT p.*, i.asset_class FROM paper_positions p JOIN instruments i USING (instrument_id)
               WHERE p.account_id=%s AND p.closed_at IS NULL ORDER BY opened_at""",
            (self.account_id,),
        ).fetchall()

    def view(self, marks: dict[str, float], kill_switch_reason: str | None = None) -> PortfolioView:
        positions = []
        mtm = 0.0
        for p in self.open_positions():
            price = marks.get(p["instrument_id"], p["entry_price"])
            notional = p["quantity"] * price
            mtm += notional if p["side"] == "long" else -notional
            group = "crypto" if p["asset_class"].startswith("crypto") else "equity"
            positions.append(OpenPosition(p["instrument_id"], group, abs(notional)))
        # Aktive Einstiegsorders (pending/partially_filled) reservieren Exposure fuer ihre RESTMENGE -
        # sie zaehlen fuer Konzentration und Duplikate, noch nicht fuer Kasse/Equity.
        for o in self.active_entry_orders():
            price = marks.get(o["instrument_id"])
            remaining = max(o["quantity"] - o["filled_quantity"], 0.0)
            group = "crypto" if self._asset_class(o["instrument_id"]).startswith("crypto") else "equity"
            positions.append(OpenPosition(o["instrument_id"], group, abs(remaining * price) if price else 0.0))
        cash = self.cash()
        return PortfolioView(equity=cash + mtm, cash=cash, positions=tuple(positions), kill_switch_reason=kill_switch_reason)

    def _asset_class(self, instrument_id: str) -> str:
        return self._conn.execute("SELECT asset_class FROM instruments WHERE instrument_id=%s", (instrument_id,)).fetchone()["asset_class"]

    def active_entry_orders(self) -> list[dict]:
        return self._conn.execute(
            """SELECT * FROM paper_orders WHERE account_id=%s AND intent='open' AND status IN ('pending','partially_filled')
               ORDER BY requested_at""", (self.account_id,)).fetchall()

    # Rueckwaertskompatibler Name
    pending_orders = active_entry_orders

    # -- Aktionen -----------------------------------------------------------
    def place_entry(self, *, signal_id: uuid.UUID, instrument_id: str, side: Side, quantity: float, requested_at: datetime,
                    delay: timedelta, stop: float, target: float | None, time_exit_at: datetime | None, reason: str) -> uuid.UUID:
        """
        Order-State-Ebene des Duplikatschutzes (Fix E, Ebene 3): unter einer Sperre je Konto+Instrument
        pruefen, dass weder eine offene Position noch eine aktive Einstiegsorder existiert.
        Ebene 4 (DB) greift zusaetzlich ueber Unique-Index und Trigger.
        """
        order_id = uuid.uuid4()
        with self._conn.transaction():
            self._conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (f"entry:{self.account_id}:{instrument_id}",))
            busy = self._conn.execute(
                """SELECT 'position' AS what FROM paper_positions WHERE account_id=%s AND instrument_id=%s AND closed_at IS NULL
                   UNION ALL
                   SELECT 'order' FROM paper_orders WHERE account_id=%s AND instrument_id=%s AND intent='open'
                     AND status IN ('pending','partially_filled') LIMIT 1""",
                (self.account_id, instrument_id, self.account_id, instrument_id)).fetchone()
            if busy:
                raise DuplicateEntryError(f"Einstieg abgewiesen: bereits {busy['what']} in {instrument_id}")
            self._conn.execute(
                """INSERT INTO paper_orders (order_id, account_id, signal_id, instrument_id, side, intent, quantity, order_type,
                                             requested_at, eligible_at, status, reason, stop_price, target_price, time_exit_at)
                   VALUES (%s,%s,%s,%s,%s,'open',%s,'market',%s,%s,'pending',%s,%s,%s,%s)""",
                (order_id, self.account_id, signal_id, instrument_id, side, quantity, requested_at, requested_at + delay, reason,
                 stop, target, time_exit_at),
            )
        return order_id

    def reject(self, order_id: uuid.UUID, reason: str) -> None:
        """Pending -> rejected. Eine teilausgefuehrte Order wird beendet (filled mit Restmenge verfallen)."""
        self._conn.execute(
            """UPDATE paper_orders SET status = CASE WHEN filled_quantity > 0 THEN 'filled' ELSE 'rejected' END, reject_reason=%s
               WHERE order_id=%s AND status IN ('pending','partially_filled')""", (reason, order_id))

    def _insert_fill(self, order_id: uuid.UUID, fill: Fill) -> None:
        self._conn.execute(
            """INSERT INTO paper_fills (fill_id, order_id, filled_at, quantity, price, fee, slippage_bps, reference_bid,
                                        reference_ask, reference_kind) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (uuid.uuid4(), order_id, fill.filled_at, fill.quantity, fill.price, fill.fee, fill.slippage_bps, fill.reference_bid,
             fill.reference_ask, fill.reference_kind),
        )

    def fill_entry(self, order: dict, fill: Fill) -> uuid.UUID:
        """Voll- oder Teilausfuehrung. Weitere Teilfills erhoehen die Position (Durchschnittspreis)."""
        if fill.filled_at < order["eligible_at"]:
            raise ValueError("Fill vor Ablauf der Handelsverzoegerung")
        remaining = order["quantity"] - order["filled_quantity"]
        if fill.quantity > remaining * (1 + 1e-9):
            raise ValueError("Fill groesser als die Restmenge der Order")
        filled_total = order["filled_quantity"] + fill.quantity
        complete = filled_total >= order["quantity"] * (1 - 1e-9)
        with self._conn.transaction():
            self._insert_fill(order["order_id"], fill)
            position_id = order.get("position_id")
            if position_id is None:
                position_id = uuid.uuid4()
                self._conn.execute(
                    """INSERT INTO paper_positions (position_id, account_id, instrument_id, signal_id, side, quantity, entry_price,
                                                    opened_at, stop_price, target_price, time_exit_at)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (position_id, self.account_id, order["instrument_id"], order["signal_id"],
                     "long" if order["side"] == "buy" else "short", fill.quantity, fill.price, fill.filled_at,
                     order["stop_price"], order["target_price"], order["time_exit_at"]),
                )
            else:
                self._conn.execute(
                    """UPDATE paper_positions SET entry_price = (entry_price*quantity + %s*%s) / (quantity + %s), quantity = quantity + %s
                       WHERE position_id=%s AND closed_at IS NULL""",
                    (fill.price, fill.quantity, fill.quantity, fill.quantity, position_id))
            self._conn.execute(
                "UPDATE paper_orders SET status=%s, filled_quantity=%s, position_id=%s WHERE order_id=%s",
                ("filled" if complete else "partially_filled", filled_total, position_id, order["order_id"]))
        return position_id

    def close_position(self, position: dict, fill: Fill, reason: str) -> float:
        side: Side = "sell" if position["side"] == "long" else "buy"
        order_id = uuid.uuid4()
        entry_fee = self._conn.execute(
            """SELECT COALESCE(SUM(f.fee),0) AS fee FROM paper_orders o JOIN paper_fills f USING (order_id)
               WHERE o.position_id=%s AND o.intent='open'""", (position["position_id"],)).fetchone()["fee"]
        sign = 1 if position["side"] == "long" else -1
        pnl = sign * (fill.price - position["entry_price"]) * position["quantity"] - fill.fee - entry_fee
        with self._conn.transaction():
            self._conn.execute(
                """INSERT INTO paper_orders (order_id, account_id, signal_id, instrument_id, side, intent, quantity, order_type,
                                             requested_at, eligible_at, status, reason, position_id)
                   VALUES (%s,%s,%s,%s,%s,'close',%s,%s,%s,%s,'filled',%s,%s)""",
                (order_id, self.account_id, position["signal_id"], position["instrument_id"], side, position["quantity"],
                 "limit" if reason == "target" else "market", fill.filled_at, fill.filled_at, reason, position["position_id"]),
            )
            self._insert_fill(order_id, fill)
            self._conn.execute(
                "UPDATE paper_positions SET closed_at=%s, exit_price=%s, exit_reason=%s, realized_pnl=%s WHERE position_id=%s",
                (fill.filled_at, fill.price, reason, pnl, position["position_id"]),
            )
        return pnl

    def realized_pnl_since(self, since: datetime) -> float:
        row = self._conn.execute(
            "SELECT COALESCE(SUM(realized_pnl),0) AS p FROM paper_positions WHERE account_id=%s AND closed_at >= %s",
            (self.account_id, since),
        ).fetchone()
        return float(row["p"])

    def closed_positions(self, limit: int = 200) -> Iterable[dict]:
        return self._conn.execute(
            "SELECT * FROM paper_positions WHERE account_id=%s AND closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT %s",
            (self.account_id, limit),
        ).fetchall()
