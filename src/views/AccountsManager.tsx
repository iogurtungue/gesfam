import { useEffect, useState } from 'react';
import { bankLabel } from '../lib/bankLabel';
import { countMovimentsCompte, eliminaCompte, renombraCompte } from '../db/operations';
import type { Compte } from '../db/types';

interface Props {
  comptes: Compte[];
  onChanged: () => void;
}

/** Gestió de comptes: editar l'àlies i eliminar comptes sense moviments associats. */
export function AccountsManager({ comptes, onChanged }: Props) {
  const [comptatges, setComptatges] = useState<Record<string, number>>({});
  const [editant, setEditant] = useState<string | null>(null);
  const [aliesEdicio, setAliesEdicio] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all(comptes.map(async (c) => [c.id, await countMovimentsCompte(c.id)] as const)).then((entrades) =>
      setComptatges(Object.fromEntries(entrades)),
    );
  }, [comptes]);

  function iniciaEdicio(c: Compte) {
    setEditant(c.id);
    setAliesEdicio(c.alias);
    setError(null);
  }

  async function desaEdicio(compteId: string) {
    const nom = aliesEdicio.trim();
    if (nom) await renombraCompte(compteId, nom);
    setEditant(null);
    onChanged();
  }

  async function handleElimina(compteId: string) {
    if (!confirm('Eliminar aquest compte? Aquesta acció no es pot desfer.')) return;
    setError(null);
    try {
      await eliminaCompte(compteId);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section>
      <h2>Comptes</h2>
      {error && <p style={{ color: '#c00' }}>{error}</p>}
      {comptes.length === 0 ? (
        <p>Encara no hi ha cap compte. Importa un extracte per crear-ne un.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={cellStyle}>Àlies</th>
              <th style={cellStyle}>Banc</th>
              <th style={cellStyle}>Tipus</th>
              <th style={cellStyle}>Número</th>
              <th style={cellStyle}>Moviments</th>
              <th style={cellStyle} />
            </tr>
          </thead>
          <tbody>
            {comptes.map((c) => {
              const nMoviments = comptatges[c.id];
              const potEliminar = nMoviments === 0;
              return (
                <tr key={c.id}>
                  <td style={cellStyle}>
                    {editant === c.id ? (
                      <>
                        <input value={aliesEdicio} onChange={(e) => setAliesEdicio(e.target.value)} autoFocus />{' '}
                        <button onClick={() => desaEdicio(c.id)}>Desa</button>{' '}
                        <button onClick={() => setEditant(null)}>Cancel·la</button>
                      </>
                    ) : (
                      <>
                        {c.alias} <button onClick={() => iniciaEdicio(c)}>Edita</button>
                      </>
                    )}
                  </td>
                  <td style={cellStyle}>{bankLabel(c.banc)}</td>
                  <td style={cellStyle}>{c.tipus === 'targeta' ? 'Targeta' : 'Compte corrent'}</td>
                  <td style={cellStyle}>{c.ibanOUltimsDigits ?? '—'}</td>
                  <td style={cellStyle}>{nMoviments ?? '…'}</td>
                  <td style={cellStyle}>
                    <button
                      onClick={() => handleElimina(c.id)}
                      disabled={!potEliminar}
                      title={potEliminar ? undefined : 'No es pot eliminar: té moviments associats'}
                    >
                      Elimina
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

const cellStyle: React.CSSProperties = { border: '1px solid #ccc', padding: '4px 8px' };
