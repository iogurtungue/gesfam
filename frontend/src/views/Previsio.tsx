import { Fragment, useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { calculaPrevisio } from '../api/client';
import type { Categoria, Compte, Previsio as PrevisioResultat } from '../api/types';
import { formatDateEs } from '../lib/dates';
import { centsToEs } from '../lib/numbers';

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

  // Saldo projectat de cada compte "en aquell moment" (una passada lineal, en
  // el mateix ordre cronològic que ja retorna el backend): com que els
  // esdeveniments ja venen ordenats per data, acumular-los d'un en un dona
  // directament, per a QUALSEVOL compte de la selecció (no només el propi de
  // la fila), el seu saldo projectat vigent en aquell punt — mateix efecte
  // que `consultaSaldoPerCompte` a MovimentsList, sense necessitat de
  // recalcular-ho amb una cerca per data.
  const files = useMemo(() => {
    const acumulat = { ...previsio.saldosInicials };
    return previsio.esdeveniments.map((e) => {
      acumulat[e.compteId] = (acumulat[e.compteId] ?? 0) + e.importCents;
      return { esdeveniment: e, saldoPerCompte: { ...acumulat } };
    });
  }, [previsio]);

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
        // Una columna d'Import/Saldo per compte seleccionat (mateix criteri
        // que la taula de Moviments): es veu de seguida quin compte rep cada
        // esdeveniment previst i com evoluciona el saldo projectat de tots
        // els comptes en paral·lel, no només el que té el moviment.
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12, whiteSpace: 'nowrap', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ ...cellStyle, ...cellData }} rowSpan={2}>
                  Data
                </th>
                <th style={{ ...cellStyle, ...cellConcepte }} rowSpan={2}>
                  Concepte
                </th>
                <th style={{ ...cellStyle, ...cellCategoria }} rowSpan={2}>
                  Categoria
                </th>
                {seleccionats.map((c) => (
                  <th key={c.id} style={cellStyle} colSpan={2}>
                    {c.alias}
                  </th>
                ))}
              </tr>
              <tr>
                {seleccionats.map((c) => (
                  <Fragment key={c.id}>
                    <th style={{ ...cellStyle, ...cellNumeric }}>Import</th>
                    <th style={{ ...cellStyle, ...cellNumeric }}>Saldo</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {files.map(({ esdeveniment: e, saldoPerCompte }) => (
                <tr key={`${e.recurrentId}-${e.data}`}>
                  <td style={{ ...cellStyle, ...cellData }}>{formatDateEs(e.data)}</td>
                  <td style={{ ...cellStyle, ...cellConcepte }}>{e.concepte}</td>
                  <td style={{ ...cellStyle, ...cellCategoria }}>{e.categoriaId ? (categoriaNom.get(e.categoriaId) ?? '—') : '—'}</td>
                  {seleccionats.map((c) => {
                    const saldo = saldoPerCompte[c.id];
                    if (c.id === e.compteId) {
                      return (
                        <Fragment key={c.id}>
                          <td style={{ ...cellStyle, ...cellNumeric, ...colorImport(e.importCents) }}>{centsToEs(e.importCents, false)}</td>
                          <td style={{ ...cellStyle, ...cellNumeric, fontWeight: 'bold' }}>{saldo !== undefined ? centsToEs(saldo, false) : '—'}</td>
                        </Fragment>
                      );
                    }
                    return (
                      <Fragment key={c.id}>
                        <td style={cellStyle} />
                        <td style={{ ...cellStyle, ...cellNumeric, color: '#999' }}>{saldo !== undefined ? centsToEs(saldo, false) : ''}</td>
                      </Fragment>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function colorImport(cents: number): React.CSSProperties {
  return cents < 0 ? { color: '#c00' } : {};
}

const cellStyle: React.CSSProperties = { border: '1px solid #ccc', padding: '2px 6px' };

function amplaFixa(px: number): React.CSSProperties {
  return { width: px, minWidth: px, maxWidth: px, boxSizing: 'border-box', overflow: 'hidden' };
}

const cellData: React.CSSProperties = amplaFixa(80);
const cellConcepte: React.CSSProperties = { whiteSpace: 'normal', overflowWrap: 'break-word', maxWidth: 220 };
const cellCategoria: React.CSSProperties = amplaFixa(150);
const cellNumeric: React.CSSProperties = { ...amplaFixa(80), textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
