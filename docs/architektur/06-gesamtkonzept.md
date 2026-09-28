# Gesamtkonzept: Der junge Kapitalist

Stand: 28.09.2026. Vorgabe: keine laufenden Kosten, nichts veröffentlichen, nichts buchen.

**Ablauf für Nutzer:** Ereignis entdecken → Unternehmen verstehen → Erwartungen untersuchen → eigene These festhalten → spätere Veränderungen überprüfen.

Der Bot bleibt das Hauptprodukt. Aktienanalyse, Insider, Große Fische und Märkte liefern Hintergrund. Die Thesen verbinden alles mit den Annahmen des Nutzers.

## 1. Stand je Baustein

Legende:
- **vorhanden** = Code existiert
- **getestet** = automatische Tests prüfen die Kernlogik
- **im Betrieb** = läuft irgendwo dauerhaft mit echten Daten
- **geplant** = noch nicht gebaut

| Baustein | vorhanden | getestet | im Betrieb | Anmerkung |
|---|---|---|---|---|
| SEC-Insiderabruf (Python) | ✔ | ✔ (nachgebildete EDGAR-Antworten) | ✖ | Läuft, sobald `./bot-lokal.sh start` auf dem Mac läuft. Mit echten SEC-Daten noch nicht nachgewiesen (siehe Etappe A) |
| Regelbasierte Erkennung und Archiv | ✔ | ✔ (Regeln, Einmaligkeit, append-only, Zeitpunkte, Nebenläufigkeit) | ✖ | wie oben |
| Abrufprotokoll, Status-API, Gesundheitsprüfung lokal | ✔ | ✔ | ✖ | |
| Startskript Mac (Start, Prüfung, Sicherung, Wiederherstellung) | ✔ | ✔ (mit Docker durchgespielt, ohne SEC-Zugang) | ✖ | |
| Website: Start mit Beispielmeldung, Ereignissen, Verbindungszustand | ✔ | ✔ | ✖ | Vercel-Deploy nur ohne Bot, also nur Live-Auswertung |
| Website: Live-Rückfall ohne Bot | ✔ | ✔ | ✖ | klar als „nicht archiviert“ gekennzeichnet |
| Aktiensuche, `/aktien` mit überwachten Ereignisarten | ✔ | ✔ | ✖ | |
| Aktienseite: Kurs, Chart (Schlusskurse), DCF mit drei Szenarien, Reverse DCF (Wachstum), Scorecard v1, SEC-Meldungen | ✔ | ✔ (Bewertungsformeln) | ✖ | Aufbau noch alt. DCF fachlich noch nicht geprüft (Etappe E) |
| Insider-Tracker, Große Fische (13F) | ✔ | ✔ | ✖ | Live-Abruf der Website |
| Watchlist im Browser | ✔ | ✖ | – | nur `localStorage` |
| Interne Handelssignal-Engine (Paper) | ✔ | ✔ | ✖ | bleibt intern |
| Meldungsdetailseite, Archiv mit Filtern und Abdeckungslücken, verknüpfte Berichtigungen und Erweiterungen, Kursverlauf ab Veröffentlichung und ab Erkennung | ✔ | ✔ (Regeln, Verknüpfungen, Prüfsumme, Kursverlauf; End-to-End mit Testfirma) | ✖ | Etappe B. Neuordnung der Aktienseite noch offen |
| „Was hat sich verändert?“ für die Watchlist | ✖ | ✖ | ✖ | Etappe C |
| Thesen-Tagebuch (lokal): Versionen mit Pflichtgrund, manuelle Prüfungen, Wiedervorlage, Archiv, Export/Import/Löschen | ✔ | ✔ (Modell, Konflikte; Browser-Ablauf mit Testfirma) | – (nur im Browser) | Etappe C; automatische Kriterienprüfung seit Etappe D |
| Automatische Kriterienprüfung aus SEC Company Facts (Marge, Umsatzwachstum, freier Cashflow, FCF-Marge, Umsatz; nur auf Klick) | ✔ | ✔ (fiktive Daten; Echtdaten-Test offen) | – (Ergebnisse nur im Browser) | Etappe D |
| Persönliche Szenarien, Bewertungsverlauf | ✖ | ✖ | ✖ | Etappe E |
| Regeln, Prüfungen, Wochenrückblick | ✖ | ✖ | ✖ | Etappe F |
| Konten, Bezahlpaket, externe Benachrichtigungen | ✖ | ✖ | ✖ | erst nach zuverlässigem Hintergrundbetrieb |

## 2. Informationsarchitektur (Ziel)

| Bereich | Inhalt | Erreichbar von dort |
|---|---|---|
| **Entdecken (Start)** | ausgewählte aktuelle Bot-Ereignisse, Verbindungszustand | Meldungsdetail → Aktie → These |
| **Aktien** | Suche, Beobachtungsliste, Unternehmensseiten | Insider und Große Fische je Unternehmen |
| **Meine Watchlist** | Veränderungen seit dem letzten Besuch, Status je Quelle | Meldungsdetail, These |
| **Meine Thesen** | Begründungen, Kriterien, fällige Prüfungen, Versionen | Aktie, auslösende Meldung, Szenario |
| **Märkte** | Kontext (Zinsen, Devisen, Krypto) | – |
| Fuß und Menü | Quellen und Methodik, Betriebsstatus, Bot-Erklärung | – |

**Aktienseite (Ziel-Reihenfolge):**
1. Unternehmen, Kurs, Datenstand.
2. Wichtigste Veränderungen und Bot-Meldungen (höchstens 3).
3. Wenige Kennzahlen mit Erklärung.
4. Chart mit Ereignisverlauf.
5. Bewertung, Reverse DCF, persönliche Szenarien.
6. Eigene These und nächste Prüfung.

Zuerst steht die Aussage, Rechenwege und Quellen sind aufklappbar.

## 3. Zentrale Festlegungen

- **Vier Zeitpunkte je Meldung:** Transaktion oder Ereignis, Veröffentlichung, Eingang beim Bot, Erkennung.
  - Rückwirkend geladene Daten zeigen den tatsächlichen, späteren Erkennungszeitpunkt. Die Verzögerung gegenüber der Veröffentlichung wird ausgewiesen.
- **Versionen statt Überschreiben:**
  - Korrekturen (Form 4/A) und Erweiterungen (z. B. Einzelkauf → Kaufgruppe) werden **neue, verknüpfte Meldungen**. Das Original bleibt unverändert.
- **Kursverlauf nach Meldungen:**
  - Nur mit geeigneten Kursdaten und festem Ausgangspunkt, getrennt „ab Veröffentlichung“ und „ab Erkennung“.
  - Auswertungen umfassen **alle** regelgemäß ausgewählten Fälle, auch die negativen.
  - Ein Kursanstieg danach beweist keine Ursache.
- **Berichtsvergleiche:**
  - Nur gleiche Kennzahldefinition, gleiche Periodenart (Quartal mit Quartal, Jahr mit Jahr), mit Einheit, Zeitraum und Quelle.
  - Fehlende Quartale werden nie übersprungen.
- **Thesen:**
  - Zunächst lokal im Browser mit geprüftem Export und Import. Lokale Speicherung ist **kein Konto und kein Zugriffsschutz**, sie ist an Browser und Gerät gebunden und kann verloren gehen.
  - Datierte Versionen mit Änderungsgrund.
  - Persönliche Einträge nie in ein Repository.
  - Spätere Konten: strikte Trennung je Nutzer, Export und bewusste Löschung.
- **Widerlegungskriterien:** Kennzahl, Operator, Grenzwert, Berichtsintervall, Anzahl aufeinanderfolgender Perioden. Dazu freie manuelle Prüfpunkte.
- **Prüfungszustände:** nicht ausgelöst · ausgelöst, überprüfen · manuelle Prüfung fällig · nicht prüfbar (fehlende, veraltete oder unpassende Daten).
  - Jeder Befund zeigt Regel, Werte, Zeitraum, Quelle und Prüfzeitpunkt.
  - Wiederholungen desselben Befunds werden unterdrückt.
- **„Keine neue relevante Veränderung“** erscheint nur für Quellen, die erfolgreich geprüft wurden. Ausfälle werden getrennt angezeigt.
- **Keine künstlichen Inhalte:** Ein leerer Feed ist ein gültiges Ergebnis.
- **Kein Markt-Score, keine 7-Tage-Prognose, keine Trefferquoten**, solange Definition, Datenbasis und unabhängige Validierung fehlen.

## 4. Etappen und Abhängigkeiten

| Etappe | Inhalt | Hängt ab von | Kosten |
|---|---|---|---|
| **A** | Betrieb prüfen und härten (dieses Dokument, Abschnitt 5) | – | keine |
| **B** | Meldungsdetailseite; Archiv mit festen Regeln; Eingang beim Bot und Verzögerung; verknüpfte Folge- und Korrekturmeldungen (Form 4/A, Kaufgruppe); Aktienseite neu geordnet, mobil zuerst | A | keine |
| **C** | „Was hat sich verändert?“ für die Watchlist (letzter Besuch lokal, Status je Quelle); Thesen-Tagebuch mit manuellen Kriterien, Versionen, Export und Import | B | keine |
| **D** | Berichtsvergleiche aus SEC-XBRL (Quartal/Jahr getrennt: Umsatz, operative Marge, operativer Cashflow, Verschuldung); datenbasierte Widerlegungskriterien; Vorbereitung auf den nächsten Bericht | C | keine |
| **E** | DCF fachlich prüfen (Cashflow-Art, Nettoverschuldung, Aktienanzahl, Währung); Reverse DCF mit einer eindeutigen Unbekannten und allen Rechenschritten; persönliche Szenarien (vorsichtig/mittel/optimistisch) mit konsistentem Modell aus Wachstum, Marge und Cashflow; Sensitivität; gespeicherte Szenarien mit Modellversion; Bewertungsverlauf zerlegt in Kurs, Zahlen und Annahmen | D (Quartalszahlen) | keine |
| **F** | Regeln und „Jetzt prüfen“ in der App (Kursgrenzen, Insiderkauf, Kennzahlgrenzen, Kriterien, Bewertungsband, Korrekturen, fällige Prüfungen); Wochenrückblick aus denselben belegten Ereignissen | C–E | keine; E-Mail und Push erst bei zuverlässigem Hintergrundbetrieb |

**Offene Abhängigkeiten**
- **Öffentlicher Betrieb:** Dafür braucht es einen dauerhaft laufenden Bot, entweder ein Server oder eine GitHub-Actions-Variante (siehe `05-betrieb-ohne-server.md`). Außerdem eine Kurslizenz, denn der Twelve-Data-Gratistarif erlaubt nur private Nutzung.
- **Prognoseänderungen und Managementaussagen (D):** Sie stehen nur in Fließtext-Anlagen (8-K EX-99) und nicht strukturiert. Jede automatisch formulierte Aussage braucht dort einen wörtlichen Beleg. Der Aufwand ist hoch, deshalb kommt das nach den Kennzahlvergleichen.
- **DACH-Unternehmen:** Es gibt keine kostenlose, strukturierte und zuverlässig lizenzierte Quelle, die mit SEC-XBRL vergleichbar wäre. Das ist die größte inhaltliche Lücke für ein deutschsprachiges Publikum.

## 5. Backlog (erst mit belastbarer Quelle, vertretbarem Aufwand und Nutzungsrechten)

Die Quellenrecherche des Nutzers (DACH, Australien, USA, global) steht geprüft und mit Korrekturen in `07-quellenregister.md`.

1. **Größeres US-Universum.** Hindernis ist die SEC-Abruflast. Nötig sind die Umstellung auf `companyfacts` und Caching.
2. **Kongressmeldungen.** Der Meldeverzug (bis zu 45 Tage) muss sichtbar sein, die Zuordnung zu Personen korrekt.
3. **13F-Bestandsänderungen.** Klar trennen: gemeldeter Stand zum Stichtag, der tatsächliche Handelszeitpunkt ist unbekannt.
4. **Makroereignisse** als Kontext für beobachtete Unternehmen. FRED und CFTC sind im Bot vorhanden.
5. **Krypto-Positionierung.** Funding, Open Interest und Liquidationen sind vorhanden, jeder Indikator wird einzeln erklärt.
6. **Prognosemärkte:** Preis, Liquidität, Auflösungsbedingungen, Datenstand. Erst nach Lizenz- und DSGVO-Prüfung.
7. **DACH-Unternehmen.** Voraussetzung ist eine Quelle für ESEF-Berichte und Directors' Dealings mit geklärten Rechten.

Großen Transaktionen oder erfolgreichen Marktteilnehmern wird nie sicheres Wissen unterstellt.

## 6. Geschäftsmodell (Hypothesen, nichts buchbar)

- **Kostenloser Einstieg:** ausgewählte Meldungen, Originalquellen, grundlegende Erklärungen, kleine Watchlist.
- **Mögliches Bezahlpaket:**
  - mehr beobachtete Unternehmen;
  - persönliche Regeln;
  - Berichtsvergleiche;
  - gespeicherte Auswertungen;
  - zuverlässige Benachrichtigungen, erst mit nachgewiesenem Hintergrundbetrieb.
- Preise sind offen und werden als Hypothese geprüft. Die früheren Tariftexte auf `/datenquellen` sind bereinigt.
- Keine Versprechen zu Gewinnen, Verlustvermeidung oder rechtlicher Sicherheit durch Hinweistexte.

## 7. Etappe A: Ergebnis

**Geprüft und behoben**

1. **Passwortabgleich beim Start.** Wurde die Konfiguration neu angelegt, während das Archiv-Volume erhalten blieb, konnte sich der Bot nicht mehr mit seiner Datenbank verbinden (`password authentication failed`). Im Test hier genau so aufgetreten. `start` gleicht das Passwort jetzt automatisch an.
2. **Gesundheitsprüfung lokal.** Die API meldete UNHEALTHY, weil sie den Handels-Worker erwartete, der lokal bewusst nicht läuft. Jetzt gibt es `EXPECT_WORKER=false`, das `einrichten` setzt. Maßgeblich ist dann der Insiderabruf: Ein Quellenausfall ist DEGRADED, nie UNHEALTHY.
3. **Beobachtungsliste.** Bot (`EQUITY_SYMBOLS` mit SPY, QQQ und AMD) und Website (mit JPM) wichen voneinander ab.
   - Der Bot hat jetzt eine eigene `INSIDER_WATCHLIST`, identisch mit der Website. Ein Test prüft das.
   - Unbekannte Ticker werden sichtbar als Fehler gezählt statt still übersprungen.
   - `/aktien` zeigt je Unternehmen die tatsächlich überwachten Ereignisarten.
4. **Nebenläufigkeit.** „Jetzt abrufen“ und der Scheduler konnten gleichzeitig laufen. Eine Datenbanksperre (Advisory-Lock) lässt jetzt nur einen Durchlauf zu. Übersprungene Läufe werden nicht als Abruf gezählt.
5. **Sicherung.** Eine abgebrochene Sicherung hinterließ eine halbe Datei. Jetzt wird erst in eine Zwischendatei geschrieben.
6. **Neue Befehle:**
   - `jetzt-abrufen`;
   - `pruefen` (vollständige Betriebsprüfung mit Bericht ohne Zugangsdaten);
   - `sicherung-pruefen` (Probe-Einspielen in eine Testdatenbank mit Zahlenvergleich);
   - `wiederherstellen` (fragt nach, sichert vorher).
7. **Umbenennung** in „Der junge Kapitalist“. README neu geschrieben, denn die alte beschrieb einen Demo-Stand mit Funktionen, die es nicht gibt. Tariftexte bereinigt.

**Nachweise in dieser Umgebung** (Docker vorhanden, `sec.gov` durch den Proxy gesperrt)
- `pruefen`: 12 bestanden, 0 fehlgeschlagen, 2 Grenzen. Die Grenzen: Die SEC antwortet hier mit 403 vom Proxy, der Bot zeigt das als „SEC lehnt ab“. Der Doppelten-Schutz war deshalb nur ohne erfolgreichen Abruf prüfbar.
- Die lokale Website zeigt den Bot mit Warnhinweis.
- Archiv und Zählungen blieben über Neustarts erhalten. Sicherung und Probe-Einspielen lieferten identische Zahlen.
- `wiederherstellen` stellte den gesicherten Stand her (10 Abrufe; danach kam der Startabruf des Schedulers hinzu). Ohne „JA“ wird abgebrochen.
- Automatische Tests: Python 161 grün (neu: wiederholte Abrufe ohne Doppelte, übersprungener Parallelabruf, lokale Gesundheit). Website 181 grün (neu: gleiche Beobachtungsliste).

**Noch nicht nachgewiesen:** ein vollständiger Lauf **auf deinem Mac mit echten SEC-Daten**. Das kann nur auf deinem Rechner passieren:

```bash
./bot-lokal.sh einrichten && ./bot-lokal.sh start
npm install && npm run dev          # zweites Terminal
./bot-lokal.sh pruefen              # Ausgabe enthält keine Zugangsdaten und kann geteilt werden
```

Erwartet wird: SEC-Abruf erfolgreich, wobei null neue Meldungen ein gültiges Ergebnis ist. Ein wiederholter Abruf erzeugt keine Doppelten. Die Wiederherstellungsprobe stimmt. Die Website zeigt „Bot aktiv“.

## 8. Etappe B: Ergebnis (Meldungsdetail, Archiv, Nachvollziehbarkeit)

**CHANGED**
- **Migration `0012`:**
  - `bot_messages` hat zusätzlich `received_at` (Eingang beim Bot), `materiality` und `amendment`. Ältere Zeilen bleiben unverändert und zeigen „nicht erfasst“.
  - Neue Tabelle `bot_message_links` (nur anhängend) mit den Arten `berichtigt`, `erweitert` und `fasst_zusammen`.
- **`quant/messages.py` (Regelversion `insider-rules-1.1`):**
  - **Berichtigungen (Form 4/A)** ersetzen die ursprüngliche Transaktion (gleiche Person, Firma, Richtung, überlappende Handelstage) für Summen und Kaufgruppen. So wird nie doppelt gezählt. Eine Berichtigung wird eine neue Meldung mit „Berichtigung:“ und Verknüpfung zum Original. Wird ein Mitglied einer archivierten Kaufgruppe berichtigt, entsteht eine **berichtigte Kaufgruppe**.
  - **Kaufgruppen**, die um weitere Insider wachsen, werden neue, verknüpfte Meldungen. Sie verweisen auch auf frühere Einzelmeldungen ihrer Mitglieder.
  - **Prüfsumme je Regelversion:** Meldungen mit Version 1.0 bleiben nachrechenbar.
  - Kaufgruppen, die unter dem alten Schlüssel archiviert sind, werden anhand der beteiligten Personen erkannt und nicht doppelt archiviert.
- **API:**
  - `GET /messages` mit Filtern für Ereignisart, Aussagekraft, Zeitraum, Seitenabruf und Hinweis auf Folgemeldungen.
  - `GET /messages/{id}` mit Verknüpfungen in beide Richtungen und nachgerechneter Prüfsumme.
  - `GET /messages/coverage`: Lücken, in denen der Bot nicht erfolgreich abrief.
- **Website:**
  - `/meldungen` (Archiv mit Filtern in der URL, Seitenabruf, Abdeckungslücken, keine Trefferquoten).
  - `/meldungen/[id]`:
    - Kernaussage, Aussagekraft und Status;
    - vier Zeitpunkte als Zeitleiste und Hinweis bei nachträglicher Erkennung;
    - Einzelangaben als Karten mit aufklappbaren Details;
    - Einordnung mit Regelversion und Gegenargumenten;
    - verknüpfte Meldungen;
    - Kursverlauf ab Veröffentlichung und ab Erkennung mit SPY-Vergleich;
    - Quellen und Prüfsumme.
  - Karten der Startseite verlinken auf die Detailseite, aber nur Archivmeldungen.
- **Kursverlauf** (`src/lib/finance/event-returns.ts`):
  - Ausgangspunkt ist der erste Schlusskurs **nach** dem Zeitpunkt (16:00 New York, Sommerzeit berücksichtigt).
  - Horizonte in Handelstagen; nicht erreichte Horizonte bleiben leer.
  - Der heutige Balken zählt vor Handelsschluss nicht.
  - Fehlt ein Vergleichstag, gibt es keinen Vergleich, statt eine Lücke zu überspringen.
- **Zwei Build-Fehler behoben, die mit gesetztem Twelve-Data-Schlüssel auftraten:**
  - Aktienseiten und Startseite überschritten beim Bauen das 60-Sekunden-Limit.
  - Ursache: Die Drosselung wartete auch bei bereits vorliegender Antwort.
  - Jetzt kommt eine frische Antwort sofort aus dem Speicher.
  - Aktienseiten werden erst beim Aufruf erzeugt, die Startseite zur Laufzeit.
  - Der Seitentitel lädt nur noch die Tickerliste statt aller Unternehmensdaten.

**TESTED**
- Python: 169 Tests grün, davon 9 neu. Geprüft werden:
  - wachsende Kaufgruppe;
  - Berichtigung (einzeln, zusammen mit dem Original, in einer Kaufgruppe);
  - Eingangszeit und Prüfsumme (auch Version 1.0);
  - unveränderliche Verknüpfungen;
  - Filter, Verknüpfungen und Lücken in der API.
- `ruff` und `mypy` ohne Befund.
- Website: 196 Tests grün, davon 16 neu für Kursverlauf, Zeitleiste, Status, Filter und Zwischenspeicher. Typprüfung ohne Befund, ESLint unverändert (5 Altfehler), Build erfolgreich, auch mit Kursschlüssel.
- **End-to-End lokal** (echtes Postgres, echte FastAPI, Next.js-Produktionsbuild; SEC und Twelve Data **nachgebildet mit fiktiver Testfirma, nur für die Prüfung**):
  - Ablauf: Einzelkauf, dann Kaufgruppe aus 2, dann aus 3 Personen, dann Berichtigung. Ergebnis sind 5 Archivmeldungen mit korrekten Verknüpfungen und Status.
  - Kursverlauf mit „noch nicht erreicht“.
  - Leere Filterergebnisse, ungültige ID, unbekannte ID, „Bot nicht erreichbar“.
  - Desktop und Smartphone, hell und dunkel, ohne JavaScript-Fehler.

**Grenzen**
- Mit echten SEC-Daten ist das erst auf dem Mac prüfbar (`./bot-lokal.sh pruefen`).
- Wächst eine Kaufgruppe um einen Kauf **vor** ihrem bisherigen Beginn, entsteht eine neue Kaufgruppe ohne Verknüpfung.
- Eine unbekannte Meldungs-ID liefert die Hinweisseite mit HTTP-Status 200 statt 404. Das ist eine Eigenheit von Next.js bei Ladeanzeigen; der Inhalt ist korrekt.
- Kursdaten: Twelve Data nur für private Nutzung. Ob Kurse um Splits und Dividenden bereinigt sind, ist nicht geprüft.

**NEXT**
- Etappe C: „Was hat sich verändert?“ für die Watchlist und das Thesen-Tagebuch mit manuellen Kriterien, Versionen und Export/Import.
- Dazu die Neuordnung der Aktienseite.

## 9. Etappe C: Ergebnis (Thesen-Tagebuch, Handelsplan)

**CHANGED**
- **Handelsplan (Rule 10b5-1) mit vier Zuständen:** bestätigt, verneint, unbekannt, nicht anwendbar.
  - Bisher wurde eine **fehlende Angabe als „kein Plan“** gespeichert.
  - Fußnoten wie „not pursuant to a Rule 10b5-1 plan“ galten fälschlich als Plan. Sie werden jetzt als Verneinung erkannt.
  - Migration `0013` fügt `plan_status` hinzu. Alte Zeilen bleiben unverändert: `NULL` gilt als „nicht sicher erfasst“, ein altes `true` bleibt „bestätigt“.
  - Regelversion `insider-rules-1.2`: Einordnung und Unsicherheitstexte benennen einen unbekannten Plan ausdrücklich.
  - Archivierte ältere Meldungen werden nicht verändert. Die Website zeigt bei ihnen „Handelsplan nicht sicher erfasst“.
- **Thesen-Tagebuch (`src/lib/thesis/model.ts`, reine Funktionen):**
  - Inhalt:
    - Haltung (beobachten/besitzen);
    - Grund, Erwartungen, Gegenargumente, „Was mich umstimmen würde“;
    - Zeithorizont und nächste Prüfung;
    - messbare Kriterien (Kennzahl mit fester Einheit, Vergleich, Schwelle, Quartal/Geschäftsjahr, 1–8 Perioden in Folge);
    - freie Prüfpunkte.
  - Jede inhaltliche Änderung wird eine neue Version mit Pflichtgrund. Unveränderte Inhalte werden abgelehnt, und das Unternehmen einer These ist nicht änderbar.
  - Prüfungen sind eigene datierte Einträge mit manueller Einschätzung je Kriterium und Prüfpunkt, Ergebnis, Begründung und neuer Wiedervorlage.
  - Der Lebenszyklus (aktiv/archiviert, mit Grund protokolliert) ist getrennt vom Prüfstatus. Archivierte Thesen sind nie fällig, wieder aktivierte werden weiter geprüft.
  - Vergleich zweier Versionen feldweise.
  - **Export** als JSON mit Format und Formatversion.
  - **Import** mit strenger Prüfung. Einordnung jeder These als neu, identisch, erweitert oder abweichend. Standard ist Auslassen. Abweichende Thesen lassen sich nur als Kopie mit Herkunftsvermerk anlegen; es wird nie still überschrieben.
  - **Löschen** nur nach Eingabe von „LÖSCHEN“.
- **Speicherung (`src/lib/thesis/storage.ts`):**
  - `localStorage` im Exportformat, über Browser-Tabs hinweg synchron.
  - Ein beschädigter Speicher wird gemeldet und nicht überschrieben. Der Rohinhalt lässt sich herunterladen.
  - Speicherfehler (voll, gesperrt) werden angezeigt.
- **Oberfläche:**
  - Aktienseite: Abschnitt „Meine These“ (anlegen, ansehen, bearbeiten, prüfen, Verlauf und Vergleich, archivieren).
  - Neue Seite `/thesen` („Meine Thesen“: aktiv, fällig, archiviert; Export, Import mit Vorschau, Löschen).
  - Neuer Menüpunkt; Link von jeder Meldung zur These.
  - Überall der Hinweis auf Browserbindung und Verlustrisiko. Kein Gesamturteil „These intakt“. An jedem Kriterium steht „Automatische Prüfung noch nicht verfügbar“.

**TESTED**
- Python: 173 Tests grün, davon 4 neu (Planzustände, verneinende Fußnote, unbekannter Plan in Meldungen, alte Zeilen). `ruff` und `mypy` ohne Befund.
- Website: 207 Tests grün, davon 12 neu:
  - Versionierung, Pflichtgrund, keine Leerversion;
  - Fälligkeit, Prüfung ohne neue Version, archiviert nie fällig, spätere Version überschreibt eine frühere Wiedervorlage;
  - Export/Import mit falschem Format, falscher Version, fehlendem Grund und ungültigem Kriterium;
  - Import-Einordnung, kein stilles Überschreiben, Kopie, bewusste Übernahme;
  - Anzeige des Handelsplans bei alten Meldungen.
- Typprüfung ohne Befund, ESLint unverändert (5 Altfehler), Produktions-Build erfolgreich.
- **Browserablauf** (Playwright; Aktienseite mit nachgebildeter SEC-Antwort einer fiktiven Testfirma):
  - Pflichtfeld-Fehler, anlegen, Fälligkeit, bearbeiten ohne und mit Grund, Versionsvergleich, Prüfung dokumentieren;
  - Export, Import identisch und abweichend (nur Auslassen oder Kopie), kaputte Datei, Löschen mit Bestätigung;
  - Smartphone und Desktop, hell und dunkel, ohne JavaScript-Fehler.

**Grenzen**
- Thesen gibt es nur im Browser: kein Konto, kein Zugriffsschutz, nicht manipulationssicher. Ein Export ist die einzige Sicherung.
- Mehrere aktive Thesen zum selben Unternehmen (etwa nach dem Import einer Kopie) sind möglich. Die Aktienseite zeigt die zuletzt bearbeitete und weist auf die übrigen hin.
- Der echte Bot-Test auf dem Mac mit SEC-Daten steht weiter aus.

**Offen für Etappe D**
- Automatische Prüfung der Kriterien aus SEC Company Facts:
  - Quartal und Jahr getrennt, kumulierte Cashflows korrekt, fehlende Perioden nie überspringen;
  - Zustände: nicht ausgelöst, ausgelöst, unzureichende Daten, veraltet, nicht unterstützt;
  - Abdeckung, etwa „2 von 3 prüfbar“.
- Nettoverschuldung ÷ operativer Cashflow nur bei vollständigen Komponenten.

## 10. Etappe D: Ergebnis (automatische Kriterienprüfung)

**Was funktioniert**
- An jedem gespeicherten Kriterium gibt es jetzt eine automatische Prüfung mit SEC-Unternehmenszahlen (XBRL Company Facts). Sie läuft nur, wenn man in der These auf „Jetzt prüfen“ klickt. Es gibt keine Hintergrundüberwachung und keine Benachrichtigung.
- Automatisch prüfbar sind:
  - operative Marge;
  - Umsatzwachstum gegenüber der Vorjahresperiode;
  - freier Cashflow;
  - FCF-Marge;
  - Umsatz.
- Nettoverschuldung ÷ operativer Cashflow ist „nicht unterstützt“, weil die SEC-Daten die Finanzschulden zu uneinheitlich erfassen.
- **Zustände:** nicht ausgelöst / ausgelöst / unzureichende Daten / veraltete Daten / nicht unterstützt.
- **Abdeckung:** Angezeigt wird „x von y Kriterien automatisch prüfbar“. Es gibt kein Gesamturteil wie „These intakt“.
- **Anzeige je Kriterium:**
  - die Bedingung;
  - ein Ergebnissatz;
  - die Werte je Periode;
  - die Eingangswerte mit SEC-Konzept, Einheit, Zeitraum, Formular und Einreichungsdatum, jeweils mit Link zur Einreichung;
  - der Rechenweg und das Alter der Prüfung.
- **Privatsphäre:** Nur das Börsenkürzel geht an die eigene Route `/api/kennzahlen/[ticker]`, nie Thesentexte. Die Route nutzt die bestehende SEC-Anbindung:
  - User-Agent;
  - zentrale Drosselung auf 8 Anfragen je Sekunde;
  - 1 Stunde Zwischenspeicher für die normalisierten Daten;
  - bis zu 24 Stunden den letzten erfolgreichen Abruf, wenn die SEC ausfällt (als älterer Abruf gekennzeichnet).

**Auswahl- und Rechenregeln** (`src/lib/finance/sec-facts.ts`, `src/lib/thesis/criteria-eval.ts`, Regelversion `kriterien-1.0`)
- **Perioden:** Die Art ergibt sich aus der Länge: Quartal 80–100 Tage, Halbjahr 170–190, neun Monate 260–285, Geschäftsjahr 350–380. Quartal und Geschäftsjahr werden nie gemischt.
- **Einzelquartale:** Direkt gemeldete Quartale haben Vorrang. Fehlt eines, wird es nur aus kumulierten Werten mit demselben Periodenbeginn, demselben Konzept und derselben Währung abgeleitet (6M − 3M, 9M − 6M, Jahr − 9M). Der Rechenweg wird angezeigt.
- **Berichtigungen:** Gibt es für denselben Zeitraum mehrere Einreichungen (Berichtigung, spätere Vergleichszahl), gilt die zuletzt eingereichte. Frühere, abweichende Werte bleiben sichtbar.
- **Konzepte:** Es gibt eine feste Vorrangliste (US-GAAP, dann IFRS), und das verwendete Konzept steht an jedem Wert. Beim Wachstum müssen beide Perioden dasselbe Konzept haben, sonst ist das Ergebnis „unzureichende Daten“.
- **Aufeinanderfolge:** Die n Perioden enden an der jüngsten gemeldeten Periode und folgen lückenlos aufeinander. Zwischen Ende und nächstem Beginn liegen 1 bis 7 Tage, das deckt 52/53-Wochen-Jahre ab. Eine fehlende Periode wird nie übersprungen.
- **Ergebnis:** „Ausgelöst“ nur, wenn alle n Perioden die Bedingung erfüllen. Erfüllt eine vorhandene Periode sie nicht, lautet das Ergebnis „nicht ausgelöst“. In allen übrigen Fällen lautet es „unzureichende Daten“, mit konkretem Grund.
- **Fehlende Werte** werden nie zu 0.
- **Keine Berechnung bei null oder negativer Basis:**
  - Umsatz ≤ 0 ergibt keine Marge;
  - ein Vorjahresumsatz ≤ 0 ergibt keine Wachstumsrate.
- **Einheiten:** Margen stehen in %, Wachstum als relative Veränderung in %, und der Abstand zur Schwelle in Prozentpunkten. Die Beträge sind in Mio. der Berichtswährung angegeben; verschiedene Währungen werden nicht verrechnet.
- **Freier Cashflow** = operativer Cashflow (`NetCashProvidedByUsedInOperatingActivities`) − Investitionen in Sachanlagen (`PaymentsToAcquirePropertyPlantAndEquipment`), beide aus derselben Periode. Fehlen die Investitionen, gibt es keinen Wert. Andere Investitionen, etwa in Software oder Leasing, sind nicht enthalten.
- **Veraltet** richtet sich nach dem Bericht, nicht nach dem Abruf: Das jüngste Quartal endet mehr als 140 Tage vor dem Prüftag, bzw. das jüngste Geschäftsjahr mehr als 455 Tage. Dann wäre nach den üblichen Meldefristen bereits ein neuerer Bericht fällig.

**Speicherung** (Feld `autoChecks` der These, wird nur ergänzt)
- Jeder Klick wird als eigener Lauf gespeichert, gebunden an die Thesenversion und mit einer Kopie des Kriteriums.
- Ein fehlgeschlagener Abruf wird ebenfalls gespeichert und angezeigt. Das letzte erfolgreiche Ergebnis bleibt mit seinem Alter sichtbar.
- Ändert sich das Kriterium, wird das alte Ergebnis als „gilt für die frühere Fassung“ markiert.
- Automatische Läufe verändern weder Versionen noch manuelle Prüfungen oder den Prüftermin.
- Export und Import enthalten die Läufe. Ein Import mit zusätzlichen Läufen gilt als „erweitert“.

**Geprüft**
- 25 neue Tests (insgesamt 232, alle grün) für:
  - Perioden, kumulierte Cashflows und Einzelquartale;
  - fehlende Quartale, Grenzwerte, Prozent und Prozentpunkte;
  - Berichtigungen, Basis null, fremdes Konzept, abweichendes Geschäftsjahr;
  - veraltete Daten, Quellenausfall, Versionsbindung, Import und Export.
- Typecheck und Produktions-Build erfolgreich.
- Browser-Ablauf auf Smartphone (390 px) und Desktop:
  - Abruf über die Route und Anzeige der Belege;
  - ein anschließender fehlgeschlagener Abruf, bei dem das Alter des früheren Ergebnisses zu sehen ist;
  - Speicherstand unverändert, kein horizontales Scrollen.
- Dieser Ablauf lief **nur mit einem lokalen Mock und fiktiven Zahlen**; das ist kein Live-Ergebnis.

**Offen**
- **Echtdaten-Test ausstehend:** In der Entwicklungsumgebung ist `data.sec.gov` gesperrt. Auf dem Mac: Website starten (mit `SEC_EDGAR_USER_AGENT`), eine These mit Kriterien zu z. B. AAPL anlegen, dann „Jetzt prüfen“. Dabei die Werte gegen die verlinkten 10-Q/10-K abgleichen.
- **Bekannte Grenzen:**
  - Unternehmen ohne XBRL-Daten bei der SEC werden nicht geprüft, das betrifft die meisten DACH-Werte.
  - Banken und Versicherer melden oft kein `OperatingIncomeLoss` und bekommen dann „unzureichende Daten“.
  - Wechselt ein Unternehmen das Umsatzkonzept, ist der Vorjahresvergleich an dieser Stelle nicht möglich.
  - Die Rohantwort der SEC kann mehrere MB groß sein; sie wird deshalb nur normalisiert im Prozess zwischengespeichert.

