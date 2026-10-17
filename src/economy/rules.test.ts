import { describe, expect, it } from 'vitest';
import { CATALOG } from './catalog';
import { applyOffline, bulkCost, buyAgents, canPrestige, discountMult, modelIncome, offlineIncome } from './engine';
import { DT, newSession, tick } from '../../tools/greedyPolicy';
import { newGame, type GameState } from './state';
import { generationRule, ruleIncomeMult, rulePriceMult } from './rules';
import { GENERATION_RULES } from '../data/generationRules';
import { LABS } from '../data/labs';

const T0 = 1_000_000;
const MIN = 60_000;

/** Забег в Поколении `generation`, идущий уже `minutes` минут игровых часов, без Температуры. */
const runAt = (generation: number, minutes = 0): GameState => ({
  ...newGame(T0),
  generation,
  temp: 0,
  heat: 0,
  runStartedAt: T0,
  lastTick: T0 + minutes * MIN,
});

/** Офис, где у каждой Модели Поколения ровно один Агент: все Лаборатории Поколения на месте. */
const fullRoster = (s: GameState): GameState => ({
  ...s,
  agents: Object.fromEntries(CATALOG[s.generation].models.map((m) => [m.id, 1])),
});

/** Офис, где один Агент только у `modelId`: в офисе одна Лаборатория. */
const loneAgent = (s: GameState, modelId: string): GameState => ({ ...s, agents: { [modelId]: 1 } });

const RULE_GENERATIONS = GENERATION_RULES.map((r) => r.generation);

describe('Правила Поколений: таблица', () => {
  it('даёт Правило Мультимодальной и Omni и оставляет Рассвет без Правила', () => {
    expect(generationRule(0)).toBeNull();
    expect(generationRule(2)?.id).toBe('variety');
    expect(generationRule(3)?.id).toBe('price-war');
  });

  it('не больше одного Правила на Поколение и только на Поколения каталога', () => {
    expect(new Set(RULE_GENERATIONS).size).toBe(RULE_GENERATIONS.length);
    for (const g of RULE_GENERATIONS) expect(g).toBeGreaterThan(0);
    for (const g of RULE_GENERATIONS) expect(CATALOG[g]).toBeDefined();
  });

  it('не пользуется словами, которых CONTEXT.md избегает', () => {
    const banned = new Set(['модификатор', 'мутатор', 'особенность', 'эпоха', 'сезон', 'монета', 'монеты', 'бонус', 'бонусы', 'уровень']);
    for (const r of GENERATION_RULES) {
      const words = [r.name, r.summary, r.news, r.quip.text].join(' ').toLowerCase().split(/[^а-яёa-z]+/);
      expect(words.filter((w) => banned.has(w)), r.id).toEqual([]);
    }
  });

  it('называет каждое Правило, объясняет его и озвучивает голосом существующей Лаборатории', () => {
    for (const r of GENERATION_RULES) {
      expect(r.name.length).toBeGreaterThan(0);
      expect(r.summary.length).toBeGreaterThan(0);
      expect(r.news.length).toBeGreaterThan(0);
      expect(LABS[r.quip.lab]).toBeDefined();
      expect(r.quip.text.length).toBeGreaterThan(0);
    }
  });
});

describe('Правило «Ценовая война» (Omni)', () => {
  const omni = 3;

  it('начинает Забег с полной цены и удешевляет Моделей со временем Забега', () => {
    const m = CATALOG[omni].models[3];
    const price = (minutes: number) => bulkCost(m, 0, 1, rulePriceMult(runAt(omni, minutes)));
    expect(rulePriceMult(runAt(omni, 0))).toBe(1);
    let prev = price(0);
    for (const minutes of [5, 10, 20, 40, 80]) {
      const now = price(minutes);
      expect(now).toBeLessThan(prev);
      prev = now;
    }
  });

  it('упирается в дно: цена не падает ниже него, сколько бы ни длился Забег', () => {
    const late = rulePriceMult(runAt(omni, 24 * 60));
    const later = rulePriceMult(runAt(omni, 240 * 60));
    expect(late).toBeGreaterThan(0);
    expect(late).toBeLessThan(1);
    expect(later).toBeGreaterThanOrEqual(late * 0.999);
    expect(later).toBeLessThanOrEqual(late);
  });

  it('входит в цену покупки: тот же Агент в конце Забега стоит дешевле, чем в начале', () => {
    const m = CATALOG[omni].models[2];
    const wallet = (s: GameState): GameState => ({ ...s, tokens: 1e15, agents: { [CATALOG[omni].models[0].id]: 5 } });
    const early = wallet(runAt(omni, 0));
    const late = wallet(runAt(omni, 60));
    const paid = (s: GameState) => s.tokens - buyAgents(s, m.id, 1).tokens;
    expect(paid(late)).toBeLessThan(paid(early));
    expect(paid(early)).toBeCloseTo(bulkCost(m, 0, 1, 1), -2);
  });

  it('держит цену целым числом ступеней минуты: между тиками одной минуты она не движется', () => {
    const a = rulePriceMult(runAt(omni, 12));
    const b = rulePriceMult({ ...runAt(omni, 12), lastTick: T0 + 12 * MIN + 40_000 });
    expect(b).toBe(a);
  });

  it('не трогает Доход', () => {
    expect(ruleIncomeMult(runAt(omni, 30))).toBe(1);
  });

  it('не меняет Оффлайн-доход: минутный эффект в оффлайн не попадает', () => {
    const office = (minutes: number) => fullRoster(runAt(omni, minutes));
    expect(offlineIncome(office(600))).toBe(offlineIncome(office(0)));
  });

  it('читает время Забега из часов состояния и не уходит в минус при откате часов', () => {
    const s = { ...runAt(omni, 0), runStartedAt: T0 + 10 * MIN };
    expect(rulePriceMult(s)).toBe(1);
  });
});

describe('Правило «Разнообразие» (Мультимодальная)', () => {
  const multimodal = 2;
  const labsIn = (g: number) => new Set(CATALOG[g].models.map((m) => m.lab)).size;

  it('не прибавляет ничего офису из одной Лаборатории и пустому офису', () => {
    const g = CATALOG[multimodal];
    expect(ruleIncomeMult(runAt(multimodal))).toBe(1);
    expect(ruleIncomeMult(loneAgent(runAt(multimodal), g.models[0].id))).toBe(1);
    const sameLab = g.models.filter((m) => m.lab === g.models[0].lab);
    const two = { ...runAt(multimodal), agents: Object.fromEntries(sameLab.map((m) => [m.id, 3])) };
    expect(ruleIncomeMult(two)).toBe(1);
  });

  it('растёт с каждой новой Лабораторией в офисе и не растёт от второго Агента той же', () => {
    const g = CATALOG[multimodal];
    const firstOfEachLab: string[] = [];
    const seen = new Set<string>();
    for (const m of g.models) if (!seen.has(m.lab)) { seen.add(m.lab); firstOfEachLab.push(m.id); }
    let prev = 1;
    const agents: Record<string, number> = {};
    for (const id of firstOfEachLab) {
      agents[id] = 1;
      const mult = ruleIncomeMult({ ...runAt(multimodal), agents: { ...agents } });
      if (Object.keys(agents).length > 1) expect(mult).toBeGreaterThan(prev);
      prev = mult;
    }
    agents[firstOfEachLab[0]] = 50;
    expect(ruleIncomeMult({ ...runAt(multimodal), agents })).toBe(prev);
    expect(Object.keys(agents).length).toBe(labsIn(multimodal));
  });

  it('множит Доход каждой Модели в офисе, а Модели без Агентов по-прежнему не платят', () => {
    const g = CATALOG[multimodal];
    const full = fullRoster(runAt(multimodal));
    const mult = ruleIncomeMult(full);
    expect(mult).toBeGreaterThan(1);
    for (const m of g.models) {
      const alone = modelIncome(loneAgent(runAt(multimodal), m.id), m);
      expect(modelIncome(full, m)).toBeCloseTo(alone * mult, -1);
    }
    expect(modelIncome(runAt(multimodal), g.models[0])).toBe(0);
  });

  it('входит в Оффлайн-доход: состав офиса держится и в отсутствие', () => {
    const g = CATALOG[multimodal];
    const full = fullRoster(runAt(multimodal));
    const mult = ruleIncomeMult(full);
    const withoutRule = g.models.reduce((sum, m) => sum + modelIncome(loneAgent(runAt(multimodal), m.id), m), 0);
    expect(offlineIncome(full)).toBeCloseTo(withoutRule * mult, -1);
    expect(offlineIncome(full)).toBeGreaterThan(withoutRule);
    const away = applyOffline({ ...full, lastTick: T0 }, T0 + 3600_000);
    expect(away.earned).toBeCloseTo(offlineIncome(full) * 3600, -1);
  });

  it('не трогает цены', () => {
    expect(rulePriceMult(fullRoster(runAt(multimodal, 30)))).toBe(1);
  });
});

describe('Правило действует только в своём Поколении', () => {
  it('в остальных Поколениях цена и Доход такие, как без Правил, в любой момент Забега', () => {
    for (const g of CATALOG) {
      if (RULE_GENERATIONS.includes(g.index)) continue;
      for (const minutes of [0, 10, 60, 600]) {
        const s = fullRoster(runAt(g.index, minutes));
        expect(rulePriceMult(s)).toBe(1);
        expect(ruleIncomeMult(s)).toBe(1);
      }
    }
  });

  it('цену Правила Omni не применяют в Мультимодальной, а прибавку Разнообразия не применяют в Omni', () => {
    expect(rulePriceMult(fullRoster(runAt(2, 60)))).toBe(1);
    expect(ruleIncomeMult(fullRoster(runAt(3, 60)))).toBe(1);
  });

  it('Правило не видно в скидке, пока Агентов меньше двух: стартовая скидка идёт отдельным сомножителем', () => {
    const s = runAt(3, 30);
    expect(discountMult(s)).toBeCloseTo(0.7 * rulePriceMult(s), 12);
  });
});

describe('Правила держат лестницу Ранга по всему каталогу', () => {
  /**
   * Цена и Доход одного Агента каждой Модели Поколения с включённым Правилом: цена идёт через
   * `bulkCost` со скидкой движка, Доход — через `modelIncome`, то есть теми же функциями, что у тика.
   * `roster` решает, какой офис вокруг: только эта Модель (одна Лаборатория) или все Модели Поколения.
   */
  const rungs = (base: GameState, roster: 'alone' | 'full') =>
    CATALOG[base.generation].models.map((m) => {
      const office = roster === 'full' ? fullRoster(base) : loneAgent(base, m.id);
      return { cost: bulkCost(m, 0, 1, discountMult(office)), income: modelIncome(office, m) };
    });

  const scenarios = (generation: number): [string, GameState, 'alone' | 'full'][] => [
    ['начало Забега, одна Лаборатория', runAt(generation, 0), 'alone'],
    ['начало Забега, все Лаборатории', runAt(generation, 0), 'full'],
    ['20-я минута, все Лаборатории', runAt(generation, 20), 'full'],
    ['десять часов Забега, одна Лаборатория', runAt(generation, 600), 'alone'],
    ['десять часов Забега, все Лаборатории', runAt(generation, 600), 'full'],
  ];

  for (const rule of GENERATION_RULES) {
    it(`«${rule.name}»: цена и Доход строго растут с Рангом, окупаемость в полосе 3×`, () => {
      for (const [label, state, roster] of scenarios(rule.generation)) {
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
});

describe('Флагман достижим в каждом Поколении с Правилом', () => {
  // Жадный игрок из `tools/greedyPolicy.ts` входит в Поколение без Compute и Перков — это нижняя
  // граница, строже настоящей кампании: в ней к Поколению приходят с Перками и Compute.
  for (const rule of GENERATION_RULES) {
    it(`«${rule.name}»: жадная политика берёт Флагман за разумное время`, () => {
      const w = newSession({});
      w.s = { ...w.s, generation: rule.generation, maxGeneration: rule.generation, runStartedAt: w.s.lastTick };
      const capMinutes = 240;
      for (let i = 0; i < (capMinutes * 60) / DT && !canPrestige(w.s); i++) tick(w);
      expect(canPrestige(w.s), `Флагман не взят за ${capMinutes} минут`).toBe(true);
    }, 120_000);
  }
});
