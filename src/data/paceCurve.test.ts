import { describe, expect, it } from 'vitest';
import { CATALOG } from '../economy/catalog';
import { FIRST_PRESTIGE_WINDOW_MIN, PACE_CURVE, paceTotalMinutes } from './paceCurve';

describe('целевая кривая темпа', () => {
  it('даёт по одному сроку на каждое Поколение каталога, по порядку', () => {
    expect(PACE_CURVE.map((p) => p.generation)).toEqual(CATALOG.map((_, i) => i));
  });

  it('первый Престиж попадает в окно 30–45 минут', () => {
    const first = PACE_CURVE[0].minutes;
    expect(first).toBeGreaterThanOrEqual(FIRST_PRESTIGE_WINDOW_MIN.from);
    expect(first).toBeLessThanOrEqual(FIRST_PRESTIGE_WINDOW_MIN.to);
  });

  it('Поколения не становятся короче и растут к ~120 минутам', () => {
    for (let i = 1; i < PACE_CURVE.length; i++) {
      expect(PACE_CURVE[i].minutes).toBeGreaterThanOrEqual(PACE_CURVE[i - 1].minutes);
    }
    expect(PACE_CURVE[PACE_CURVE.length - 1].minutes).toBe(120);
  });

  it('вся кампания до Финала контента занимает около 10 часов', () => {
    expect(paceTotalMinutes()).toBeGreaterThanOrEqual(570);
    expect(paceTotalMinutes()).toBeLessThanOrEqual(630);
  });
});
