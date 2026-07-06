import { useState } from 'react';
import {
  aplicaReglesAMovimentsSenseCategoria,
  createCategoria,
  createRegla,
  deleteCategoria,
  deleteRegla,
  renombraCategoria,
} from '../db/operations';
import type { Categoria, ReglaCategoritzacio } from '../db/types';

interface Props {
  categories: Categoria[];
  regles: ReglaCategoritzacio[];
  onChanged: () => void;
}

/** Spec 3.4: llista editable de categories (ordenades alfabèticament per listCategories) + regles de categorització automàtica. */
export function CategoriesManager({ categories, regles, onChanged }: Props) {
  const [novaCategoria, setNovaCategoria] = useState('');
  const [nouPatro, setNouPatro] = useState('');
  const [novaCategoriaRegla, setNovaCategoriaRegla] = useState(categories[0]?.id ?? '');
  const [aplicantResultat, setAplicantResultat] = useState<number | null>(null);
  const [editant, setEditant] = useState<string | null>(null);
  const [nomEdicio, setNomEdicio] = useState('');

  async function handleAfegeixCategoria(e: React.FormEvent) {
    e.preventDefault();
    if (!novaCategoria.trim()) return;
    await createCategoria(novaCategoria.trim());
    setNovaCategoria('');
    onChanged();
  }

  function iniciaEdicio(c: Categoria) {
    setEditant(c.id);
    setNomEdicio(c.nom);
  }

  async function desaEdicio(id: string) {
    const nom = nomEdicio.trim();
    if (nom) await renombraCategoria(id, nom);
    setEditant(null);
    onChanged();
  }

  async function handleEsborraCategoria(id: string) {
    if (!confirm('Esborrar aquesta categoria? Els moviments que la tinguin assignada quedaran sense categoria.')) return;
    await deleteCategoria(id);
    onChanged();
  }

  async function handleAfegeixRegla(e: React.FormEvent) {
    e.preventDefault();
    if (!nouPatro.trim() || !novaCategoriaRegla) return;
    await createRegla({ patro: nouPatro.trim(), categoriaId: novaCategoriaRegla, prioritat: regles.length });
    setNouPatro('');
    onChanged();
  }

  async function handleEsborraRegla(id: string) {
    await deleteRegla(id);
    onChanged();
  }

  async function handleAplicaRegles() {
    const n = await aplicaReglesAMovimentsSenseCategoria();
    setAplicantResultat(n);
    onChanged();
  }

  const categoriaNom = (id: string) => categories.find((c) => c.id === id)?.nom ?? id;

  return (
    <section>
      <h2>Categories i regles</h2>

      <h3>Categories</h3>
      <ul>
        {categories.map((c) => (
          <li key={c.id}>
            {editant === c.id ? (
              <>
                <input value={nomEdicio} onChange={(e) => setNomEdicio(e.target.value)} autoFocus />{' '}
                <button onClick={() => desaEdicio(c.id)}>Desa</button>{' '}
                <button onClick={() => setEditant(null)}>Cancel·la</button>
              </>
            ) : (
              <>
                {c.nom} <button onClick={() => iniciaEdicio(c)}>Edita</button>{' '}
                <button onClick={() => handleEsborraCategoria(c.id)}>Esborra</button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={handleAfegeixCategoria}>
        <input value={novaCategoria} onChange={(e) => setNovaCategoria(e.target.value)} placeholder="Nom de la categoria" />
        <button type="submit">Afegeix categoria</button>
      </form>

      <h3>Regles de categorització automàtica</h3>
      <p>Si el concepte conté el patró indicat, s'assigna la categoria automàticament en importar.</p>
      <ul>
        {regles.map((r) => (
          <li key={r.id}>
            "{r.patro}" → {categoriaNom(r.categoriaId)} <button onClick={() => handleEsborraRegla(r.id)}>Esborra</button>
          </li>
        ))}
      </ul>
      <form onSubmit={handleAfegeixRegla}>
        <input value={nouPatro} onChange={(e) => setNouPatro(e.target.value)} placeholder="p.ex. ENDESA" />
        <select value={novaCategoriaRegla} onChange={(e) => setNovaCategoriaRegla(e.target.value)}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nom}
            </option>
          ))}
        </select>
        <button type="submit">Afegeix regla</button>
      </form>

      <p>
        <button onClick={handleAplicaRegles}>Aplica les regles als moviments sense categoria</button>
        {aplicantResultat !== null && <span> — {aplicantResultat} moviments actualitzats.</span>}
      </p>
    </section>
  );
}
