import { useState } from 'react';
import { creaRecurrentManual } from '../api/client';
import type { Categoria, Compte, PeriodicitatRecurrent } from '../api/types';
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
  cellTI,
  inputCompletCella,
} from '../lib/recurrentsTable';

interface Props {
  comptes: Compte[];
  categories: Categoria[];
  onChanged: () => void;
}

/** Afegir manualment un recurrent (spec 4.1.5), p. ex. un rebut anual o una subscripció. Mateix format de columnes (i amplades) que RecurrentsList. */
export function RecurrentManualForm({ comptes, categories, onChanged }: Props) {
  const [compteId, setCompteId] = useState(comptes[0]?.id ?? '');
  const [concepte, setConcepte] = useState('');
  const [periodicitat, setPeriodicitat] = useState<PeriodicitatRecurrent>('mensual');
  const [importEuros, setImportEuros] = useState('');
  const [importAproximat, setImportAproximat] = useState(false);
  const [dataPrevista, setDataPrevista] = useState('');
  const [dataFi, setDataFi] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [referencia, setReferencia] = useState('');
  const [esTransferenciaInterna, setEsTransferenciaInterna] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAfegeix() {
    setError(null);
    const importCents = Math.round(parseFloat(importEuros.replace(',', '.')) * 100);
    if (!compteId || concepte.trim() === '' || !dataPrevista || Number.isNaN(importCents)) {
      setError('Omple almenys el compte, el concepte, l’import i la data.');
      return;
    }
    setBusy(true);
    try {
      await creaRecurrentManual({
        compteId,
        concepte: concepte.trim(),
        periodicitat,
        importCents,
        importAproximat,
        dataPrevista,
        dataFi: dataFi || undefined,
        categoriaId: categoriaId || undefined,
        referencia: referencia.trim() || undefined,
        esTransferenciaInterna,
      });
      setConcepte('');
      setImportEuros('');
      setImportAproximat(false);
      setDataPrevista('');
      setDataFi('');
      setReferencia('');
      setEsTransferenciaInterna(false);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ marginTop: 24 }}>
      <h2>Afegir un recurrent manualment</h2>
      <p style={{ fontSize: 12, color: '#555' }}>Compromís periòdic o puntual, p. ex. un rebut anual o una subscripció.</p>
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
            <th style={{ ...cellStyle, ...cellTI }}>TI</th>
            <th style={{ ...cellStyle, ...cellOrigen }}>Origen</th>
            <th style={{ ...cellStyle, ...cellReferencia }}>Referència</th>
            <th style={{ ...cellStyle, ...cellAccions }}></th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ ...cellStyle, ...cellCompte }}>
              <select value={compteId} onChange={(e) => setCompteId(e.target.value)}>
                {comptes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.alias}
                  </option>
                ))}
              </select>
            </td>
            <td style={{ ...cellStyle, ...cellPeriodicitat }}>
              <select value={periodicitat} onChange={(e) => setPeriodicitat(e.target.value as PeriodicitatRecurrent)}>
                {TOTES_LES_PERIODICITATS.map((p) => (
                  <option key={p} value={p}>
                    {PERIODICITAT_LABEL[p]}
                  </option>
                ))}
              </select>
            </td>
            <td style={{ ...cellStyle, ...cellData }}>
              <input type="date" value={dataPrevista} onChange={(e) => setDataPrevista(e.target.value)} />
            </td>
            <td style={{ ...cellStyle, ...cellData }} title="Última ocurrència esperada, opcional">
              <input type="date" value={dataFi} onChange={(e) => setDataFi(e.target.value)} />
            </td>
            <td style={{ ...cellStyle, ...cellConcepte }}>
              <input value={concepte} onChange={(e) => setConcepte(e.target.value)} style={inputCompletCella} />
            </td>
            <td style={{ ...cellStyle, ...cellImport }}>
              <input type="number" step="0.01" value={importEuros} onChange={(e) => setImportEuros(e.target.value)} style={{ width: 70, textAlign: 'right' }} />
              <label title="L'import és una estimació, no un valor cert">
                <input type="checkbox" checked={importAproximat} onChange={(e) => setImportAproximat(e.target.checked)} /> aprox.
              </label>
            </td>
            <td style={{ ...cellStyle, ...cellCategoria }}>
              <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
                <option value="">--</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nom}
                  </option>
                ))}
              </select>
            </td>
            <td style={{ ...cellStyle, ...cellTI }}>
              <input type="checkbox" checked={esTransferenciaInterna} onChange={(e) => setEsTransferenciaInterna(e.target.checked)} />
            </td>
            <td style={{ ...cellStyle, ...cellOrigen }}>Manual</td>
            <td style={{ ...cellStyle, ...cellReferencia }}>
              <input value={referencia} onChange={(e) => setReferencia(e.target.value)} style={inputCompletCella} />
            </td>
            <td style={{ ...cellStyle, ...cellAccions }}>
              <button onClick={handleAfegeix} disabled={busy}>
                Afegir
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      {error && <p style={{ color: '#c00' }}>{error}</p>}
    </section>
  );
}
