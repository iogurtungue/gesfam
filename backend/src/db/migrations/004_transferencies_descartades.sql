-- Permet descartar un suggeriment de transferència interna (spec 3.4):
-- indica que la coincidència és una falsa alarma i no s'ha de tornar a
-- suggerir, a diferència de "Confirmar" que marca els dos moviments com a
-- transferència interna real.
CREATE TABLE transferencies_descartades (
  id TEXT PRIMARY KEY,
  moviment_a_id TEXT NOT NULL,
  moviment_b_id TEXT NOT NULL
);

CREATE INDEX idx_transferencies_descartades_a ON transferencies_descartades(moviment_a_id);
CREATE INDEX idx_transferencies_descartades_b ON transferencies_descartades(moviment_b_id);
