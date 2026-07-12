import { useState } from 'react';
import { confirmaCandidatRecurrent, ignoraCandidatRecurrent } from '../api/client';
import type { CandidatRecurrent, Categoria, Compte, PeriodicitatRecurrent } from '../api/types';
import { centsToEs } from '../lib/numbers';
import { PERIODICITAT_LABEL, PERIODICITATS_REPETITIVES } from '../lib/periodicitat';

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
  };
}

/** Pantalla de revisió dels candidats detectats pel motor de periodicitat (sub-fase 3.4, especificacio.md 4.1.5): confirmar (amb possibles correccions), o ignorar (falsa alarma, no es torna a suggerir). */
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

  return (
    <section style={{ marginTop: 24 }}>
      <h2>Candidats detectats</h2>
      <p style={{ fontSize: 12, color: '#555' }}>
        Patrons detectats automàticament sobre l'històric de moviments de compte corrent. Corregeix-ne els valors si cal abans de confirmar,
        o ignora'ls si és una falsa alarma (no es tornaran a suggerir).
      </p>
      {candidats.map((c) => {
        const esborrany = esborranyPer(c);
        const k = clau(c);
        return (
          <div key={k} style={{ border: '1px solid #999', padding: 12, marginBottom: 12, fontSize: 12 }}>
            <div style={{ color: '#555', marginBottom: 6 }}>
              {compteAlias.get(c.compteId) ?? c.compteId} — {c.ocurrencies} ocurrències, rang {centsToEs(c.importMinCents, false)}..
              {centsToEs(c.importMaxCents, false)}, confiança {c.confianca}%
            </div>
            <label>
              Concepte: <input value={esborrany.concepte} onChange={(e) => actualitzaEsborrany(c, { concepte: e.target.value })} />
            </label>{' '}
            <label>
              Periodicitat:{' '}
              <select value={esborrany.periodicitat} onChange={(e) => actualitzaEsborrany(c, { periodicitat: e.target.value as PeriodicitatRecurrent })}>
                {PERIODICITATS_REPETITIVES.map((p) => (
                  <option key={p} value={p}>
                    {PERIODICITAT_LABEL[p]}
                  </option>
                ))}
              </select>
            </label>{' '}
            <label>
              Import:{' '}
              <input
                type="number"
                step="0.01"
                value={esborrany.importEuros}
                onChange={(e) => actualitzaEsborrany(c, { importEuros: e.target.value })}
                style={{ width: 70, textAlign: 'right' }}
              />
            </label>{' '}
            <label title="L'import és una estimació, no un valor cert">
              <input type="checkbox" checked={esborrany.importAproximat} onChange={(e) => actualitzaEsborrany(c, { importAproximat: e.target.checked })} />{' '}
              aprox.
            </label>{' '}
            <label>
              Propera data:{' '}
              <input type="date" value={esborrany.dataPrevista} onChange={(e) => actualitzaEsborrany(c, { dataPrevista: e.target.value })} />
            </label>{' '}
            <label title="Última ocurrència esperada, opcional">
              Data de finalització:{' '}
              <input type="date" value={esborrany.dataFi} onChange={(e) => actualitzaEsborrany(c, { dataFi: e.target.value })} />
            </label>{' '}
            <label>
              Categoria:{' '}
              <select value={esborrany.categoriaId} onChange={(e) => actualitzaEsborrany(c, { categoriaId: e.target.value })}>
                <option value="">--</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.nom}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ marginTop: 6 }}>
              <button onClick={() => handleConfirma(c)} disabled={ocupat === k}>
                Confirmar
              </button>{' '}
              <button onClick={() => handleIgnora(c)} disabled={ocupat === k}>
                Ignorar
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
