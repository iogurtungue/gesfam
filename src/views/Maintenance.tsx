import { useState } from 'react';
import { eliminaTotsElsMoviments, exportaCopiaSeguretat, reinicialitzaBaseDades } from '../db/operations';
import { esborraSeleccioDesada } from '../hooks/useCompteSeleccio';
import { avui } from '../lib/dates';

interface Props {
  onReset: () => void;
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
