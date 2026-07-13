import type {
  AccountType,
  Backup,
  BackupFileInfo,
  BankId,
  Categoria,
  ColumnMapping,
  CommitImportResult,
  Compte,
  DadesRecurrent,
  ImportaRecurrentsResult,
  ImportOutcome,
  LotImportacio,
  Moviment,
  ParsedMoviment,
  ParsedRecurrentImport,
  PeriodicitatRecurrent,
  Previsio,
  PrevisualitzacioRecurrentsResult,
  Recurrent,
  ReglaCategoritzacio,
  ReglaLiquidacioTargeta,
  ResultatMarcaLiquidacio,
  SuggerimentAmbDetall,
  SuggerimentLiquidacio,
  SuggerimentTransferencia,
} from './types';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as Record<string, string>);
    throw new Error(body.error || body.message || `Error ${res.status} a ${path}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function json(body: unknown): RequestInit {
  return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

// --- Comptes ---

export function listComptes(): Promise<Compte[]> {
  return req('/comptes');
}

export function createCompte(data: { banc: BankId; tipus: AccountType; alias: string; numeroCompte?: string }): Promise<Compte> {
  return req('/comptes', { method: 'POST', ...json(data) });
}

export async function findMatchingCompte(banc: BankId, tipus: AccountType, numeroCompte?: string): Promise<Compte | undefined> {
  if (!numeroCompte) return undefined;
  const comptes = await listComptes();
  return comptes.find((c) => c.banc === banc && c.tipus === tipus && c.ibanOUltimsDigits === numeroCompte);
}

export interface ActualitzacioCompte {
  alias?: string;
  banc?: BankId;
  tipus?: AccountType;
  numeroCompte?: string | null;
  compteLiquidacioId?: string | null;
  diaLiquidacio?: number | null;
  ordre?: number | null;
  grup?: string | null;
}

export function actualitzaCompte(compteId: string, data: ActualitzacioCompte): Promise<void> {
  return req(`/comptes/${compteId}`, { method: 'PATCH', ...json(data) });
}

export async function countMovimentsCompte(compteId: string): Promise<number> {
  const moviments = await listMovimentsPerComptes([compteId]);
  return moviments.length;
}

export function eliminaCompte(compteId: string): Promise<void> {
  return req(`/comptes/${compteId}`, { method: 'DELETE' });
}

// --- Lots ---

export function listLots(): Promise<LotImportacio[]> {
  return req('/lots');
}

export function undoLot(lotId: string): Promise<void> {
  return req(`/lots/${lotId}`, { method: 'DELETE' });
}

// --- Moviments ---

export function listMovimentsPerComptes(compteIds: string[]): Promise<Moviment[]> {
  if (compteIds.length === 0) return Promise.resolve([]);
  return req(`/moviments?compteIds=${compteIds.map(encodeURIComponent).join(',')}`);
}

export function setMovimentCategoria(movimentId: string, categoriaId: string | undefined): Promise<void> {
  return req(`/moviments/${movimentId}`, { method: 'PATCH', ...json({ categoriaId: categoriaId ?? null }) });
}

export function setTransferenciaInterna(movimentId: string, value: boolean): Promise<void> {
  return req(`/moviments/${movimentId}`, { method: 'PATCH', ...json({ esTransferenciaInterna: value }) });
}

export function eliminaMoviment(movimentId: string): Promise<void> {
  return req(`/moviments/${movimentId}`, { method: 'DELETE' });
}

// --- Categories i regles ---

export function listCategories(): Promise<Categoria[]> {
  return req('/categories');
}

export function createCategoria(nom: string): Promise<Categoria> {
  return req('/categories', { method: 'POST', ...json({ nom }) });
}

export function renombraCategoria(categoriaId: string, nom: string): Promise<void> {
  return req(`/categories/${categoriaId}`, { method: 'PATCH', ...json({ nom }) });
}

export function deleteCategoria(id: string): Promise<void> {
  return req(`/categories/${id}`, { method: 'DELETE' });
}

export function listRegles(): Promise<ReglaCategoritzacio[]> {
  return req('/regles');
}

export function createRegla(data: { patro: string; categoriaId: string; prioritat: number }): Promise<ReglaCategoritzacio> {
  return req('/regles', { method: 'POST', ...json(data) });
}

export function actualitzaRegla(id: string, data: { patro?: string; categoriaId?: string }): Promise<void> {
  return req(`/regles/${id}`, { method: 'PATCH', ...json(data) });
}

export function deleteRegla(id: string): Promise<void> {
  return req(`/regles/${id}`, { method: 'DELETE' });
}

export async function aplicaReglesAMovimentsSenseCategoria(): Promise<number> {
  const { actualitzats } = await req<{ actualitzats: number }>('/regles/aplica', { method: 'POST' });
  return actualitzats;
}

// --- Transferències internes ---

export function suggereixTransferencies(): Promise<SuggerimentAmbDetall[]> {
  return req('/transferencies/suggeriments');
}

export function confirmaTransferencia(suggeriment: SuggerimentTransferencia): Promise<void> {
  return req('/transferencies/confirma', { method: 'POST', ...json(suggeriment) });
}

export function descartaTransferencia(suggeriment: SuggerimentTransferencia): Promise<void> {
  return req('/transferencies/descarta', { method: 'POST', ...json(suggeriment) });
}

// --- Liquidacions de targeta (especificacio.md 3.2.1) ---

export function listReglesLiquidacio(): Promise<ReglaLiquidacioTargeta[]> {
  return req('/liquidacions/regles');
}

export function createReglaLiquidacio(data: { patro: string; targetaCompteId: string }): Promise<ReglaLiquidacioTargeta> {
  return req('/liquidacions/regles', { method: 'POST', ...json(data) });
}

export function deleteReglaLiquidacio(id: string): Promise<void> {
  return req(`/liquidacions/regles/${id}`, { method: 'DELETE' });
}

export function suggereixLiquidacionsTargeta(): Promise<SuggerimentLiquidacio[]> {
  return req('/liquidacions/suggeriments');
}

export function marcaLiquidacioTargeta(movimentId: string, targetaCompteId: string): Promise<ResultatMarcaLiquidacio> {
  return req('/liquidacions/marca', { method: 'POST', ...json({ movimentId, targetaCompteId }) });
}

export function desmarcaLiquidacioTargeta(movimentId: string): Promise<void> {
  return req('/liquidacions/desmarca', { method: 'POST', ...json({ movimentId }) });
}

// --- Recurrents (especificacio.md 4.1, 4.2) ---

export function listRecurrents(): Promise<Recurrent[]> {
  return req('/recurrents');
}

export function creaRecurrentManual(data: DadesRecurrent): Promise<Recurrent> {
  return req('/recurrents', { method: 'POST', ...json(data) });
}

export function actualitzaRecurrent(
  id: string,
  data: Partial<{
    compteId: string;
    concepte: string;
    periodicitat: PeriodicitatRecurrent;
    importCents: number;
    importAproximat: boolean;
    dataPrevista: string;
    dataFi: string | null;
    categoriaId: string | null;
    referencia: string | null;
    esTransferenciaInterna: boolean;
  }>,
): Promise<void> {
  return req(`/recurrents/${id}`, { method: 'PATCH', ...json(data) });
}

export function eliminaRecurrent(id: string): Promise<void> {
  return req(`/recurrents/${id}`, { method: 'DELETE' });
}

/** Descarta una ocurrència prevista des de la pestanya de Previsió (especificacio.md 4.3): elimina el recurrent sencer si és puntual (`unica`), o avança `dataPrevista` a la propera repetició si és periòdic. */
export function eliminaOcurrenciaPrevista(recurrentId: string, data: string): Promise<void> {
  return req(`/recurrents/${recurrentId}/elimina-ocurrencia`, { method: 'POST', ...json({ data }) });
}

export async function previsualitzaImportacioRecurrents(file: File): Promise<PrevisualitzacioRecurrentsResult> {
  const form = new FormData();
  form.append('fitxer', file);
  return req('/recurrents/importacio/previsualitza', { method: 'POST', body: form });
}

export function confirmaImportacioRecurrents(compteId: string, recurrents: ParsedRecurrentImport[]): Promise<ImportaRecurrentsResult> {
  return req('/recurrents/importacio/confirma', { method: 'POST', ...json({ compteId, recurrents }) });
}

// --- Previsió (especificacio.md 4.3, sub-fase 4.1) ---

export function calculaPrevisio(compteIds: string[], horitzoDies: number): Promise<Previsio> {
  if (compteIds.length === 0) return Promise.resolve({ saldosInicials: {}, esdeveniments: [], serieDiaria: [] });
  return req(`/previsio?compteIds=${compteIds.map(encodeURIComponent).join(',')}&horitzoDies=${horitzoDies}`);
}

// --- Còpia de seguretat ---

export function exportaCopiaSeguretat(): Promise<Backup> {
  return req('/backup');
}

export function importaCopiaSeguretat(backup: Backup): Promise<void> {
  return req('/backup', { method: 'POST', ...json(backup) });
}

// --- Manteniment ---

export function eliminaTotsElsMoviments(): Promise<void> {
  return req('/manteniment/elimina-moviments', { method: 'POST' });
}

export function reinicialitzaBaseDades(): Promise<void> {
  return req('/manteniment/reinicialitza', { method: 'POST' });
}

export function listBackupFiles(): Promise<BackupFileInfo[]> {
  return req('/manteniment/backups');
}

export function creaCopiaSeguretatDb(): Promise<BackupFileInfo | null> {
  return req('/manteniment/backups', { method: 'POST' });
}

export function restoreBackup(filename: string): Promise<void> {
  return req(`/manteniment/backups/${encodeURIComponent(filename)}/restaura`, { method: 'POST' });
}

// --- Importació (spec 3.1) — parsing/dedup happen on the backend now ---

export async function importFile(file: File): Promise<ImportOutcome> {
  const form = new FormData();
  form.append('fitxer', file);
  return req('/importacio/previsualitza', { method: 'POST', body: form });
}

export async function previsualitzaManual(file: File, mapping: ColumnMapping): Promise<ImportOutcome> {
  const form = new FormData();
  form.append('fitxer', file);
  form.append('mapping', JSON.stringify(mapping));
  return req('/importacio/previsualitza-manual', { method: 'POST', body: form });
}

export function commitImport(
  compte: { id: string } | { banc: BankId; tipus: AccountType; alias: string; numeroCompte?: string },
  moviments: ParsedMoviment[],
  fitxerOrigen: string,
): Promise<CommitImportResult> {
  return req('/importacio/confirma', { method: 'POST', ...json({ compte, moviments, fitxerOrigen }) });
}
