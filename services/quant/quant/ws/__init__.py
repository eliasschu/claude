"""
WebSocket-Marktdaten: Provider-Verbindung -> Normalizer -> Event Bus -> Market State -> Features.

Strategien sehen nie rohe WebSocket-Nachrichten. Die normalisierten Ereignisse
werden sekundenweise aggregiert und mit received_at (Bot-Uhr) gespeichert -
damit sind Live-Betrieb und Replay/Backtest dieselbe Datenbasis.
"""
