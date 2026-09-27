"""
Interne Metriken (Prometheus-Textformat), ohne Zusatzbibliothek.

Zaehler und einfache Histogramme je Prozess. Die API liefert sie unter
/metrics; Worker und Scheduler schreiben ihren Stand zusaetzlich in den
Heartbeat, damit ein zentraler Blick moeglich ist, ohne dass jeder Prozess
einen offenen Port braucht.
"""

from __future__ import annotations

import threading
from collections import defaultdict

BUCKETS_MS = (5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000)

DESCRIPTIONS = {
    "bot_cycles_total": "Anzahl Bot-Zyklen nach Scope und Status",
    "bot_cycle_duration_ms": "Dauer eines Bot-Zyklus",
    "provider_requests_total": "Erfolgreiche Provider-Abrufe",
    "provider_failures_total": "Fehlgeschlagene Provider-Abrufe",
    "provider_latency_ms": "Latenz erfolgreicher Provider-Abrufe",
    "websocket_disconnects_total": "WebSocket-Verbindungsabbrueche",
    "websocket_messages_total": "Empfangene WebSocket-Nachrichten",
    "orderbook_resyncs_total": "Orderbuch-Neusynchronisationen (Sequenzluecke)",
    "signals_generated_total": "Protokollierte Signale nach Entscheidung",
    "signals_rejected_total": "Von der Risk Engine abgelehnte Signale",
    "orders_simulated_total": "Paper-/Shadow-Orders",
    "strategy_runtime_ms": "Laufzeit einer Strategiebewertung",
    "db_query_latency_ms": "Latenz ausgewaehlter Datenbankabfragen",
    "stale_data_total": "Als veraltet eingestufte Merkmale",
}


def _key(labels: dict[str, str]) -> tuple[tuple[str, str], ...]:
    return tuple(sorted((k, str(v)) for k, v in labels.items()))


class Metrics:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._counters: dict[str, dict[tuple, float]] = defaultdict(lambda: defaultdict(float))
        self._hist: dict[str, dict[tuple, list[float]]] = defaultdict(dict)  # Name -> Labels -> Buckets, +Inf, Summe

    def inc(self, name: str, value: float = 1.0, **labels: str) -> None:
        with self._lock:
            self._counters[name][_key(labels)] += value

    def observe(self, name: str, value_ms: float, **labels: str) -> None:
        with self._lock:
            h = self._hist[name].setdefault(_key(labels), [0.0] * (len(BUCKETS_MS) + 2))  # Buckets, +Inf, Summe
            for i, b in enumerate(BUCKETS_MS):
                if value_ms <= b:
                    h[i] += 1
            h[len(BUCKETS_MS)] += 1
            h[len(BUCKETS_MS) + 1] += value_ms

    def counter(self, name: str, **labels: str) -> float:
        with self._lock:
            return self._counters[name].get(_key(labels), 0.0)

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "counters": {n: {",".join(f"{k}={v}" for k, v in key): val for key, val in series.items()} for n, series in self._counters.items()},
                "histograms": {n: {",".join(f"{k}={v}" for k, v in key): {"count": h[len(BUCKETS_MS)], "sum_ms": h[len(BUCKETS_MS) + 1]}
                                   for key, h in series.items()} for n, series in self._hist.items()},
            }

    def render(self) -> str:
        def lab(key: tuple, extra: str = "") -> str:
            parts = [f'{k}="{v}"' for k, v in key] + ([extra] if extra else [])
            return "{" + ",".join(parts) + "}" if parts else ""

        lines: list[str] = []
        with self._lock:
            for name, series in sorted(self._counters.items()):
                lines += [f"# HELP {name} {DESCRIPTIONS.get(name, name)}", f"# TYPE {name} counter"]
                lines += [f"{name}{lab(k)} {v}" for k, v in series.items()]
            for name, hseries in sorted(self._hist.items()):
                lines += [f"# HELP {name} {DESCRIPTIONS.get(name, name)}", f"# TYPE {name} histogram"]
                for k, h in hseries.items():
                    for i, b in enumerate(BUCKETS_MS):
                        le = 'le="' + str(b) + '"'
                        lines.append(f"{name}_bucket{lab(k, le)} {h[i]}")
                    inf = 'le="+Inf"'
                    lines += [f"{name}_bucket{lab(k, inf)} {h[len(BUCKETS_MS)]}",
                              f"{name}_count{lab(k)} {h[len(BUCKETS_MS)]}", f"{name}_sum{lab(k)} {h[len(BUCKETS_MS) + 1]}"]
        return "\n".join(lines) + "\n"


METRICS = Metrics()
