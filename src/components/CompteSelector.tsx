import type { Compte } from '../db/types';
import type { useCompteSeleccio } from '../hooks/useCompteSeleccio';

interface Props {
  comptes: Compte[];
  seleccio: ReturnType<typeof useCompteSeleccio>;
}

/** Shared global account selector rendered atop every query view (spec 3.5). */
export function CompteSelector({ comptes, seleccio }: Props) {
  if (comptes.length === 0) return null;

  return (
    <div style={{ border: '1px solid #ccc', padding: 8, marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <strong>Comptes:</strong>
      {comptes.map((c) => (
        <label key={c.id} style={{ whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={seleccio.isSelected(c.id)} onChange={() => seleccio.toggleCompte(c.id)} /> {c.alias}
        </label>
      ))}
      <button type="button" onClick={seleccio.seleccionaTots}>
        Tots
      </button>
      <button type="button" onClick={seleccio.seleccionaCap}>
        Cap
      </button>
    </div>
  );
}
