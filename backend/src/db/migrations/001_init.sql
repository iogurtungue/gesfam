CREATE TABLE comptes (
  id TEXT PRIMARY KEY,
  banc TEXT NOT NULL,
  tipus TEXT NOT NULL,
  alias TEXT NOT NULL,
  iban_o_ultims_digits TEXT,
  compte_liquidacio_id TEXT,
  dia_liquidacio INTEGER
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL
);

CREATE TABLE regles (
  id TEXT PRIMARY KEY,
  patro TEXT NOT NULL,
  categoria_id TEXT NOT NULL,
  prioritat INTEGER NOT NULL
);

CREATE TABLE lots (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  fitxer_origen TEXT NOT NULL,
  banc TEXT NOT NULL,
  compte_id TEXT NOT NULL,
  nombre_moviments INTEGER NOT NULL
);

CREATE TABLE moviments (
  id TEXT PRIMARY KEY,
  compte_id TEXT NOT NULL,
  data_operacio TEXT NOT NULL,
  data_valor TEXT NOT NULL,
  concepte_original TEXT NOT NULL,
  concepte_normalitzat TEXT NOT NULL,
  import_cents INTEGER NOT NULL,
  saldo_posterior_cents INTEGER,
  categoria_id TEXT,
  lot_importacio_id TEXT NOT NULL,
  es_transferencia_interna INTEGER NOT NULL DEFAULT 0,
  seq INTEGER NOT NULL
);

CREATE INDEX idx_moviments_compte ON moviments(compte_id);
CREATE INDEX idx_moviments_data ON moviments(data_operacio);
CREATE INDEX idx_moviments_lot ON moviments(lot_importacio_id);
CREATE INDEX idx_moviments_categoria ON moviments(categoria_id);
CREATE INDEX idx_moviments_seq ON moviments(seq);

-- Default categories, seeded once here (a fresh DB always runs every
-- migration in order, unlike Dexie's .upgrade(), which never fires for a
-- brand-new IndexedDB database — see ESTAT.md's history of that bug).
INSERT INTO categories (id, nom) VALUES
  ('habitatge', 'Habitatge'),
  ('subministraments', 'Subministraments'),
  ('alimentacio', 'Alimentació'),
  ('transport', 'Transport'),
  ('nomina', 'Nòmina'),
  ('impostos', 'Impostos'),
  ('oci', 'Oci'),
  ('transferencies_internes', 'Transferències internes'),
  ('altres', 'Altres');
