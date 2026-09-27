-- Bekannte Datenquellen mit Lizenzstand. display_allowed/redistribution_allowed
-- bleiben NULL (= ungeprueft), bis die Nutzungsbedingungen fuer den konkreten
-- Einsatz geprueft sind. Solange gilt: nur privater Research/Paper-Betrieb.
INSERT INTO data_sources (source_id, name, homepage, priority, source_kind, license_note, display_allowed, redistribution_allowed, commercial_use_allowed) VALUES
 ('sec',       'SEC EDGAR',                'https://www.sec.gov/edgar',               10, 'regulator',        'US-Behoerdendaten; max. 10 Anfragen/s; User-Agent mit Kontakt Pflicht', true, true, true),
 ('cftc',      'CFTC Commitments of Traders','https://www.cftc.gov/MarketReports/CommitmentsofTraders', 10, 'regulator', 'US-Behoerdendaten', true, true, true),
 ('fred',      'FRED / ALFRED (St. Louis Fed)','https://fred.stlouisfed.org',        20, 'regulator',        'API-Schluessel; Nutzungsbedingungen je Reihe (Drittanbieter-Rechte moeglich)', NULL, NULL, NULL),
 ('binance',   'Binance Market Data',      'https://developers.binance.com',          30, 'exchange',         'Oeffentliche Marktdaten-API; Anzeige/Weitergabe abgeleiteter Daten vor oeffentlicher Nutzung pruefen; Zugriff regional eingeschraenkt', NULL, NULL, NULL),
 ('coinbase',  'Coinbase Exchange Market Data','https://docs.cdp.coinbase.com',       30, 'exchange',         'Oeffentliche Marktdaten-API; Nutzungsbedingungen vor oeffentlicher Nutzung pruefen', NULL, NULL, NULL),
 ('kraken',    'Kraken Market Data',       'https://docs.kraken.com',                 30, 'exchange',         'Oeffentliche Marktdaten-API; Nutzungsbedingungen vor oeffentlicher Nutzung pruefen', NULL, NULL, NULL),
 ('stooq',     'Stooq (Tageskurse)',       'https://stooq.com',                       60, 'aggregator',       'Kostenlose Tageskurse; Lizenz fuer oeffentliche Anzeige ungeklaert -> nur privater Research', NULL, false, false),
 ('coingecko', 'CoinGecko',                'https://www.coingecko.com/en/api',        60, 'aggregator',       'Demo-Tarif; Namensnennung Pflicht; Cache max. 24 h', true, false, false),
 ('defillama', 'DefiLlama',                'https://defillama.com/docs/api',          60, 'aggregator',       'Offene API; Quellenangabe', NULL, NULL, NULL),
 ('internal',  'Eigene Berechnung',        NULL,                                      50, 'secondary_vendor', 'Aus obigen Quellen abgeleitet; erbt deren Einschraenkungen', NULL, NULL, NULL);
