import { useState } from 'react';
import { creaRecurrentManual } from '../api/client';
import type { Categoria, Compte, PeriodicitatRecurrent } from '../api/types';
import { PERIODICITAT_LABEL, TOTES_LES_PERIODICITATS } from '../lib/periodicitat';

interface Props {
  comptes: Compte[];
  categories: Categoria[];
  onChanged: () => void;
}

/** Afegir manualment un recurrent que el motor de detecció no ha vist (spec 4.1.5), p. ex. un rebut anual amb una sola ocurrència a l'històric. */
export function RecurrentManualForm({ comptes, categories, onChanged }: Props) {
  const [compteId, setCompteId] = useState(comptes[0]?.id ?? '');
  const [concepte, setConcepte] = useState('');
  const [periodicitat, setPeriodicitat] = useState<PeriodicitatRecurrent>('mensual');
  const [importEuros, setImportEuros] = useState('');
  const [dataPrevista, setDataPrevista] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [referencia, setReferencia] = useState('');
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
        dataPrevista,
        categoriaId: categoriaId || undefined,
        referencia: referencia.trim() || undefined,
      });
      setConcepte('');
      setImportEuros('');
      setDataPrevista('');
      setReferencia('');
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
      <p style={{ fontSize: '0.9em', color: '#555' }}>Per a un recurrent que el motor de detecció encara no ha vist (p. ex. un rebut anual amb una sola ocurrència a l'històric).</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label>
          Compte:{' '}
          <select value={compteId} onChange={(e) => setCompteId(e.target.value)}>
            {comptes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.alias}
              </option>
            ))}
          </select>
        </label>
        <label>
          Concepte: <input value={concepte} onChange={(e) => setConcepte(e.target.value)} />
        </label>
        <label>
          Periodicitat:{' '}
          <select value={periodicitat} onChange={(e) => setPeriodicitat(e.target.value as PeriodicitatRecurrent)}>
            {TOTES_LES_PERIODICITATS.map((p) => (
              <option key={p} value={p}>
                {PERIODICITAT_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Import: <input type="number" step="0.01" value={importEuros} onChange={(e) => setImportEuros(e.target.value)} style={{ width: 80 }} />
        </label>
        <label>
          Data: <input type="date" value={dataPrevista} onChange={(e) => setDataPrevista(e.target.value)} />
        </label>
        <label>
          Categoria:{' '}
          <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
            <option value="">--</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nom}
              </option>
            ))}
          </select>
        </label>
        <label>
          Referència: <input value={referencia} onChange={(e) => setReferencia(e.target.value)} style={{ width: 100 }} />
        </label>
        <button onClick={handleAfegeix} disabled={busy}>
          Afegir
        </button>
      </div>
      {error && <p style={{ color: '#c00' }}>{error}</p>}
    </section>
  );
}
