import { describe, expect, it } from 'vitest';
import { CATALOG } from './catalog';
import { applyOffline, bulkCost, buyAgents, canPrestige, discountMult, modelIncome, offlineIncome } from './engine';
import { DT, newSession, tick } from '../../tools/greedyPolicy';
import { newGame, type GameState } from './state';
import { arenaOutlook, generationRule, ruleIncomeMult, rulePriceMult } from './rules';
import { exportSave, importSave } from './save';
import { characterIncomeMult } from './character';
import { newsPool } from './news';
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
      // Агенты Meta в офисе усиливают чужие Модели («Открытые веса»): это Характер, а не Правило,
      // и тест называет его отдельным сомножителем, а не прячет в допуске.
      expect(modelIncome(full, m)).toBeCloseTo(alone * mult * characterIncomeMult(full, m), -1);
    }
    expect(modelIncome(runAt(multimodal), g.models[0])).toBe(0);
  });

  it('входит в Оффлайн-доход: состав офиса держится и в отсутствие', () => {
    const g = CATALOG[multimodal];
    const full = fullRoster(runAt(multimodal));
    const mult = ruleIncomeMult(full);
    const withoutRule = g.models.reduce(
      (sum, m) => sum + modelIncome(loneAgent(runAt(multimodal), m.id), m) * characterIncomeMult(full, m),
      0,
    );
    expect(offlineIncome(full)).toBeCloseTo(withoutRule * mult, -1);
    expect(offlineIncome(full)).toBeGreaterThan(withoutRule);
    const away = applyOffline({ ...full, lastTick: T0 }, T0 + 3600_000);
    expect(away.earned).toBeCloseTo(offlineIncome(full) * 3600, -1);
  });

  it('не трогает цены', () => {
    expect(rulePriceMult(fullRoster(runAt(multimodal, 30)))).toBe(1);
  });
});

describe('Правило «Роутер» (GPT-5)', () => {
  const gpt5 = 6;
  const models = CATALOG[gpt5].models;

  /** Во сколько раз Доход одного Агента Модели в пустом офисе отличается от базового из каталога. */
  const shareOfBase = (m: (typeof models)[number]) => modelIncome(loneAgent(runAt(gpt5), m.id), m) / m.baseIncome;

  it('платит полный Доход трём умнейшим Моделям Поколения и 60% остальным', () => {
    for (const m of models) {
      const topThree = m.rank >= models.length - 3;
      expect(shareOfBase(m), m.name).toBeCloseTo(topThree ? 1 : 0.6, 10);
    }
  });

  it('держит троих умнейших вне зависимости от состава офиса: Рейтинг по Рангу, а не по тому, кого нанял игрок', () => {
    const lowest = models[0];
    const crowded = fullRoster(runAt(gpt5));
    expect(modelIncome(crowded, lowest) / lowest.baseIncome / 1).toBeCloseTo(0.6, 10);
    const flagship = models[models.length - 1];
    expect(modelIncome(crowded, flagship) / flagship.baseIncome).toBeCloseTo(1, 10);
  });

  it('входит в Оффлайн-доход: расклад по Рангу не зависит от времени', () => {
    const full = fullRoster(runAt(gpt5));
    const rawIncome = models.reduce((sum, m) => sum + m.baseIncome, 0);
    const paid = offlineIncome(full);
    expect(paid).toBeLessThan(rawIncome);
    expect(paid).toBeGreaterThan(rawIncome * 0.6);
  });

  it('не трогает цены', () => {
    expect(rulePriceMult(fullRoster(runAt(gpt5, 30)))).toBe(1);
  });
});

describe('Правило «Лидер Арены» (Фронтир)', () => {
  const frontier = 7;
  const models = CATALOG[frontier].models;
  const labs = [...new Set(models.map((m) => m.lab))];
  const PERIOD_MIN = 5;
  const leaderAt = (minutes: number, over: Partial<GameState> = {}) =>
    arenaOutlook({ ...runAt(frontier, minutes), ...over })!.leader;

  it('ставит лидером Лабораторию Поколения и держит её весь период', () => {
    for (let period = 0; period < 20; period++) {
      const first = leaderAt(period * PERIOD_MIN);
      expect(labs).toContain(first);
      expect(leaderAt(period * PERIOD_MIN + 2.5)).toBe(first);
      expect(leaderAt(period * PERIOD_MIN + PERIOD_MIN - 0.01)).toBe(first);
    }
  });

  it('меняет лидера на каждой границе периода и ни разу не оставляет прежнего', () => {
    for (let period = 1; period < 60; period++) {
      expect(leaderAt(period * PERIOD_MIN), `период ${period}`).not.toBe(leaderAt(period * PERIOD_MIN - 0.01));
    }
  });

  it('за круг побеждает каждая Лаборатория Поколения по разу', () => {
    for (let block = 0; block < 4; block++) {
      const circle = Array.from({ length: labs.length }, (_, i) => leaderAt((block * labs.length + i) * PERIOD_MIN));
      expect(new Set(circle).size).toBe(labs.length);
    }
  });

  it('считается от времени Забега и не зависит от случая: два вызова, один ответ', () => {
    const a = Array.from({ length: 30 }, (_, i) => leaderAt(i * PERIOD_MIN));
    const b = Array.from({ length: 30 }, (_, i) => leaderAt(i * PERIOD_MIN));
    expect(b).toEqual(a);
  });

  it('у разных Забегов порядок лидеров разный', () => {
    const seq = (runStartedAt: number) =>
      Array.from({ length: 14 }, (_, i) => arenaOutlook({ ...runAt(frontier, 0), runStartedAt, lastTick: runStartedAt + i * PERIOD_MIN * MIN })!.leader);
    const orders = new Set([T0, T0 + 86_400_000, T0 + 2 * 86_400_000, T0 + 3 * 86_400_000].map((t) => seq(t).join()));
    expect(orders.size).toBeGreaterThan(1);
  });

  it('переживает перезагрузку: сохранённый и загруженный Забег называют одного лидера в тот же момент', () => {
    const s = { ...fullRoster(runAt(frontier, 37)), runStartedAt: T0 + 123_457 };
    const reloaded = importSave(exportSave(s), s.lastTick)!;
    expect(reloaded.runStartedAt).toBe(s.runStartedAt);
    for (const minutes of [0, 1, 4.9, 5, 17.3, 61, 240]) {
      const at = (st: GameState) => arenaOutlook({ ...st, lastTick: st.runStartedAt + minutes * MIN })!;
      expect(at(reloaded)).toEqual(at(s));
    }
  });

  it('множит Доход Моделей лидера в полтора раза и не трогает остальных', () => {
    const state = runAt(frontier, 12);
    const leader = arenaOutlook(state)!.leader;
    for (const m of models) {
      expect(modelIncome(loneAgent(state, m.id), m) / m.baseIncome, m.name).toBeCloseTo(m.lab === leader ? 1.5 : 1, 10);
    }
  });

  it('предупреждает о смене только за минуту до неё и называет следующего лидера', () => {
    const calm = arenaOutlook(runAt(frontier, 2))!;
    expect(calm.warning).toBe(false);
    const nearEnd = arenaOutlook(runAt(frontier, PERIOD_MIN - 0.5))!;
    expect(nearEnd.warning).toBe(true);
    expect(nearEnd.next).toBe(leaderAt(PERIOD_MIN));
    expect(nearEnd.next).not.toBe(nearEnd.leader);
    expect(nearEnd.secondsLeft).toBe(30);
    expect(arenaOutlook(runAt(frontier, PERIOD_MIN - 1.01))!.warning).toBe(false);
    expect(arenaOutlook(runAt(frontier, PERIOD_MIN - 1))!.warning).toBe(true);
  });

  it('называет следующего лидера в ленте только в окне предупреждения', () => {
    const warn = runAt(frontier, PERIOD_MIN - 0.5);
    const next = LABS[arenaOutlook(warn)!.next].name;
    const warned = newsPool(warn).filter((line) => line.includes(next) && line.includes('Арена'));
    expect(warned).toHaveLength(1);
    expect(newsPool(runAt(frontier, 1)).some((line) => line.startsWith('Арена'))).toBe(false);
    expect(newsPool(runAt(2, PERIOD_MIN - 0.5)).some((line) => line.startsWith('Арена'))).toBe(false);
  });

  it('не входит в Оффлайн-доход: минутный эффект платит только живой тик', () => {
    const full = fullRoster(runAt(frontier, 12));
    const raw = models.reduce((sum, m) => sum + m.baseIncome, 0);
    expect(offlineIncome(full)).toBeCloseTo(raw, -2);
    const away = applyOffline({ ...full, lastTick: full.lastTick }, full.lastTick + 3600_000);
    expect(away.earned).toBeCloseTo(raw * 3600, -2);
  });

  it('молчит вне Фронтира', () => {
    expect(arenaOutlook(runAt(2, 12))).toBeNull();
    expect(arenaOutlook(runAt(0, 12))).toBeNull();
  });

  it('держит лестницу Ранга и полосу 3× при каждом лидере', () => {
    for (let period = 0; period < labs.length * 2; period++) {
      for (const roster of ['alone', 'full'] as const) {
        const base = runAt(frontier, period * PERIOD_MIN + 1);
        const ladder = models.map((m) => {
          const office = roster === 'full' ? fullRoster(base) : loneAgent(base, m.id);
          return { cost: bulkCost(m, 0, 1, discountMult(office)), income: modelIncome(office, m) };
        });
        for (let i = 1; i < ladder.length; i++) {
          expect(ladder[i].cost).toBeGreaterThan(ladder[i - 1].cost);
          expect(ladder[i].income, `лидер ${leaderAt(period * PERIOD_MIN + 1)}, Ранг ${i}, ${roster}`).toBeGreaterThan(ladder[i - 1].income);
        }
        const payback = ladder.map((r) => r.cost / r.income);
        expect(Math.max(...payback) / Math.min(...payback)).toBeLessThanOrEqual(3);
      }
    }
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
