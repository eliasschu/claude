import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STOCK_MOVER_UNIVERSE } from "../config/movers.ts";

test("Beobachtungsliste von Website und Bot ist identisch (Standardwerte)", () => {
  const py = readFileSync(new URL("../../services/quant/quant/config.py", import.meta.url), "utf8");
  const m = py.match(/DEFAULT_INSIDER_WATCHLIST = "([^"]+)"/);
  assert.ok(m, "DEFAULT_INSIDER_WATCHLIST fehlt in services/quant/quant/config.py");
  assert.deepEqual(m[1].split(","), STOCK_MOVER_UNIVERSE);
});
