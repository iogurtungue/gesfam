import { describe, expect, it } from 'vitest';
import { resumInterval, resumPerAnyICategoria, resumPerMesICategoria, SENSE_CATEGORIA } from './summary';

describe('resumPerMesICategoria', () => {
  it('groups income and expenses by month', () => {
    const resum = resumPerMesICategoria([
      { dataOperacio: '2026-06-05', importCents: 250000, categoriaId: 'nomina' },
      { dataOperacio: '2026-06-10', importCents: -5000, categoriaId: 'alimentacio' },
      { dataOperacio: '2026-07-01', importCents: -2000, categoriaId: 'alimentacio' },
    ]);

    expect(resum).toHaveLength(2);
    expect(resum[0]).toMatchObject({ periode: '2026-06', ingressosCents: 250000, despesesCents: 5000 });
    expect(resum[1]).toMatchObject({ periode: '2026-07', ingressosCents: 0, despesesCents: 2000 });
  });

  it('breaks each month down per category, using despesesCents as a positive magnitude', () => {
    const resum = resumPerMesICategoria([
      { dataOperacio: '2026-06-05', importCents: -5000, categoriaId: 'alimentacio' },
      { dataOperacio: '2026-06-06', importCents: -1000, categoriaId: 'oci' },
    ]);
    expect(resum[0].perCategoria['alimentacio']).toEqual({ ingressosCents: 0, despesesCents: 5000 });
    expect(resum[0].perCategoria['oci']).toEqual({ ingressosCents: 0, despesesCents: 1000 });
  });

  it('buckets uncategorized movements under SENSE_CATEGORIA', () => {
    const resum = resumPerMesICategoria([{ dataOperacio: '2026-06-05', importCents: -1000 }]);
    expect(resum[0].perCategoria[SENSE_CATEGORIA]).toEqual({ ingressosCents: 0, despesesCents: 1000 });
  });

  it('excludes internal transfers from all totals', () => {
    const resum = resumPerMesICategoria([
      { dataOperacio: '2026-06-05', importCents: 50000, esTransferenciaInterna: true },
      { dataOperacio: '2026-06-05', importCents: -1000, categoriaId: 'oci' },
    ]);
    expect(resum[0].ingressosCents).toBe(0);
    expect(resum[0].despesesCents).toBe(1000);
  });

  it('sorts months chronologically', () => {
    const resum = resumPerMesICategoria([
      { dataOperacio: '2026-08-01', importCents: -100 },
      { dataOperacio: '2026-06-01', importCents: -100 },
      { dataOperacio: '2026-07-01', importCents: -100 },
    ]);
    expect(resum.map((r) => r.periode)).toEqual(['2026-06', '2026-07', '2026-08']);
  });
});

describe('resumPerAnyICategoria', () => {
  it('groups income and expenses by year, across months', () => {
    const resum = resumPerAnyICategoria([
      { dataOperacio: '2025-12-20', importCents: -1000, categoriaId: 'oci' },
      { dataOperacio: '2026-01-05', importCents: 200000, categoriaId: 'nomina' },
      { dataOperacio: '2026-06-10', importCents: -500, categoriaId: 'oci' },
    ]);
    expect(resum).toHaveLength(2);
    expect(resum[0]).toMatchObject({ periode: '2025', ingressosCents: 0, despesesCents: 1000 });
    expect(resum[1]).toMatchObject({ periode: '2026', ingressosCents: 200000, despesesCents: 500 });
  });
});

describe('resumInterval', () => {
  it('aggregates a single block for movements within an inclusive date range', () => {
    const moviments = [
      { dataOperacio: '2026-01-01', importCents: -100 },
      { dataOperacio: '2026-06-15', importCents: -200, categoriaId: 'oci' },
      { dataOperacio: '2026-12-31', importCents: 500 },
    ];
    const resum = resumInterval(moviments, '2026-06-01', '2026-06-30');
    expect(resum.ingressosCents).toBe(0);
    expect(resum.despesesCents).toBe(200);
    expect(resum.perCategoria['oci']).toEqual({ ingressosCents: 0, despesesCents: 200 });
  });

  it('treats a missing bound as open-ended', () => {
    const moviments = [
      { dataOperacio: '2026-01-01', importCents: -100 },
      { dataOperacio: '2026-12-31', importCents: 500 },
    ];
    expect(resumInterval(moviments, '2026-06-01').despesesCents).toBe(0);
    expect(resumInterval(moviments, '2026-06-01').ingressosCents).toBe(500);
    expect(resumInterval(moviments, undefined, '2026-06-01').despesesCents).toBe(100);
  });

  it('excludes internal transfers', () => {
    const resum = resumInterval([{ dataOperacio: '2026-06-01', importCents: 1000, esTransferenciaInterna: true }]);
    expect(resum.ingressosCents).toBe(0);
  });
});
