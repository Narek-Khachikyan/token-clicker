import { describe, expect, it } from 'vitest';
import { CATALOG } from './catalog';
import { bulkCost, discountMult, modelIncome } from './engine';
import { CHALLENGES, RISK_MULT_MAX, riskClass, riskMult } from './challenges';
import { newGame, type GameState } from './state';

const T0 = 1_000_000;

/**
 * Максимальный Класс риска: все Испытания таблицы взяты разом, в Поколении `generation`. Новое
 * Испытание со временем сдвигает и саму планку — тест этого и хочет, а не фиксированного числа.
 */
const maxRisk = (generation: number): GameState => ({
  ...newGame(T0),
  generation,
  maxGeneration: generation,
  temp: 0,
  heat: 0,
  activeChallenges: CHALLENGES.map((c) => c.id),
});

const fullRoster = (s: GameState): GameState => ({
  ...s,
  agents: Object.fromEntries(CATALOG[s.generation].models.map((m) => [m.id, 1])),
});
const loneAgent = (s: GameState, modelId: string): GameState => ({ ...s, agents: { [modelId]: 1 } });

describe('Класс риска держит лестницу Ранга по всему каталогу', () => {
  it('полный набор Испытаний всегда даёт потолок множителя Compute', () => {
    expect(riskClass(maxRisk(0))).toBe(CHALLENGES.reduce((sum, c) => sum + c.weight, 0));
    expect(riskMult(riskClass(maxRisk(0)))).toBe(RISK_MULT_MAX);
  });

  /**
   * Инвариант ADR-0013 и AGENTS.md (правило 3) с включённым максимальным Классом риска: цена и
   * Доход строго растут с Рангом, окупаемость держится в полосе 3× к самой дешёвой Модели.
   * Множитель Класса риска сидит на Compute за Престиж и на цену и Доход попасть не должен —
   * тест читает цену и Доход теми же функциями, что тик и магазин, поэтому любая утечка
   * множителя в лестницу упадёт здесь, а не у игрока.
   */
  CATALOG.forEach((g, gi) => {
    it(`Поколение ${gi + 1} (${g.name}): цена и Доход растут с Рангом, окупаемость в полосе 3×`, () => {
      for (const roster of ['alone', 'full'] as const) {
        const ladder = g.models.map((m) => {
          const office = roster === 'full' ? fullRoster(maxRisk(gi)) : loneAgent(maxRisk(gi), m.id);
          return { cost: bulkCost(m, 0, 1, discountMult(office)), income: modelIncome(office, m) };
        });
        for (let i = 1; i < ladder.length; i++) {
          expect(ladder[i].cost, `цена, ${roster}, Ранг ${i}`).toBeGreaterThan(ladder[i - 1].cost);
          expect(ladder[i].income, `Доход, ${roster}, Ранг ${i}`).toBeGreaterThan(ladder[i - 1].income);
        }
        const payback = ladder.map((r) => r.cost / r.income);
        const cheapest = Math.min(...payback);
        const dearest = Math.max(...payback);
        for (const p of payback) {
          expect(p, `окупаемость, ${roster}`).toBeLessThanOrEqual(cheapest * 3);
          expect(p, `окупаемость, ${roster}`).toBeGreaterThanOrEqual(dearest / 3);
        }
      }
    });
  });
});
