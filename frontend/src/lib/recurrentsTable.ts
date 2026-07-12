import type { CSSProperties } from 'react';

// Estils de columna compartits entre RecurrentsList, RecurrentsCandidatsList
// i RecurrentManualForm perquè les tres seccions (recurrents confirmats,
// candidats detectats, afegir-ne un de manual) tinguin exactament la mateixa
// amplada de columna a columna.

export const cellStyle: CSSProperties = { border: '1px solid #ccc', padding: '2px 6px' };

function amplaFixa(px: number): CSSProperties {
  return { width: px, minWidth: px, maxWidth: px, boxSizing: 'border-box', overflow: 'hidden' };
}

export const cellCompte: CSSProperties = amplaFixa(110);
export const cellPeriodicitat: CSSProperties = amplaFixa(100);
export const cellData: CSSProperties = amplaFixa(125);
// Sense amplada fixa a propòsit: absorbeix l'espai que deixen lliure la resta de columnes fixes.
export const cellConcepte: CSSProperties = { whiteSpace: 'normal', overflowWrap: 'break-word' };
export const cellImport: CSSProperties = { ...amplaFixa(160), textAlign: 'right' };
export const cellCategoria: CSSProperties = amplaFixa(175);
export const cellOrigen: CSSProperties = amplaFixa(110);
export const cellReferencia: CSSProperties = amplaFixa(125);
export const cellAccions: CSSProperties = amplaFixa(170);

/**
 * Per a un `<input>` que ha d'omplir tota la cel·la (Concepte, Referència):
 * cal `boxSizing: 'border-box'` explícit perquè un input HTML és
 * `content-box` per defecte — `width: 100%` s'hi sumaria al seu propi
 * padding/border, sobreeixint de la cel·la (que té `overflow: hidden` via
 * `amplaFixa`) i deixant el requadre tallat, no visible sencer.
 */
export const inputCompletCella: CSSProperties = { width: '100%', boxSizing: 'border-box' };
