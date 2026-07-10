-- Liquidacions directes de targeta (especificacio.md 3.2.1): moviments de
-- targeta (p. ex. retirades d'efectiu en caixer) que es cobren directament
-- al compte corrent en lloc d'entrar a la liquidació mensual. Cal marcar-los
-- i aparellar-los amb el càrrec corresponent perquè la despesa no es dupliqui
-- i perquè la quadratura de la liquidació mensual no els tingui en compte.
ALTER TABLE moviments ADD COLUMN es_liquidacio_directa INTEGER NOT NULL DEFAULT 0;
ALTER TABLE moviments ADD COLUMN aparellat_amb_id TEXT;

CREATE INDEX idx_moviments_liquidacio_directa ON moviments(es_liquidacio_directa);
CREATE INDEX idx_moviments_aparellat_amb ON moviments(aparellat_amb_id);

-- Regles per detectar automàticament, pel concepte del propi moviment de
-- targeta, si es tracta d'una retirada/disposició d'efectiu — a diferència
-- de regles_liquidacio, no apunten a cap compte concret (qualsevol targeta
-- pot fer una retirada).
CREATE TABLE regles_liquidacio_directa (
  id TEXT PRIMARY KEY,
  patro TEXT NOT NULL
);

INSERT INTO regles_liquidacio_directa (id, patro) VALUES
  ('seed-retirada-efectivo', 'RETIRADA EFECTIVO'),
  ('seed-disposicion', 'DISPOSICION'),
  ('seed-cajero', 'CAJERO'),
  ('seed-reintegro', 'REINTEGRO');

-- Categoria per defecte assignada al càrrec del compte corrent en aparellar
-- (especificacio.md 3.2.1 punt 3). El codi mai depèn d'aquest id fix — sempre
-- es busca per nom (veure obteOCreaCategoriaEfectiuRetirat a operations.ts) —
-- però sembrar-la ja fa que sigui visible d'entrada a la pestanya Categories.
INSERT INTO categories (id, nom) VALUES ('efectiu_retirat', 'Efectiu retirat');
