"""
Strukturierte Logs (eine JSON-Zeile je Ereignis) statt print().

Pflichtfelder: timestamp, level, service, event, message. Optionale Felder
(cycle_id, provider, strategy, asset, duration_ms, status, error_type, ...)
kommen ueber `extra={...}`. Werte, deren Schluessel nach Geheimnis aussehen,
werden unkenntlich gemacht; Zugangsdaten in URLs ebenso.
"""

from __future__ import annotations

import json
import logging
import re
import sys
from datetime import datetime, timezone

SERVICE = "quant"
_RESERVED = set(vars(logging.LogRecord("", 0, "", 0, "", (), None))) | {"message", "asctime"}
_SECRET_KEY = re.compile(r"(pass(word)?|secret|token|api[_-]?key|authorization|dsn|database_url|credential)", re.I)
_URL_CREDENTIALS = re.compile(r"(\w+://)([^:/@\s]+):([^@\s]+)@")
_QUERY_SECRET = re.compile(r"((?:api_?key|apikey|token|secret)=)[^&\s]+", re.I)


def redact(value: object) -> object:
    if isinstance(value, str):
        return _QUERY_SECRET.sub(r"\1***", _URL_CREDENTIALS.sub(r"\1\2:***@", value))
    if isinstance(value, dict):
        return {k: ("***" if _SECRET_KEY.search(str(k)) else redact(v)) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact(v) for v in value]
    return value


class JsonFormatter(logging.Formatter):
    def __init__(self, service: str):
        super().__init__()
        self.service = service

    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, object] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname.lower(),
            "service": self.service,
            "logger": record.name,
            "event": getattr(record, "event", None) or "log",
            "message": redact(record.getMessage()),
        }
        for key, value in record.__dict__.items():
            if key not in _RESERVED and key not in entry and not key.startswith("_"):
                entry[key] = "***" if _SECRET_KEY.search(key) else redact(value)
        if record.exc_info:
            entry["error_type"] = entry.get("error_type") or (record.exc_info[0].__name__ if record.exc_info[0] else None)
            entry["stack"] = redact(self.formatException(record.exc_info))
        return json.dumps(entry, default=str, ensure_ascii=False)


def configure_logging(service: str, level: int = logging.INFO) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter(service))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    # httpx loggt vollstaendige URLs (inkl. Query-Parametern) - nur Warnungen durchlassen
    logging.getLogger("httpx").setLevel(logging.WARNING)
