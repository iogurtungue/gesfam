import { useState } from 'react';
import { avui } from '../lib/dates';
import { exportaCopiaSeguretat, importaCopiaSeguretat, type Backup as BackupData } from '../db/operations';

function esBackupValid(data: unknown): data is BackupData {
  if (typeof data !== 'object' || data === null) return false;
  const b = data as Record<string, unknown>;
  return (
    b.versio === 1 &&
    Array.isArray(b.comptes) &&
    Array.isArray(b.moviments) &&
    Array.isArray(b.lots) &&
    Array.isArray(b.categories) &&
    Array.isArray(b.regles)
  );
}

interface Props {
  onImported: () => void;
}

/** NFR secció 2: còpia de seguretat completa en JSON, perquè l'usuari no perdi res en canviar de navegador. */
export function Backup({ onImported }: Props) {
  const [missatge, setMissatge] = useState<string | null>(null);

  async function handleExporta() {
    const backup = await exportaCopiaSeguretat();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gesfam-copia-seguretat-${avui()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImporta(fitxer: File | undefined) {
    if (!fitxer) return;
    setMissatge(null);
    try {
      const text = await fitxer.text();
      const data = JSON.parse(text);
      if (!esBackupValid(data)) {
        setMissatge('El fitxer no té el format esperat d\'una còpia de seguretat de GesFam.');
        return;
      }
      if (
        !confirm(
          'Importar aquesta còpia de seguretat esborrarà TOTES les dades actuals (comptes, moviments, lots, categories i regles) i les substituirà pel contingut del fitxer. Vols continuar?',
        )
      ) {
        return;
      }
      await importaCopiaSeguretat(data);
      setMissatge('Còpia de seguretat importada correctament.');
      onImported();
    } catch (err) {
      setMissatge(`Error important el fitxer: ${(err as Error).message}`);
    }
  }

  return (
    <section>
      <h2>Còpia de seguretat</h2>
      <p>
        <button onClick={handleExporta}>Exportar còpia de seguretat (JSON)</button>
      </p>
      <p>
        <label>
          Importar còpia de seguretat: <input type="file" accept=".json" onChange={(e) => handleImporta(e.target.files?.[0])} />
        </label>
      </p>
      {missatge && <p>{missatge}</p>}
    </section>
  );
}
