-- Contrapartida automàtica de liquidacions de targeta (especificacio.md 3.2.1):
-- permet marcar un càrrec del compte corrent com la liquidació mensual
-- d'una targeta i vincular-hi el moviment virtual generat a la targeta amb
-- el moviment real (compte corrent) que el va originar.
ALTER TABLE moviments ADD COLUMN es_liquidacio_targeta_id TEXT;
ALTER TABLE moviments ADD COLUMN moviment_origen_id TEXT;

CREATE INDEX idx_moviments_liquidacio_targeta ON moviments(es_liquidacio_targeta_id);
CREATE INDEX idx_moviments_origen ON moviments(moviment_origen_id);

-- Regles per detectar automàticament, pel concepte del càrrec, a quina
-- targeta correspon (p. ex. patró "LIQUIDACION TARJETA VISA" -> targeta X) —
-- anàleg a `regles` (categorització) però apuntant a un compte en lloc
-- d'una categoria.
CREATE TABLE regles_liquidacio (
  id TEXT PRIMARY KEY,
  patro TEXT NOT NULL,
  targeta_compte_id TEXT NOT NULL
);
