-- Afegeix un ordre manual (per mostrar els comptes en l'ordre que l'usuari
-- vulgui, p. ex. a la pestanya de Moviments) i un grup opcional (p. ex.
-- "Familia", "Empresa") per organitzar-los a la pestanya de Comptes.
ALTER TABLE comptes ADD COLUMN ordre INTEGER;
ALTER TABLE comptes ADD COLUMN grup TEXT;

-- Preserva l'ordre de visualització actual (per rowid) perquè els comptes
-- existents no saltin a ordre alfabètic de cop en aplicar la migració.
UPDATE comptes SET ordre = rowid;
