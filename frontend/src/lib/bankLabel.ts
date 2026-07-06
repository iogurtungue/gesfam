import type { BankId } from '../api/types';

export function bankLabel(banc: BankId): string {
  switch (banc) {
    case 'sabadell':
      return 'Banc Sabadell';
    case 'bbva':
      return 'BBVA';
    case 'ing':
      return 'ING';
    case 'openbank':
      return 'OpenBank';
    default:
      return 'Altre';
  }
}
