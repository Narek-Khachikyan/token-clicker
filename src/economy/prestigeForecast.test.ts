import { describe, expect, it } from 'vitest';
import { CATALOG, computeGain, prestigeDivisor } from './catalog';
import { buyAgents, prestige, prestigeGain, startingTokens } from './engine';
import {
  PRESTIGE_BOOKKEEPING,
  PRESTIGE_KEEPS,
  PRESTIGE_RESETS,
  prestigeForecast,
} from './prestigeForecast';
import { newGame, type GameState } from './state';
import { modelUpgradeId } from './upgrades';

const T0 = 1_000_000;
/** Забег поколения `gen` на заработке `runTokens`: Флагман нанят, чтобы Престиж был открыт. */
function runAt(gen: number, runTokens: number): GameState {
  const s: GameState = { ...newGame(T0), generation: gen, maxGeneration: gen, tokens: 0, runTokens };
  return buyAgents({ ...s, tokens: 1e300 }, CATALOG[gen].flagship.id, 1);
}

describe('prestigeForecast', () => {
  it('promises exactly the Compute that Престиж pays, in every generation and at every volume', () => {
    for (const g of CATALOG) {
      for (const exp of [0, 3, 8, 15, 30, 60, 100, 200, 300]) {
        const s = runAt(g.index, Math.pow(10, exp));
        const f = prestigeForecast(s);
        expect(f.gain).toBe(prestigeGain(s));
        // Не только формула, но и сам переход: что обещано в карточке, то лежит в Compute.
        // На финале контента переход закрыт: обещанного Compute нет, и карточка так и говорит.
        if (!f.finale) expect(prestige(s, T0).compute - s.compute).toBe(f.gain);
      }
    }
  });

  it('puts the boost exactly at +50% Compute (at least +1) and the shortfall exactly on its edge', () => {
    for (const g of CATALOG) {
      for (const exp of [0, 3, 8, 15, 30, 60, 100, 200, 299]) {
        const s = runAt(g.index, Math.pow(10, exp));
        const f = prestigeForecast(s);
        expect(Number.isFinite(f.boostShortfall)).toBe(true);
        expect(f.boostShortfall).toBeGreaterThan(0);
        // На пороге Престиж платит прибавку, на шаг раньше — ещё нет.
        const atEdge = computeGain(s.runTokens + f.boostShortfall, g.index);
        expect(atEdge).toBeGreaterThanOrEqual(f.boostGain);
        const justBefore = computeGain(s.runTokens + f.boostShortfall * (1 - 1e-6), g.index);
        expect(justBefore).toBeLessThan(f.boostGain);
      }
    }
  });

  it('promises a boost of 1, 2 and 15 for a gain of 0, 1 and 10', () => {
    // Литералы: Compute 1 и 10 берутся из кубов делителя, 15 — это 10 + 50 %.
    const cases = [
      { k: 0, gain: 0, boostGain: 1 },
      { k: 1, gain: 1, boostGain: 2 },
      { k: 10, gain: 10, boostGain: 15 },
    ];
    for (const c of cases) {
      const f = prestigeForecast(runAt(0, c.k ** 3 * prestigeDivisor(0)));
      expect(f.gain).toBe(c.gain);
      expect(f.boostGain).toBe(c.boostGain);
    }
  });

  it('starts from the first unit when nothing is earned yet', () => {
    const f = prestigeForecast(runAt(0, 0));
    expect(f.gain).toBe(0);
    expect(f.boostGain).toBe(1);
    // Единица Compute начинается ровно с делителя Поколения.
    expect(f.boostShortfall).toBe(prestigeDivisor(0));
  });

  it('flags the finale and a closed Престиж, so the card never promises what the transition refuses', () => {
    expect(prestigeForecast(newGame(T0)).ready).toBe(false);
    expect(prestigeForecast(runAt(0, 1e9)).ready).toBe(true);
    const last = runAt(CATALOG.length - 1, 1e9);
    expect(prestigeForecast(last).ready).toBe(true);
    expect(prestigeForecast(last).finale).toBe(true);
  });
});

/** Забег, где каждое поле, которое Престиж трогает или не трогает, не равно значению по умолчанию. */
function loadedRun(): GameState {
  const base = runAt(2, 5e26);
  return {
    ...base,
    tokens: 123456,
    upgrades: [modelUpgradeId(CATALOG[2].flagship.id, 0)],
    runClicks: 77,
    clicks: 500,
    compute: 40,
    computeSpent: 15,
    perks: ['start_tokens'],
    achievements: ['first_click'],
    crystals: 4,
    crystalPlantedAt: T0 - 5000,
    crystalUpgrades: ['cu:speed1'],
    milestones: ['m1'],
    eventsSeen: 6,
    eventCaughtAt: T0 - 10,
    catchUpPaid: 99,
    nextEventAt: T0 + 5000,
    event: { kind: 'hype', startedAt: T0 - 100, red: false },
    combo: 4,
    glitchSeq: 3,
    nextGlitchAt: T0 + 9000,
    glitches: [{ id: 2, stolen: 0.3, clicks: 1 }],
    uprising: 2,
    pledgeUntil: T0 + 60_000,
    pledgeBought: 2,
    covenant: true,
    quipsSeen: ['q1'],
    activeChallenge: 'no-click',
    challengesDone: ['no-synergy'],
    temp: 1.3,
    heat: 0.4,
    overheatedAt: T0 - 7000,
  };
}

describe('what Престиж resets and what stays', () => {
  const fresh = newGame(T0);
  const before = loadedRun();
  const after = prestige(before, T0 + 1);

  it('puts every field of the run in exactly one of: reset, kept, bookkeeping', () => {
    const listed = [
      ...PRESTIGE_RESETS.flatMap((e) => e.fields),
      ...PRESTIGE_KEEPS.flatMap((e) => e.fields),
      ...PRESTIGE_BOOKKEEPING,
    ];
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(Object.keys(fresh).sort());
  });

  it('really resets every field listed under «сбросится»', () => {
    for (const e of PRESTIGE_RESETS) {
      for (const f of e.fields) {
        // Токены: с перком забег стартует со стартовой суммой, а не с нуля.
        if (f === 'tokens') {
          expect(after.tokens).toBe(startingTokens(before, after.generation));
          expect(before.tokens).not.toBe(after.tokens);
          continue;
        }
        expect(before[f], `${f} before`).not.toEqual(fresh[f]);
        expect(after[f], `${f} after`).toEqual(fresh[f]);
      }
    }
  });

  it('really keeps every field listed under «останется»', () => {
    for (const e of PRESTIGE_KEEPS) {
      for (const f of e.fields) {
        expect(after[f], f).toEqual(before[f]);
      }
    }
  });
});
