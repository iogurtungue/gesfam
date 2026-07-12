import { useState } from 'react';
import { actualitzaRecurrent, eliminaRecurrent } from '../api/client';
import type { Categoria, Compte, PeriodicitatRecurrent, Recurrent } from '../api/types';
import { formatDateEs } from '../lib/dates';
import { centsToEs } from '../lib/numbers';
import { PERIODICITAT_LABEL, TOTES_LES_PERIODICITATS } from '../lib/periodicitat';
import {
  cellAccions,
  cellCategoria,
  cellCompte,
  cellConcepte,
  cellData,
  cellImport,
  cellOrigen,
  cellReferencia,
  cellStyle,
  cellPeriodicitat,
} from '../lib/recurrentsTable';

interface Props {
  recurrents: Recurrent[];
  comptes: Compte[];
  categories: Categoria[];
  onChanged: () => void;
}

interface EsborranyEdicio {
  concepte: string;
  periodicitat: PeriodicitatRecurrent;
  importEuros: string;
  importAproximat: boolean;
  dataPrevista: string;
  dataFi: string;
  categoriaId: string;
  referencia: string;
}

function esborranyDe(r: Recurrent): EsborranyEdicio {
  return {
    concepte: r.concepte,
    periodicitat: r.periodicitat,
    importEuros: (r.importCents / 100).toString(),
    importAproximat: r.importAproximat,
    dataPrevista: r.dataPrevista,
    dataFi: r.dataFi ?? '',
    categoriaId: r.categoriaId ?? '',
    referencia: r.referencia ?? '',
  };
}

/** Llistat dels recurrents ja confirmats (manuals, importats o confirmats des d'un candidat detectat), amb edició i eliminació (sub-fase 3.4). */
export function RecurrentsList({ recurrents, comptes, categories, onChanged }: Props) {
  const [eliminant, setEliminant] = useState<string | null>(null);
  const [editant, setEditant] = useState<string | null>(null);
  const [esborrany, setEsborrany] = useState<EsborranyEdicio | null>(null);
  const [desant, setDesant] = useState(false);
  const compteAlias = new Map(comptes.map((c) => [c.id, c.alias]));
  const categoriaNom = new Map(categories.map((c) => [c.id, c.nom]));

  async function handleElimina(id: string) {
    if (!confirm('Eliminar aquest recurrent?')) return;
    setEliminant(id);
    try {
      await eliminaRecurrent(id);
      onChanged();
    } finally {
      setEliminant(null);
    }
  }

  function obreEdicio(r: Recurrent) {
    setEditant(r.id);
    setEsborrany(esborranyDe(r));
  }

  async function handleDesa(id: string) {
    if (!esborrany) return;
    const importCents = Math.round(parseFloat(esborrany.importEuros.replace(',', '.')) * 100);
    if (Number.isNaN(importCents)) return;
    setDesant(true);
    try {
      await actualitzaRecurrent(id, {
        concepte: esborrany.concepte,
        periodicitat: esborrany.periodicitat,
        importCents,
        importAproximat: esborrany.importAproximat,
        dataPrevista: esborrany.dataPrevista,
        dataFi: esborrany.dataFi || null,
        categoriaId: esborrany.categoriaId || null,
        referencia: esborrany.referencia || null,
      });
      setEditant(null);
      onChanged();
    } finally {
      setDesant(false);
    }
  }

  if (recurrents.length === 0) {
    return (
      <section style={{ marginTop: 24 }}>
        <h2>Recurrents confirmats</h2>
        <p style={{ fontSize: 12, color: '#555' }}>Encara no hi ha cap recurrent confirmat.</p>
      </section>
    );
  }

  const ordenats = [...recurrents].sort(
    (a, b) =>
      (compteAlias.get(a.compteId) ?? a.compteId).localeCompare(compteAlias.get(b.compteId) ?? b.compteId) ||
      a.dataPrevista.localeCompare(b.dataPrevista),
  );

  return (
    <section style={{ marginTop: 24 }}>
      <h2>Recurrents confirmats</h2>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
        <thead>
          <tr>
            <th style={{ ...cellStyle, ...cellCompte }}>Compte</th>
            <th style={{ ...cellStyle, ...cellPeriodicitat }}>Periodicitat</th>
            <th style={{ ...cellStyle, ...cellData }}>Data</th>
            <th style={{ ...cellStyle, ...cellData }}>Data fi</th>
            <th style={{ ...cellStyle, ...cellConcepte }}>Concepte</th>
            <th style={{ ...cellStyle, ...cellImport }}>Import</th>
            <th style={{ ...cellStyle, ...cellCategoria }}>Categoria</th>
            <th style={{ ...cellStyle, ...cellOrigen }}>Origen</th>
            <th style={{ ...cellStyle, ...cellReferencia }}>Referència</th>
            <th style={{ ...cellStyle, ...cellAccions }}></th>
          </tr>
        </thead>
        <tbody>
          {ordenats.map((r) =>
            editant === r.id && esborrany ? (
              <tr key={r.id}>
                <td style={{ ...cellStyle, ...cellCompte }}>{compteAlias.get(r.compteId) ?? r.compteId}</td>
                <td style={{ ...cellStyle, ...cellPeriodicitat }}>
                  <select
                    value={esborrany.periodicitat}
                    onChange={(e) => setEsborrany({ ...esborrany, periodicitat: e.target.value as PeriodicitatRecurrent })}
                  >
                    {TOTES_LES_PERIODICITATS.map((p) => (
                      <option key={p} value={p}>
                        {PERIODICITAT_LABEL[p]}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={{ ...cellStyle, ...cellData }}>
                  <input type="date" value={esborrany.dataPrevista} onChange={(e) => setEsborrany({ ...esborrany, dataPrevista: e.target.value })} />
                </td>
                <td style={{ ...cellStyle, ...cellData }}>
                  <input type="date" value={esborrany.dataFi} onChange={(e) => setEsborrany({ ...esborrany, dataFi: e.target.value })} />
                </td>
                <td style={{ ...cellStyle, ...cellConcepte }}>
                  <input value={esborrany.concepte} onChange={(e) => setEsborrany({ ...esborrany, concepte: e.target.value })} style={{ width: '100%' }} />
                </td>
                <td style={{ ...cellStyle, ...cellImport }}>
                  <input
                    type="number"
                    step="0.01"
                    value={esborrany.importEuros}
                    onChange={(e) => setEsborrany({ ...esborrany, importEuros: e.target.value })}
                    style={{ width: 70, textAlign: 'right' }}
                  />
                  <label title="L'import és una estimació, no un valor cert">
                    <input
                      type="checkbox"
                      checked={esborrany.importAproximat}
                      onChange={(e) => setEsborrany({ ...esborrany, importAproximat: e.target.checked })}
                    />{' '}
                    aprox.
                  </label>
                </td>
                <td style={{ ...cellStyle, ...cellCategoria }}>
                  <select value={esborrany.categoriaId} onChange={(e) => setEsborrany({ ...esborrany, categoriaId: e.target.value })}>
                    <option value="">--</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nom}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={{ ...cellStyle, ...cellOrigen }}>{r.origen}</td>
                <td style={{ ...cellStyle, ...cellReferencia }}>
                  <input value={esborrany.referencia} onChange={(e) => setEsborrany({ ...esborrany, referencia: e.target.value })} style={{ width: '100%' }} />
                </td>
                <td style={{ ...cellStyle, ...cellAccions }}>
                  <button onClick={() => handleDesa(r.id)} disabled={desant}>
                    Desa
                  </button>{' '}
                  <button onClick={() => setEditant(null)} disabled={desant}>
                    Cancel·la
                  </button>
                </td>
              </tr>
            ) : (
              <tr key={r.id}>
                <td style={{ ...cellStyle, ...cellCompte }}>{compteAlias.get(r.compteId) ?? r.compteId}</td>
                <td style={{ ...cellStyle, ...cellPeriodicitat }}>{PERIODICITAT_LABEL[r.periodicitat]}</td>
                <td style={{ ...cellStyle, ...cellData }}>{formatDateEs(r.dataPrevista)}</td>
                <td style={{ ...cellStyle, ...cellData }}>{r.dataFi ? formatDateEs(r.dataFi) : '—'}</td>
                <td style={{ ...cellStyle, ...cellConcepte }}>{r.concepte}</td>
                <td style={{ ...cellStyle, ...cellImport }} title={r.importAproximat ? 'Import aproximat (estimació)' : 'Import cert'}>
                  {r.importAproximat && '≈ '}
                  {centsToEs(r.importCents, false)}
                </td>
                <td style={{ ...cellStyle, ...cellCategoria }}>{r.categoriaId ? (categoriaNom.get(r.categoriaId) ?? '—') : '—'}</td>
                <td style={{ ...cellStyle, ...cellOrigen }}>{r.origen}</td>
                <td style={{ ...cellStyle, ...cellReferencia }}>{r.referencia ?? '—'}</td>
                <td style={{ ...cellStyle, ...cellAccions }}>
                  <button onClick={() => obreEdicio(r)} title="Edita">
                    Edita
                  </button>{' '}
                  <button onClick={() => handleElimina(r.id)} disabled={eliminant === r.id} title="Eliminar">
                    X
                  </button>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </section>
  );
}
