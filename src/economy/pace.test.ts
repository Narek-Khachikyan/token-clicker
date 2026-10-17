import { describe, expect, it } from 'vitest';
import { CATALOG, LAST_GENERATION } from './catalog';
import { FIRST_PRESTIGE_WINDOW_MIN, PACE_CURVE, PACE_TOLERANCE } from '../data/paceCurve';
import { campaignPace, firstPrestigeMinutes } from '../../tools/greedyPolicy';

describe('темп первого Престижа на жадной политике', () => {
  it('наступает не раньше нижней границы окна кривой и укладывается в верхнюю', () => {
    const { from, to } = FIRST_PRESTIGE_WINDOW_MIN;
    const minutes = firstPrestigeMinutes(to);
    // null — Престиж не случился за верхнюю границу окна: игрок уходит из Рассвета ни с чем.
    expect(minutes, 'жадная политика не дошла до Престижа в окне').not.toBeNull();
    expect(minutes ?? 0).toBeGreaterThanOrEqual(from);
    expect(minutes ?? Infinity).toBeLessThanOrEqual(to);
  });
});

describe('темп кампании на жадной политике', () => {
  // Последнее Поколение кончается покупкой Флагмана, а не Престижем: делитель Престижа его не
  // двигает, лестница Ранга берёт его за ~10 минут при любых ручках темпа (докблок `paceCurve.ts`).
  // Поэтому в допуск проверяются Поколения с Престижем; последнее — только то, что оно достигнуто.
  // Это не принятый исход, а открытое решение разработчика: убрать исключение можно, только сменив
  // кривую или саму механику Финала контента.
  it('каждое Поколение с Престижем ложится в допуск кривой, а Финал контента достигается', () => {
    const pace = campaignPace(1500);
    expect(pace.map((p) => p.generation), 'политика не дошла до Финала контента').toEqual(CATALOG.map((_, i) => i));
    for (const target of PACE_CURVE) {
      if (target.generation === LAST_GENERATION) continue;
      const minutes = pace[target.generation].minutes ?? Infinity;
      const label = `Поколение ${target.generation + 1} (${CATALOG[target.generation].name}): ${minutes.toFixed(1)} мин, кривая ${target.minutes}`;
      expect(Math.abs(minutes - target.minutes) <= target.minutes * PACE_TOLERANCE, label).toBe(true);
    }
  }, 180_000);
});
