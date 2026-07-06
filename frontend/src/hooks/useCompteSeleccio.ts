import { useEffect, useMemo, useState } from 'react';
import type { Compte } from '../api/types';

const STORAGE_KEY = 'gesfam.compteSeleccio';

export function esborraSeleccioDesada(): void {
  localStorage.removeItem(STORAGE_KEY);
}

function llegeixSeleccioDesada(): string[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Global multi-account selector (spec 3.5): "un compte, una combinació
 * lliure de comptes o tots alhora", persisted across sessions and shared by
 * every query view. Selection is stored as an explicit id list in
 * localStorage; if nothing is stored yet (first run) or a stored id no
 * longer exists (account deleted), it falls back to "select everything
 * currently available" rather than showing an empty view.
 */
export function useCompteSeleccio(comptes: Compte[]) {
  const [idsSeleccionats, setIdsSeleccionats] = useState<Set<string>>(new Set());
  const [inicialitzat, setInicialitzat] = useState(false);

  useEffect(() => {
    if (inicialitzat || comptes.length === 0) return;
    const desat = llegeixSeleccioDesada();
    if (desat) {
      const valids = desat.filter((id) => comptes.some((c) => c.id === id));
      setIdsSeleccionats(new Set(valids.length > 0 ? valids : comptes.map((c) => c.id)));
    } else {
      setIdsSeleccionats(new Set(comptes.map((c) => c.id)));
    }
    setInicialitzat(true);
  }, [comptes, inicialitzat]);

  useEffect(() => {
    if (!inicialitzat) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...idsSeleccionats]));
  }, [idsSeleccionats, inicialitzat]);

  const seleccionats = useMemo(() => comptes.filter((c) => idsSeleccionats.has(c.id)), [comptes, idsSeleccionats]);

  function toggleCompte(id: string) {
    setIdsSeleccionats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function seleccionaTots() {
    setIdsSeleccionats(new Set(comptes.map((c) => c.id)));
  }

  function seleccionaCap() {
    setIdsSeleccionats(new Set());
  }

  return {
    idsSeleccionats,
    seleccionats,
    toggleCompte,
    seleccionaTots,
    seleccionaCap,
    isSelected: (id: string) => idsSeleccionats.has(id),
  };
}
