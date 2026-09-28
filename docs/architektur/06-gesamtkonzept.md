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
| Thesen-Tagebuch | ✖ | ✖ | ✖ | Etappe C |
| Berichtsvergleiche (Quartal/Jahr) | ✖ | ✖ | ✖ | Etappe D |
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
