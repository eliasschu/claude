"""
bot-worker: dauerhaft laufender Prozess fuer den Krypto-Echtzeitzyklus.
Laeuft unabhaengig davon, ob jemand die Website geoeffnet hat.
"""

from __future__ import annotations

import logging
import time

from .runtime import build, stop_event

log = logging.getLogger("quant.worker")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings, bot = build()
    stop = stop_event()
    log.info("bot-worker gestartet (Modus %s, Zyklus %ss, Paare %s)", settings.mode, settings.crypto_cycle_seconds, settings.crypto_symbols)
    while not stop.is_set():
        started = time.monotonic()
        try:
            rep = bot.run_crypto_cycle()
            log.info("Zyklus %s: %s%s", rep.cycle_id, rep.counts, f" KILL SWITCH: {rep.kill_switch}" if rep.kill_switch else "")
        except Exception:
            log.exception("Krypto-Zyklus fehlgeschlagen - naechster Versuch im naechsten Takt")
        stop.wait(max(1.0, settings.crypto_cycle_seconds - (time.monotonic() - started)))
    log.info("bot-worker beendet")


if __name__ == "__main__":
    main()
