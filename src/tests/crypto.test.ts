import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { assessCoin, coinProfile, cryptoMetrics, rangePct } from "../lib/finance/crypto.ts";
import type { CoinRow } from "../lib/sources/parsers/coingecko.ts";

const row = (over: Partial<CoinRow>): CoinRow => ({
  id: "x", symbol: "X", name: "X", imageUrl: null, price: 1, marketCap: 1000, marketCapRank: 1, fdv: 1000,
  volume24h: 100, change1h: 0, change24h: 0, change7d: 0, circulatingSupply: 1, totalSupply: 1, maxSupply: 1,
  lastUpdated: null, sparkline7d: [100, 105], ...over,
});

describe("Krypto-Einordnung", () => {
  test("kennzeichnet Stablecoins getrennt, ohne Schwankungsurteil", () => {
    assert.equal(coinProfile(row({}), ["stablecoin"]).label, "Stablecoin");
  });
  test("stuft nach Schwankung und Handelsaktivität ein", () => {
    assert.equal(coinProfile(row({ sparkline7d: [100, 130] }), []).label, "Sehr hohe Schwankung");
    assert.equal(coinProfile(row({ sparkline7d: [100, 105] }), []).label, "Moderate Schwankung");
    const thin = coinProfile(row({ volume24h: 5 }), []);
    assert.equal(thin.tone, "warn");
    assert.match(thin.reasons.join(" "), /Geringe Handelsaktivität/);
  });
  test("weist Verwässerungspotenzial über die verwässerte Bewertung aus", () => {
    assert.match(coinProfile(row({ fdv: 5000 }), []).reasons.join(" "), /verwässerte Bewertung/);
  });
  test("berechnet Spanne und Kennzahlen", () => {
    assert.ok(Math.abs(rangePct([100, 110, 90])! - 22.22) < 0.1);
    const m = cryptoMetrics({ daily: Array.from({ length: 200 }, (_, i) => 100 + (i % 2)), marketCap: 1000, fdv: 3000, volume24h: 50, circulating: 50, maxSupply: 100, priceUsd: 0.995, isStablecoin: true });
    assert.equal(m.fdvToMarketCap, 3);
    assert.equal(m.circulatingShareOfMaxPct, 50);
    assert.ok(Math.abs(m.pegDeviationPct! - 0.5) < 1e-9);
    assert.equal(m.turnoverPct, 5);
  });
  test("berechnet keinen fairen Tokenpreis und trennt die Blickwinkel", () => {
    const m = cryptoMetrics({ daily: [], marketCap: 1000, fdv: 3000, volume24h: 5, circulating: 40, maxSupply: 100, priceUsd: null, isStablecoin: false });
    const a = assessCoin(m, []);
    assert.match(a.valuation, /Nicht belastbar bewertbar/);
    assert.match(a.projectQuality, /Nicht automatisch bewertbar/);
    assert.ok(a.risks.length >= 2);
  });
  test("verwendet für Stablecoins andere Kriterien", () => {
    const m = cryptoMetrics({ daily: [], marketCap: 1000, fdv: 1000, volume24h: 500, circulating: 100, maxSupply: null, priceUsd: 0.97, isStablecoin: true });
    const a = assessCoin(m, ["stablecoin"]);
    assert.match(a.valuation, /Bindung an den Gegenwert/);
    assert.match(a.risks.join(" "), /Abweichung vom angestrebten Gegenwert/);
  });
});
