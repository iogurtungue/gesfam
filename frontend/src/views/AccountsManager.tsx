import { Fragment, useEffect, useMemo, useState } from 'react';
import { bankLabel } from '../lib/bankLabel';
import { actualitzaCompte, countMovimentsCompte, eliminaCompte } from '../api/client';
import type { AccountType, BankId, Compte } from '../api/types';

interface Props {
  comptes: Compte[];
  onChanged: () => void;
}

const BANCS: BankId[] = ['sabadell', 'bbva', 'ing', 'openbank', 'altre'];
const SENSE_GRUP = '(Sense grup)';

interface FormEdicio {
  alias: string;
  banc: BankId;
  tipus: AccountType;
  numeroCompte: string;
  grup: string;
  ordre: string;
  compteLiquidacioId: string;
  diaLiquidacio: string;
}

function formInicial(c: Compte): FormEdicio {
  return {
    alias: c.alias,
    banc: c.banc,
    tipus: c.tipus,
    numeroCompte: c.ibanOUltimsDigits ?? '',
    grup: c.grup ?? '',
    ordre: c.ordre !== undefined ? String(c.ordre) : '',
    compteLiquidacioId: c.compteLiquidacioId ?? '',
    diaLiquidacio: c.diaLiquidacio !== undefined ? String(c.diaLiquidacio) : '',
  };
}

/** Gestió de comptes: editar totes les dades, agrupar-los (p. ex. Família/Empresa) i eliminar comptes sense moviments associats. */
export function AccountsManager({ comptes, onChanged }: Props) {
  const [comptatges, setComptatges] = useState<Record<string, number>>({});
  const [editant, setEditant] = useState<string | null>(null);
  const [form, setForm] = useState<FormEdicio | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all(comptes.map(async (c) => [c.id, await countMovimentsCompte(c.id)] as const)).then((entrades) =>
      setComptatges(Object.fromEntries(entrades)),
    );
  }, [comptes]);

  // Els comptes ja arriben ordenats per `ordre` des del backend; aquí només
  // cal agrupar-los per `grup` mantenint aquest ordre relatiu, amb els comptes
  // sense grup sempre a la secció final.
  const grups = useMemo(() => {
    const ordreGrups: string[] = [];
    const perGrup = new Map<string, Compte[]>();
    for (const c of comptes) {
      const nom = c.grup?.trim() || SENSE_GRUP;
      if (!perGrup.has(nom)) {
        ordreGrups.push(nom);
        perGrup.set(nom, []);
      }
      perGrup.get(nom)!.push(c);
    }
    ordreGrups.sort((a, b) => (a === SENSE_GRUP ? 1 : b === SENSE_GRUP ? -1 : 0));
    return ordreGrups.map((nom) => [nom, perGrup.get(nom)!] as const);
  }, [comptes]);

  const nomsGrupExistents = useMemo(
    () => [...new Set(comptes.map((c) => c.grup?.trim()).filter((g): g is string => !!g))],
    [comptes],
  );
  const comptesCorrent = comptes.filter((c) => c.tipus === 'corrent');

  function iniciaEdicio(c: Compte) {
    setEditant(c.id);
    setForm(formInicial(c));
    setError(null);
  }

  function cancelaEdicio() {
    setEditant(null);
    setForm(null);
  }

  async function desaEdicio(compteId: string) {
    if (!form) return;
    setError(null);
    try {
      await actualitzaCompte(compteId, {
        alias: form.alias.trim(),
        banc: form.banc,
        tipus: form.tipus,
        numeroCompte: form.numeroCompte.trim() || null,
        grup: form.grup.trim() || null,
        ordre: form.ordre.trim() === '' ? null : Number(form.ordre),
        compteLiquidacioId: form.tipus === 'targeta' && form.compteLiquidacioId ? form.compteLiquidacioId : null,
        diaLiquidacio: form.tipus === 'targeta' && form.diaLiquidacio.trim() !== '' ? Number(form.diaLiquidacio) : null,
      });
      cancelaEdicio();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleElimina(compteId: string) {
    if (!confirm('Eliminar aquest compte? Aquesta acció no es pot desfer.')) return;
    setError(null);
    try {
      await eliminaCompte(compteId);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section>
      <h2>Comptes</h2>
      {error && <p style={{ color: '#c00' }}>{error}</p>}
      {comptes.length === 0 ? (
        <p>Encara no hi ha cap compte. Importa un extracte per crear-ne un.</p>
      ) : (
        grups.map(([nomGrup, comptesGrup]) => (
          <div key={nomGrup} style={{ marginBottom: 20 }}>
            <h3>{nomGrup}</h3>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={cellStyle}>Àlies</th>
                  <th style={cellStyle}>Banc</th>
                  <th style={cellStyle}>Tipus</th>
                  <th style={cellStyle}>Número</th>
                  <th style={cellStyle}>Ordre</th>
                  <th style={cellStyle}>Moviments</th>
                  <th style={cellStyle} />
                </tr>
              </thead>
              <tbody>
                {comptesGrup.map((c) => {
                  const nMoviments = comptatges[c.id];
                  const potEliminar = nMoviments === 0;
                  const editantAquest = editant === c.id;
                  return (
                    <Fragment key={c.id}>
                      <tr>
                        <td style={cellStyle}>{c.alias}</td>
                        <td style={cellStyle}>{bankLabel(c.banc)}</td>
                        <td style={cellStyle}>{c.tipus === 'targeta' ? 'Targeta' : 'Compte corrent'}</td>
                        <td style={cellStyle}>{c.ibanOUltimsDigits ?? '—'}</td>
                        <td style={cellStyle}>{c.ordre ?? '—'}</td>
                        <td style={cellStyle}>{nMoviments ?? '…'}</td>
                        <td style={cellStyle}>
                          <button onClick={() => (editantAquest ? cancelaEdicio() : iniciaEdicio(c))}>
                            {editantAquest ? 'Cancel·la' : 'Edita'}
                          </button>{' '}
                          <button
                            onClick={() => handleElimina(c.id)}
                            disabled={!potEliminar}
                            title={potEliminar ? undefined : 'No es pot eliminar: té moviments associats'}
                          >
                            Elimina
                          </button>
                        </td>
                      </tr>
                      {editantAquest && form && (
                        <tr>
                          <td colSpan={7} style={{ ...cellStyle, background: '#f7f7f7' }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
                              <label>
                                Àlies
                                <br />
                                <input value={form.alias} onChange={(e) => setForm({ ...form, alias: e.target.value })} />
                              </label>
                              <label>
                                Banc
                                <br />
                                <select value={form.banc} onChange={(e) => setForm({ ...form, banc: e.target.value as BankId })}>
                                  {BANCS.map((b) => (
                                    <option key={b} value={b}>
                                      {bankLabel(b)}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                Tipus
                                <br />
                                <select value={form.tipus} onChange={(e) => setForm({ ...form, tipus: e.target.value as AccountType })}>
                                  <option value="corrent">Compte corrent</option>
                                  <option value="targeta">Targeta</option>
                                </select>
                              </label>
                              <label>
                                Número
                                <br />
                                <input
                                  value={form.numeroCompte}
                                  onChange={(e) => setForm({ ...form, numeroCompte: e.target.value })}
                                />
                              </label>
                              <label>
                                Grup
                                <br />
                                <input
                                  value={form.grup}
                                  onChange={(e) => setForm({ ...form, grup: e.target.value })}
                                  list="gesfam-grups-existents"
                                  placeholder="p. ex. Família"
                                />
                              </label>
                              <label>
                                Ordre
                                <br />
                                <input
                                  type="number"
                                  style={{ width: 70 }}
                                  value={form.ordre}
                                  onChange={(e) => setForm({ ...form, ordre: e.target.value })}
                                />
                              </label>
                              {form.tipus === 'targeta' && (
                                <>
                                  <label>
                                    Compte de liquidació
                                    <br />
                                    <select
                                      value={form.compteLiquidacioId}
                                      onChange={(e) => setForm({ ...form, compteLiquidacioId: e.target.value })}
                                    >
                                      <option value="">— cap —</option>
                                      {comptesCorrent
                                        .filter((cc) => cc.id !== c.id)
                                        .map((cc) => (
                                          <option key={cc.id} value={cc.id}>
                                            {cc.alias}
                                          </option>
                                        ))}
                                    </select>
                                  </label>
                                  <label>
                                    Dia de liquidació
                                    <br />
                                    <input
                                      type="number"
                                      min={1}
                                      max={31}
                                      style={{ width: 60 }}
                                      value={form.diaLiquidacio}
                                      onChange={(e) => setForm({ ...form, diaLiquidacio: e.target.value })}
                                    />
                                  </label>
                                </>
                              )}
                              <button onClick={() => desaEdicio(c.id)}>Desa</button>
                              <button onClick={cancelaEdicio}>Cancel·la</button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))
      )}
      <datalist id="gesfam-grups-existents">
        {nomsGrupExistents.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
    </section>
  );
}

const cellStyle: React.CSSProperties = { border: '1px solid #ccc', padding: '4px 8px' };
