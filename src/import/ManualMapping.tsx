import { useState } from 'react';
import { cellToText } from '../parsers/tableUtils';
import type { AccountType, BankId, RawTable } from '../parsers/types';
import type { ColumnMapping } from '../parsers/columnMapping';

const BANK_OPTIONS: { value: BankId; label: string }[] = [
  { value: 'sabadell', label: 'Banc Sabadell' },
  { value: 'bbva', label: 'BBVA' },
  { value: 'ing', label: 'ING' },
  { value: 'openbank', label: 'OpenBank' },
  { value: 'altre', label: 'Altre' },
];

interface Props {
  table: RawTable;
  onSubmit: (mapping: ColumnMapping) => void;
}

/**
 * Fallback column-mapping assistant (spec 3.1.4) shown when automatic bank
 * detection fails. The user picks which column index holds each field; the
 * header row is guessed as the first non-blank row but can be corrected.
 */
export function ManualMapping({ table, onSubmit }: Props) {
  const [headerRowIndex, setHeaderRowIndex] = useState(
    () => table.findIndex((row) => row.some((c) => cellToText(c) !== '')) || 0,
  );
  const [banc, setBanc] = useState<BankId>('altre');
  const [tipus, setTipus] = useState<AccountType>('corrent');
  const [dataOperacioCol, setDataOperacioCol] = useState(0);
  const [dataValorCol, setDataValorCol] = useState<number | ''>('');
  const [concepteColsRaw, setConcepteColsRaw] = useState('1');
  const [importCol, setImportCol] = useState(2);
  const [saldoCol, setSaldoCol] = useState<number | ''>('');

  const previewRows = table.slice(headerRowIndex, headerRowIndex + 6);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const concepteCols = concepteColsRaw
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !Number.isNaN(n));
    const mapping: ColumnMapping = {
      banc,
      tipus,
      headerRowIndex,
      dataOperacioCol,
      dataValorCol: dataValorCol === '' ? undefined : dataValorCol,
      concepteCols,
      importCol,
      saldoCol: saldoCol === '' ? undefined : saldoCol,
    };
    onSubmit(mapping);
  }

  return (
    <form onSubmit={handleSubmit} style={{ border: '1px solid #999', padding: 12, marginBottom: 12 }}>
      <p>
        <strong>No s'ha reconegut automàticament el format del fitxer.</strong> Indica quina columna
        (numerada des de 0) conté cada dada.
      </p>
      <table style={{ borderCollapse: 'collapse', marginBottom: 8 }}>
        <tbody>
          {previewRows.map((row, i) => (
            <tr key={i}>
              <td style={{ color: '#888', paddingRight: 8 }}>{headerRowIndex + i}</td>
              {row.map((cell, j) => (
                <td key={j} style={{ border: '1px solid #ccc', padding: '2px 6px' }}>
                  <span style={{ color: '#888', marginRight: 4 }}>[{j}]</span>
                  {cellToText(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <label>
        Fila de capçalera:{' '}
        <input
          type="number"
          value={headerRowIndex}
          onChange={(e) => setHeaderRowIndex(parseInt(e.target.value, 10) || 0)}
        />
      </label>
      <div>
        <label>
          Banc:{' '}
          <select value={banc} onChange={(e) => setBanc(e.target.value as BankId)}>
            {BANK_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>{' '}
        <label>
          Tipus:{' '}
          <select value={tipus} onChange={(e) => setTipus(e.target.value as AccountType)}>
            <option value="corrent">Compte corrent</option>
            <option value="targeta">Targeta de crèdit</option>
          </select>
        </label>
      </div>
      <div>
        <label>
          Columna data operació: <input type="number" value={dataOperacioCol} onChange={(e) => setDataOperacioCol(parseInt(e.target.value, 10) || 0)} />
        </label>{' '}
        <label>
          Columna data valor (opcional):{' '}
          <input
            type="number"
            value={dataValorCol}
            onChange={(e) => setDataValorCol(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
          />
        </label>
      </div>
      <div>
        <label>
          Columnes de concepte (separades per comes): <input value={concepteColsRaw} onChange={(e) => setConcepteColsRaw(e.target.value)} />
        </label>
      </div>
      <div>
        <label>
          Columna import: <input type="number" value={importCol} onChange={(e) => setImportCol(parseInt(e.target.value, 10) || 0)} />
        </label>{' '}
        <label>
          Columna saldo (opcional):{' '}
          <input
            type="number"
            value={saldoCol}
            onChange={(e) => setSaldoCol(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
          />
        </label>
      </div>
      <button type="submit">Aplicar mapatge</button>
    </form>
  );
}
