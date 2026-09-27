from datetime import datetime, timezone

from quant.ws.events import OrderBookEvent
from quant.ws.orderbook import BookState, LocalOrderBook

T = datetime(2026, 9, 22, tzinfo=timezone.utc)


def d(U, u, bids=(), asks=(), pu=None):
    return OrderBookEvent("binance", "BTCUSDT", "delta", tuple(bids), tuple(asks), T, T, U, u, pu)


SNAP_BIDS = [(100.0, 1.0), (99.0, 2.0)]
SNAP_ASKS = [(101.0, 1.0), (102.0, 2.0)]


def test_spot_buffer_snapshot_replay():
    book = LocalOrderBook("binance", "BTCUSDT", "binance_spot")
    book.on_delta(d(95, 99, bids=[(100.0, 9.0)]))         # vor dem Snapshot -> verwerfen
    book.on_delta(d(100, 103, bids=[(100.0, 3.0)]))       # U <= 101 <= u -> erstes angewandtes
    book.on_delta(d(104, 104, asks=[(101.0, 0.0)]))       # entfernt Stufe
    assert book.state == BookState.WAITING_SNAPSHOT and book.metrics() is None
    book.on_snapshot(100, SNAP_BIDS, SNAP_ASKS)
    assert book.state == BookState.SYNCED and book.last_update_id == 104
    assert book.bids[100.0] == 3.0 and 101.0 not in book.asks
    m = book.metrics()
    assert m.best_bid == 100.0 and m.best_ask == 102.0


def test_gap_invalidates_and_resync_recovers():
    book = LocalOrderBook("binance", "BTCUSDT", "binance_spot")
    book.on_snapshot(100, SNAP_BIDS, SNAP_ASKS)
    book.on_delta(d(101, 101, bids=[(100.0, 5.0)]))
    book.on_delta(d(105, 106, bids=[(100.0, 7.0)]))       # 102-104 fehlen -> Luecke
    assert book.state == BookState.INVALID and "Sequenzluecke" in book.last_error
    assert book.metrics() is None and book.needs_snapshot and book.resyncs == 1
    book.on_delta(d(107, 107, asks=[(101.5, 1.0)]))
    book.on_snapshot(106, [(100.0, 7.0)], SNAP_ASKS)          # neuer Snapshot
    assert book.state == BookState.SYNCED and book.asks[101.5] == 1.0 and book.last_update_id == 107


def test_snapshot_older_than_buffer_start_is_rejected():
    book = LocalOrderBook("binance", "BTCUSDT", "binance_spot")
    book.on_delta(d(200, 205))
    book.on_snapshot(150, SNAP_BIDS, SNAP_ASKS)              # 151..199 fehlen
    assert book.state == BookState.INVALID and book.needs_snapshot


def test_futures_rule_uses_pu():
    book = LocalOrderBook("binance", "BTCUSDT", "binance_futures")
    book.on_delta(d(98, 102, bids=[(100.0, 4.0)], pu=97))    # U <= 100 <= u
    book.on_snapshot(100, SNAP_BIDS, SNAP_ASKS)
    assert book.state == BookState.SYNCED
    book.on_delta(d(103, 105, pu=102))
    assert book.state == BookState.SYNCED
    book.on_delta(d(107, 108, pu=106))                       # pu passt nicht zu 105
    assert book.state == BookState.INVALID


def test_crossed_book_is_invalidated():
    book = LocalOrderBook("binance", "BTCUSDT", "binance_spot")
    book.on_snapshot(100, SNAP_BIDS, SNAP_ASKS)
    book.on_delta(d(101, 101, bids=[(101.5, 1.0)]))          # Bid ueber bester Ask
    assert book.state == BookState.INVALID and "gekreuzt" in book.last_error


def test_delta_without_sequence_ids_is_never_applied():
    book = LocalOrderBook("binance", "BTCUSDT", "binance_spot")
    book.on_snapshot(100, SNAP_BIDS, SNAP_ASKS)
    book.on_delta(OrderBookEvent("binance", "BTCUSDT", "delta", ((100.0, 50.0),), (), T, T))
    assert book.state == BookState.INVALID
