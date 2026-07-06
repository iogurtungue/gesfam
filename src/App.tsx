import { useCallback, useEffect, useState } from 'react';
import { listComptes, listLots } from './db/operations';
import type { Compte, LotImportacio } from './db/types';
import { ImportWizard } from './import/ImportWizard';
import { LotsList } from './import/LotsList';

function App() {
  const [comptes, setComptes] = useState<Compte[]>([]);
  const [lots, setLots] = useState<LotImportacio[]>([]);

  const refresh = useCallback(() => {
    listComptes().then(setComptes);
    listLots().then(setLots);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 16, fontFamily: 'sans-serif' }}>
      <h1>GesFam — Centralitzador d'extractes bancaris</h1>

      <section>
        <h2>Comptes</h2>
        {comptes.length === 0 ? (
          <p>Encara no hi ha cap compte. Importa un extracte per crear-ne un.</p>
        ) : (
          <ul>
            {comptes.map((c) => (
              <li key={c.id}>
                {c.alias} — {c.banc} ({c.tipus === 'targeta' ? 'targeta' : 'compte corrent'})
                {c.ibanOUltimsDigits && ` — núm. ${c.ibanOUltimsDigits}`}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ImportWizard comptes={comptes} onChanged={refresh} />

      <LotsList lots={lots} comptes={comptes} onChanged={refresh} />
    </div>
  );
}

export default App;
