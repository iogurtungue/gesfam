import { getDb } from './client.ts';
import type { Configuracio } from './types.ts';

interface ConfiguracioRow {
  tolerancia_import_conciliacio: number;
  finestra_conciliacio_dies: number;
  dies_desplacament_vencut: number;
  finestra_resolucio_vencut_dies: number;
  dies_diferencia_transferencies: number;
  max_copies_seguretat: number;
}

function rowToConfiguracio(row: ConfiguracioRow): Configuracio {
  return {
    toleranciaImportConciliacio: row.tolerancia_import_conciliacio,
    finestraConciliacioDies: row.finestra_conciliacio_dies,
    diesDesplacamentVencut: row.dies_desplacament_vencut,
    finestraResolucioVencutDies: row.finestra_resolucio_vencut_dies,
    diesDiferenciaTransferencies: row.dies_diferencia_transferencies,
    maxCopiesSeguretat: row.max_copies_seguretat,
  };
}

/** Configuració global de l'aplicació (especificacio.md 4.4): fila única, creada per la migració amb els valors que fins ara eren constants fixes. */
export function getConfiguracio(): Configuracio {
  const row = getDb().prepare('SELECT * FROM configuracio WHERE id = 1').get() as unknown as ConfiguracioRow;
  return rowToConfiguracio(row);
}

export type CanvisConfiguracio = Partial<Configuracio>;

const LIMITS: Record<keyof Configuracio, { min: number; max: number; enter: boolean }> = {
  toleranciaImportConciliacio: { min: 0, max: 1, enter: false },
  finestraConciliacioDies: { min: 0, max: 365, enter: true },
  diesDesplacamentVencut: { min: 0, max: 365, enter: true },
  finestraResolucioVencutDies: { min: 0, max: 365, enter: true },
  diesDiferenciaTransferencies: { min: 0, max: 365, enter: true },
  maxCopiesSeguretat: { min: 1, max: 1000, enter: true },
};

function valida(camp: keyof Configuracio, valor: number): void {
  const limit = LIMITS[camp];
  if (!Number.isFinite(valor) || (limit.enter && !Number.isInteger(valor)) || valor < limit.min || valor > limit.max) {
    const tipus = limit.enter ? 'un enter' : 'un número';
    throw new Error(`${camp} ha de ser ${tipus} entre ${limit.min} i ${limit.max}.`);
  }
}

/** Actualitza un o més paràmetres de configuració (validant rangs) i retorna la configuració completa resultant. */
export function actualitzaConfiguracio(canvis: CanvisConfiguracio): Configuracio {
  for (const [camp, valor] of Object.entries(canvis) as [keyof Configuracio, number][]) {
    valida(camp, valor);
  }

  const nou: Configuracio = { ...getConfiguracio(), ...canvis };
  getDb()
    .prepare(
      `UPDATE configuracio SET
        tolerancia_import_conciliacio = ?,
        finestra_conciliacio_dies = ?,
        dies_desplacament_vencut = ?,
        finestra_resolucio_vencut_dies = ?,
        dies_diferencia_transferencies = ?,
        max_copies_seguretat = ?
       WHERE id = 1`,
    )
    .run(
      nou.toleranciaImportConciliacio,
      nou.finestraConciliacioDies,
      nou.diesDesplacamentVencut,
      nou.finestraResolucioVencutDies,
      nou.diesDiferenciaTransferencies,
      nou.maxCopiesSeguretat,
    );

  return nou;
}
