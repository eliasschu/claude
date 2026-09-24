import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { child, childrenNamed, decodeXmlEntities, findAll, parseXml, textOf, valueOf } from "../lib/core/xml.ts";

describe("XML-Zerleger", () => {
  test("liest verschachtelte Knoten, Attribute und Namensräume ohne Präfix", () => {
    const doc = parseXml(`<?xml version="1.0"?><feed xmlns:d="x"><entry><d:NEW_DATE>2026-09-18T00:00:00</d:NEW_DATE><d:BC_10YEAR>4.12</d:BC_10YEAR></entry></feed>`);
    const entries = findAll(doc, "entry");
    assert.equal(entries.length, 1);
    assert.equal(textOf(child(entries[0], "NEW_DATE")), "2026-09-18T00:00:00");
    assert.equal(textOf(child(entries[0], "BC_10YEAR")), "4.12");
  });

  test("beherrscht CDATA, Kommentare, leere Elemente und Entitäten", () => {
    const doc = parseXml(`<r><!-- weg --><a><![CDATA[<b>roh</b>]]></a><b/><c attr="a &amp; b">x &lt; y</c></r>`);
    assert.equal(textOf(child(doc.children[0], "a")), "<b>roh</b>");
    assert.equal(child(doc.children[0], "b")!.children.length, 0);
    assert.equal(child(doc.children[0], "c")!.attrs.attr, "a & b");
    assert.equal(textOf(child(doc.children[0], "c")), "x < y");
  });

  test("liefert mehrere gleichnamige Kinder", () => {
    const doc = parseXml(`<rss><channel><item><title>A</title></item><item><title>B</title></item></channel></rss>`);
    const items = childrenNamed(child(child(doc, "rss"), "channel"), "item");
    assert.deepEqual(items.map((i) => textOf(child(i, "title"))), ["A", "B"]);
  });

  test("valueOf liest den verschachtelten Wert von Form-4-Feldern", () => {
    const doc = parseXml(`<t><transactionShares><value>1000</value></transactionShares><plain>7</plain></t>`);
    assert.equal(valueOf(child(doc.children[0], "transactionShares")), "1000");
    assert.equal(valueOf(child(doc.children[0], "plain")), "7");
    assert.equal(valueOf(undefined), null);
  });

  test("stürzt bei kaputtem XML nicht ab", () => {
    assert.doesNotThrow(() => parseXml("<a><b>text"));
    assert.equal(decodeXmlEntities("Zins &amp; Ausblick &#8211; EZB"), "Zins & Ausblick – EZB");
  });
});
