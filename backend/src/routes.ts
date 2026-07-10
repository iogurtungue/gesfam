import { Router } from 'express';
import multer from 'multer';
import * as ops from './db/operations.ts';
import type { Backup } from './db/operations.ts';
import { backupDbFile, listBackupFiles, restoreBackup } from './db/backupFile.ts';
import { applyColumnMapping, type ColumnMapping } from './parsers/columnMapping.ts';
import { importFile, readRawTable } from './parsers/importFile.ts';
import type { AccountType, BankId, ParsedMoviment } from './parsers/types.ts';
import type { SuggerimentTransferencia } from './lib/internalTransfers.ts';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export const router: Router = Router();

// --- Comptes ---

router.get('/comptes', (_req, res) => {
  res.json(ops.listComptes());
});

router.post('/comptes', (req, res) => {
  const { banc, tipus, alias, numeroCompte } = req.body as { banc: BankId; tipus: AccountType; alias: string; numeroCompte?: string };
  res.status(201).json(ops.createCompte({ banc, tipus, alias, numeroCompte }));
});

router.patch('/comptes/:id', (req, res) => {
  const { alias, banc, tipus, numeroCompte, compteLiquidacioId, diaLiquidacio, ordre, grup } = req.body as ops.ActualitzacioCompte;
  try {
    ops.actualitzaCompte(req.params.id, { alias, banc, tipus, numeroCompte, compteLiquidacioId, diaLiquidacio, ordre, grup });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.delete('/comptes/:id', (req, res) => {
  try {
    ops.eliminaCompte(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(409).json({ error: (err as Error).message });
  }
});

// --- Lots ---

router.get('/lots', (_req, res) => {
  res.json(ops.listLots());
});

router.delete('/lots/:id', (req, res) => {
  ops.undoLot(req.params.id);
  res.json({ ok: true });
});

// --- Moviments ---

router.get('/moviments', (req, res) => {
  const raw = req.query.compteIds;
  const compteIds = typeof raw === 'string' ? raw.split(',').filter(Boolean) : [];
  res.json(ops.listMovimentsPerComptes(compteIds));
});

router.patch('/moviments/:id', (req, res) => {
  const body = req.body as { categoriaId?: string | null; esTransferenciaInterna?: boolean };
  try {
    if ('categoriaId' in body) ops.setMovimentCategoria(req.params.id, body.categoriaId ?? undefined);
    if ('esTransferenciaInterna' in body) ops.setTransferenciaInterna(req.params.id, !!body.esTransferenciaInterna);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// --- Categories i regles ---

router.get('/categories', (_req, res) => {
  res.json(ops.listCategories());
});

router.post('/categories', (req, res) => {
  res.status(201).json(ops.createCategoria(req.body.nom as string));
});

router.patch('/categories/:id', (req, res) => {
  ops.renombraCategoria(req.params.id, req.body.nom as string);
  res.json({ ok: true });
});

router.delete('/categories/:id', (req, res) => {
  ops.deleteCategoria(req.params.id);
  res.json({ ok: true });
});

router.get('/regles', (_req, res) => {
  res.json(ops.listRegles());
});

router.post('/regles', (req, res) => {
  const { patro, categoriaId, prioritat } = req.body as { patro: string; categoriaId: string; prioritat: number };
  try {
    res.status(201).json(ops.createRegla({ patro, categoriaId, prioritat }));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.patch('/regles/:id', (req, res) => {
  const { patro, categoriaId } = req.body as { patro?: string; categoriaId?: string };
  try {
    ops.actualitzaRegla(req.params.id, { patro, categoriaId });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.delete('/regles/:id', (req, res) => {
  ops.deleteRegla(req.params.id);
  res.json({ ok: true });
});

router.post('/regles/aplica', (_req, res) => {
  res.json({ actualitzats: ops.aplicaReglesAMovimentsSenseCategoria() });
});

// --- Transferències internes ---

router.get('/transferencies/suggeriments', (_req, res) => {
  res.json(ops.suggereixTransferencies());
});

router.post('/transferencies/confirma', (req, res) => {
  ops.confirmaTransferencia(req.body as SuggerimentTransferencia);
  res.json({ ok: true });
});

// --- Liquidacions de targeta ---

router.get('/liquidacions/regles', (_req, res) => {
  res.json(ops.listReglesLiquidacio());
});

router.post('/liquidacions/regles', (req, res) => {
  const { patro, targetaCompteId } = req.body as { patro: string; targetaCompteId: string };
  try {
    res.status(201).json(ops.createReglaLiquidacio({ patro, targetaCompteId }));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.delete('/liquidacions/regles/:id', (req, res) => {
  ops.deleteReglaLiquidacio(req.params.id);
  res.json({ ok: true });
});

router.get('/liquidacions/suggeriments', (_req, res) => {
  res.json(ops.suggereixLiquidacionsTargeta());
});

router.post('/liquidacions/marca', (req, res) => {
  const { movimentId, targetaCompteId } = req.body as { movimentId: string; targetaCompteId: string };
  try {
    res.json(ops.marcaLiquidacioTargeta(movimentId, targetaCompteId));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/liquidacions/desmarca', (req, res) => {
  const { movimentId } = req.body as { movimentId: string };
  ops.desmarcaLiquidacioTargeta(movimentId);
  res.json({ ok: true });
});

// --- Liquidacions directes de targeta ---

router.get('/liquidacions-directes/regles', (_req, res) => {
  res.json(ops.listReglesLiquidacioDirecta());
});

router.post('/liquidacions-directes/regles', (req, res) => {
  const { patro } = req.body as { patro: string };
  res.status(201).json(ops.createReglaLiquidacioDirecta(patro));
});

router.delete('/liquidacions-directes/regles/:id', (req, res) => {
  ops.deleteReglaLiquidacioDirecta(req.params.id);
  res.json({ ok: true });
});

router.get('/liquidacions-directes/suggeriments-marcatge', (_req, res) => {
  res.json(ops.suggereixMarcatgeLiquidacioDirecta());
});

router.post('/liquidacions-directes/marca', (req, res) => {
  const { movimentId, value } = req.body as { movimentId: string; value: boolean };
  try {
    ops.marcaEsLiquidacioDirecta(movimentId, value);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/liquidacions-directes/suggeriments-aparellament', (_req, res) => {
  res.json(ops.suggereixAparellamentsDirectes());
});

router.post('/liquidacions-directes/aparella', (req, res) => {
  const { targetaMovimentId, correntMovimentId } = req.body as { targetaMovimentId: string; correntMovimentId: string };
  try {
    ops.aparellaLiquidacioDirecta(targetaMovimentId, correntMovimentId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/liquidacions-directes/desaparella', (req, res) => {
  const { targetaMovimentId } = req.body as { targetaMovimentId: string };
  ops.desaparellaLiquidacioDirecta(targetaMovimentId);
  res.json({ ok: true });
});

// --- Còpia de seguretat ---

router.get('/backup', (_req, res) => {
  res.json(ops.exportaCopiaSeguretat());
});

router.post('/backup', (req, res) => {
  ops.importaCopiaSeguretat(req.body as Backup);
  res.json({ ok: true });
});

// --- Manteniment ---

router.post('/manteniment/elimina-moviments', (_req, res) => {
  ops.eliminaTotsElsMoviments();
  res.json({ ok: true });
});

router.get('/manteniment/backups', (_req, res) => {
  res.json(listBackupFiles());
});

router.post('/manteniment/backups', (_req, res) => {
  backupDbFile();
  res.status(201).json(listBackupFiles()[0] ?? null);
});

router.post('/manteniment/backups/:filename/restaura', (req, res) => {
  try {
    restoreBackup(req.params.filename);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/manteniment/reinicialitza', (_req, res) => {
  ops.reinicialitzaBaseDades();
  res.json({ ok: true });
});

// --- Importació (spec 3.1) ---

router.post('/importacio/previsualitza', upload.single('fitxer'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ status: 'error', message: 'Cap fitxer rebut.' });
    return;
  }
  const outcome = await importFile({ name: req.file.originalname, buffer: toArrayBuffer(req.file.buffer) });
  res.json(outcome);
});

router.post('/importacio/previsualitza-manual', upload.single('fitxer'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ status: 'error', message: 'Cap fitxer rebut.' });
    return;
  }
  try {
    const mapping = JSON.parse(req.body.mapping as string) as ColumnMapping;
    const table = readRawTable({ name: req.file.originalname, buffer: toArrayBuffer(req.file.buffer) });
    const { moviments, warnings } = applyColumnMapping(table, mapping);
    res.json({ status: 'parsed', results: [{ compte: { banc: mapping.banc, tipus: mapping.tipus }, moviments, warnings }] });
  } catch (err) {
    res.status(400).json({ status: 'error', message: (err as Error).message });
  }
});

router.post('/importacio/confirma', (req, res) => {
  const { compte, moviments, fitxerOrigen } = req.body as {
    compte: { id: string } | { banc: BankId; tipus: AccountType; alias: string; numeroCompte?: string };
    moviments: ParsedMoviment[];
    fitxerOrigen: string;
  };

  const target = 'id' in compte ? ops.listComptes().find((c) => c.id === compte.id) : ops.createCompte(compte);
  if (!target) {
    res.status(404).json({ error: 'Compte no trobat.' });
    return;
  }

  res.json(ops.commitImport(target, moviments, fitxerOrigen));
});
