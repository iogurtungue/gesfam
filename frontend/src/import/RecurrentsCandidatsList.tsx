import { useState } from 'react';
import { confirmaCandidatRecurrent, ignoraCandidatRecurrent } from '../api/client';
import type { CandidatRecurrent, Categoria, Compte, PeriodicitatRecurrent } from '../api/types';
import { centsToEs } from '../lib/numbers';
import { PERIODICITAT_LABEL, PERIODICITATS_REPETITIVES } from '../lib/periodicitat';
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
  candidats: CandidatRecurrent[];
  comptes: Compte[];
  categories: Categoria[];
  onChanged: () => void;
}

interface Esborrany {
  concepte: string;
  periodicitat: PeriodicitatRecurrent;
  importEuros: string;
  importAproximat: boolean;
  dataPrevista: string;
  dataFi: string;
  categoriaId: string;
  referencia: string;
}

function clau(c: CandidatRecurrent): string {
  return `${c.compteId}|${c.concepteNormalitzat}|${Math.sign(c.importEstimatCents)}`;
}

function esborranyDe(c: CandidatRecurrent): Esborrany {
  return {
    concepte: c.concepte,
    periodicitat: c.periodicitat,
    importEuros: (c.importEstimatCents / 100).toString(),
    // Rang detectat diferent -> per defecte marcat com a aproximat; import constant a totes les ocurrències -> cert.
    importAproximat: c.importMinCents !== c.importMaxCents,
    dataPrevista: c.dataPrevista,
    dataFi: '',
    categoriaId: '',
    referencia: '',
  };
}

/** Pantalla de revisió dels candidats detectats pel motor de periodicitat (sub-fase 3.4, especificacio.md 4.1.5): confirmar (amb possibles correccions), o ignorar (falsa alarma, no es torna a suggerir). Mateixes columnes (i amplades) que la taula de recurrents confirmats. */
export function RecurrentsCandidatsList({ candidats, comptes, categories, onChanged }: Props) {
  const [esborranys, setEsborranys] = useState<Record<string, Esborrany>>({});
  const [ocupat, setOcupat] = useState<string | null>(null);
  const compteAlias = new Map(comptes.map((c) => [c.id, c.alias]));

  function esborranyPer(c: CandidatRecurrent): Esborrany {
    return esborranys[clau(c)] ?? esborranyDe(c);
  }

  function actualitzaEsborrany(c: CandidatRecurrent, canvis: Partial<Esborrany>) {
    setEsborranys((prev) => ({ ...prev, [clau(c)]: { ...esborranyPer(c), ...canvis } }));
  }

  async function handleConfirma(c: CandidatRecurrent) {
    const esborrany = esborranyPer(c);
    const importCents = Math.round(parseFloat(esborrany.importEuros.replace(',', '.')) * 100);
    if (Number.isNaN(importCents)) return;
    setOcupat(clau(c));
    try {
      await confirmaCandidatRecurrent({
        compteId: c.compteId,
        concepte: esborrany.concepte,
        periodicitat: esborrany.periodicitat,
        importCents,
        importAproximat: esborrany.importAproximat,
        dataPrevista: esborrany.dataPrevista,
        dataFi: esborrany.dataFi || undefined,
        categoriaId: esborrany.categoriaId || undefined,
        referencia: esborrany.referencia.trim() || undefined,
      });
      onChanged();
    } finally {
      setOcupat(null);
    }
  }

  async function handleIgnora(c: CandidatRecurrent) {
    setOcupat(clau(c));
    try {
      await ignoraCandidatRecurrent({
        compteId: c.compteId,
        concepte: c.concepte,
        periodicitat: c.periodicitat,
        importCents: c.importEstimatCents,
        dataPrevista: c.dataPrevista,
      });
      onChanged();
    } finally {
      setOcupat(null);
    }
  }

  if (candidats.length === 0) {
    return (
      <section style={{ marginTop: 24 }}>
        <h2>Candidats detectats</h2>
        <p style={{ fontSize: 12, color: '#555' }}>Cap patró nou detectat sobre l'històric de moviments.</p>
      </section>
    );
  }

  const ordenats = [...candidats].sort(
    (a, b) =>
      (compteAlias.get(a.compteId) ?? a.compteId).localeCompare(compteAlias.get(b.compteId) ?? b.compteId) ||
      a.dataPrevista.localeCompare(b.dataPrevista),
  );

  return (
    <section style={{ marginTop: 24 }}>
      <h2>Candidats detectats</h2>
      <p style={{ fontSize: 12, color: '#555' }}>
        Patrons detectats automàticament sobre l'històric de moviments de compte corrent. Corregeix-ne els valors si cal abans de confirmar,
        o ignora'ls si és una falsa alarma (no es tornaran a suggerir).
      </p>
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
            <th style={{ ...cellStyle, ...cellOrigen }}>Detecció</th>
            <th style={{ ...cellStyle, ...cellReferencia }}>Referència</th>
            <th style={{ ...cellStyle, ...cellAccions }}></th>
          </tr>
        </thead>
        <tbody>
          {ordenats.map((c) => {
            const esborrany = esborranyPer(c);
            const k = clau(c);
            return (
              <tr key={k}>
                <td style={{ ...cellStyle, ...cellCompte }}>{compteAlias.get(c.compteId) ?? c.compteId}</td>
                <td style={{ ...cellStyle, ...cellPeriodicitat }}>
                  <select value={esborrany.periodicitat} onChange={(e) => actualitzaEsborrany(c, { periodicitat: e.target.value as PeriodicitatRecurrent })}>
                    {PERIODICITATS_REPETITIVES.map((p) => (
                      <option key={p} value={p}>
                        {PERIODICITAT_LABEL[p]}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={{ ...cellStyle, ...cellData }}>
                  <input type="date" value={esborrany.dataPrevista} onChange={(e) => actualitzaEsborrany(c, { dataPrevista: e.target.value })} />
                </td>
                <td style={{ ...cellStyle, ...cellData }}>
                  <input type="date" value={esborrany.dataFi} onChange={(e) => actualitzaEsborrany(c, { dataFi: e.target.value })} />
                </td>
                <td style={{ ...cellStyle, ...cellConcepte }}>
                  <input value={esborrany.concepte} onChange={(e) => actualitzaEsborrany(c, { concepte: e.target.value })} style={{ width: '100%' }} />
                </td>
                <td style={{ ...cellStyle, ...cellImport }}>
                  <input
                    type="number"
                    step="0.01"
                    value={esborrany.importEuros}
                    onChange={(e) => actualitzaEsborrany(c, { importEuros: e.target.value })}
                    style={{ width: 70, textAlign: 'right' }}
                  />
                  <label title="L'import és una estimació, no un valor cert">
                    <input
                      type="checkbox"
                      checked={esborrany.importAproximat}
                      onChange={(e) => actualitzaEsborrany(c, { importAproximat: e.target.checked })}
                    />{' '}
                    aprox.
                  </label>
                </td>
                <td style={{ ...cellStyle, ...cellCategoria }}>
                  <select value={esborrany.categoriaId} onChange={(e) => actualitzaEsborrany(c, { categoriaId: e.target.value })}>
                    <option value="">--</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.nom}
                      </option>
                    ))}
                  </select>
                </td>
                <td
                  style={{ ...cellStyle, ...cellOrigen }}
                  title={`${c.ocurrencies} ocurrències detectades, rang ${centsToEs(c.importMinCents, false)}..${centsToEs(c.importMaxCents, false)}, confiança ${c.confianca}%`}
                >
                  {c.ocurrencies} oc., {c.confianca}%
                </td>
                <td style={{ ...cellStyle, ...cellReferencia }}>
                  <input
                    value={esborrany.referencia}
                    onChange={(e) => actualitzaEsborrany(c, { referencia: e.target.value })}
                    style={{ width: 80 }}
                  />
                </td>
                <td style={{ ...cellStyle, ...cellAccions }}>
                  <button onClick={() => handleConfirma(c)} disabled={ocupat === k}>
                    Confirmar
                  </button>{' '}
                  <button onClick={() => handleIgnora(c)} disabled={ocupat === k}>
                    Ignorar
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
