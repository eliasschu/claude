import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parse13FInfoTable, parseEdgarIndexJson, findInfoTableFile, valueMultiplier } from "../lib/sources/parsers/sec-13f.ts";

const INFO_TABLE_XML = `<?xml version="1.0"?>
<informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">
  <infoTable>
    <nameOfIssuer>APPLE INC</nameOfIssuer>
    <titleOfClass>COM</titleOfClass>
    <cusip>037833100</cusip>
    <value>150000000</value>
    <shrsOrPrnAmt>
      <sshPrnamt>900000000</sshPrnamt>
      <sshPrnamtType>SH</sshPrnamtType>
    </shrsOrPrnAmt>
    <investmentDiscretion>SOLE</investmentDiscretion>
    <votingAuthority><Sole>900000000</Sole><Shared>0</Shared><None>0</None></votingAuthority>
  </infoTable>
  <infoTable>
    <nameOfIssuer>BANK OF AMER CORP</nameOfIssuer>
    <titleOfClass>COM</titleOfClass>
    <cusip>060505104</cusip>
    <value>30000000</value>
    <shrsOrPrnAmt><sshPrnamt>1000000000</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
    <investmentDiscretion>SOLE</investmentDiscretion>
  </infoTable>
  <infoTable>
    <nameOfIssuer>BROKEN ROW NO CUSIP</nameOfIssuer>
    <titleOfClass>COM</titleOfClass>
    <value>500</value>
    <shrsOrPrnAmt><sshPrnamt>100</sshPrnamt></shrsOrPrnAmt>
  </infoTable>
</informationTable>`;

describe("13F-Informationstabelle", () => {
  test("Einreichungen ab 03.01.2023 melden den Wert in ganzen US-Dollar", () => {
    const holdings = parse13FInfoTable(INFO_TABLE_XML, "2026-08-14");
    assert.equal(holdings[0].valueUsd, 150_000_000);
    assert.equal(valueMultiplier("2023-01-02"), 1000);
    assert.equal(valueMultiplier("2023-01-03"), 1);
  });

  test("liest Positionen aus Einreichungen vor 2023 (Meldung gibt Tausend USD an)", () => {
    const holdings = parse13FInfoTable(INFO_TABLE_XML, "2022-11-14");
    assert.equal(holdings.length, 2, "Zeile ohne CUSIP wird verworfen, nicht erfunden");
    assert.equal(holdings[0].issuerName, "Apple Inc");
    assert.equal(holdings[0].cusip, "037833100");
    assert.equal(holdings[0].valueUsd, 150_000_000_000);
    assert.equal(holdings[0].shares, 900_000_000);
    assert.equal(holdings[1].issuerName, "Bank of Amer Corp");
  });

  test("Ordnerindex: findet die Informationstabelle, nie das Deckblatt", () => {
    const items = parseEdgarIndexJson({
      directory: { item: [
        { name: "primary_doc.xml", type: "text.xml" },
        { name: "form13fInfoTable.xml", type: "text.xml" },
        { name: "0001067983-26-000123-index.htm", type: "text.htm" },
      ] },
    });
    assert.equal(findInfoTableFile(items, "primary_doc.xml"), "form13fInfoTable.xml");
  });

  test("Ordnerindex ohne Treffer liefert null statt eine falsche Datei zu raten", () => {
    const items = parseEdgarIndexJson({ directory: { item: [{ name: "primary_doc.xml", type: "text.xml" }] } });
    assert.equal(findInfoTableFile(items, "primary_doc.xml"), null);
  });
});

test("13F: mehrfache Zeilen je CUSIP werden addiert, Put/Call-Optionen nicht als Bestand gezählt", () => {
  const row = (shares: number, value: number, extra = "") => `<infoTable><nameOfIssuer>APPLE INC</nameOfIssuer><titleOfClass>COM</titleOfClass>
    <cusip>037833100</cusip><value>${value}</value><shrsOrPrnAmt><sshPrnamt>${shares}</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>${extra}
    <investmentDiscretion>DFND</investmentDiscretion></infoTable>`;
  const xml = `<informationTable>${row(100, 20000)}${row(50, 10000)}${row(10, 2000, "<putCall>Put</putCall>")}</informationTable>`;
  const holdings = parse13FInfoTable(xml, "2026-08-14");
  assert.equal(holdings.length, 1, "eine Zeile je CUSIP - keine doppelten Schlüssel in der Anzeige");
  assert.equal(holdings[0].shares, 150);
  assert.equal(holdings[0].valueUsd, 30000);
});
