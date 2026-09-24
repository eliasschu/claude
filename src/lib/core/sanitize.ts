/**
 * Fremde Inhalte werden nur als reiner Text uebernommen: Markup entfernt,
 * Entitaeten aufgeloest, Laenge begrenzt. Sie werden nie als HTML gerendert
 * und nie als Anweisung ausgewertet.
 */

import { decodeXmlEntities } from "./xml.ts";

const EXTRA: Record<string, string> = {
  ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß", euro: "€",
};

export function decodeEntities(text: string): string {
  return decodeXmlEntities(text).replace(/&([a-zA-Z]+);/g, (m, name) => EXTRA[name] ?? m);
}

export function toPlainText(input: unknown, maxLength = 600): string {
  if (typeof input !== "string") return "";
  let text = input
    .replace(/<(script|style|iframe|object|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ");
  text = decodeEntities(decodeEntities(text));
  text = text.replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (text.length > maxLength) text = `${text.slice(0, maxLength - 1).replace(/\s+\S*$/, "")} …`;
  return text;
}

/** Nur http(s); javascript:- und data:-Adressen werden verworfen. */
export function safeHttpUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  try {
    const url = new URL(input.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
