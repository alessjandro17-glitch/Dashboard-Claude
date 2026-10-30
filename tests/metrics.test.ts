import { describe, it, expect } from 'vitest';
import { derive, mannWhitney, benjaminiHochberg, median, mad, durationBucket } from '../shared/metrics';
import { parseNumber, parseDate, parseBool } from '../server/import';
import { robustZ, tierFor } from '../server/analytics';

describe('métricas derivadas', () => {
  it('calcula las fórmulas especificadas', () => {
    const d = derive({ reach: 1000, likes: 50, comments: 10, shares: 20, saves: 20, profile_visits: 40, follows: 10, views: 2000, total_watch_time_seconds: 30000 }, 30);
    expect(d.interactions).toBe(100);
    expect(d.engagement_rate).toBeCloseTo(10);
    expect(d.share_rate).toBeCloseTo(2);
    expect(d.save_rate).toBeCloseTo(2);
    expect(d.profile_visit_rate).toBeCloseTo(4);
    expect(d.follower_conversion_rate).toBeCloseTo(25);
    expect(d.avg_watch_time).toBeCloseTo(15);
    expect(d.avg_watch_time_is_computed).toBe(true);
    expect(d.retention_approx).toBeCloseTo(50);
  });
  it('prefiere el tiempo medio registrado y permite retención > 100 %', () => {
    const d = derive({ avg_watch_time_seconds: 40, total_watch_time_seconds: 1, views: 1 }, 25);
    expect(d.avg_watch_time).toBe(40);
    expect(d.avg_watch_time_is_computed).toBe(false);
    expect(d.retention_approx).toBeCloseTo(160);
  });
  it('devuelve null (no registrado) cuando falta un dato, nunca 0', () => {
    const d = derive({ reach: 1000, likes: 50, comments: 10, shares: 20 }, null);
    expect(d.interactions).toBeNull();
    expect(d.engagement_rate).toBeNull();
    expect(d.share_rate).toBeCloseTo(2);
    expect(d.save_rate).toBeNull();
    expect(d.retention_approx).toBeNull();
    expect(derive({ reach: 0, shares: 5 }, 10).share_rate).toBeNull();
  });
});

describe('estadística', () => {
  it('mediana y MAD', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(mad([1, 2, 3, 4, 100])).toBeCloseTo(1.4826);
  });
  it('Mann-Whitney detecta diferencias claras y no inventa diferencias entre grupos iguales', () => {
    const a = [10, 11, 12, 13, 14, 15, 16, 17];
    const b = [30, 31, 32, 33, 34, 35, 36, 37];
    expect(mannWhitney(a, b)!.p).toBeLessThan(0.01);
    expect(mannWhitney(a, [...a])!.p).toBeGreaterThan(0.9);
    expect(mannWhitney([1], [2, 3])).toBeNull();
  });
  it('Benjamini-Hochberg', () => {
    const q = benjaminiHochberg([0.01, 0.04, 0.03, 0.5]);
    expect(q[0]).toBeCloseTo(0.04);
    expect(q[3]).toBeCloseTo(0.5);
    expect(q[1]).toBeCloseTo(0.0533, 3);
  });
  it('z robusta y niveles', () => {
    const z = robustZ([100, 110, 90, 105, 95, 100], 'reach');
    expect(z(100)).toBeCloseTo(0);
    expect(tierFor(z(10000))).toBe('extraordinario');
    expect(tierFor(z(10))).toBe('inferior');
    expect(tierFor(0.2)).toBe('normal');
    expect(tierFor(1)).toBe('superior');
  });
  it('tramos de duración', () => {
    expect(durationBucket(25)).toBe('16–30 s');
    expect(durationBucket(45)).toBe('31–45 s');
    expect(durationBucket(null)).toBeNull();
  });
});

describe('lectura de CSV', () => {
  it('números con separadores', () => {
    expect(parseNumber('1.234')).toBe(1234);
    expect(parseNumber('1,234')).toBe(1234);
    expect(parseNumber('12,5')).toBe(12.5);
    expect(parseNumber('1.234,5')).toBe(1234.5);
    expect(parseNumber('1:05')).toBe(65);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('abc')).toBe('invalid');
  });
  it('fechas en varios formatos y zona horaria', () => {
    expect(parseDate('2026-03-05 10:30', 0)).toBe('2026-03-05T10:30:00.000Z');
    expect(parseDate('05/03/2026 10:30', 120)).toBe('2026-03-05T08:30:00.000Z');
    expect(parseDate('31/02/2026')).toBe('invalid');
    expect(parseDate('')).toBeNull();
  });
  it('booleanos', () => {
    expect(parseBool('Sí')).toBe(true);
    expect(parseBool('no')).toBe(false);
    expect(parseBool('quizá')).toBe('invalid');
  });
});
