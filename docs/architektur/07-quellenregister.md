# Quellenregister: Recherche des Nutzers, geprüft

Stand: 28.09.2026. Grundlage ist die Quellenrecherche des Nutzers (Unternehmensmeldungen USA, DACH, Australien, global). **Keine Quelle ist gebucht oder angebunden, und keine Lizenz ist geprüft.** Die Anmerkungen stammen aus einer ersten fachlichen Durchsicht. Vor jeder Anbindung braucht es aktuelle offizielle Dokumentation, eine echte Datenprobe und eine Prüfung der Nutzungsrechte für Anzeige, Speicherung und Weitergabe.

## Leitregeln

- Kostenloser Abruf, private Nutzung, öffentliche Anzeige, Weitergabe von Rohdaten und kommerzielle Nutzung sind **verschiedene Rechte**. Auch eine kostenlose Website kann schon eine Weitergabe sein.
- Große Transaktionen oder erfolgreiche Marktteilnehmer bedeuten kein sicheres Wissen.
- Jede Integration zeigt Abdeckung, Verzögerung und den letzten erfolgreichen Abruf.

## USA (angebunden oder naheliegend)

| Quelle | Nutzen | Stand / Anmerkung |
|---|---|---|
| SEC Submissions, Form 4/4-A | Insider, Berichtigungen | **angebunden** (Bot und Website) |
| SEC Company Facts | Berichtsvergleiche, schnellere Aktienseite (ein Abruf statt 15–25) | **nächster sinnvoller Schritt** (Etappe D) |
| SEC EDGAR-Indizes und RSS | neue Einreichungen effizient finden, Voraussetzung für ein größeres Universum | vor der Erweiterung der Beobachtungsliste nötig |
| SEC 8-K/6-K mit Anlage EX-99 | Ergebnisse, Prognosen | nur Fließtext: jede Aussage braucht einen wörtlichen Beleg |
| SEC 13F, 13D/G, N-PORT | Bestände, Großbeteiligungen, Fondsportfolios | 13F teils angebunden. Nie aktuelle Kaufzeitpunkte behaupten |
| FINRA Short Sale Volume, Short Interest, OTC/ATS | Kontext zu Leerverkäufen und außerbörslichem Handel | **Korrektur:** Die Daten „erkennen“ keine Dark-Pool-Käufer. Sie sind aggregiert und verzögert (ATS wöchentlich), und Tagesvolumen ist nicht der offene Shortbestand. Nutzungsrechte je Datensatz prüfen |
| House Clerk, Senate eFD | Kongressmeldungen | Die eFD-Bedingungen schließen kommerzielle Nutzung aus (mit einer Ausnahme für bestimmte Medienzwecke). **Bis zur rechtlichen Klärung kein Teil einer Abo-App** |
| USAspending | Staatsaufträge | Die Zuordnung zu börsennotierten Unternehmen ist unsicher. Auftragsrahmen ist nicht Umsatz |

## DACH

| Quelle | Nutzen | Anmerkung |
|---|---|---|
| BaFin-Datenbank Eigengeschäfte von Führungskräften (Art. 19 MAR) | Directors' Dealings DE | Öffentlich einsehbar. **Eine offizielle, freie Massen-API ist nicht belegt.** Die Verbreitung läuft über Emittenten und Dienstleister wie EQS. Zugang und Weiterverwendung prüfen |
| Unternehmensregister / Bundesanzeiger | Finanzberichte (ESEF), Stimmrechtsmitteilungen | Automatisierter Abruf und Weiterverwendung sind nicht pauschal frei. Nutzungsbedingungen prüfen |
| FMA, OeKB Issuer Information Center | Directors' Dealings und Pflichtmeldungen AT | Zugangsbedingungen der OeKB prüfen. Nur mit Drosselung abrufen |
| SIX Swiss Exchange | Management-Transaktionen CH | Auf der SIX-Seite einsehbar. Strukturierte oder kommerzielle Nutzung ist voraussichtlich lizenzpflichtig |
| Zefix | Handelsregister **Schweiz** | **Korrektur:** Zefix ist das Schweizer Register, nicht das von Liechtenstein |
| FMA Liechtenstein, Amt für Justiz | Liechtenstein | Für Aktien geringe Relevanz. Niedrige Priorität |

## Australien

| Quelle | Nutzen | Anmerkung |
|---|---|---|
| ASX Appendix 3Y | Änderungen von Direktorenbeteiligungen (Frist 5 Geschäftstage) | Inhaltlich wertvoll. **Eine freie, offizielle API für kommerzielle Weitergabe ist nicht belegt**, ASX-Daten sind in der Regel lizenzpflichtig |
| Substantial holder notices (Form 603/604) | Beteiligungen ab 5 % | **Korrektur:** Diese Meldungen gehen an die ASX und erscheinen dort. ASIC ist nicht die Hauptquelle dafür |

## Global

| Quelle | Nutzen | Anmerkung |
|---|---|---|
| GDELT | weltweite Fundstellen zu Unternehmen | Laut GDELT frei mit Quellenangabe. Die Rechte an den verlinkten Artikeln gehen nicht mit über. Tonwerte sind keine geprüften Signale |
| GLEIF (LEI, CC0) | eindeutige Zuordnung juristischer Personen, Konzernstrukturen | gut geeignet. Eine LEI ist keine Aktiengattung und keine Börsennotierung |
| OpenFIGI, ESMA FIRDS | Instrumentenkennungen | ergänzend zur Zuordnung |
| EIA | Energie als Kontext | kostenloser Schlüssel, Nutzungsbedingungen beachten |
| NewsAPI | Artikelsuche | Der Developer-Tarif ist **nicht für Produktion** gedacht, deshalb kein Baustein |

## Priorität für die Umsetzung

1. SEC Company Facts und EDGAR-Indizes: Berichtsvergleiche und ein größeres US-Universum.
2. GLEIF und OpenFIGI zur Zuordnung.
3. DACH-Directors' Dealings, erst nach geklärtem Zugang (BaFin, OeKB, SIX). Das ist die größte inhaltliche Lücke für die Zielgruppe.
4. ASX, erst nach Lizenzklärung.
5. GDELT als Fundstellen-Ergänzung zu Unternehmensnachrichten.

## Zu Monetarisierung und Thesen-Tagebuch aus derselben Recherche

- **Richtig:** Einfache Kursalarme sind kein Grund für ein Abo. Bezahlt wird für Arbeitsersparnis: Kaufgruppen-Alarme, Prognose- und Margenänderungen, Verletzung der eigenen These, Berichtsvergleiche.
- **Preise:** Die Recherche nennt 9,99–14,99 €, früher waren 9,99/29,99 € genannt. Beides bleibt Hypothese.
- **Rechtliches:** Kein Alarm darf als Empfehlung formuliert sein, und ein Hinweistext schafft keine rechtliche Sicherheit.
- **Thesen-Tagebuch** (Etappe C): Das vorgeschlagene Datenmodell passt weitgehend. Abweichungen:
  - Frühere Fassungen werden als eigenständige, unveränderliche Versionen mit **Änderungsgrund** gespeichert, nicht nur als Kopie.
  - Automatische Prüfungen laufen erst mit Berichtsvergleichen (Etappe D).
  - Keine KI-formulierten Thesen.
  - Lokale Speicherung mit Export, Import und Löschen. Die Grenzen (Browserbindung, kein Zugriffsschutz) werden in der App erklärt.
