import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { calculaPrevisio } from '../api/client';
import type { Categoria, Compte, Previsio as PrevisioResultat } from '../api/types';
import { formatDateEs } from '../lib/dates';
import { centsToEs } from '../lib/numbers';
import { cellCategoria, cellCompte, cellConcepte, cellData, cellImport, cellStyle } from '../lib/recurrentsTable';

interface Props {
  seleccionats: Compte[];
  categories: Categoria[];
}

const HORITZONS_PREDEFINITS = [30, 60, 90];

const PREVISIO_BUIDA: PrevisioResultat = { saldosInicials: {}, esdeveniments: [], serieDiaria: [] };

export function Previsio({ seleccionats, categories }: Props) {
  const [horitzoDies, setHoritzoDies] = useState(30);
  const [previsio, setPrevisio] = useState<PrevisioResultat>(PREVISIO_BUIDA);

  const compteIds = useMemo(() => seleccionats.map((c) => c.id), [seleccionats]);
  const compteAlias = useMemo(() => new Map(seleccionats.map((c) => [c.id, c.alias])), [seleccionats]);
  const categoriaNom = useMemo(() => new Map(categories.map((c) => [c.id, c.nom])), [categories]);

  useEffect(() => {
    if (compteIds.length === 0 || horitzoDies <= 0) {
      setPrevisio(PREVISIO_BUIDA);
      return;
    }
    calculaPrevisio(compteIds, horitzoDies).then(setPrevisio);
  }, [compteIds, horitzoDies]);

  const evolucio = useMemo(
    () => previsio.serieDiaria.map((p) => ({ dataLabel: formatDateEs(p.data), saldo: p.saldoTotal / 100 })),
    [previsio.serieDiaria],
  );

  if (seleccionats.length === 0) {
    return (
      <section>
        <h2>Previsió</h2>
        <p>Selecciona algun compte per veure'n la previsió.</p>
      </section>
    );
  }

  return (
    <section>
      <h2>Previsió</h2>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <span>Horitzó:</span>
        {HORITZONS_PREDEFINITS.map((dies) => (
          <button
            key={dies}
            onClick={() => setHoritzoDies(dies)}
            style={{ fontWeight: horitzoDies === dies ? 'bold' : 'normal' }}
          >
            {dies} dies
          </button>
        ))}
        <label>
          Altres:{' '}
          <input
            type="number"
            min={1}
            value={horitzoDies}
            onChange={(e) => setHoritzoDies(Math.max(1, Math.round(Number(e.target.value)) || 1))}
            style={{ width: 60 }}
          />{' '}
          dies
        </label>
      </div>

      {evolucio.length > 1 && (
        <div style={{ width: '100%', height: 300, marginBottom: 24 }}>
          <ResponsiveContainer>
            <LineChart data={evolucio}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="dataLabel" />
              <YAxis />
              <Tooltip formatter={(value) => `${Number(value).toFixed(2)} €`} />
              <Line type="stepAfter" dataKey="saldo" name="Saldo projectat" dot={false} stroke="#2a6" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <h3>Moviments previstos</h3>
      {previsio.esdeveniments.length === 0 ? (
        <p style={{ fontSize: 12, color: '#555' }}>Cap moviment previst en aquest horitzó.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
          <thead>
            <tr>
              <th style={{ ...cellStyle, ...cellData }}>Data</th>
              <th style={{ ...cellStyle, ...cellCompte }}>Compte</th>
              <th style={{ ...cellStyle, ...cellConcepte }}>Concepte</th>
              <th style={{ ...cellStyle, ...cellImport }}>Import</th>
              <th style={{ ...cellStyle, ...cellCategoria }}>Categoria</th>
            </tr>
          </thead>
          <tbody>
            {previsio.esdeveniments.map((e) => (
              <tr key={`${e.recurrentId}-${e.data}`}>
                <td style={{ ...cellStyle, ...cellData }}>{formatDateEs(e.data)}</td>
                <td style={{ ...cellStyle, ...cellCompte }}>{compteAlias.get(e.compteId) ?? e.compteId}</td>
                <td style={{ ...cellStyle, ...cellConcepte }}>{e.concepte}</td>
                <td style={{ ...cellStyle, ...cellImport }}>{centsToEs(e.importCents, false)}</td>
                <td style={{ ...cellStyle, ...cellCategoria }}>{e.categoriaId ? (categoriaNom.get(e.categoriaId) ?? '—') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
