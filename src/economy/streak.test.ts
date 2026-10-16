import { describe, expect, it } from 'vitest';
import {
  HOLD_CLICK_MIN_GAP_MS,
  pushClick,
  STREAK_MAX_LEVEL,
  STREAK_WINDOW_MS,
  streakLevel,
} from './streak';

/** Клики с постоянным шагом: n штук, последний — ровно в `end`. */
const evenly = (n: number, gapMs: number, end = 10_000): number[] =>
  Array.from({ length: n }, (_, i) => end - (n - 1 - i) * gapMs);

describe('Серия Кликов', () => {
  it('starts at zero for a lone Клик and for no Кликов at all', () => {
    expect(streakLevel([], 5_000)).toBe(0);
    expect(streakLevel([5_000], 5_000)).toBe(0);
  });

  it('rises with the rate of Кликов and never past the top level', () => {
    // Чем чаще нажимает игрок, тем выше уровень: проверка по ряду частот, а не по одной точке.
    const rates = [1, 2, 3, 4, 6, 8, 10, 14, 20];
    const levels = rates.map((perSec) => {
      const gap = 1000 / perSec;
      const clicks = evenly(Math.ceil((STREAK_WINDOW_MS / gap) * 2), gap);
      return streakLevel(clicks, clicks[clicks.length - 1]);
    });
    for (let i = 1; i < levels.length; i += 1) expect(levels[i]).toBeGreaterThanOrEqual(levels[i - 1]);
    expect(levels[0]).toBe(0);
    expect(levels[levels.length - 1]).toBe(STREAK_MAX_LEVEL);
    for (const level of levels) {
      expect(Number.isInteger(level)).toBe(true);
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(STREAK_MAX_LEVEL);
    }
  });

  it('is at the top level for a player holding a key at the hold ceiling', () => {
    const gap = HOLD_CLICK_MIN_GAP_MS;
    const clicks = evenly(30, gap);
    expect(streakLevel(clicks, clicks[clicks.length - 1])).toBe(STREAK_MAX_LEVEL);
  });

  it('decays during a pause, step by step, down to zero', () => {
    const clicks = evenly(20, 100);
    const last = clicks[clicks.length - 1];
    const levels = [0, 300, 700, 1100, STREAK_WINDOW_MS, STREAK_WINDOW_MS * 3].map((pause) =>
      streakLevel(clicks, last + pause),
    );
    expect(levels[0]).toBe(STREAK_MAX_LEVEL);
    for (let i = 1; i < levels.length; i += 1) expect(levels[i]).toBeLessThanOrEqual(levels[i - 1]);
    expect(levels[levels.length - 1]).toBe(0);
  });

  it('drops a Клик exactly one window old, so the Серия ends on the window edge', () => {
    // Три Клика в одной точке — уровень 1 (порог 3). Чуть раньше границы окна они ещё в Серии,
    // ровно на границе — уже выпали.
    const clicks = [1_000, 1_000, 1_000];
    expect(streakLevel(clicks, 1_000 + STREAK_WINDOW_MS - 1)).toBe(1);
    expect(streakLevel(clicks, 1_000 + STREAK_WINDOW_MS)).toBe(0);
  });

  it('does not count a Клик from the future, so a clock set back cannot freeze the top level', () => {
    const clicks = evenly(20, 100, 50_000);
    expect(streakLevel(clicks, 10_000)).toBe(0);
  });

  it('pushClick keeps only as many moments as the top level needs', () => {
    let moments: readonly number[] = [];
    let level = 0;
    for (let i = 0; i < 500; i += 1) ({ moments, level } = pushClick(moments, i * 20));
    expect(level).toBe(STREAK_MAX_LEVEL);
    expect(moments.length).toBeLessThanOrEqual(32);
    expect(moments[moments.length - 1]).toBe(499 * 20);
  });

  it('pushClick starts a fresh Серия after a pause', () => {
    let moments: readonly number[] = [];
    for (let i = 0; i < 30; i += 1) ({ moments } = pushClick(moments, i * 80));
    const after = pushClick(moments, 30 * 80 + STREAK_WINDOW_MS * 4);
    expect(after.level).toBe(0);
  });
});
