import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { saldoEnData } from '../lib/balance';
import { avui, formatDateEs } from '../lib/dates';
import { centsToEs } from '../lib/numbers';
import { listMovimentsPerComptes } from '../db/operations';
import type { Compte, Moviment } from '../db/types';

const DIES_AVIS_DESACTUALITZAT = 10;

function diesEntre(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);
}

interface Props {
  seleccionats: Compte[];
}

export function Dashboard({ seleccionats }: Props) {
  const [moviments, setMoviments] = useState<Moviment[]>([]);

  useEffect(() => {
    listMovimentsPerComptes(seleccionats.map((c) => c.id)).then(setMoviments);
  }, [seleccionats]);

  const perCompteId = useMemo(() => {
    const map = new Map<string, Moviment[]>();
    for (const m of moviments) {
      const arr = map.get(m.compteId) ?? [];
      arr.push(m);
      map.set(m.compteId, arr);
    }
    return map;
  }, [moviments]);

  const filesCompte = useMemo(
    () =>
      seleccionats.map((compte) => {
        const propis = perCompteId.get(compte.id) ?? [];
        const saldoActual = saldoEnData(propis, compte.tipus, avui());
        const ultimMoviment = propis.reduce<string | null>(
          (max, m) => (max === null || m.dataOperacio > max ? m.dataOperacio : max),
          null,
        );
        const diesDesactualitzat = ultimMoviment ? diesEntre(ultimMoviment, avui()) : null;
        return { compte, saldoActual, ultimMoviment, diesDesactualitzat };
      }),
    [seleccionats, perCompteId],
  );

  const totalConsolidat = filesCompte.reduce((sum, f) => sum + (f.saldoActual ?? 0), 0);

  const evolucio = useMemo(() => {
    const dates = [...new Set(moviments.map((m) => m.dataOperacio))].sort();
    return dates.map((data) => ({
      data,
      dataLabel: formatDateEs(data),
      saldo:
        seleccionats.reduce((sum, compte) => sum + (saldoEnData(perCompteId.get(compte.id) ?? [], compte.tipus, data) ?? 0), 0) /
        100,
    }));
  }, [moviments, seleccionats, perCompteId]);

  return (
    <section>
      <h2>Panell general</h2>
      {seleccionats.length === 0 ? (
        <p>Selecciona algun compte per veure'n el resum.</p>
      ) : (
        <>
          <table style={{ borderCollapse: 'collapse', marginBottom: 12 }}>
            <thead>
              <tr>
                <th style={cellStyle}>Compte</th>
                <th style={{ ...cellStyle, textAlign: 'right' }}>Saldo</th>
                <th style={cellStyle}>Últim moviment</th>
              </tr>
            </thead>
            <tbody>
              {filesCompte.map(({ compte, saldoActual, ultimMoviment, diesDesactualitzat }) => (
                <tr key={compte.id}>
                  <td style={cellStyle}>
                    {compte.alias} {compte.tipus === 'targeta' && '(deute targeta)'}
                  </td>
                  <td style={{ ...cellStyle, textAlign: 'right' }}>{saldoActual !== null ? centsToEs(saldoActual, false) : '—'}</td>
                  <td style={cellStyle}>
                    {ultimMoviment ? formatDateEs(ultimMoviment) : '—'}
                    {diesDesactualitzat !== null && diesDesactualitzat > DIES_AVIS_DESACTUALITZAT && (
                      <span style={{ color: '#c00' }}> (fa {diesDesactualitzat} dies)</span>
                    )}
                  </td>
                </tr>
              ))}
              <tr>
                <td style={{ ...cellStyle, fontWeight: 'bold' }}>Total consolidat</td>
                <td style={{ ...cellStyle, fontWeight: 'bold', textAlign: 'right' }}>{centsToEs(totalConsolidat, false)}</td>
                <td style={cellStyle} />
              </tr>
            </tbody>
          </table>

          {evolucio.length > 1 && (
            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer>
                <LineChart data={evolucio}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="dataLabel" />
                  <YAxis />
                  <Tooltip formatter={(value) => `${Number(value).toFixed(2)} €`} />
                  <Line type="stepAfter" dataKey="saldo" name="Saldo consolidat" dot={false} stroke="#2a6" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </section>
  );
}

const cellStyle: React.CSSProperties = { border: '1px solid #ccc', padding: '2px 6px' };
