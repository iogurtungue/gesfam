import { useState } from 'react';
import { confirmaImportacioRecurrents, previsualitzaImportacioRecurrents } from '../api/client';
import type { Compte, ParsedRecurrentImport } from '../api/types';
import { centsToEs } from '../lib/numbers';

interface Props {
  comptes: Compte[];
  onChanged: () => void;
}

/** Sub-fase 3.2 (especificacio.md 4.2): importar compromisos confirmats (p. ex. factures de proveïdor amb import i venciment coneguts) des d'un Excel de format fix, un compte per importació. */
export function RecurrentsImportWizard({ comptes, onChanged }: Props) {
  const [compteId, setCompteId] = useState(comptes[0]?.id ?? '');
  const [fileName, setFileName] = useState<string | null>(null);
  const [recurrents, setRecurrents] = useState<ParsedRecurrentImport[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [summary, setSummary] = useState<{ nous: number; duplicats: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    setError(null);
    setSummary(null);
    setFileName(file.name);
    setRecurrents([]);
    setWarnings([]);
    try {
      const result = await previsualitzaImportacioRecurrents(file);
      setRecurrents(result.recurrents);
      setWarnings(result.warnings);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      const result = await confirmaImportacioRecurrents(compteId, recurrents);
      setSummary(result);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ marginTop: 24 }}>
      <h2>Importar compromisos confirmats</h2>
      <p style={{ fontSize: 12, color: '#555' }}>
        Factures o altres compromisos amb import i data de venciment ja coneguts (no estimats). Excel amb columnes: Data de venciment,
        Concepte, Import, i opcionalment Categoria i Referència.
      </p>
      <label>
        Compte:{' '}
        <select value={compteId} onChange={(e) => setCompteId(e.target.value)}>
          {comptes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.alias}
            </option>
          ))}
        </select>
      </label>{' '}
      <input type="file" accept=".xlsx,.xls" onChange={(e) => handleFile(e.target.files)} disabled={!compteId} />

      {error && <p style={{ color: '#c00' }}>{error}</p>}

      {fileName && !summary && (recurrents.length > 0 || warnings.length > 0) && (
        <div style={{ border: '1px solid #999', padding: 12, marginTop: 12 }}>
          <strong>{fileName}</strong>
          <p>
            {recurrents.length} files interpretades{warnings.length > 0 && `, ${warnings.length} no interpretables`}.
          </p>
          {recurrents.length > 0 && (
            <>
              <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                <thead>
                  <tr>
                    <th style={cellStyle}>Venciment</th>
                    <th style={cellStyle}>Concepte</th>
                    <th style={{ ...cellStyle, textAlign: 'right' }}>Import</th>
                    <th style={cellStyle}>Categoria</th>
                    <th style={cellStyle}>Referència</th>
                  </tr>
                </thead>
                <tbody>
                  {recurrents.slice(0, 15).map((r, i) => (
                    <tr key={i}>
                      <td style={cellStyle}>{r.dataPrevista}</td>
                      <td style={cellStyle}>{r.concepte}</td>
                      <td style={{ ...cellStyle, textAlign: 'right' }}>{centsToEs(r.importCents, false)}</td>
                      <td style={cellStyle}>{r.categoriaNom ?? '—'}</td>
                      <td style={cellStyle}>{r.referencia ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {recurrents.length > 15 && <p>... i {recurrents.length - 15} més.</p>}
            </>
          )}
          {warnings.length > 0 && (
            <ul>
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          {recurrents.length > 0 && (
            <button onClick={handleConfirm} disabled={busy || !compteId}>
              Confirmar importació
            </button>
          )}
        </div>
      )}

      {summary && (
        <div style={{ border: '1px solid #2a2', padding: 12, marginTop: 12 }}>
          <strong>{fileName}</strong>: {summary.nous} compromisos nous, {summary.duplicats} duplicats ignorats.
        </div>
      )}
    </section>
  );
}

const cellStyle: React.CSSProperties = { border: '1px solid #ccc', padding: '2px 6px' };
