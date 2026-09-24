import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parse13FInfoTable, parseEdgarIndexJson, findInfoTableFile } from "../lib/sources/parsers/sec-13f.ts";

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
  test("liest Positionen mit Wert in USD (Meldung gibt Tausend an)", () => {
    const holdings = parse13FInfoTable(INFO_TABLE_XML);
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
