import { useEffect, useState } from 'react';
import {
  actualitzaRegla,
  aplicaReglaForçada,
  aplicaReglesAMovimentsSenseCategoria,
  createCategoria,
  createRegla,
  deleteCategoria,
  deleteRegla,
  renombraCategoria,
} from '../api/client';
import type { Categoria, ReglaCategoritzacio } from '../api/types';

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
  const [errorRegla, setErrorRegla] = useState<string | null>(null);
  const [editantRegla, setEditantRegla] = useState<string | null>(null);
  const [edicioRegla, setEdicioRegla] = useState<{ patro: string; categoriaId: string } | null>(null);
  const [forçantRegla, setForçantRegla] = useState<string | null>(null);
  const [missatgeForcat, setMissatgeForcat] = useState<string | null>(null);

  // `novaCategoriaRegla` només s'inicialitza un cop (useState); si la
  // categoria seleccionada desapareix (esborrada) o encara no n'hi ha cap
  // seleccionada (primer render, abans que arribi la llista real), cal
  // re-sincronitzar-la explícitament — altrament el <select> mostra una
  // categoria vàlida però l'estat intern queda apuntant a un id obsolet o
  // buit, i la regla es crearia amb una categoria que no toca (o cap).
  useEffect(() => {
    if (categories.length === 0) return;
    if (!categories.some((c) => c.id === novaCategoriaRegla)) {
      setNovaCategoriaRegla(categories[0].id);
    }
  }, [categories, novaCategoriaRegla]);

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
    setErrorRegla(null);
    try {
      await createRegla({ patro: nouPatro.trim(), categoriaId: novaCategoriaRegla, prioritat: regles.length });
      setNouPatro('');
      onChanged();
    } catch (err) {
      setErrorRegla((err as Error).message);
    }
  }

  async function handleEsborraRegla(id: string) {
    await deleteRegla(id);
    onChanged();
  }

  function iniciaEdicioRegla(r: ReglaCategoritzacio) {
    setEditantRegla(r.id);
    setEdicioRegla({ patro: r.patro, categoriaId: r.categoriaId });
    setErrorRegla(null);
  }

  function cancelaEdicioRegla() {
    setEditantRegla(null);
    setEdicioRegla(null);
    setErrorRegla(null);
  }

  async function desaEdicioRegla(id: string) {
    if (!edicioRegla || !edicioRegla.patro.trim() || !edicioRegla.categoriaId) return;
    setErrorRegla(null);
    try {
      await actualitzaRegla(id, { patro: edicioRegla.patro.trim(), categoriaId: edicioRegla.categoriaId });
      cancelaEdicioRegla();
      onChanged();
    } catch (err) {
      setErrorRegla((err as Error).message);
    }
  }

  async function handleAplicaRegles() {
    const n = await aplicaReglesAMovimentsSenseCategoria();
    setAplicantResultat(n);
    onChanged();
  }

  async function handleForcaRegla(r: ReglaCategoritzacio) {
    if (
      !confirm(
        `Forçar la regla "${r.patro}" → ${categoriaNom(r.categoriaId)} sobreescriurà la categoria de TOTS els moviments ` +
          "el concepte dels quals coincideixi amb aquest patró, encara que ja tinguin una categoria assignada (inclosa una " +
          'manual). Continuar?',
      )
    ) {
      return;
    }
    setForçantRegla(r.id);
    setMissatgeForcat(null);
    try {
      const n = await aplicaReglaForçada(r.id);
      setMissatgeForcat(`Regla "${r.patro}": ${n} moviments actualitzats.`);
      onChanged();
    } finally {
      setForçantRegla(null);
    }
  }

  const categoriaNom = (id: string) => categories.find((c) => c.id === id)?.nom ?? `⚠ categoria inexistent (${id})`;

  const reglesOrdenades = [...regles].sort(
    (a, b) => categoriaNom(a.categoriaId).localeCompare(categoriaNom(b.categoriaId)) || a.patro.localeCompare(b.patro),
  );

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
        {reglesOrdenades.map((r) => (
          <li key={r.id}>
            {editantRegla === r.id && edicioRegla ? (
              <>
                <select
                  value={edicioRegla.categoriaId}
                  onChange={(e) => setEdicioRegla({ ...edicioRegla, categoriaId: e.target.value })}
                  autoFocus
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nom}
                    </option>
                  ))}
                </select>{' '}
                ←{' '}
                <input value={edicioRegla.patro} onChange={(e) => setEdicioRegla({ ...edicioRegla, patro: e.target.value })} />{' '}
                <button onClick={() => desaEdicioRegla(r.id)}>Desa</button>{' '}
                <button onClick={cancelaEdicioRegla}>Cancel·la</button>
              </>
            ) : (
              <>
                {categoriaNom(r.categoriaId)} ← "{r.patro}" <button onClick={() => iniciaEdicioRegla(r)}>Edita</button>{' '}
                <button onClick={() => handleEsborraRegla(r.id)}>Esborra</button>{' '}
                <button
                  onClick={() => handleForcaRegla(r)}
                  disabled={forçantRegla !== null}
                  title="Aplica aquesta regla a tots els moviments coincidents, encara que ja tinguin categoria"
                >
                  {forçantRegla === r.id ? 'Forçant…' : 'Força'}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {missatgeForcat && <p>{missatgeForcat}</p>}
      {errorRegla && <p style={{ color: '#c00' }}>{errorRegla}</p>}
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
