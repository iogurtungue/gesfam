-- Feedback de l'usuari: cal poder marcar un recurrent com a transferència
-- interna (moviment entre comptes propis), mateix concepte que ja existeix
-- per als moviments reals (es_transferencia_interna), perquè es pugui
-- filtrar a la pestanya de Recurrents i a la previsió.
ALTER TABLE recurrents ADD COLUMN es_transferencia_interna INTEGER NOT NULL DEFAULT 0;
