import { describe, expect, it } from 'vitest';
import { CATALOG, LAST_GENERATION } from './catalog';
import { bulkCost, canPrestige, discountMult, modelIncome } from './engine';
import { coursePool } from './course';
import { newGame, type GameState } from './state';
import { DT, newSession, tick } from '../../tools/greedyPolicy';

const T0 = 1_000_000;
const MIN = 60_000;

/**
 * Каждый Курс, который игрок реально может получить, вместе с Поколением, где он будет действовать.
 * Престиж из Поколения `g` ведёт в `g + 1`, а пул зависит от пройденных Правил, поэтому пары берутся
 * из `coursePool`, а не из всего списка: Курс, которого пул не отдаст, проверять не на чем. Правило
 * Фронтира в пул не попадает и после Престижа с Финала: его Курс ломает полосу окупаемости (ADR-0013, слой 5).
 */
const REACHABLE: { course: string; name: string; generation: number }[] = [];
for (let from = 0; from < LAST_GENERATION; from++) {
  for (const c of coursePool({ generation: from, maxGeneration: from })) {
    REACHABLE.push({ course: c.id, name: c.name, generation: from + 1 });
  }
}

/** Забег Поколения `generation` под Курсом `course`, идущий `minutes` минут игровых часов, без Температуры. */
const runAt = (generation: number, course: string, minutes = 0): GameState => ({
  ...newGame(T0),
  generation,
  maxGeneration: generation,
  course,
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

describe('Курс держит лестницу Ранга по всему каталогу', () => {
  /** Цена и Доход одного Агента каждой Модели Поколения: теми же функциями, что у тика и магазина. */
  const rungs = (base: GameState, roster: 'alone' | 'full') =>
    CATALOG[base.generation].models.map((m) => {
      const office = roster === 'full' ? fullRoster(base) : loneAgent(base, m.id);
      return { cost: bulkCost(m, 0, 1, discountMult(office)), income: modelIncome(office, m) };
    });

  const scenarios = (generation: number, course: string): [string, GameState, 'alone' | 'full'][] => {
    const out: [string, GameState, 'alone' | 'full'][] = [];
    // Минуты Забега: Правила, зависящие от времени («Ценовая война», «Лидер Арены»), меняют цену и Доход
    // от минуты к минуте, а лестница обязана держаться на каждой.
    for (const minutes of [0, 1, 5, 20, 61, 600]) {
      out.push([`${minutes}-я минута, одна Лаборатория`, runAt(generation, course, minutes), 'alone']);
      out.push([`${minutes}-я минута, все Лаборатории`, runAt(generation, course, minutes), 'full']);
    }
    // Состояние Правил с собственной памятью: ряд покупок на пределе и полная копилка размышления.
    const streak = { ...runAt(generation, course, 5), buyStreak: 100, lastBuyAt: T0 + 5 * MIN };
    out.push(['ряд покупок на пределе, одна Лаборатория', streak, 'alone']);
    out.push(['ряд покупок на пределе, все Лаборатории', streak, 'full']);
    out.push(['полная копилка размышления, все Лаборатории', { ...runAt(generation, course, 5), thought: 4, thoughtAt: T0 + 5 * MIN }, 'full']);
    return out;
  };

  for (const { course, name, generation } of REACHABLE) {
    it(`«${name}» в Поколении ${generation}: цена и Доход строго растут с Рангом, окупаемость в полосе 3×`, () => {
      for (const [label, state, roster] of scenarios(generation, course)) {
        const ladder = rungs(state, roster);
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
      }
    });
  }

  it('проверяет каждый Курс таблицы, который пул способен отдать', () => {
    const covered = new Set(REACHABLE.map((r) => r.course));
    const expected = coursePool({ generation: LAST_GENERATION - 1, maxGeneration: LAST_GENERATION - 1 }).map((c) => c.id);
    for (const id of expected) expect(covered.has(id), id).toBe(true);
  });
});

describe('Флагман достижим под каждым Курсом', () => {
  // Жадный игрок из `tools/greedyPolicy.ts` входит в Поколение без Compute и Перков — нижняя граница,
  // строже настоящей кампании. Берётся одно Поколение за Курс (по кругу), чтобы тест остался дешёвым.
  const courses = [...new Set(REACHABLE.map((r) => r.course))];
  courses.forEach((course, i) => {
    const generation = 1 + (i % LAST_GENERATION);
    const reach = REACHABLE.find((r) => r.course === course && r.generation >= generation) ?? REACHABLE.find((r) => r.course === course)!;
    it(`«${course}» в Поколении ${reach.generation}: жадная политика берёт Флагман за разумное время`, () => {
      const w = newSession({});
      w.s = { ...w.s, generation: reach.generation, maxGeneration: reach.generation, course, runStartedAt: w.s.lastTick };
      const capMinutes = 240;
      for (let n = 0; n < (capMinutes * 60) / DT && !canPrestige(w.s); n++) tick(w);
      expect(canPrestige(w.s), `Флагман не взят за ${capMinutes} минут`).toBe(true);
    }, 120_000);
  });
});
