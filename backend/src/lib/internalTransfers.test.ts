import { describe, expect, it } from 'vitest';
import { suggereixTransferenciesInternes, type TransferCandidat } from './internalTransfers';

function mov(id: string, compteId: string, dataOperacio: string, importCents: number): TransferCandidat {
  return { id, compteId, dataOperacio, importCents };
}

describe('suggereixTransferenciesInternes', () => {
  it('pairs an outgoing and incoming movement of equal amount across accounts within the date window', () => {
    const moviments = [
      mov('m1', 'compte-A', '2026-06-29', -42400),
      mov('m2', 'compte-B', '2026-06-29', 42400),
    ];
    expect(suggereixTransferenciesInternes(moviments)).toEqual([{ a: 'm1', b: 'm2' }]);
  });

  it('does not pair movements on the same account', () => {
    const moviments = [mov('m1', 'compte-A', '2026-06-29', -100), mov('m2', 'compte-A', '2026-06-29', 100)];
    expect(suggereixTransferenciesInternes(moviments)).toEqual([]);
  });

  it('does not pair movements with the same sign', () => {
    const moviments = [mov('m1', 'compte-A', '2026-06-29', -100), mov('m2', 'compte-B', '2026-06-29', -100)];
    expect(suggereixTransferenciesInternes(moviments)).toEqual([]);
  });

  it('does not pair movements further apart than the day window', () => {
    const moviments = [mov('m1', 'compte-A', '2026-06-01', -100), mov('m2', 'compte-B', '2026-06-10', 100)];
    expect(suggereixTransferenciesInternes(moviments, 2)).toEqual([]);
  });

  it('does not reuse an already-matched movement for a second pair', () => {
    const moviments = [
      mov('m1', 'compte-A', '2026-06-29', -100),
      mov('m2', 'compte-B', '2026-06-29', 100),
      mov('m3', 'compte-C', '2026-06-29', 100),
    ];
    const result = suggereixTransferenciesInternes(moviments);
    expect(result).toHaveLength(1);
    const usats = new Set(result.flatMap((s) => [s.a, s.b]));
    expect(usats.has('m1')).toBe(true);
    expect(usats.size).toBe(2);
  });

  it('ignores zero-amount movements', () => {
    expect(suggereixTransferenciesInternes([mov('m1', 'A', '2026-06-01', 0), mov('m2', 'B', '2026-06-01', 0)])).toEqual([]);
  });
});
