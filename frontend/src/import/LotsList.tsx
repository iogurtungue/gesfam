import type { Compte, LotImportacio } from '../api/types';
import { undoLot } from '../api/client';

interface Props {
  lots: LotImportacio[];
  comptes: Compte[];
  onChanged: () => void;
}

export function LotsList({ lots, comptes, onChanged }: Props) {
  if (lots.length === 0) return null;

  async function handleUndo(lotId: string) {
    if (!confirm('Desfer aquesta importació? S\'eliminaran tots els moviments d\'aquest lot.')) return;
    await undoLot(lotId);
    onChanged();
  }

  return (
    <section>
      <h2>Lots d'importació</h2>
      <table style={{ borderCollapse: 'collapse', fontSize: '0.9em' }}>
        <thead>
          <tr>
            <th style={cellStyle}>Data importació</th>
            <th style={cellStyle}>Fitxer</th>
            <th style={cellStyle}>Compte</th>
            <th style={cellStyle}>Moviments</th>
            <th style={cellStyle}></th>
          </tr>
        </thead>
        <tbody>
          {[...lots].reverse().map((lot) => (
            <tr key={lot.id}>
              <td style={cellStyle}>{new Date(lot.data).toLocaleString('es-ES')}</td>
              <td style={cellStyle}>{lot.fitxerOrigen}</td>
              <td style={cellStyle}>{comptes.find((c) => c.id === lot.compteId)?.alias ?? lot.compteId}</td>
              <td style={cellStyle}>{lot.nombreMoviments}</td>
              <td style={cellStyle}>
                <button onClick={() => handleUndo(lot.id)}>Desfer</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const cellStyle: React.CSSProperties = { border: '1px solid #ccc', padding: '2px 6px' };
