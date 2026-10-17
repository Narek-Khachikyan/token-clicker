import { describe, expect, it } from 'vitest';
import { CATALOG } from './catalog';
import { bulkCost, discountMult, modelIncome } from './engine';
import { applyFinetune, FINETUNE_ARCHETYPES } from './finetune';
import { newGame, type FinetuneArchetype, type GameState } from './state';

const T0 = 1_000_000;
const MIN = 60_000;

/** Забег Поколения `generation` без Температуры, идущий `minutes` минут игровых часов. */
const runAt = (generation: number, minutes: number): GameState => ({
  ...newGame(T0),
  generation,
  maxGeneration: generation,
  temp: 0,
  heat: 0,
  runStartedAt: T0,
  lastTick: T0 + minutes * MIN,
});

const fullRoster = (s: GameState): GameState => ({
  ...s,
  agents: Object.fromEntries(CATALOG[s.generation].models.map((m) => [m.id, 1])),
});
const loneAgent = (s: GameState, modelId: string): GameState => ({ ...s, agents: { [modelId]: 1 } });

/**
 * Цена и Доход каждой Модели Поколения теми же функциями, что у тика и магазина.
 * `finetune` — Модель, которой Заготовка уже применена: её архетип входит в офис, где она считается.
 * Файнтюн ставится через `applyFinetune`, а не записью в поле, поэтому проверяется и сам переход.
 */
const rungs = (base: GameState, roster: 'alone' | 'full', finetune: { modelId: string; archetype: FinetuneArchetype } | null) =>
  CATALOG[base.generation].models.map((m) => {
    const office = roster === 'full' ? fullRoster(base) : loneAgent(base, m.id);
    const dressed =
      finetune && office.agents[finetune.modelId] ? applyFinetune({ ...office, finetuneStock: 1 }, finetune.modelId, finetune.archetype) : office;
    return { cost: bulkCost(m, 0, 1, discountMult(dressed)), income: modelIncome(dressed, m) };
  });

const checkLadder = (ladder: { cost: number; income: number }[], label: string) => {
  for (let i = 1; i < ladder.length; i++) {
    expect(ladder[i].cost, `цена, ${label}, Ранг ${i}`).toBeGreaterThan(ladder[i - 1].cost);
    expect(ladder[i].income, `Доход, ${label}, Ранг ${i}`).toBeGreaterThan(ladder[i - 1].income);
  }
  const payback = ladder.map((r) => r.cost / r.income);
  const cheapest = Math.min(...payback);
  const dearest = Math.max(...payback);
  for (const p of payback) {
    expect(p, `окупаемость, ${label}`).toBeLessThanOrEqual(cheapest * 3);
    expect(p, `окупаемость, ${label}`).toBeGreaterThanOrEqual(dearest / 3);
  }
};

describe('Файнтюн держит лестницу Ранга по всему каталогу', () => {
  // Худший случай, а не среднее: архетип проверяется на каждой Модели Поколения по отдельности, потому
  // что игрок выбирает Модель сам, и самая дешёвая по окупаемости Модель с «Thinking» — самое тесное место
  // полосы 3×. Шестое Поколение держит поправку лишь около ±8%: см. докблок `FINETUNE_SPEC`.
  for (let generation = 0; generation < CATALOG.length; generation++) {
    for (const archetype of FINETUNE_ARCHETYPES) {
      it(`Поколение ${generation}: «${archetype}» на любой Модели — цена и Доход строго растут с Рангом, окупаемость в полосе 3×`, () => {
        const models = CATALOG[generation].models;
        for (const minutes of [0, 61]) {
          const base = runAt(generation, minutes);
          for (const m of models) {
            for (const roster of ['alone', 'full'] as const) {
              checkLadder(rungs(base, roster, { modelId: m.id, archetype }), `${minutes}-я минута, ${roster}, «${archetype}» на ${m.id}`);
            }
          }
        }
      });
    }
  }

  it('держит полосу 3× и тогда, когда архетип стоит на всех Моделях Поколения разом', () => {
    // Равномерный сдвиг всех Моделей полосы не меняет, но проверка нужна: она ловит случай, когда
    // Файнтюны одного архетипа накладываются на общий Доход офиса и тот не сдвигает лестницу.
    for (const archetype of FINETUNE_ARCHETYPES) {
      for (let generation = 0; generation < CATALOG.length; generation++) {
        const base = fullRoster(runAt(generation, 0));
        const everyone = CATALOG[generation].models.reduce<GameState>(
          (s, m) => applyFinetune({ ...s, finetuneStock: s.finetuneStock + 1 }, m.id, archetype),
          base,
        );
        const ladder = CATALOG[generation].models.map((m) => ({
          cost: bulkCost(m, 0, 1, discountMult(everyone)),
          income: modelIncome(everyone, m),
        }));
        checkLadder(ladder, `все Модели «${archetype}», Поколение ${generation}`);
      }
    }
  });
});
