import { useEffect, useMemo, useState } from 'react';
import { formatDateEs } from '../lib/dates';
import { centsToEs } from '../lib/numbers';
import { resumInterval, resumPerAnyICategoria, resumPerMesICategoria, SENSE_CATEGORIA, type ResumPeriode } from '../lib/summary';
import { listMovimentsPerComptes } from '../db/operations';
import type { Categoria, Compte, Moviment } from '../db/types';

type Mode = 'mensual' | 'anual' | 'interval';

interface Props {
  seleccionats: Compte[];
  categories: Categoria[];
}

/** Spec 3.5: ingressos vs despeses per categoria — mensual, anual, o per un interval de data lliure. */
export function Summary({ seleccionats, categories }: Props) {
  const [moviments, setMoviments] = useState<Moviment[]>([]);
  const [mode, setMode] = useState<Mode>('mensual');
  const [dataDes, setDataDes] = useState('');
  const [dataFins, setDataFins] = useState('');

  const categoriaNom = useMemo(() => {
    const map = new Map(categories.map((c) => [c.id, c.nom]));
    map.set(SENSE_CATEGORIA, 'Sense categoria');
    return (categoriaId: string) => map.get(categoriaId) ?? categoriaId;
  }, [categories]);

  useEffect(() => {
    listMovimentsPerComptes(seleccionats.map((c) => c.id)).then(setMoviments);
  }, [seleccionats]);

  const resums = useMemo((): ResumPeriode[] => {
    if (mode === 'mensual') return resumPerMesICategoria(moviments);
    if (mode === 'anual') return resumPerAnyICategoria(moviments);
    return [resumInterval(moviments, dataDes || undefined, dataFins || undefined)];
  }, [moviments, mode, dataDes, dataFins]);

  function etiqueta(resum: ResumPeriode): string {
    if (mode !== 'interval') return resum.periode;
    const des = dataDes ? formatDateEs(dataDes) : "l'inici";
    const fins = dataFins ? formatDateEs(dataFins) : 'avui';
    return `Del ${des} al ${fins}`;
  }

  return (
    <section>
      <h2>Resums</h2>

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12 }}>
        <label>
          <input type="radio" checked={mode === 'mensual'} onChange={() => setMode('mensual')} /> Mensual
        </label>
        <label>
          <input type="radio" checked={mode === 'anual'} onChange={() => setMode('anual')} /> Anual
        </label>
        <label>
          <input type="radio" checked={mode === 'interval'} onChange={() => setMode('interval')} /> Interval de dates
        </label>
        {mode === 'interval' && (
          <>
            <label>
              Des de: <input type="date" value={dataDes} onChange={(e) => setDataDes(e.target.value)} />
            </label>
            <label>
              Fins a: <input type="date" value={dataFins} onChange={(e) => setDataFins(e.target.value)} />
            </label>
          </>
        )}
      </div>

      {seleccionats.length === 0 ? (
        <p>Selecciona algun compte per veure el resum.</p>
      ) : resums.length === 0 || resums.every((r) => Object.keys(r.perCategoria).length === 0) ? (
        <p>No hi ha moviments per resumir.</p>
      ) : (
        [...resums].reverse().map((resum) => (
          <div key={resum.periode} style={{ marginBottom: 16, border: '1px solid #ccc', padding: 8 }}>
            <h3>{etiqueta(resum)}</h3>
            <p>
              Ingressos: {centsToEs(resum.ingressosCents, false)} — Despeses: {centsToEs(resum.despesesCents, false)} — Net:{' '}
              {centsToEs(resum.ingressosCents - resum.despesesCents, false)}
            </p>
            <table style={{ borderCollapse: 'collapse', fontSize: '0.9em' }}>
              <thead>
                <tr>
                  <th style={cellStyle}>Categoria</th>
                  <th style={{ ...cellStyle, textAlign: 'right' }}>Ingressos</th>
                  <th style={{ ...cellStyle, textAlign: 'right' }}>Despeses</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(resum.perCategoria)
                  // Alfabètic pel nom mostrat, amb "Sense categoria" sempre al final (és un calaix de sastre, no una categoria real).
                  .sort(([idA], [idB]) => {
                    if (idA === SENSE_CATEGORIA) return 1;
                    if (idB === SENSE_CATEGORIA) return -1;
                    return categoriaNom(idA).localeCompare(categoriaNom(idB));
                  })
                  .map(([categoriaId, totals]) => (
                    <tr key={categoriaId}>
                      <td style={cellStyle}>{categoriaNom(categoriaId)}</td>
                      <td style={{ ...cellStyle, textAlign: 'right' }}>{centsToEs(totals.ingressosCents, false)}</td>
                      <td style={{ ...cellStyle, textAlign: 'right' }}>{centsToEs(totals.despesesCents, false)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </section>
  );
}

const cellStyle: React.CSSProperties = { border: '1px solid #ccc', padding: '2px 6px' };
