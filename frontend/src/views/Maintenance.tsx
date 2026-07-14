import { useEffect, useState } from 'react';
import {
  creaCopiaSeguretatDb,
  eliminaTotsElsMoviments,
  exportaCopiaSeguretat,
  importaCopiaSeguretat,
  listBackupFiles,
  reinicialitzaBaseDades,
  restoreBackup,
} from '../api/client';
import { esborraSeleccioDesada } from '../hooks/useCompteSeleccio';
import { avui, formatDateEs } from '../lib/dates';
import type { Backup as BackupData, BackupFileInfo } from '../api/types';

interface Props {
  onReset: () => void;
}

function formatDataHora(iso: string): string {
  const d = new Date(iso);
  const data = formatDateEs(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  const hora = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  return `${data} ${hora}`;
}

function formatMida(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Llista les còpies de seguretat automàtiques del fitxer .db (creades sols
 * abans de cada importació/operació destructiva, spec secció 2) i permet
 * restaurar-ne una. Diferent de la còpia JSON manual de la pestanya "Còpia
 * de seguretat": aquestes viuen només en aquesta màquina i no es poden
 * descarregar, però abans no hi havia cap manera de recuperar-les sense
 * aturar el servidor i copiar el fitxer a mà.
 */
function RestauraCopies({ onRestaurat }: { onRestaurat: () => void }) {
  const [backups, setBackups] = useState<BackupFileInfo[]>([]);
  const [restaurant, setRestaurant] = useState<string | null>(null);
  const [creant, setCreant] = useState(false);
  const [missatge, setMissatge] = useState<string | null>(null);

  function carrega() {
    listBackupFiles().then(setBackups);
  }

  useEffect(() => {
    carrega();
  }, []);

  async function handleCrea() {
    setCreant(true);
    setMissatge(null);
    try {
      const nova = await creaCopiaSeguretatDb();
      setMissatge(nova ? `Còpia de seguretat creada (${formatDataHora(nova.creatEl)}).` : 'No hi ha cap base de dades encara per copiar.');
      carrega();
    } catch (err) {
      setMissatge(`Error creant la còpia de seguretat: ${(err as Error).message}`);
    } finally {
      setCreant(false);
    }
  }

  async function handleRestaura(b: BackupFileInfo) {
    if (
      !confirm(
        `Restaurar la còpia del ${formatDataHora(b.creatEl)} substituirà TOTES les dades actuals per les d'aquell moment. ` +
          "Es farà primer una còpia de l'estat actual (per si cal desfer-ho), però qualsevol canvi fet des d'aquella còpia " +
          'es perdrà. Continuar?',
      )
    ) {
      return;
    }
    setRestaurant(b.filename);
    setMissatge(null);
    try {
      await restoreBackup(b.filename);
      setMissatge(`Restaurada la còpia del ${formatDataHora(b.creatEl)}.`);
      carrega();
      onRestaurat();
    } catch (err) {
      setMissatge(`Error restaurant: ${(err as Error).message}`);
    } finally {
      setRestaurant(null);
    }
  }

  return (
    <div style={{ border: '1px solid #999', padding: 12, marginBottom: 16 }}>
      <h3>Còpies de seguretat automàtiques</h3>
      <p>
        Còpies del fitxer de dades fetes automàticament abans de cada importació o operació destructiva (el nombre que es
        conserva es configura a la pestanya "Configuració"). Restaurar-ne una substitueix totes les dades actuals.
      </p>
      <p>
        <button onClick={handleCrea} disabled={creant}>
          {creant ? 'Creant…' : 'Fes una còpia de seguretat ara'}
        </button>
      </p>
      {backups.length === 0 ? (
        <p>No hi ha cap còpia de seguretat automàtica encara.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '2px 8px' }}>Data</th>
              <th style={{ textAlign: 'right', padding: '2px 8px' }}>Mida</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {backups.map((b) => (
              <tr key={b.filename}>
                <td style={{ padding: '2px 8px' }}>{formatDataHora(b.creatEl)}</td>
                <td style={{ padding: '2px 8px', textAlign: 'right' }}>{formatMida(b.midaBytes)}</td>
                <td style={{ padding: '2px 8px' }}>
                  <button onClick={() => handleRestaura(b)} disabled={restaurant !== null}>
                    {restaurant === b.filename ? 'Restaurant…' : 'Restaura'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {missatge && <p>{missatge}</p>}
    </div>
  );
}

async function descarregaCopiaSeguretat() {
  const backup = await exportaCopiaSeguretat();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gesfam-copia-seguretat-${avui()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

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

/** NFR secció 2: còpia de seguretat completa en JSON, perquè l'usuari no perdi res en canviar de navegador. */
function CopiaSeguretatJSON({ onImportat }: { onImportat: () => void }) {
  const [missatge, setMissatge] = useState<string | null>(null);

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
      onImportat();
    } catch (err) {
      setMissatge(`Error important el fitxer: ${(err as Error).message}`);
    }
  }

  return (
    <div style={{ border: '1px solid #999', padding: 12, marginBottom: 16 }}>
      <h3>Còpia de seguretat (JSON)</h3>
      <p>
        Exporta totes les dades (comptes, moviments, lots, categories i regles) a un fitxer JSON descarregable, útil per
        guardar-lo fora d'aquest ordinador o per canviar de navegador/dispositiu. Importar-ne un substitueix totes les dades
        actuals.
      </p>
      <p>
        <button onClick={descarregaCopiaSeguretat}>Exportar còpia de seguretat (JSON)</button>
      </p>
      <p>
        <label>
          Importar còpia de seguretat: <input type="file" accept=".json" onChange={(e) => handleImporta(e.target.files?.[0])} />
        </label>
      </p>
      {missatge && <p>{missatge}</p>}
    </div>
  );
}

interface ZonaPerillProps {
  titol: string;
  descripcio: string;
  fraseConfirmacio: string;
  missatgeConfirm: string;
  etiquetaBoto: string;
  onExecuta: () => Promise<void>;
}

/** Bloc reutilitzable de "zona de perill": exigeix escriure una frase exacta + un confirm() del navegador abans d'executar una acció destructiva. */
function ZonaPerill({ titol, descripcio, fraseConfirmacio, missatgeConfirm, etiquetaBoto, onExecuta }: ZonaPerillProps) {
  const [frase, setFrase] = useState('');
  const [executant, setExecutant] = useState(false);
  const [fet, setFet] = useState(false);

  const habilitat = frase.trim() === fraseConfirmacio;

  async function handleExecuta() {
    if (!habilitat) return;
    if (!confirm(missatgeConfirm)) return;
    setExecutant(true);
    try {
      await onExecuta();
      setFrase('');
      setFet(true);
    } finally {
      setExecutant(false);
    }
  }

  return (
    <div style={{ border: '1px solid #c00', padding: 12, marginBottom: 16 }}>
      <h3>{titol}</h3>
      <p>{descripcio}</p>
      <p>
        <button onClick={descarregaCopiaSeguretat}>Fes primer una còpia de seguretat (recomanat)</button>
      </p>
      <p>
        Per confirmar, escriu <code>{fraseConfirmacio}</code> al quadre i prem el botó:
      </p>
      <p>
        <input value={frase} onChange={(e) => setFrase(e.target.value)} placeholder={fraseConfirmacio} />
      </p>
      <p>
        <button onClick={handleExecuta} disabled={!habilitat || executant} style={{ color: habilitat ? '#c00' : undefined }}>
          {executant ? 'Executant…' : etiquetaBoto}
        </button>
      </p>
      {fet && <p>Fet correctament.</p>}
    </div>
  );
}

/** Menú de manteniment: accions destructives amb confirmació explícita. */
export function Maintenance({ onReset }: Props) {
  return (
    <section>
      <h2>Manteniment</h2>

      <RestauraCopies onRestaurat={onReset} />

      <CopiaSeguretatJSON onImportat={onReset} />

      <ZonaPerill
        titol="Eliminar només els moviments"
        descripcio={
          "Elimina tots els moviments i els lots d'importació associats, però manté intactes els comptes, les categories " +
          "i les regles de categorització. Útil per tornar a importar els extractes des de zero (p. ex. si es corregeix " +
          "un parser) sense haver de tornar a configurar comptes ni regles. No es pot desfer."
        }
        fraseConfirmacio="ESBORRA MOVIMENTS"
        missatgeConfirm="Aquesta acció esborrarà TOTS els moviments i lots d'importació (mantenint comptes, categories i regles). Continuar?"
        etiquetaBoto="Eliminar tots els moviments"
        onExecuta={async () => {
          await eliminaTotsElsMoviments();
          onReset();
        }}
      />

      <ZonaPerill
        titol="Reinicialitzar la base de dades sencera"
        descripcio={
          "Elimina totes les dades emmagatzemades localment (comptes, moviments, lots d'importació, categories i " +
          "regles) i deixa l'aplicació com acabada d'instal·lar. No es pot desfer."
        }
        fraseConfirmacio="ESBORRA-HO TOT"
        missatgeConfirm="Aquesta acció esborrarà TOTS els comptes, moviments, lots, categories i regles, sense possibilitat de desfer-ho. Continuar?"
        etiquetaBoto="Eliminar totes les dades i reinicialitzar"
        onExecuta={async () => {
          await reinicialitzaBaseDades();
          esborraSeleccioDesada();
          onReset();
        }}
      />
    </section>
  );
}
