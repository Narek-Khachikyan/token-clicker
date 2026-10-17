import { describe, expect, it } from 'vitest';
import { CATALOG, type Model } from './catalog';
import { bulkCost, buyAgents, buyUpgrade, discountMult, modelIncome } from './engine';
import { migrate } from './save';
import { newGame, SAVE_VERSION, type GameState } from './state';
import { ASSIST1_THRESHOLD, MODEL_TIERS, modelTierThreshold, modelUpgradeId, UPGRADE_BY_ID } from './upgrades';

const T0 = 1_000_000;
const rich = (s: GameState): GameState => ({ ...s, tokens: 1e300, runTokens: 1e300 });
const cold = (s: GameState): GameState => ({ ...s, temp: 0, heat: 0, nextEventAt: 4e12, nextGlitchAt: 4e12 });
const TIERS = MODEL_TIERS.length;

/** Сколько Апгрейдов Модели можно купить у `modelId` при `agents` Агентах — по настоящей покупке. */
function tiersUnlockedAt(gen: number, modelId: string, agents: number): number {
  const start: GameState = { ...newGame(T0), generation: gen, maxGeneration: gen };
  const s = buyAgents(rich(start), modelId, agents);
  expect(s.agents[modelId]).toBe(agents);
  let count = 0;
  for (let tier = 0; tier < TIERS; tier++) {
    if (buyUpgrade(s, modelUpgradeId(modelId, tier)) !== s) count++;
  }
  return count;
}

describe('пороги Апгрейдов Модели', () => {
  const models = CATALOG[0].models;
  const youngest = models[0];
  const flagship = models[models.length - 1];

  it('Модель младшего Ранга открывает ступени раньше Флагмана', () => {
    // Литералы посчитаны руками: порог «середины» 1/5/25/50/100 × доля 0,9 у младшей и 1,1 у
    // Флагмана, то есть 1/5/23/45/90 и 1/6/28/55/110; 4,5, 22,5, 5,5 и 27,5 округляются вверх.
    expect(tiersUnlockedAt(0, youngest.id, 1)).toBe(1);
    expect(tiersUnlockedAt(0, youngest.id, 4)).toBe(1);
    expect(tiersUnlockedAt(0, youngest.id, 5)).toBe(2);
    expect(tiersUnlockedAt(0, youngest.id, 23)).toBe(3);
    expect(tiersUnlockedAt(0, youngest.id, 45)).toBe(4);
    expect(tiersUnlockedAt(0, youngest.id, 89)).toBe(4);
    expect(tiersUnlockedAt(0, youngest.id, 90)).toBe(5);

    expect(tiersUnlockedAt(0, flagship.id, 5)).toBe(1);
    expect(tiersUnlockedAt(0, flagship.id, 6)).toBe(2);
    expect(tiersUnlockedAt(0, flagship.id, 28)).toBe(3);
    expect(tiersUnlockedAt(0, flagship.id, 55)).toBe(4);
    expect(tiersUnlockedAt(0, flagship.id, 109)).toBe(4);
    expect(tiersUnlockedAt(0, flagship.id, 110)).toBe(5);
  });

  it('Модель середины ростера лежит между младшей и Флагманом', () => {
    // Ранг 4 из 8 Моделей Поколения 0: доля 0,9 + 0,2 × 4/7 = 1,014; 5, 25, 50, 100 × 1,014 = 5,07, 25,4, 50,7, 101,4.
    const mid = models[4];
    expect([1, 2, 3, 4].map((t) => modelTierThreshold(mid, t))).toEqual([5, 25, 51, 101]);
  });

  it('держит порядок: пороги растут по ступеням и по Рангу, а старший не выше ассистов', () => {
    for (const g of CATALOG) {
      g.models.forEach((m, i) => {
        expect(modelTierThreshold(m, 0)).toBe(1);
        for (let tier = 1; tier < TIERS; tier++) {
          expect(modelTierThreshold(m, tier)).toBeGreaterThan(modelTierThreshold(m, tier - 1));
          if (i > 0) {
            expect(modelTierThreshold(m, tier)).toBeGreaterThanOrEqual(modelTierThreshold(g.models[i - 1], tier));
          }
        }
        expect(modelTierThreshold(m, TIERS - 1)).toBeLessThan(ASSIST1_THRESHOLD);
      });
    }
  });
});

describe('кривые порогов и лестница Ранга', () => {
  // Числа Агентов, на которых проверяется лестница: каждый порог любой Модели каталога и по одному
  // числу с обеих сторон от него, плюс хвост за старшим порогом.
  const checkpoints = (() => {
    const set = new Set<number>([1, 2, 3, 300]);
    for (const g of CATALOG) {
      for (const m of g.models) {
        for (let tier = 1; tier < TIERS; tier++) {
          const th = modelTierThreshold(m, tier);
          set.add(th - 1);
          set.add(th);
          set.add(th + 1);
        }
      }
    }
    return [...set].filter((n) => n >= 1).sort((a, b) => a - b);
  })();

  const tiersOf = (m: Model, agents: number): number => {
    let k = 0;
    for (let tier = 0; tier < TIERS; tier++) if (agents >= modelTierThreshold(m, tier)) k++;
    return k;
  };

  it('расходит соседние Ранги и крайние не больше чем на одну ступень на любом числе Агентов', () => {
    // Больше одной ступени — это ×4 между Моделями, а шаг Дохода между соседями на ростере из
    // 19 Моделей всего 3,02: порядок Ранга перевернулся бы.
    for (const g of CATALOG) {
      const youngest = g.models[0];
      const top = g.models[g.models.length - 1];
      for (const n of checkpoints) {
        expect(tiersOf(youngest, n) - tiersOf(top, n), `Поколение ${g.index}, Агентов ${n}`).toBeLessThanOrEqual(1);
        for (let i = 1; i < g.models.length; i++) {
          expect(tiersOf(g.models[i - 1], n) - tiersOf(g.models[i], n)).toBeLessThanOrEqual(1);
          expect(tiersOf(g.models[i - 1], n) - tiersOf(g.models[i], n)).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('держит строгий порядок Дохода Агента по Рангу и полосу окупаемости 3× с Апгрейдами Моделей при любом числе Агентов', () => {
    // Доход Агента с открытыми ступенями — baseIncome × 2^ступени; цена следующего Агента — baseCost.
    // Цена от ступеней не зависит, поэтому её порядок по Рангу держит каталог (economy.test.ts).
    for (const g of CATALOG) {
      for (const n of checkpoints) {
        const income = g.models.map((m) => m.baseIncome * 2 ** tiersOf(m, n));
        for (let i = 1; i < g.models.length; i++) {
          expect(income[i], `Поколение ${g.index}, ранг ${i}, Агентов ${n}`).toBeGreaterThan(income[i - 1]);
        }
        const payback = g.models.map((m, i) => m.baseCost / income[i]);
        const cheapest = Math.min(...payback);
        const dearest = Math.max(...payback);
        for (const p of payback) {
          expect(p, `Поколение ${g.index}, Агентов ${n}`).toBeLessThanOrEqual(cheapest * 3);
          expect(p, `Поколение ${g.index}, Агентов ${n}`).toBeGreaterThanOrEqual(dearest / 3);
        }
      }
    }
  });

  describe('вместе со всеми Характерами Лабораторий', () => {
    /**
     * Настоящий офис: по `n` Агентов каждой Модели Поколения (при n ≥ 5 «Конвейер» Alibaba и
     * «Открытые веса» Meta в полную силу), куплены все открытые Апгрейды Моделей, все восемь
     * Характеров включены. Равные числа Агентов — худший случай для лестницы: обычная игра их
     * разводит, а здесь любая разница в ступенях между Моделями видна целиком.
     */
    function officeAt(gen: number, n: number): GameState {
      let s: GameState = cold({ ...newGame(T0), generation: gen, maxGeneration: gen });
      for (const m of CATALOG[gen].models) s = buyAgents(rich(s), m.id, n);
      for (const m of CATALOG[gen].models) {
        for (let tier = 0; tier < TIERS; tier++) s = buyUpgrade(rich(s), modelUpgradeId(m.id, tier));
      }
      return s;
    }

    /**
     * Что здесь НЕ утверждается, точно. Любая кривая порогов, где у соседей разные пороги, даёт окно
     * в несколько Агентов, где у одной Модели ступенью больше (×2). Без кривой на равных числах
     * Агентов разброс окупаемости с Характерами 2,75, и запаса на ×2 нет: в окне, где ступенью
     * больше у Модели Alibaba («Конвейер», до ×1,9 в полном офисе), строгий порядок Дохода по Рангу
     * и полоса 3× нарушаются. Замер: 0,9/1,1 — три окна с обратным порядком (Поколение 8, Alibaba выше
     * соседа на 26%) и разброс до 3,84; сузить до 0,98/1,02 не помогает, пока пороги вообще различаются.
     * Поэтому вне окон (все Модели на одном числе ступеней) держится всё строго, а в окнах — порядок
     * для каждой пары, где нижняя Модель не Alibaba, и две границы: перевёрнутая пара Alibaba не
     * более 1,3, разброс окупаемости не более 4.
     */
    const WINDOW_BAND_LIMIT = 4;
    const ALIBABA_INVERSION_LIMIT = 1.3;

    it('держит порядок Дохода и полосу окупаемости 3× с Характерами на любом числе Агентов, кроме окон Alibaba', () => {
      for (const g of CATALOG) {
        for (let n = 1; n <= 300; n++) {
          const office = officeAt(g.index, n);
          const discount = discountMult(office);
          const cost = g.models.map((m) => bulkCost(m, 0, 1, discount));
          const income = g.models.map((m) => modelIncome(office, m) / n);
          const tiers = g.models.map((m) => tiersOf(m, n));
          const plateau = tiers.every((k) => k === tiers[0]);
          const where = `Поколение ${g.index}, Агентов ${n}`;
          for (let i = 1; i < g.models.length; i++) {
            expect(cost[i], where).toBeGreaterThan(cost[i - 1]);
            if (plateau || g.models[i - 1].lab !== 'alibaba') {
              expect(income[i], `${where}, ранг ${i}`).toBeGreaterThan(income[i - 1]);
            } else {
              expect(income[i - 1] / income[i], `${where}, ранг ${i - 1} Alibaba`).toBeLessThan(ALIBABA_INVERSION_LIMIT);
            }
          }
          const payback = cost.map((c, i) => c / income[i]);
          const spread = Math.max(...payback) / Math.min(...payback);
          expect(spread, where).toBeLessThanOrEqual(plateau ? 3 : WINDOW_BAND_LIMIT);
        }
      }
    });
  });

  it('платит движок ровно столько, сколько открыла кривая', () => {
    // Одна Модель в офисе, Характеры без разнообразия молчат: Доход = baseIncome × Агенты × 2^ступени.
    const models = CATALOG[0].models;
    for (const [m, agents, tiers] of [
      [models[0], 5, 2], // порог второй ступени младшей — 5
      [models[models.length - 1], 5, 1], // порог Флагмана — 6
      [models[models.length - 1], 6, 2],
    ] as const) {
      let s: GameState = cold({ ...newGame(T0), generation: 0 });
      s = buyAgents(rich(s), m.id, agents);
      for (let tier = 0; tier < TIERS; tier++) s = buyUpgrade(rich(s), modelUpgradeId(m.id, tier));
      expect(modelIncome(s, m)).toBeCloseTo(m.baseIncome * agents * 2 ** tiers, 6);
    }
  });
});

describe('Апгрейды Моделей в сейвах', () => {
  it('сохраняет id каждой ступени каждой Модели каталога и грузит купленные без потерь', () => {
    const ids = CATALOG.flatMap((g) =>
      g.models.flatMap((m) => Array.from({ length: TIERS }, (_, tier) => `m:${m.id}:${tier}`)),
    );
    for (const id of ids) expect(UPGRADE_BY_ID[id], id).toBeDefined();

    // Сейв Поколения 0 со всеми его ступенями, как до кривых: порогов в нём нет, их знает только код.
    const owned = CATALOG[0].models.flatMap((m) => Array.from({ length: TIERS }, (_, tier) => `m:${m.id}:${tier}`));
    const loaded = migrate({ version: SAVE_VERSION, generation: 0, upgrades: owned }, T0);
    expect(loaded.upgrades).toEqual(owned);
  });
});
