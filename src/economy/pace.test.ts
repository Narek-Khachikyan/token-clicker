import { describe, expect, it } from 'vitest';
import { FIRST_PRESTIGE_WINDOW_MIN } from '../data/paceCurve';
import { firstPrestigeMinutes } from '../../tools/greedyPolicy';

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
