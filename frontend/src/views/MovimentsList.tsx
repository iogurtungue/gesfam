import { Fragment, useEffect, useMemo, useState } from 'react';
import { creaConsultaSaldo } from '../lib/balance';
import { avui, formatDateEs } from '../lib/dates';
import { centsToEs } from '../lib/numbers';
import {
  aplicaReglesAMovimentsSenseCategoria,
  confirmaTransferencia,
  createRegla,
  listMovimentsPerComptes,
  setMovimentCategoria,
  setTransferenciaInterna,
  suggereixTransferencies,
} from '../api/client';
import type { Categoria, Compte, Moviment, ReglaCategoritzacio, SuggerimentAmbDetall } from '../api/types';

type FiltreTipus = 'tots' | 'ingres' | 'carrec';
type CampOrdre = 'dataOperacio' | 'concepteOriginal';

interface FormRegla {
  patro: string;
  categoriaId: string;
}

interface Props {
  seleccionats: Compte[];
  categories: Categoria[];
  regles: ReglaCategoritzacio[];
  onChanged: () => void;
}

function csvField(value: string): string {
  if (/[",\n;]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function MovimentsList({ seleccionats, categories, regles, onChanged }: Props) {
  const [moviments, setMoviments] = useState<Moviment[]>([]);
  const [dataDes, setDataDes] = useState('');
  const [dataFins, setDataFins] = useState('');
  const [categoriaFiltre, setCategoriaFiltre] = useState('');
  const [text, setText] = useState('');
  const [tipus, setTipus] = useState<FiltreTipus>('tots');
  const [ordre, setOrdre] = useState<{ camp: CampOrdre; direccio: 'asc' | 'desc' }>({ camp: 'dataOperacio', direccio: 'desc' });
  const [suggeriments, setSuggeriments] = useState<SuggerimentAmbDetall[]>([]);
  const [reglaObertaPer, setReglaObertaPer] = useState<string | null>(null);
  const [formRegla, setFormRegla] = useState<FormRegla | null>(null);
  const [errorRegla, setErrorRegla] = useState<string | null>(null);

  const compteIds = seleccionats.map((c) => c.id).join(',');
  const compteAlias = useMemo(() => {
    const map = new Map(seleccionats.map((c) => [c.id, c.alias]));
    return (compteId: string) => map.get(compteId) ?? compteId;
  }, [seleccionats]);
  const categoriaNom = useMemo(() => {
    const map = new Map(categories.map((c) => [c.id, c.nom]));
    return (categoriaId?: string) => (categoriaId ? (map.get(categoriaId) ?? '') : '');
  }, [categories]);

  // Per a cada compte, una funció data -> saldo conegut en aquella data (o
  // l'anterior més recent), perquè les cel·les de Saldo d'un compte sense
  // moviment aquell dia puguin mostrar igualment el seu saldo vigent.
  const consultaSaldoPerCompte = useMemo(() => {
    const map = new Map<string, (dataISO: string) => number | null>();
    for (const c of seleccionats) {
      const movimentsCompte = moviments.filter((m) => m.compteId === c.id);
      map.set(c.id, creaConsultaSaldo(movimentsCompte, c.tipus));
    }
    return map;
  }, [moviments, seleccionats]);

  function refresh() {
    listMovimentsPerComptes(seleccionats.map((c) => c.id)).then(setMoviments);
    suggereixTransferencies().then(setSuggeriments);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [compteIds]);

  const filtrats = useMemo(() => {
    const textNormalitzat = text.trim().toUpperCase();
    const resultat = moviments.filter((m) => {
      if (dataDes && m.dataOperacio < dataDes) return false;
      if (dataFins && m.dataOperacio > dataFins) return false;
      if (categoriaFiltre && m.categoriaId !== categoriaFiltre) return false;
      if (tipus === 'ingres' && m.importCents < 0) return false;
      if (tipus === 'carrec' && m.importCents >= 0) return false;
      if (textNormalitzat && !m.concepteNormalitzat.includes(textNormalitzat)) return false;
      return true;
    });
    const dir = ordre.direccio === 'asc' ? 1 : -1;
    // Same-key ties (typically same-day movements) always fall back to `seq`
    // ascending — i.e. the order they appeared in the imported file — instead
    // of arbitrary row order, and this tiebreak is NOT flipped by the sort
    // direction: reversing date order shouldn't reverse a single day's
    // internal chronology.
    return resultat.sort((a, b) => {
      if (ordre.camp === 'concepteOriginal') return a.concepteOriginal.localeCompare(b.concepteOriginal) * dir || a.seq - b.seq;
      return a.dataOperacio.localeCompare(b.dataOperacio) * dir || a.seq - b.seq;
    });
  }, [moviments, dataDes, dataFins, categoriaFiltre, text, tipus, ordre]);

  function canviaOrdre(camp: CampOrdre) {
    setOrdre((prev) => (prev.camp === camp ? { camp, direccio: prev.direccio === 'asc' ? 'desc' : 'asc' } : { camp, direccio: 'asc' }));
  }

  function exportaCSV() {
    const capçalera = ['Data', 'Compte', 'Concepte', 'Import', 'Saldo', 'Categoria'];
    const files = filtrats.map((m) => [
      formatDateEs(m.dataOperacio),
      compteAlias(m.compteId),
      m.concepteOriginal,
      centsToEs(m.importCents),
      m.saldoPosteriorCents !== null ? centsToEs(m.saldoPosteriorCents) : '',
      categoriaNom(m.categoriaId),
    ]);
    const csv = [capçalera, ...files].map((fila) => fila.map(csvField).join(';')).join('\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `moviments-${avui()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleCategoriaChange(movimentId: string, categoriaId: string) {
    await setMovimentCategoria(movimentId, categoriaId || undefined);
    setMoviments((prev) => prev.map((m) => (m.id === movimentId ? { ...m, categoriaId: categoriaId || undefined } : m)));
  }

  async function handleTransferenciaChange(movimentId: string, value: boolean) {
    await setTransferenciaInterna(movimentId, value);
    setMoviments((prev) => prev.map((m) => (m.id === movimentId ? { ...m, esTransferenciaInterna: value } : m)));
  }

  async function handleConfirmaSuggeriment(s: SuggerimentAmbDetall) {
    await confirmaTransferencia(s);
    setSuggeriments((prev) => prev.filter((x) => x !== s));
    setMoviments((prev) => prev.map((m) => (m.id === s.a || m.id === s.b ? { ...m, esTransferenciaInterna: true } : m)));
  }

  function obreFormRegla(m: Moviment) {
    setReglaObertaPer(m.id);
    setFormRegla({ patro: m.concepteNormalitzat, categoriaId: m.categoriaId ?? categories[0]?.id ?? '' });
    setErrorRegla(null);
  }

  function tancaFormRegla() {
    setReglaObertaPer(null);
    setFormRegla(null);
    setErrorRegla(null);
  }

  async function handleDesaRegla(aplicaAra: boolean) {
    if (!formRegla || !formRegla.patro.trim() || !formRegla.categoriaId) return;
    setErrorRegla(null);
    try {
      await createRegla({ patro: formRegla.patro.trim(), categoriaId: formRegla.categoriaId, prioritat: regles.length });
      if (aplicaAra) await aplicaReglesAMovimentsSenseCategoria();
      tancaFormRegla();
      onChanged();
      refresh();
    } catch (err) {
      setErrorRegla((err as Error).message);
    }
  }

  return (
    <section>
      <h2>Moviments</h2>

      {suggeriments.length > 0 && (
        <div style={{ border: '1px solid #d90', padding: 8, marginBottom: 12, fontSize: 12 }}>
          <strong>Transferències internes suggerides</strong>
          <ul>
            {suggeriments.map((s) => (
              <li key={`${s.a}-${s.b}`}>
                {formatDateEs(s.movimentA.dataOperacio)} — {compteAlias(s.movimentA.compteId)}: {s.movimentA.concepteOriginal} (
                <span style={colorImport(s.movimentA.importCents)}>{centsToEs(s.movimentA.importCents, false)}</span>) ↔{' '}
                {compteAlias(s.movimentB.compteId)}: {s.movimentB.concepteOriginal} (
                <span style={colorImport(s.movimentB.importCents)}>{centsToEs(s.movimentB.importCents, false)}</span>){' '}
                <button onClick={() => handleConfirmaSuggeriment(s)}>Confirmar</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <label>
          Des de: <input type="date" value={dataDes} onChange={(e) => setDataDes(e.target.value)} />
        </label>
        <label>
          Fins a: <input type="date" value={dataFins} onChange={(e) => setDataFins(e.target.value)} />
        </label>
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
          Text: <input value={text} onChange={(e) => setText(e.target.value)} placeholder="cercar al concepte" />
        </label>
        <button onClick={exportaCSV}>Exportar CSV</button>
      </div>

      <p>{filtrats.length} moviments</p>

      {/* Una columna d'Import/Saldo per compte seleccionat, en lloc d'una columna
          "Compte" repetida: es veu de seguida quin compte va tenir moviment
          cada dia i com evoluciona el seu saldo, comparant-los en paral·lel. */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, whiteSpace: 'nowrap', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ ...cellStyleClicable, ...cellData }} rowSpan={2} onClick={() => canviaOrdre('dataOperacio')}>
                Data {ordre.camp === 'dataOperacio' && (ordre.direccio === 'asc' ? '▲' : '▼')}
              </th>
              <th style={{ ...cellStyleClicable, ...cellConcepte }} rowSpan={2} onClick={() => canviaOrdre('concepteOriginal')}>
                Concepte {ordre.camp === 'concepteOriginal' && (ordre.direccio === 'asc' ? '▲' : '▼')}
              </th>
              <th style={{ ...cellStyle, ...cellCategoria }} rowSpan={2}>
                Categoria
              </th>
              <th style={{ ...cellStyle, ...cellTI }} rowSpan={2}>
                TI
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
            {filtrats.map((m) => (
              <Fragment key={m.id}>
                <tr style={m.esTransferenciaInterna ? { opacity: 0.6 } : undefined}>
                  <td style={{ ...cellStyle, ...cellData }}>{formatDateEs(m.dataOperacio)}</td>
                  <td style={{ ...cellStyle, ...cellConcepte }}>{m.concepteOriginal}</td>
                  <td style={{ ...cellStyle, ...cellCategoria }}>
                    <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                      <select
                        value={m.categoriaId ?? ''}
                        onChange={(e) => handleCategoriaChange(m.id, e.target.value)}
                        style={{ width: '100%', fontSize: 12 }}
                      >
                        <option value="">--</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nom}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => (reglaObertaPer === m.id ? tancaFormRegla() : obreFormRegla(m))}
                        title="Afegeix una regla de categorització automàtica per aquest concepte"
                        style={{ fontSize: 12, lineHeight: 1, padding: '1px 5px' }}
                      >
                        +
                      </button>
                    </div>
                  </td>
                  <td style={{ ...cellStyle, ...cellTI }}>
                    <input
                      type="checkbox"
                      checked={m.esTransferenciaInterna ?? false}
                      onChange={(e) => handleTransferenciaChange(m.id, e.target.checked)}
                    />
                  </td>
                  {seleccionats.map((c) => {
                    if (c.id === m.compteId) {
                      return (
                        <Fragment key={c.id}>
                          <td style={{ ...cellStyle, ...cellNumeric, ...colorImport(m.importCents) }}>
                            {centsToEs(m.importCents, false)}
                          </td>
                          <td style={{ ...cellStyle, ...cellNumeric, fontWeight: 'bold' }}>
                            {m.saldoPosteriorCents !== null ? centsToEs(m.saldoPosteriorCents, false) : '—'}
                          </td>
                        </Fragment>
                      );
                    }
                    const saldoAnterior = consultaSaldoPerCompte.get(c.id)?.(m.dataOperacio) ?? null;
                    return (
                      <Fragment key={c.id}>
                        <td style={cellStyle} />
                        <td style={{ ...cellStyle, ...cellNumeric, color: '#999' }}>
                          {saldoAnterior !== null ? centsToEs(saldoAnterior, false) : ''}
                        </td>
                      </Fragment>
                    );
                  })}
                </tr>
                {reglaObertaPer === m.id && formRegla && (
                  <tr>
                    <td colSpan={4 + seleccionats.length * 2} style={{ ...cellStyle, background: '#f7f7f7' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <strong>Nova regla:</strong>
                        <label>
                          Si el concepte conté:{' '}
                          <input
                            value={formRegla.patro}
                            onChange={(e) => setFormRegla({ ...formRegla, patro: e.target.value })}
                            style={{ width: 280 }}
                          />
                        </label>
                        <label>
                          Categoria:{' '}
                          <select
                            value={formRegla.categoriaId}
                            onChange={(e) => setFormRegla({ ...formRegla, categoriaId: e.target.value })}
                          >
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.nom}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button onClick={() => handleDesaRegla(false)}>Desa la regla</button>
                        <button onClick={() => handleDesaRegla(true)}>Desa i aplica als moviments sense categoria</button>
                        <button onClick={tancaFormRegla}>Cancel·la</button>
                      </div>
                      {errorRegla && <p style={{ color: '#c00' }}>{errorRegla}</p>}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function colorImport(cents: number): React.CSSProperties {
  return cents < 0 ? { color: '#c00' } : {};
}

const cellStyle: React.CSSProperties = { border: '1px solid #ccc', padding: '2px 6px' };
const cellStyleClicable: React.CSSProperties = { ...cellStyle, cursor: 'pointer' };

// Amplades fixes (width = minWidth = maxWidth, box-sizing: border-box perquè
// incloguin el padding): a 12px de font, calculades pel contingut més ample
// que hi pot aparèixer, no per un valor arbitrari.
function amplaFixa(px: number): React.CSSProperties {
  return { width: px, minWidth: px, maxWidth: px, boxSizing: 'border-box', overflow: 'hidden' };
}

// "06/07/2026" (10 xifres/separadors) és el contingut més ample d'aquesta columna.
const cellData: React.CSSProperties = amplaFixa(80);
// Concepte guanya espai per a la resta de columnes mostrant-se en ~2 files en lloc d'una sola línia llarga.
const cellConcepte: React.CSSProperties = { whiteSpace: 'normal', overflowWrap: 'break-word', maxWidth: 220 };
// 162px (135px +20%, per fer lloc també al botó "+" de nova regla).
const cellCategoria: React.CSSProperties = amplaFixa(162);
// La més estreta possible: només cal encabir-hi la casella de selecció.
const cellTI: React.CSSProperties = { ...amplaFixa(28), textAlign: 'center', padding: '2px 4px' };
// P.ex. "-12.345,67" és un import/saldo raonablement gran per a un ús personal.
const cellNumeric: React.CSSProperties = { ...amplaFixa(80), textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
