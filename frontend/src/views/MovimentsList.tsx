import { Fragment, useEffect, useMemo, useState } from 'react';
import { creaConsultaSaldo, creaSaldoAcumulatPerMoviment } from '../lib/balance';
import { avui, formatDateEs } from '../lib/dates';
import { centsToEs } from '../lib/numbers';
import {
  aplicaReglesAMovimentsSenseCategoria,
  confirmaTransferencia,
  createRegla,
  descartaTransferencia,
  desmarcaLiquidacioTargeta,
  eliminaMoviment,
  listMovimentsPerComptes,
  marcaLiquidacioTargeta,
  setMovimentCategoria,
  setTransferenciaInterna,
  suggereixLiquidacionsTargeta,
  suggereixTransferencies,
} from '../api/client';
import type { Categoria, Compte, Moviment, ReglaCategoritzacio, SuggerimentAmbDetall, SuggerimentLiquidacio } from '../api/types';

type FiltreTipus = 'tots' | 'ingres' | 'carrec';
type CampOrdre = 'dataOperacio' | 'concepteOriginal';

interface FormRegla {
  patro: string;
  categoriaId: string;
}

interface Props {
  seleccionats: Compte[];
  totsElsComptes: Compte[];
  categories: Categoria[];
  regles: ReglaCategoritzacio[];
  onChanged: () => void;
}

function csvField(value: string): string {
  if (/[",\n;]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function MovimentsList({ seleccionats, totsElsComptes, categories, regles, onChanged }: Props) {
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
  const [suggerimentsLiquidacio, setSuggerimentsLiquidacio] = useState<SuggerimentLiquidacio[]>([]);
  const [seleccioLiquidacio, setSeleccioLiquidacio] = useState<Record<string, string>>({});
  const [avisQuadratura, setAvisQuadratura] = useState<string | null>(null);
  const [errorLiquidacio, setErrorLiquidacio] = useState<string | null>(null);

  const compteIds = seleccionats.map((c) => c.id).join(',');
  const compteAlias = useMemo(() => {
    const map = new Map(seleccionats.map((c) => [c.id, c.alias]));
    return (compteId: string) => map.get(compteId) ?? compteId;
  }, [seleccionats]);
  const categoriaNom = useMemo(() => {
    const map = new Map(categories.map((c) => [c.id, c.nom]));
    return (categoriaId?: string) => (categoriaId ? (map.get(categoriaId) ?? '') : '');
  }, [categories]);
  const compteById = useMemo(() => new Map(totsElsComptes.map((c) => [c.id, c])), [totsElsComptes]);
  const targetes = useMemo(() => totsElsComptes.filter((c) => c.tipus === 'targeta'), [totsElsComptes]);

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

  // Les targetes no porten saldo a l'extracte (saldoPosteriorCents és sempre
  // null): el deute acumulat de cada moviment propi es calcula sumant els
  // imports en ordre cronològic (es reinicia amb cada contrapartida de
  // liquidació, que cancel·la exactament l'import liquidat).
  const saldoAcumulatTargetaPerMoviment = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of seleccionats) {
      if (c.tipus !== 'targeta') continue;
      const movimentsCompte = moviments.filter((m) => m.compteId === c.id);
      for (const [id, saldo] of creaSaldoAcumulatPerMoviment(movimentsCompte)) {
        map.set(id, saldo);
      }
    }
    return map;
  }, [moviments, seleccionats]);

  function refresh() {
    listMovimentsPerComptes(seleccionats.map((c) => c.id)).then(setMoviments);
    suggereixTransferencies().then(setSuggeriments);
    suggereixLiquidacionsTargeta().then(setSuggerimentsLiquidacio);
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
    // internal chronology. Excepció: la contrapartida automàtica d'una
    // liquidació de targeta pren com a "seq efectiu" el del càrrec que
    // l'origina (no el seu propi seq, molt més alt per haver-se creat després)
    // perquè es comporti, davant de la RESTA de moviments del dia, com si
    // estigués a la mateixa posició que el càrrec -- comparar-la només contra
    // el càrrec (seq idèntic per construcció) no n'hi ha prou: un comparador
    // que namés desempata aquest parell concret deixa de ser transitiu quan
    // hi ha un tercer moviment aquell dia, i Array.sort no garanteix cap
    // resultat concret en aquest cas (bug real: la contrapartida acabava al
    // final del dia en lloc de just per sobre del càrrec). El seu saldo
    // (creaSaldoAcumulatPerMoviment / creaConsultaSaldo) ja es calcula per
    // data/lot, no per aquest ordre visual, així que no es veu afectat.
    const seqOrigen = new Map(moviments.map((m) => [m.id, m.seq]));
    function seqEfectiu(m: Moviment): number {
      return (m.movimentOrigenId ? seqOrigen.get(m.movimentOrigenId) : undefined) ?? m.seq;
    }
    function comparaParella(a: Moviment, b: Moviment): number {
      const diferencia = seqEfectiu(a) - seqEfectiu(b);
      if (diferencia !== 0) return diferencia;
      if (a.movimentOrigenId === b.id) return -1;
      if (b.movimentOrigenId === a.id) return 1;
      return a.seq - b.seq;
    }
    return resultat.sort((a, b) => {
      if (ordre.camp === 'concepteOriginal') return a.concepteOriginal.localeCompare(b.concepteOriginal) * dir || comparaParella(a, b);
      return a.dataOperacio.localeCompare(b.dataOperacio) * dir || comparaParella(a, b);
    });
  }, [moviments, dataDes, dataFins, categoriaFiltre, text, tipus, ordre]);

  function canviaOrdre(camp: CampOrdre) {
    setOrdre((prev) => (prev.camp === camp ? { camp, direccio: prev.direccio === 'asc' ? 'desc' : 'asc' } : { camp, direccio: 'asc' }));
  }

  const capçaleraExport = ['Data', 'Compte', 'Concepte', 'Import', 'Saldo', 'Categoria'];

  // Saldo "propi" d'un moviment (mateixa lògica que la columna Saldo de la
  // taula): per a targetes, el deute acumulat calculat al frontend, ja que
  // saldoPosteriorCents hi és sempre null (els extractes de targeta no en
  // porten).
  function saldoPropiCents(m: Moviment): number | null {
    if (compteById.get(m.compteId)?.tipus === 'targeta') return saldoAcumulatTargetaPerMoviment.get(m.id) ?? null;
    return m.saldoPosteriorCents;
  }

  function exportaCSV() {
    const files = filtrats.map((m) => {
      const saldo = saldoPropiCents(m);
      return [formatDateEs(m.dataOperacio), compteAlias(m.compteId), m.concepteOriginal, centsToEs(m.importCents), saldo !== null ? centsToEs(saldo) : '', categoriaNom(m.categoriaId)];
    });
    const csv = [capçaleraExport, ...files].map((fila) => fila.map(csvField).join(';')).join('\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `moviments-${avui()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportaExcel() {
    // Import dinàmic: xlsx és una llibreria pesada (~300kB) que només cal
    // carregar quan realment s'exporta, no al càrregar la pàgina.
    const XLSX = await import('xlsx');
    const files = filtrats.map((m) => {
      const saldo = saldoPropiCents(m);
      return [formatDateEs(m.dataOperacio), compteAlias(m.compteId), m.concepteOriginal, m.importCents / 100, saldo !== null ? saldo / 100 : '', categoriaNom(m.categoriaId)];
    });
    const worksheet = XLSX.utils.aoa_to_sheet([capçaleraExport, ...files]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Moviments');
    XLSX.writeFile(workbook, `moviments-${avui()}.xlsx`);
  }

  async function handleCategoriaChange(movimentId: string, categoriaId: string) {
    await setMovimentCategoria(movimentId, categoriaId || undefined);
    setMoviments((prev) => prev.map((m) => (m.id === movimentId ? { ...m, categoriaId: categoriaId || undefined } : m)));
  }

  async function handleTransferenciaChange(movimentId: string, value: boolean) {
    await setTransferenciaInterna(movimentId, value);
    setMoviments((prev) => prev.map((m) => (m.id === movimentId ? { ...m, esTransferenciaInterna: value } : m)));
  }

  async function handleElimina(m: Moviment) {
    if (!confirm(`Eliminar aquest moviment ("${m.concepteOriginal}", ${formatDateEs(m.dataOperacio)})? Aquesta acció no es pot desfer.`)) return;
    await eliminaMoviment(m.id);
    refresh();
  }

  async function handleConfirmaSuggeriment(s: SuggerimentAmbDetall) {
    await confirmaTransferencia(s);
    setSuggeriments((prev) => prev.filter((x) => x !== s));
    setMoviments((prev) => prev.map((m) => (m.id === s.a || m.id === s.b ? { ...m, esTransferenciaInterna: true } : m)));
  }

  async function handleDescartaSuggeriment(s: SuggerimentAmbDetall) {
    await descartaTransferencia(s);
    setSuggeriments((prev) => prev.filter((x) => x !== s));
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

  async function handleMarcaLiquidacio(movimentId: string, targetaCompteId: string) {
    if (!targetaCompteId) return;
    setErrorLiquidacio(null);
    setAvisQuadratura(null);
    try {
      const { quadratura } = await marcaLiquidacioTargeta(movimentId, targetaCompteId);
      if (quadratura.diferenciaCents !== 0) {
        const signe = quadratura.diferenciaCents > 0 ? 'més' : 'menys';
        setAvisQuadratura(
          `La liquidació (${centsToEs(quadratura.obtingutCents, false)}) no quadra amb els moviments de la targeta des de ` +
            `l'anterior liquidació (${centsToEs(quadratura.esperatCents, false)}): ${centsToEs(Math.abs(quadratura.diferenciaCents), false)} ${signe}.`,
        );
      }
      setSuggerimentsLiquidacio((prev) => prev.filter((s) => s.moviment.id !== movimentId));
      refresh();
    } catch (err) {
      setErrorLiquidacio((err as Error).message);
    }
  }

  async function handleDesmarcaLiquidacio(movimentId: string) {
    setErrorLiquidacio(null);
    try {
      await desmarcaLiquidacioTargeta(movimentId);
      refresh();
    } catch (err) {
      setErrorLiquidacio((err as Error).message);
    }
  }

  /** Contingut de la columna "Liquidació" (especificacio.md 3.2.1): marcar/desmarcar un càrrec del compte corrent com la liquidació d'una targeta. No aplicable a moviments de targeta ni a les seves contrapartides automàtiques. */
  function cellaLiquidacio(m: Moviment) {
    if (m.movimentOrigenId) {
      return <span title="Contrapartida automàtica d'una liquidació de targeta">contrapartida</span>;
    }
    if (compteById.get(m.compteId)?.tipus !== 'corrent') return null;
    if (m.esLiquidacioTargetaId) {
      return (
        <>
          {compteById.get(m.esLiquidacioTargetaId)?.alias ?? m.esLiquidacioTargetaId}{' '}
          <button onClick={() => handleDesmarcaLiquidacio(m.id)} title="Desmarca la liquidació">
            D
          </button>
        </>
      );
    }
    const seleccionada = seleccioLiquidacio[m.id] ?? targetes[0]?.id ?? '';
    return (
      <>
        <select
          value={seleccionada}
          onChange={(e) => setSeleccioLiquidacio({ ...seleccioLiquidacio, [m.id]: e.target.value })}
          style={{ width: 90, fontSize: 12 }}
        >
          {targetes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.alias}
            </option>
          ))}
        </select>{' '}
        <button onClick={() => handleMarcaLiquidacio(m.id, seleccionada)} title="Marca liquidació">
          M
        </button>
      </>
    );
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
                <button onClick={() => handleConfirmaSuggeriment(s)}>Confirmar</button>{' '}
                <button onClick={() => handleDescartaSuggeriment(s)} title="No tornar a suggerir aquesta parella">
                  Descartar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {suggerimentsLiquidacio.length > 0 && (
        <div style={{ border: '1px solid #d90', padding: 8, marginBottom: 12, fontSize: 12 }}>
          <strong>Liquidacions de targeta suggerides</strong>
          <ul>
            {suggerimentsLiquidacio.map((s) => (
              <li key={s.moviment.id}>
                {formatDateEs(s.moviment.dataOperacio)} — {s.moviment.concepteOriginal} (
                <span style={colorImport(s.moviment.importCents)}>{centsToEs(s.moviment.importCents, false)}</span>) → liquidació de{' '}
                {compteById.get(s.targetaCompteId)?.alias ?? s.targetaCompteId}{' '}
                <button onClick={() => handleMarcaLiquidacio(s.moviment.id, s.targetaCompteId)}>Confirmar</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {avisQuadratura && (
        <p style={{ color: '#d90' }}>
          ⚠ {avisQuadratura} <button onClick={() => setAvisQuadratura(null)}>D'acord</button>
        </p>
      )}
      {errorLiquidacio && <p style={{ color: '#c00' }}>{errorLiquidacio}</p>}

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
        <button onClick={exportaExcel}>Exportar Excel</button>
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
              {targetes.length > 0 && (
                <th style={{ ...cellStyle, ...cellLiquidacio }} rowSpan={2}>
                  Liquidació
                </th>
              )}
              {seleccionats.map((c) => (
                <th key={c.id} style={cellStyle} colSpan={2}>
                  {c.alias}
                </th>
              ))}
              <th style={{ ...cellStyle, ...cellElimina }} rowSpan={2}></th>
            </tr>
            <tr>
              {seleccionats.map((c) => (
                <Fragment key={c.id}>
                  <th style={{ ...cellStyle, ...cellNumeric }}>Import</th>
                  <th
                    style={{ ...cellStyle, ...cellNumeric }}
                    title={
                      c.tipus === 'targeta'
                        ? "Deute acumulat des de l'inici de les dades importades; es reinicia amb cada liquidació registrada. No és un saldo disponible."
                        : undefined
                    }
                  >
                    Saldo
                  </th>
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
                  {targetes.length > 0 && <td style={{ ...cellStyle, ...cellLiquidacio }}>{cellaLiquidacio(m)}</td>}
                  {seleccionats.map((c) => {
                    if (c.id === m.compteId) {
                      return (
                        <Fragment key={c.id}>
                          <td style={{ ...cellStyle, ...cellNumeric, ...colorImport(m.importCents) }}>
                            {centsToEs(m.importCents, false)}
                          </td>
                          <td style={{ ...cellStyle, ...cellNumeric, fontWeight: 'bold' }}>
                            {(() => {
                              const saldoPropi = c.tipus === 'targeta' ? (saldoAcumulatTargetaPerMoviment.get(m.id) ?? null) : m.saldoPosteriorCents;
                              return saldoPropi !== null ? centsToEs(saldoPropi, false) : '—';
                            })()}
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
                  <td style={{ ...cellStyle, ...cellElimina }}>
                    <button type="button" onClick={() => handleElimina(m)} title="Eliminar aquest moviment" style={{ fontSize: 12, lineHeight: 1, padding: '1px 3px' }}>
                      X
                    </button>
                  </td>
                </tr>
                {reglaObertaPer === m.id && formRegla && (
                  <tr>
                    <td colSpan={(targetes.length > 0 ? 6 : 5) + seleccionats.length * 2} style={{ ...cellStyle, background: '#f7f7f7' }}>
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
// Encabeix el selector de targeta (90px) + el botó "M"/"D" d'una lletra.
const cellLiquidacio: React.CSSProperties = amplaFixa(130);
// La més estreta possible: només cal encabir-hi el botó "X" d'eliminar.
const cellElimina: React.CSSProperties = { ...amplaFixa(28), textAlign: 'center', padding: '2px 4px' };
// P.ex. "-12.345,67" és un import/saldo raonablement gran per a un ús personal.
const cellNumeric: React.CSSProperties = { ...amplaFixa(80), textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
