-- Feedback de l'usuari gestionant recurrents (sub-fase 3.4): calia poder
-- distingir un import cert (factura, ingrés fix) d'un d'estimat (patró
-- detectat amb variació entre ocurrències), i poder marcar una data de
-- finalització opcional (p. ex. una subscripció que se sap que s'acaba,
-- un préstec amb data de fi coneguda).
ALTER TABLE recurrents ADD COLUMN import_aproximat INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recurrents ADD COLUMN data_fi TEXT;
