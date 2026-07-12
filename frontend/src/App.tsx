import { useCallback, useEffect, useState } from 'react';
import { listCategories, listComptes, listLots, listRecurrents, listRegles } from './api/client';
import type { Categoria, Compte, LotImportacio, Recurrent, ReglaCategoritzacio } from './api/types';
import { CompteSelector } from './components/CompteSelector';
import { useCompteSeleccio } from './hooks/useCompteSeleccio';
import { ImportWizard } from './import/ImportWizard';
import { LotsList } from './import/LotsList';
import { RecurrentsImportWizard } from './import/RecurrentsImportWizard';
import { RecurrentsList } from './import/RecurrentsList';
import { AccountsManager } from './views/AccountsManager';
import { CategoriesManager } from './views/CategoriesManager';
import { Dashboard } from './views/Dashboard';
import { Maintenance } from './views/Maintenance';
import { MovimentsList } from './views/MovimentsList';
import { Summary } from './views/Summary';

type Pestanya = 'panell' | 'moviments' | 'resum' | 'categories' | 'comptes' | 'importar' | 'manteniment';

const PESTANYES: { id: Pestanya; label: string; ambSelector: boolean }[] = [
  { id: 'panell', label: 'Panell general', ambSelector: true },
  { id: 'moviments', label: 'Moviments', ambSelector: true },
  { id: 'resum', label: 'Resums', ambSelector: true },
  { id: 'categories', label: 'Categories i regles', ambSelector: false },
  { id: 'comptes', label: 'Comptes', ambSelector: false },
  { id: 'importar', label: 'Importar', ambSelector: false },
  { id: 'manteniment', label: 'Manteniment', ambSelector: false },
];

function App() {
  const [comptes, setComptes] = useState<Compte[]>([]);
  const [lots, setLots] = useState<LotImportacio[]>([]);
  const [categories, setCategories] = useState<Categoria[]>([]);
  const [regles, setRegles] = useState<ReglaCategoritzacio[]>([]);
  const [recurrents, setRecurrents] = useState<Recurrent[]>([]);
  const [pestanya, setPestanya] = useState<Pestanya>('panell');

  const seleccio = useCompteSeleccio(comptes);

  const refresh = useCallback(() => {
    listComptes().then(setComptes);
    listLots().then(setLots);
    listCategories().then(setCategories);
    listRegles().then(setRegles);
    listRecurrents().then(setRecurrents);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const pestanyaActiva = PESTANYES.find((p) => p.id === pestanya)!;

  // La taula de Moviments té una columna Import/Saldo per compte, així que
  // necessita tot l'ample de pantalla disponible en lloc del contenidor
  // centrat i limitat a 1000px que fan servir la resta de pestanyes.
  const amplariMaxima = pestanya === 'moviments' ? 'none' : 1000;

  return (
    <div style={{ maxWidth: amplariMaxima, margin: '0 auto', padding: 16, fontFamily: 'sans-serif' }}>
      <h1>GesFam — Centralitzador d'extractes bancaris</h1>

      <nav style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12, borderBottom: '1px solid #ccc' }}>
        {PESTANYES.map((p) => (
          <button
            key={p.id}
            onClick={() => setPestanya(p.id)}
            style={{
              padding: '6px 12px',
              border: 'none',
              borderBottom: pestanya === p.id ? '2px solid #2a6' : '2px solid transparent',
              background: 'none',
              fontWeight: pestanya === p.id ? 'bold' : 'normal',
              cursor: 'pointer',
            }}
          >
            {p.label}
          </button>
        ))}
      </nav>

      {pestanyaActiva.ambSelector && <CompteSelector comptes={comptes} seleccio={seleccio} />}

      {pestanya === 'panell' && <Dashboard seleccionats={seleccio.seleccionats} />}
      {pestanya === 'moviments' && (
        <MovimentsList
          seleccionats={seleccio.seleccionats}
          totsElsComptes={comptes}
          categories={categories}
          regles={regles}
          onChanged={refresh}
        />
      )}
      {pestanya === 'resum' && <Summary seleccionats={seleccio.seleccionats} categories={categories} />}
      {pestanya === 'categories' && <CategoriesManager categories={categories} regles={regles} onChanged={refresh} />}
      {pestanya === 'comptes' && <AccountsManager comptes={comptes} onChanged={refresh} />}
      {pestanya === 'importar' && (
        <>
          <ImportWizard comptes={comptes} onChanged={refresh} />
          <LotsList lots={lots} comptes={comptes} onChanged={refresh} />
          <RecurrentsImportWizard comptes={comptes} onChanged={refresh} />
          <RecurrentsList recurrents={recurrents} comptes={comptes} onChanged={refresh} />
        </>
      )}
      {pestanya === 'manteniment' && <Maintenance onReset={refresh} />}
    </div>
  );
}

export default App;
