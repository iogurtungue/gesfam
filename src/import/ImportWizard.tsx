import { useEffect, useState } from 'react';
import { bankLabel } from '../lib/bankLabel';
import { centsToEs } from '../lib/numbers';
import { applyColumnMapping, type ColumnMapping } from '../parsers/columnMapping';
import { importFile } from '../parsers/importFile';
import type { ParseResult, RawTable } from '../parsers/types';
import type { Compte } from '../db/types';
import { commitImport, createCompte, findMatchingCompte } from '../db/operations';
import { ManualMapping } from './ManualMapping';

interface BaseItem {
  key: string;
  fileName: string;
}
interface ParsedItem extends BaseItem {
  kind: 'parsed';
  result: ParseResult;
}
interface MappingItem extends BaseItem {
  kind: 'needsMapping';
  table: RawTable;
}
interface ErrorItem extends BaseItem {
  kind: 'error';
  message: string;
}
type ImportItem = ParsedItem | MappingItem | ErrorItem;

interface Props {
  comptes: Compte[];
  onChanged: () => void;
}

export function ImportWizard({ comptes, onChanged }: Props) {
  const [items, setItems] = useState<ImportItem[]>([]);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList) return;
    const files = Array.from(fileList);
    const newItems: ImportItem[] = [];
    for (const file of files) {
      const outcome = await importFile(file);
      if (outcome.status === 'parsed') {
        outcome.results.forEach((result, i) => {
          newItems.push({ key: `${file.name}-${i}-${Date.now()}`, fileName: file.name, kind: 'parsed', result });
        });
      } else if (outcome.status === 'needsMapping') {
        newItems.push({ key: `${file.name}-map-${Date.now()}`, fileName: file.name, kind: 'needsMapping', table: outcome.table });
      } else {
        newItems.push({ key: `${file.name}-err-${Date.now()}`, fileName: file.name, kind: 'error', message: outcome.message });
      }
    }
    setItems((prev) => [...prev, ...newItems]);
  }

  function replaceItem(key: string, updated: ImportItem) {
    setItems((prev) => prev.map((it) => (it.key === key ? updated : it)));
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((it) => it.key !== key));
  }

  return (
    <section>
      <h2>Importar extractes</h2>
      <input type="file" multiple accept=".csv,.xls,.xlsx,.txt" onChange={(e) => handleFiles(e.target.files)} />
      {items.map((item) => (
        <ImportItemCard
          key={item.key}
          item={item}
          comptes={comptes}
          onResolved={(result) => replaceItem(item.key, { key: item.key, fileName: item.fileName, kind: 'parsed', result })}
          onCommitted={() => {
            removeItem(item.key);
            onChanged();
          }}
        />
      ))}
    </section>
  );
}

function ImportItemCard({
  item,
  comptes,
  onResolved,
  onCommitted,
}: {
  item: ImportItem;
  comptes: Compte[];
  onResolved: (result: ParseResult) => void;
  onCommitted: () => void;
}) {
  if (item.kind === 'error') {
    return (
      <div style={{ border: '1px solid #c00', padding: 12, marginBottom: 12 }}>
        <strong>{item.fileName}</strong>: {item.message}
      </div>
    );
  }

  if (item.kind === 'needsMapping') {
    return (
      <div style={{ marginBottom: 12 }}>
        <strong>{item.fileName}</strong>
        <ManualMapping
          table={item.table}
          onSubmit={(mapping: ColumnMapping) => {
            const { moviments, warnings } = applyColumnMapping(item.table, mapping);
            onResolved({ compte: { banc: mapping.banc, tipus: mapping.tipus }, moviments, warnings });
          }}
        />
      </div>
    );
  }

  return <ParsedResultCard fileName={item.fileName} result={item.result} comptes={comptes} onCommitted={onCommitted} />;
}

function ParsedResultCard({
  fileName,
  result,
  comptes,
  onCommitted,
}: {
  fileName: string;
  result: ParseResult;
  comptes: Compte[];
  onCommitted: () => void;
}) {
  const { compte, moviments, warnings } = result;
  const [compteId, setCompteId] = useState<string>('__new__');
  const [novaAlies, setNovaAlies] = useState('');
  const [summary, setSummary] = useState<{ nous: number; duplicats: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const candidats = comptes.filter((c) => c.banc === compte.banc && c.tipus === compte.tipus);

  useEffect(() => {
    let cancelled = false;
    findMatchingCompte(compte.banc, compte.tipus, compte.numeroCompte).then((match) => {
      if (!cancelled && match) setCompteId(match.id);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConfirm() {
    setBusy(true);
    try {
      let target: Compte | undefined = comptes.find((c) => c.id === compteId);
      if (!target) {
        target = await createCompte({
          banc: compte.banc,
          tipus: compte.tipus,
          alias: novaAlies.trim() || `${bankLabel(compte.banc)} ${compte.tipus === 'targeta' ? '(targeta)' : ''}`.trim(),
          numeroCompte: compte.numeroCompte,
        });
      }
      const { nous, duplicats } = await commitImport(target, moviments, fileName);
      setSummary({ nous, duplicats });
    } finally {
      setBusy(false);
    }
  }

  if (summary) {
    return (
      <div style={{ border: '1px solid #2a2', padding: 12, marginBottom: 12 }}>
        <strong>{fileName}</strong>: {summary.nous} moviments nous, {summary.duplicats} duplicats ignorats
        {warnings.length > 0 && `, ${warnings.length} files no interpretables`}.
        {warnings.length > 0 && (
          <ul>
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
        <div>
          <button onClick={onCommitted}>D'acord</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ border: '1px solid #999', padding: 12, marginBottom: 12 }}>
      <strong>{fileName}</strong> — {bankLabel(compte.banc)} ({compte.tipus === 'targeta' ? 'targeta' : 'compte corrent'})
      {compte.numeroCompte && <span> — núm. {compte.numeroCompte}</span>}
      <div>
        <label>
          Compte de destí:{' '}
          <select value={compteId} onChange={(e) => setCompteId(e.target.value)}>
            <option value="__new__">-- Crear compte nou --</option>
            {candidats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.alias}
              </option>
            ))}
          </select>
        </label>
        {compteId === '__new__' && (
          <label>
            {' '}
            Àlies: <input value={novaAlies} onChange={(e) => setNovaAlies(e.target.value)} placeholder={bankLabel(compte.banc)} />
          </label>
        )}
      </div>

      <p>
        {moviments.length} moviments interpretats
        {warnings.length > 0 && `, ${warnings.length} files no interpretables`}.
      </p>
      <table style={{ borderCollapse: 'collapse', fontSize: '0.9em' }}>
        <thead>
          <tr>
            <th style={cellStyle}>Data</th>
            <th style={cellStyle}>Concepte</th>
            <th style={{ ...cellStyle, textAlign: 'right' }}>Import</th>
            <th style={{ ...cellStyle, textAlign: 'right' }}>Saldo</th>
          </tr>
        </thead>
        <tbody>
          {moviments.slice(0, 15).map((m, i) => (
            <tr key={i}>
              <td style={cellStyle}>{m.dataOperacio}</td>
              <td style={cellStyle}>{m.concepteOriginal}</td>
              <td style={{ ...cellStyle, textAlign: 'right' }}>{centsToEs(m.importCents, false)}</td>
              <td style={{ ...cellStyle, textAlign: 'right' }}>
                {m.saldoPosteriorCents !== null ? centsToEs(m.saldoPosteriorCents, false) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {moviments.length > 15 && <p>... i {moviments.length - 15} més.</p>}

      <button onClick={handleConfirm} disabled={busy}>
        Confirmar importació
      </button>
    </div>
  );
}

const cellStyle: React.CSSProperties = { border: '1px solid #ccc', padding: '2px 6px' };
