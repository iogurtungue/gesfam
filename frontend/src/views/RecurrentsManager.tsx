import { useCallback, useEffect, useState } from 'react';
import { detectaCandidatsRecurrents, listRecurrents } from '../api/client';
import type { CandidatRecurrent, Categoria, Compte, Recurrent } from '../api/types';
import { RecurrentManualForm } from '../import/RecurrentManualForm';
import { RecurrentsCandidatsList } from '../import/RecurrentsCandidatsList';
import { RecurrentsImportWizard } from '../import/RecurrentsImportWizard';
import { RecurrentsList } from '../import/RecurrentsList';

interface Props {
  comptes: Compte[];
  categories: Categoria[];
}

/** Sub-fase 3.4 (especificacio.md 4.1.5): pantalla unificada de recurrents — candidats detectats (3.3) i compromisos manuals/importats (3.1/3.2), amb accions de confirmar/corregir/ignorar/eliminar. */
export function RecurrentsManager({ comptes, categories }: Props) {
  const [recurrents, setRecurrents] = useState<Recurrent[]>([]);
  const [candidats, setCandidats] = useState<CandidatRecurrent[]>([]);

  const refresh = useCallback(() => {
    listRecurrents().then(setRecurrents);
    detectaCandidatsRecurrents().then(setCandidats);
  }, []);

  useEffect(refresh, [refresh]);

  return (
    <section>
      <h1>Recurrents</h1>
      <RecurrentsCandidatsList candidats={candidats} comptes={comptes} categories={categories} onChanged={refresh} />
      <RecurrentManualForm comptes={comptes} categories={categories} onChanged={refresh} />
      <RecurrentsImportWizard comptes={comptes} onChanged={refresh} />
      <RecurrentsList recurrents={recurrents} comptes={comptes} categories={categories} onChanged={refresh} />
    </section>
  );
}
