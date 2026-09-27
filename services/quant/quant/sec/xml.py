"""Namensraum-tolerante XML-Hilfen (SEC-Dokumente verwenden teils Namensraeume, teils nicht)."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from collections.abc import Iterator


class SecParseError(ValueError):
    pass


def parse(text: str) -> ET.Element:
    try:
        return ET.fromstring(text.encode("utf-8") if isinstance(text, str) else text)
    except ET.ParseError as exc:
        raise SecParseError(f"XML nicht lesbar: {exc}") from exc


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def children(el: ET.Element | None, name: str) -> list[ET.Element]:
    return [c for c in el] if el is not None and name == "*" else [c for c in (el if el is not None else []) if local(c.tag) == name]


def child(el: ET.Element | None, name: str) -> ET.Element | None:
    for c in el if el is not None else []:
        if local(c.tag) == name:
            return c
    return None


def path(el: ET.Element | None, *names: str) -> ET.Element | None:
    for n in names:
        el = child(el, n)
        if el is None:
            return None
    return el


def text(el: ET.Element | None) -> str | None:
    if el is None:
        return None
    t = (el.text or "").strip()
    return t or None


def value(el: ET.Element | None, *names: str) -> str | None:
    """Form-4-Konvention: <feld><value>...</value></feld>; faellt auf direkten Text zurueck."""
    node = path(el, *names) if names else el
    if node is None:
        return None
    v = child(node, "value")
    return text(v) if v is not None else text(node)


def iter_local(el: ET.Element, name: str) -> Iterator[ET.Element]:
    for node in el.iter():
        if local(node.tag).lower() == name.lower():
            yield node


def footnote_ids(el: ET.Element | None) -> list[str]:
    if el is None:
        return []
    return [fid for f in el.iter() if local(f.tag) == "footnoteId" and (fid := f.get("id"))]


def num(s: str | None) -> float | None:
    if s is None:
        return None
    try:
        return float(s.replace(",", ""))
    except ValueError:
        return None


def flag(s: str | None) -> bool | None:
    if s is None:
        return None
    return s.strip().lower() in ("1", "true", "y", "yes")
