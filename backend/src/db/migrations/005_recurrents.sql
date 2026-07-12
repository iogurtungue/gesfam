-- Model unificat de recurrents (spec 4.1, 4.2): cobreix tant els patrons
-- detectats automàticament sobre l'històric (origen='detectat', sub-fase 3.3)
-- com els compromisos confirmats introduïts manualment o per importació
-- (origen='manual'/'importat', periodicitat='unica' per a un venciment
-- puntual no repetitiu). Els candidats detectats però encara no revisats no
-- es persisteixen aquí (es recalculen en calent); només hi ha files per a
-- decisions ja preses per l'usuari (estat='confirmat'/'ignorat').
CREATE TABLE recurrents (
  id TEXT PRIMARY KEY,
  compte_id TEXT NOT NULL,
  concepte TEXT NOT NULL,
  concepte_normalitzat TEXT NOT NULL,
  periodicitat TEXT NOT NULL,
  import_cents INTEGER NOT NULL,
  data_prevista TEXT NOT NULL,
  categoria_id TEXT,
  referencia TEXT,
  origen TEXT NOT NULL,
  estat TEXT NOT NULL
);

CREATE INDEX idx_recurrents_compte ON recurrents(compte_id);
CREATE INDEX idx_recurrents_data_prevista ON recurrents(data_prevista);
CREATE INDEX idx_recurrents_categoria ON recurrents(categoria_id);
