import { useCallback, useEffect, useState } from 'react';
import { listRecurrents } from '../api/client';
import type { Categoria, Compte, Recurrent } from '../api/types';
import { RecurrentManualForm } from '../import/RecurrentManualForm';
import { RecurrentsImportWizard } from '../import/RecurrentsImportWizard';
import { RecurrentsList } from '../import/RecurrentsList';

interface Props {
  comptes: Compte[];
  categories: Categoria[];
}

/** Pantalla de recurrents (especificacio.md 4.1.5): compromisos manuals (3.1) i importats (3.2), amb edició/eliminació. Sense detecció automàtica — eliminada a petició de l'usuari (vegeu ESTAT.md historial). */
export function RecurrentsManager({ comptes, categories }: Props) {
  const [recurrents, setRecurrents] = useState<Recurrent[]>([]);

  const refresh = useCallback(() => {
    listRecurrents().then(setRecurrents);
  }, []);

  useEffect(refresh, [refresh]);

  return (
    <section>
      <h1>Recurrents</h1>
      <RecurrentManualForm comptes={comptes} categories={categories} onChanged={refresh} />
      <RecurrentsImportWizard comptes={comptes} onChanged={refresh} />
      <RecurrentsList recurrents={recurrents.filter((r) => r.estat === 'confirmat')} comptes={comptes} categories={categories} onChanged={refresh} />
    </section>
  );
}
