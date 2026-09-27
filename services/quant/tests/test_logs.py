import json
import logging

from quant.logs import JsonFormatter, redact


def test_structured_log_line_has_fields_and_no_secrets():
    rec = logging.LogRecord("quant.worker", logging.INFO, "", 0, "Abruf https://api.x.com/q?symbol=A&apikey=SECRET123", (), None)
    rec.event, rec.cycle_id, rec.provider, rec.duration_ms, rec.api_key = "provider_call", "c1", "binance", 12, "SECRET123"
    rec.dsn = "postgresql://quant:geheim@db:5432/quant"
    line = json.loads(JsonFormatter("bot-worker").format(rec))
    assert {"timestamp", "level", "service", "event", "message", "cycle_id", "provider", "duration_ms"} <= set(line)
    assert "SECRET123" not in json.dumps(line) and "geheim" not in json.dumps(line)
    assert line["service"] == "bot-worker" and line["event"] == "provider_call"


def test_redact_nested():
    assert redact({"headers": {"Authorization": "Bearer x"}, "url": "redis://u:pw@h:1/0"}) == {
        "headers": {"Authorization": "***"}, "url": "redis://u:***@h:1/0"}
