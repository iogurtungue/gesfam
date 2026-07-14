import { beforeEach, describe, expect, it } from 'vitest';

process.env.GESFAM_DB_PATH = ':memory:';
const { getDb } = await import('./client.ts');
const { actualitzaConfiguracio, getConfiguracio } = await import('./configuracio.ts');

beforeEach(() => {
  getDb().exec(
    `UPDATE configuracio SET
      tolerancia_import_conciliacio = 0.15,
      finestra_conciliacio_dies = 3,
      dies_desplacament_vencut = 10,
      finestra_resolucio_vencut_dies = 30,
      dies_diferencia_transferencies = 2,
      max_copies_seguretat = 20
     WHERE id = 1`,
  );
});

describe('getConfiguracio', () => {
  it('returns the defaults inserted by the migration on a fresh database', () => {
    expect(getConfiguracio()).toEqual({
      toleranciaImportConciliacio: 0.15,
      finestraConciliacioDies: 3,
      diesDesplacamentVencut: 10,
      finestraResolucioVencutDies: 30,
      diesDiferenciaTransferencies: 2,
      maxCopiesSeguretat: 20,
    });
  });
});

describe('actualitzaConfiguracio', () => {
  it('updates only the given fields, leaving the rest untouched', () => {
    const resultat = actualitzaConfiguracio({ toleranciaImportConciliacio: 0.25 });

    expect(resultat.toleranciaImportConciliacio).toBe(0.25);
    expect(resultat.finestraConciliacioDies).toBe(3);
    expect(getConfiguracio().toleranciaImportConciliacio).toBe(0.25);
  });

  it('updates several fields at once', () => {
    const resultat = actualitzaConfiguracio({ finestraConciliacioDies: 5, diesDesplacamentVencut: 14, maxCopiesSeguretat: 50 });

    expect(resultat).toMatchObject({ finestraConciliacioDies: 5, diesDesplacamentVencut: 14, maxCopiesSeguretat: 50 });
  });

  it('rejects a toleranciaImportConciliacio outside [0, 1]', () => {
    expect(() => actualitzaConfiguracio({ toleranciaImportConciliacio: 1.5 })).toThrow();
    expect(() => actualitzaConfiguracio({ toleranciaImportConciliacio: -0.1 })).toThrow();
  });

  it('rejects a negative day-based window', () => {
    expect(() => actualitzaConfiguracio({ finestraConciliacioDies: -1 })).toThrow();
    expect(() => actualitzaConfiguracio({ diesDesplacamentVencut: -1 })).toThrow();
    expect(() => actualitzaConfiguracio({ finestraResolucioVencutDies: -1 })).toThrow();
    expect(() => actualitzaConfiguracio({ diesDiferenciaTransferencies: -1 })).toThrow();
  });

  it('rejects a non-integer day-based window', () => {
    expect(() => actualitzaConfiguracio({ finestraConciliacioDies: 2.5 })).toThrow();
  });

  it('rejects maxCopiesSeguretat below 1', () => {
    expect(() => actualitzaConfiguracio({ maxCopiesSeguretat: 0 })).toThrow();
  });

  it('leaves the stored configuration untouched when validation fails', () => {
    expect(() => actualitzaConfiguracio({ toleranciaImportConciliacio: 2 })).toThrow();
    expect(getConfiguracio().toleranciaImportConciliacio).toBe(0.15);
  });
});
