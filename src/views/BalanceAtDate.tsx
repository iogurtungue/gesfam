import { useEffect, useMemo, useState } from 'react';
import { saldoEnData } from '../lib/balance';
import { avui } from '../lib/dates';
import { centsToEs } from '../lib/numbers';
import { listMovimentsPerComptes } from '../db/operations';
import type { Compte, Moviment } from '../db/types';

interface Props {
  seleccionats: Compte[];
}

/** Spec 3.5: "foto" dels saldos de cada compte seleccionat en una data concreta, per comparar posicions de tresoreria. */
export function BalanceAtDate({ seleccionats }: Props) {
  const [moviments, setMoviments] = useState<Moviment[]>([]);
  const [data, setData] = useState(avui());

  useEffect(() => {
    listMovimentsPerComptes(seleccionats.map((c) => c.id)).then(setMoviments);
  }, [seleccionats]);

  const files = useMemo(
    () =>
      seleccionats.map((compte) => {
        const propis = moviments.filter((m) => m.compteId === compte.id);
        return { compte, saldo: saldoEnData(propis, compte.tipus, data) };
      }),
    [seleccionats, moviments, data],
  );

  const total = files.reduce((sum, f) => sum + (f.saldo ?? 0), 0);

  return (
    <section>
      <h2>Saldos a una data</h2>
      <label>
        Data: <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
      </label>
      {seleccionats.length === 0 ? (
        <p>Selecciona algun compte per veure els saldos.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', marginTop: 8 }}>
          <thead>
            <tr>
              <th style={cellStyle}>Compte</th>
              <th style={{ ...cellStyle, textAlign: 'right' }}>Saldo el {data}</th>
            </tr>
          </thead>
          <tbody>
            {files.map(({ compte, saldo }) => (
              <tr key={compte.id}>
                <td style={cellStyle}>{compte.alias}</td>
                <td style={{ ...cellStyle, textAlign: 'right' }}>{saldo !== null ? centsToEs(saldo, false) : 'sense dades'}</td>
              </tr>
            ))}
            <tr>
              <td style={{ ...cellStyle, fontWeight: 'bold' }}>Total consolidat</td>
              <td style={{ ...cellStyle, fontWeight: 'bold', textAlign: 'right' }}>{centsToEs(total, false)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </section>
  );
}

const cellStyle: React.CSSProperties = { border: '1px solid #ccc', padding: '2px 6px' };
