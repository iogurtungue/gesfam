import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { actualitzaRecurrent, calculaPrevisio, eliminaOcurrenciaPrevista, listRecurrents } from '../api/client';
import type { Categoria, Compte, PeriodicitatRecurrent, Previsio as PrevisioResultat, Recurrent } from '../api/types';
import { formatDateEs } from '../lib/dates';
import { centsToEs } from '../lib/numbers';
import { PERIODICITAT_LABEL, TOTES_LES_PERIODICITATS } from '../lib/periodicitat';
import { esborranyAPayload, esborranyDe, type EsborranyEdicio } from '../lib/recurrentEdit';
import { inputCompletCella } from '../lib/recurrentsTable';

type FiltreTipus = 'tots' | 'ingres' | 'carrec';
type FiltreTI = 'tots' | 'nomes' | 'exclou';

interface Props {
  seleccionats: Compte[];
  categories: Categoria[];
}

const HORITZONS_PREDEFINITS = [30, 60, 90];

const PREVISIO_BUIDA: PrevisioResultat = { saldosInicials: {}, esdeveniments: [], serieDiaria: [] };

export function Previsio({ seleccionats, categories }: Props) {
  const [horitzoDies, setHoritzoDies] = useState(30);
  const [previsio, setPrevisio] = useState<PrevisioResultat>(PREVISIO_BUIDA);
  const [recurrents, setRecurrents] = useState<Recurrent[]>([]);
  const [categoriaFiltre, setCategoriaFiltre] = useState('');
  const [tipus, setTipus] = useState<FiltreTipus>('tots');
  const [filtreTI, setFiltreTI] = useState<FiltreTI>('tots');
  const [text, setText] = useState('');
  const [editant, setEditant] = useState<string | null>(null);
  const [esborrany, setEsborrany] = useState<EsborranyEdicio | null>(null);
  const [desant, setDesant] = useState(false);
  const [eliminant, setEliminant] = useState<string | null>(null);

  const compteIds = useMemo(() => seleccionats.map((c) => c.id), [seleccionats]);
  const categoriaNom = useMemo(() => new Map(categories.map((c) => [c.id, c.nom])), [categories]);
  const recurrentPerId = useMemo(() => new Map(recurrents.map((r) => [r.id, r])), [recurrents]);

  const refresh = useCallback(() => {
    listRecurrents().then(setRecurrents);
    if (compteIds.length === 0 || horitzoDies <= 0) {
      setPrevisio(PREVISIO_BUIDA);
      return;
    }
    calculaPrevisio(compteIds, horitzoDies).then(setPrevisio);
  }, [compteIds, horitzoDies]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function obreEdicio(recurrentId: string) {
    const r = recurrentPerId.get(recurrentId);
    if (!r) return;
    setEditant(recurrentId);
    setEsborrany(esborranyDe(r));
  }

  function tancaEdicio() {
    setEditant(null);
    setEsborrany(null);
  }

  async function handleDesa(recurrentId: string) {
    if (!esborrany) return;
    const payload = esborranyAPayload(esborrany);
    if (!payload) return;
    setDesant(true);
    try {
      await actualitzaRecurrent(recurrentId, payload);
      tancaEdicio();
      refresh();
    } finally {
      setDesant(false);
    }
  }

  async function handleTransferenciaChange(recurrentId: string, value: boolean) {
    await actualitzaRecurrent(recurrentId, { esTransferenciaInterna: value });
    refresh();
  }

  async function handleElimina(recurrentId: string, dataOcurrencia: string) {
    const periodic = recurrentPerId.get(recurrentId)?.periodicitat !== 'unica';
    const missatge = periodic
      ? 'Aquest recurrent és periòdic: en lloc d\'eliminar-lo, la propera repetició s\'avançarà al període següent. Continuar?'
      : 'Eliminar aquest recurrent puntual?';
    if (!confirm(missatge)) return;
    setEliminant(recurrentId);
    try {
      await eliminaOcurrenciaPrevista(recurrentId, dataOcurrencia);
      refresh();
    } finally {
      setEliminant(null);
    }
  }

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

  // Els filtres només decideixen quines files es mostren, mai recalculen el
  // saldo (ja calculat a `files` sobre TOTS els esdeveniments): mateix
  // criteri que MovimentsList, on el saldo mostrat és sempre el real
  // acumulat, independentment de quins moviments queden visibles.
  const filtrats = useMemo(() => {
    const textNormalitzat = text.trim().toUpperCase();
    return files.filter(({ esdeveniment: e }) => {
      if (categoriaFiltre && e.categoriaId !== categoriaFiltre) return false;
      if (tipus === 'ingres' && e.importCents < 0) return false;
      if (tipus === 'carrec' && e.importCents >= 0) return false;
      if (filtreTI === 'nomes' && !e.esTransferenciaInterna) return false;
      if (filtreTI === 'exclou' && e.esTransferenciaInterna) return false;
      if (textNormalitzat && !e.concepte.toUpperCase().includes(textNormalitzat)) return false;
      return true;
    });
  }, [files, categoriaFiltre, tipus, filtreTI, text]);

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

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <label>
          Categoria:{' '}
          <select value={categoriaFiltre} onChange={(e) => setCategoriaFiltre(e.target.value)}>
            <option value="">-- Totes --</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nom}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tipus:{' '}
          <select value={tipus} onChange={(e) => setTipus(e.target.value as FiltreTipus)}>
            <option value="tots">Tots</option>
            <option value="ingres">Ingressos</option>
            <option value="carrec">Càrrecs</option>
          </select>
        </label>
        <label>
          TI:{' '}
          <select value={filtreTI} onChange={(e) => setFiltreTI(e.target.value as FiltreTI)}>
            <option value="tots">Totes</option>
            <option value="nomes">Només TI</option>
            <option value="exclou">Sense TI</option>
          </select>
        </label>
        <label>
          Text: <input value={text} onChange={(e) => setText(e.target.value)} placeholder="cercar al concepte" />
        </label>
      </div>

      {previsio.esdeveniments.length === 0 ? (
        <p style={{ fontSize: 12, color: '#555' }}>Cap moviment previst en aquest horitzó.</p>
      ) : filtrats.length === 0 ? (
        <p style={{ fontSize: 12, color: '#555' }}>Cap moviment previst coincideix amb els filtres.</p>
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
                <th style={{ ...cellStyle, ...cellAccions }} rowSpan={2}></th>
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
              {filtrats.map(({ esdeveniment: e, saldoPerCompte }) => (
                <Fragment key={`${e.recurrentId}-${e.data}`}>
                  <tr style={e.vençut ? { background: '#fff3e0' } : undefined}>
                    <td style={{ ...cellStyle, ...cellData }}>{formatDateEs(e.data)}</td>
                    <td style={{ ...cellStyle, ...cellConcepte }}>
                      {e.concepte}
                      {e.vençut && (
                        <span
                          title="La data prevista original ja havia passat i encara no s'ha conciliat amb cap moviment real; es mostra desplaçada perquè no quedi fora de la previsió."
                          style={{ color: '#d90', marginLeft: 6, fontWeight: 'bold' }}
                        >
                          ⚠ vençut{e.dataPrevistaOriginal && ` (venciment: ${formatDateEs(e.dataPrevistaOriginal)})`}
                        </span>
                      )}
                    </td>
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
                    <td style={{ ...cellStyle, ...cellAccions }}>
                      <button onClick={() => (editant === e.recurrentId ? tancaEdicio() : obreEdicio(e.recurrentId))} title="Edita">
                        Edita
                      </button>{' '}
                      <button onClick={() => handleElimina(e.recurrentId, e.data)} disabled={eliminant === e.recurrentId} title="Eliminar">
                        X
                      </button>
                    </td>
                  </tr>
                  {editant === e.recurrentId && esborrany && (
                    <tr>
                      <td colSpan={4 + seleccionats.length * 2} style={{ ...cellStyle, background: '#f7f7f7' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <strong>Edita el recurrent:</strong>
                          <label>
                            Concepte:{' '}
                            <input
                              value={esborrany.concepte}
                              onChange={(ev) => setEsborrany({ ...esborrany, concepte: ev.target.value })}
                              style={{ ...inputCompletCella, width: 200 }}
                            />
                          </label>
                          <label>
                            Periodicitat:{' '}
                            <select
                              value={esborrany.periodicitat}
                              onChange={(ev) => setEsborrany({ ...esborrany, periodicitat: ev.target.value as PeriodicitatRecurrent })}
                            >
                              {TOTES_LES_PERIODICITATS.map((p) => (
                                <option key={p} value={p}>
                                  {PERIODICITAT_LABEL[p]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Data prevista:{' '}
                            <input
                              type="date"
                              value={esborrany.dataPrevista}
                              onChange={(ev) => setEsborrany({ ...esborrany, dataPrevista: ev.target.value })}
                            />
                          </label>
                          <label title="Última ocurrència esperada, opcional">
                            Data fi:{' '}
                            <input type="date" value={esborrany.dataFi} onChange={(ev) => setEsborrany({ ...esborrany, dataFi: ev.target.value })} />
                          </label>
                          <label>
                            Import:{' '}
                            <input
                              type="number"
                              step="0.01"
                              value={esborrany.importEuros}
                              onChange={(ev) => setEsborrany({ ...esborrany, importEuros: ev.target.value })}
                              style={{ width: 80, textAlign: 'right' }}
                            />
                          </label>
                          <label title="L'import és una estimació, no un valor cert">
                            <input
                              type="checkbox"
                              checked={esborrany.importAproximat}
                              onChange={(ev) => setEsborrany({ ...esborrany, importAproximat: ev.target.checked })}
                            />{' '}
                            aprox.
                          </label>
                          <label>
                            Categoria:{' '}
                            <select value={esborrany.categoriaId} onChange={(ev) => setEsborrany({ ...esborrany, categoriaId: ev.target.value })}>
                              <option value="">--</option>
                              {categories.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.nom}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Referència:{' '}
                            <input
                              value={esborrany.referencia}
                              onChange={(ev) => setEsborrany({ ...esborrany, referencia: ev.target.value })}
                              style={{ width: 100 }}
                            />
                          </label>
                          <label title="Transferència interna (moviment entre comptes propis)">
                            <input
                              type="checkbox"
                              checked={recurrentPerId.get(e.recurrentId)?.esTransferenciaInterna ?? false}
                              onChange={(ev) => handleTransferenciaChange(e.recurrentId, ev.target.checked)}
                            />{' '}
                            TI
                          </label>
                          <button onClick={() => handleDesa(e.recurrentId)} disabled={desant}>
                            Desa
                          </button>
                          <button onClick={tancaEdicio} disabled={desant}>
                            Cancel·la
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
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
const cellAccions: React.CSSProperties = { ...amplaFixa(110), textAlign: 'center', padding: '2px 4px' };
