import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  addReview, applyImport, createThesis, current, describeCriterion, diffVersions, emptyStore, exportJson, latestAssessments,
  parseImport, planImport, reviewState, saveVersion, setLifecycle, ThesisError, type ThesisContent, type ThesisStore,
} from "../lib/thesis/model.ts";

const base: ThesisContent = {
  ticker: "tst", companyName: "Test Corp", stance: "beobachten", reason: " Starkes Kerngeschäft ", expectations: "Marge steigt",
  counterArguments: "Konkurrenz", changeMyMind: "Marge fällt zwei Quartale unter 20 %", horizonMonths: 24, nextReviewDate: "2026-10-15",
  criteria: [{ id: "k1", metric: "operating_margin", operator: "<", threshold: 20, period: "quartal", consecutive: 2 }],
  checkpoints: [{ id: "p1", text: "Neues Produkt erscheint" }, { id: "p2", text: "  " }],
};
const T0 = "2026-09-28T10:00:00.000Z", T1 = "2026-09-29T10:00:00.000Z", T2 = "2026-10-20T10:00:00.000Z";

describe("These anlegen und versionieren", () => {
  test("Erstfassung normalisiert und validiert", () => {
    const t = createThesis(base, T0, "a");
    assert.equal(current(t).content.ticker, "TST");
    assert.equal(current(t).content.reason, "Starkes Kerngeschäft");
    assert.equal(current(t).content.checkpoints.length, 1, "leere Prüfpunkte werden verworfen");
    assert.equal(current(t).reason, "Erstfassung");
    assert.throws(() => createThesis({ ...base, reason: "" }, T0, "b"), ThesisError);
    assert.throws(() => createThesis({ ...base, criteria: [{ ...base.criteria[0], consecutive: 0 }] }, T0, "b"), /1 bis 8/);
  });

  test("neue Version nur mit Grund und echter Änderung; Erstellungsdatum und alte Versionen bleiben", () => {
    const t = createThesis(base, T0, "a");
    assert.throws(() => saveVersion(t, { ...base, expectations: "anders" }, "  ", T1), /Änderungsgrund/);
    assert.throws(() => saveVersion(t, { ...base }, "Grund", T1), /Keine inhaltliche Änderung/);
    assert.throws(() => saveVersion(t, { ...base, ticker: "ABC", expectations: "x" }, "Grund", T1), /Unternehmen/);
    const t2 = saveVersion(t, { ...base, expectations: "Marge steigt deutlich" }, "Neue Quartalszahlen", T1);
    assert.equal(t2.createdAt, T0);
    assert.equal(t2.versions.length, 2);
    assert.equal(t2.versions[0].content.expectations, "Marge steigt", "frühere Version unverändert");
    assert.equal(current(t2).version, 2);
    assert.equal(t.versions.length, 1, "Original-Objekt wird nicht verändert");
    const d = diffVersions(t2.versions[0], t2.versions[1]);
    assert.deepEqual(d.map((x) => x.field), ["Erwartete Entwicklung"]);
  });

  test("Kriterium verständlich beschrieben", () => {
    assert.equal(describeCriterion(base.criteria[0]), "Operative Marge unter 20 % in 2 aufeinanderfolgenden Quartalen");
  });
});

describe("Prüfungen und Wiedervorlage getrennt vom Lebenszyklus", () => {
  test("Fälligkeit, Prüfung als eigener Eintrag, neue Wiedervorlage", () => {
    let t = createThesis(base, T0, "a");
    assert.equal(reviewState(t, "2026-10-14").due, false);
    const due = reviewState(t, "2026-10-17");
    assert.equal(due.due, true);
    assert.equal(due.daysOverdue, 2);
    assert.throws(() => addReview(t, { id: "r", at: "", outcome: "beibehalten", note: " ", assessments: [], nextReviewDate: null }, T2), /begründen/);
    assert.throws(() => addReview(t, { id: "r", at: "", outcome: "beibehalten", note: "ok", assessments: [{ targetId: "zz", assessment: "unklar" }], nextReviewDate: null }, T2), /unbekannten/);
    t = addReview(t, { id: "r1", at: "", outcome: "beibehalten", note: "Zahlen geprüft",
      assessments: [{ targetId: "k1", assessment: "nicht_eingetreten" }, { targetId: "p1", assessment: "unklar" }], nextReviewDate: "2027-01-15" }, T2);
    assert.equal(t.versions.length, 1, "Prüfung erzeugt keine neue Version");
    assert.equal(t.reviews[0].version, 1);
    const s = reviewState(t, "2026-10-21");
    assert.equal(s.due, false);
    assert.equal(s.nextReviewDate, "2027-01-15");
    assert.equal(latestAssessments(t).get("k1")?.assessment, "nicht_eingetreten");
  });

  test("archivierte These ist nie fällig; Statuswechsel braucht Grund und bleibt protokolliert", () => {
    let t = createThesis(base, T0, "a");
    assert.throws(() => setLifecycle(t, "archiviert", "", T1), /Grund/);
    t = setLifecycle(t, "archiviert", "Position verkauft", T1);
    assert.equal(reviewState(t, "2026-12-01").due, false);
    t = setLifecycle(t, "aktiv", "Beobachte wieder", T2);
    assert.equal(t.lifecycleEvents.length, 2);
    assert.equal(reviewState(t, "2026-12-01").due, true, "wieder aktive These wird weiter geprüft");
  });

  test("eine spätere Version setzt die Wiedervorlage der früheren Prüfung außer Kraft", () => {
    let t = createThesis(base, T0, "a");
    t = addReview(t, { id: "r1", at: "", outcome: "anpassen", note: "passe an", assessments: [], nextReviewDate: "2027-06-01" }, T1);
    t = saveVersion(t, { ...base, nextReviewDate: "2026-11-01", expectations: "neu" }, "Angepasst nach Prüfung", T2);
    assert.equal(reviewState(t, "2026-11-02").nextReviewDate, "2026-11-01");
  });
});

describe("Export, Import, Konflikte, Löschen", () => {
  const store = (): ThesisStore => ({ ...emptyStore(), theses: [createThesis(base, T0, "a")] });

  test("Export ist wieder importierbar; fremde oder beschädigte Dateien werden abgelehnt", () => {
    const json = exportJson(store(), T1);
    const r = parseImport(json);
    assert.ok(r.ok && r.theses.length === 1);
    assert.equal(parseImport("{kaputt").ok, false);
    assert.equal(parseImport(JSON.stringify({ format: "anderes", formatVersion: 1, theses: [] })).ok, false);
    const v2 = JSON.parse(json); v2.formatVersion = 2;
    const r2 = parseImport(JSON.stringify(v2));
    assert.ok(!r2.ok && /Formatversion 2/.test(r2.errors[0]));
    const bad = JSON.parse(json); bad.theses[0].versions[0].reason = "";
    assert.equal(parseImport(JSON.stringify(bad)).ok, false, "Version ohne Änderungsgrund");
    const bad2 = JSON.parse(json); bad2.theses[0].versions[0].content.criteria[0].consecutive = 99;
    assert.equal(parseImport(JSON.stringify(bad2)).ok, false);
  });

  test("Einordnung: neu, identisch, erweitert, abweichend", () => {
    const local = store();
    const same = local.theses[0];
    const longer = saveVersion(same, { ...base, expectations: "mehr" }, "Update", T1);
    const diverged = saveVersion(same, { ...base, expectations: "anders" }, "Andere Richtung", T1);
    const other = createThesis({ ...base, ticker: "XYZ" }, T0, "b");
    const plan = planImport(local, [same, other]);
    assert.deepEqual(plan.map((p) => p.kind), ["identisch", "neu"]);
    assert.equal(planImport(local, [longer])[0].kind, "erweitert");
    const withDiverged = { ...local, theses: [saveVersion(same, { ...base, expectations: "lokal" }, "Lokal", T1)] };
    assert.equal(planImport(withDiverged, [diverged])[0].kind, "abweichend");
  });

  test("nichts wird still überschrieben: Standard ist Auslassen, abweichende nur als Kopie", () => {
    const same = createThesis(base, T0, "a");
    const local: ThesisStore = { ...emptyStore(), theses: [saveVersion(same, { ...base, expectations: "lokal" }, "Lokal", T1)] };
    const incoming = saveVersion(same, { ...base, expectations: "fremd" }, "Fremd", T1);
    const plan = planImport(local, [incoming]);
    const skipped = applyImport(local, plan, {}, T2, () => "neu-id");
    assert.equal(skipped.applied, 0);
    assert.deepEqual(skipped.store, local);
    assert.throws(() => applyImport(local, plan, { a: "uebernehmen" }, T2, () => "x"), /nicht überschrieben/);
    const copied = applyImport(local, plan, { a: "kopie" }, T2, () => "neu-id");
    assert.equal(copied.store.theses.length, 2);
    assert.equal(copied.store.theses[0], local.theses[0], "lokale These unverändert");
    assert.deepEqual(copied.store.theses[1].importedFrom, { originalId: "a", at: T2 });
    assert.equal(current(copied.store.theses[1]).content.expectations, "fremd");
  });

  test("erweiterte These kann bewusst übernommen werden", () => {
    const same = createThesis(base, T0, "a");
    const local: ThesisStore = { ...emptyStore(), theses: [same] };
    const longer = saveVersion(same, { ...base, expectations: "mehr" }, "Update", T1);
    const r = applyImport(local, planImport(local, [longer]), { a: "uebernehmen" }, T2, () => "x");
    assert.equal(r.store.theses[0].versions.length, 2);
  });
});
