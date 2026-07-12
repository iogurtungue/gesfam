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
// +20% respecte a l'amplada original (95px).
export const cellData: CSSProperties = amplaFixa(114);
// Sense amplada fixa a propòsit: absorbeix l'espai que deixen lliure la resta de columnes fixes.
export const cellConcepte: CSSProperties = { whiteSpace: 'normal', overflowWrap: 'break-word' };
export const cellImport: CSSProperties = { ...amplaFixa(160), textAlign: 'right' };
// +25% respecte a l'amplada original (120px).
export const cellCategoria: CSSProperties = amplaFixa(150);
export const cellOrigen: CSSProperties = amplaFixa(110);
// +20% respecte a l'amplada original (90px).
export const cellReferencia: CSSProperties = amplaFixa(108);
export const cellAccions: CSSProperties = amplaFixa(170);
