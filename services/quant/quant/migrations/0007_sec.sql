-- =============================================================================
-- 0007 SEC: Einreichungen, Form-4-Transaktionen, 13F-Bestaende, Schedule 13D/G.
-- available_at = fruehester oeffentlicher Zeitpunkt (EDGAR-Annahme, konservativ
-- als New-Yorker Zeit gelesen); received_at = wann der Bot sie geholt hat.
-- Eine Entscheidung darf eine Meldung erst ab max(available_at, received_at) nutzen.
-- Alle Tabellen append-only.
-- =============================================================================
CREATE TABLE sec_filings (
  accession        text PRIMARY KEY,
  form             text NOT NULL,
  filer_cik        text NOT NULL,        -- wessen Einreichungsliste (Emittent, Manager, Melder)
  filing_date      date NOT NULL,
  report_date      date,
  accepted_at      timestamptz,
  available_at     timestamptz NOT NULL,
  received_at      timestamptz NOT NULL,
  primary_document text,
  url              text,
  parse_status     text NOT NULL CHECK (parse_status IN ('parsed','metadata_only','error','skipped')),
  parse_error      text
);
CREATE INDEX sec_filings_by_filer ON sec_filings (filer_cik, filing_date DESC);
CREATE TRIGGER sec_filings_append_only BEFORE UPDATE OR DELETE ON sec_filings FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE insider_transactions (
  accession               text NOT NULL REFERENCES sec_filings(accession),
  seq                     integer NOT NULL,
  document_type           text NOT NULL,
  issuer_cik              text NOT NULL,
  issuer_ticker           text,
  owner_ciks              text[] NOT NULL,
  owner_names             text[] NOT NULL,
  roles                   text[] NOT NULL,
  officer_title           text,
  table_kind              text NOT NULL CHECK (table_kind IN ('non_derivative','derivative')),
  security_title          text,
  transaction_date        date,
  code                    text,
  classification          text NOT NULL,
  classification_confidence double precision NOT NULL,
  classification_version  text NOT NULL,
  context                 text[] NOT NULL,
  discretionary           boolean NOT NULL,
  plan_10b5_1             boolean NOT NULL,
  shares                  double precision,
  price                   double precision,
  value                   double precision,
  acquired_disposed       text,
  shares_after            double precision,
  ownership               text,
  nature_of_ownership     text,
  footnotes               jsonb NOT NULL,
  available_at            timestamptz NOT NULL,
  received_at             timestamptz NOT NULL,
  PRIMARY KEY (accession, seq)
);
CREATE INDEX insider_tx_by_issuer ON insider_transactions (issuer_cik, available_at DESC);
CREATE TRIGGER insider_transactions_append_only BEFORE UPDATE OR DELETE ON insider_transactions FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE institutional_holdings (
  accession              text NOT NULL REFERENCES sec_filings(accession),
  row_no                 integer NOT NULL,
  manager_cik            text NOT NULL,
  report_period          date NOT NULL,
  amendment_type         text,
  cusip                  text NOT NULL,
  issuer_name            text NOT NULL,
  title_of_class         text,
  value_usd              double precision NOT NULL,
  shares                 double precision,
  share_type             text,
  put_call               text,
  investment_discretion  text,
  voting_sole            double precision,
  voting_shared          double precision,
  voting_none            double precision,
  available_at           timestamptz NOT NULL,
  received_at            timestamptz NOT NULL,
  PRIMARY KEY (accession, row_no)
);
CREATE INDEX holdings_by_manager ON institutional_holdings (manager_cik, report_period, available_at);
CREATE TRIGGER institutional_holdings_append_only BEFORE UPDATE OR DELETE ON institutional_holdings FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE ownership_reports_13dg (
  accession          text PRIMARY KEY REFERENCES sec_filings(accession),
  form               text NOT NULL,
  schedule           text NOT NULL CHECK (schedule IN ('D','G')),
  is_amendment       boolean NOT NULL,
  subject_cik        text NOT NULL,
  filer_ciks         text[] NOT NULL,
  parse_status       text NOT NULL CHECK (parse_status IN ('structured','metadata_only')),
  reporting_persons  jsonb NOT NULL,
  percent_of_class   double precision,
  shares_owned       double precision,
  available_at       timestamptz NOT NULL,
  received_at        timestamptz NOT NULL
);
CREATE INDEX ownership_13dg_by_subject ON ownership_reports_13dg (subject_cik, available_at DESC);
CREATE TRIGGER ownership_reports_13dg_append_only BEFORE UPDATE OR DELETE ON ownership_reports_13dg FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
