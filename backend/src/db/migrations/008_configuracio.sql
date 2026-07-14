-- Pestanya "Configuració": agrupa els marges i finestres de dies que fins ara
-- eren constants fixes al codi (conciliació de previsió, suggeriment de
-- transferències internes, nombre de còpies de seguretat), perquè l'usuari
-- els pugui ajustar sense tocar codi. Fila única (id=1).
CREATE TABLE configuracio (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  tolerancia_import_conciliacio REAL NOT NULL DEFAULT 0.15,
  finestra_conciliacio_dies INTEGER NOT NULL DEFAULT 3,
  dies_desplacament_vencut INTEGER NOT NULL DEFAULT 10,
  finestra_resolucio_vencut_dies INTEGER NOT NULL DEFAULT 30,
  dies_diferencia_transferencies INTEGER NOT NULL DEFAULT 2,
  max_copies_seguretat INTEGER NOT NULL DEFAULT 20
);

INSERT INTO configuracio (id) VALUES (1);
