import { useState } from 'react';
import { eliminaRecurrent } from '../api/client';
import type { Compte, Recurrent } from '../api/types';
import { centsToEs } from '../lib/numbers';

interface Props {
  recurrents: Recurrent[];
  comptes: Compte[];
  onChanged: () => void;
}

const PERIODICITAT_LABEL: Record<Recurrent['periodicitat'], string> = {
  unica: 'Puntual',
  setmanal: 'Setmanal',
  mensual: 'Mensual',
  bimestral: 'Bimestral',
  trimestral: 'Trimestral',
  semestral: 'Semestral',
  anual: 'Anual',
};

/** Llistat de consulta dels recurrents ja confirmats (manuals o importats). La pantalla de revisió de candidats detectats arriba amb la sub-fase 3.4. */
export function RecurrentsList({ recurrents, comptes, onChanged }: Props) {
  const [eliminant, setEliminant] = useState<string | null>(null);
  const compteAlias = new Map(comptes.map((c) => [c.id, c.alias]));

  async function handleElimina(id: string) {
    if (!confirm('Eliminar aquest compromís?')) return;
    setEliminant(id);
    try {
      await eliminaRecurrent(id);
      onChanged();
    } finally {
      setEliminant(null);
    }
  }

  if (recurrents.length === 0) {
    return (
      <section style={{ marginTop: 24 }}>
        <h2>Compromisos confirmats</h2>
        <p style={{ fontSize: '0.9em', color: '#555' }}>Encara no hi ha cap compromís confirmat.</p>
      </section>
    );
  }

  const ordenats = [...recurrents].sort((a, b) => a.dataPrevista.localeCompare(b.dataPrevista));

  return (
    <section style={{ marginTop: 24 }}>
      <h2>Compromisos confirmats</h2>
      <table style={{ borderCollapse: 'collapse', fontSize: '0.9em' }}>
        <thead>
          <tr>
            <th style={cellStyle}>Data</th>
            <th style={cellStyle}>Concepte</th>
            <th style={{ ...cellStyle, textAlign: 'right' }}>Import</th>
            <th style={cellStyle}>Compte</th>
            <th style={cellStyle}>Periodicitat</th>
            <th style={cellStyle}>Origen</th>
            <th style={cellStyle}>Referència</th>
            <th style={cellStyle}></th>
          </tr>
        </thead>
        <tbody>
          {ordenats.map((r) => (
            <tr key={r.id}>
              <td style={cellStyle}>{r.dataPrevista}</td>
              <td style={cellStyle}>{r.concepte}</td>
              <td style={{ ...cellStyle, textAlign: 'right' }}>{centsToEs(r.importCents, false)}</td>
              <td style={cellStyle}>{compteAlias.get(r.compteId) ?? r.compteId}</td>
              <td style={cellStyle}>{PERIODICITAT_LABEL[r.periodicitat]}</td>
              <td style={cellStyle}>{r.origen}</td>
              <td style={cellStyle}>{r.referencia ?? '—'}</td>
              <td style={cellStyle}>
                <button onClick={() => handleElimina(r.id)} disabled={eliminant === r.id} title="Eliminar">
                  X
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const cellStyle: React.CSSProperties = { border: '1px solid #ccc', padding: '2px 6px' };
