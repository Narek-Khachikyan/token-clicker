import { describe, expect, it } from 'vitest';
import { CATALOG, LAST_GENERATION, type Model } from './catalog';
import { buyAgents, buyUpgrade, bulkCost, discountMult, globalMult, incomeGain, modelIncome, prestige, totalIncome } from './engine';
import { globalFactors } from './engine';
import { AVAILABLE_CAP_SEC, availabilityOf, modelCardSummary, type BulkAmount } from './modelCard';
import { newGame, type GameState } from './state';
import { thermalRead } from './thermal';
import { availableUpgrades, modelUpgradeId } from './upgrades';
import { ACHIEVEMENTS } from './achievements';
import { PERKS } from './perks';
import { CHALLENGES } from './challenges';

const T0 = 1_700_000_000_000;
const rich = (s: GameState, tokens: number): GameState => ({ ...s, tokens, runTokens: tokens });
const cold = (s: GameState): GameState => ({ ...s, temp: 0, heat: 0, nextEventAt: 4e12, nextGlitchAt: 4e12 });

/** Состояние Поколения `gen`: Забеги пройдены Престижами, как у игрока, дальше — только Агенты. */
function atGeneration(gen: number): GameState {
  let s = newGame(T0);
  for (let g = 0; g < gen; g++) {
    s = prestige(buyAgents(rich(s, 1e50), CATALOG[g].flagship.id, 1), T0 + g * 1000);
  }
  return cold(s);
}

/**
 * Состояние со всеми постоянными усилениями сразу: Агенты у каждой Модели, все доступные Апгрейды,
 * Перки (Партнёрства и Наследия), Compute, запас кристаллов, Лицензия и закрытые Испытания.
 * Без этого тест разбивки видел бы одни единицы и сходился бы на любой неверной формуле.
 */
function stacked(gen: number): GameState {
  // Достижения нужны до покупок: пороги Датасета считаются по ним.
  let s: GameState = { ...atGeneration(gen), achievements: ACHIEVEMENTS.map((a) => a.id) };
  CATALOG[gen].models.forEach((m, i) => {
    s = buyAgents(rich(s, 1e300), m.id, 20 + i * 7);
  });
  for (let pass = 0; pass < 4; pass++) {
    for (const u of availableUpgrades(s)) s = buyUpgrade(rich(s, 1e300), u.id);
  }
  return {
    ...rich(s, 1e30),
    perks: PERKS.map((p) => p.id),
    compute: 250,
    crystals: 3,
    covenant: true,
    challengesDone: CHALLENGES.map((c) => c.id),
  };
}

const relDiff = (a: number, b: number): number => Math.abs(a - b) / Math.max(Math.abs(b), Number.MIN_VALUE);

const product = (s: ReturnType<typeof modelCardSummary>): number =>
  s.rows.reduce((p, r) => p * r.value, 1);

describe('карточка Модели: разбивка Дохода', () => {
  it('произведение множителей равно Доходу каждой Модели каждого Поколения', () => {
    for (let gen = 0; gen <= LAST_GENERATION; gen++) {
      const plain = cold(buyAgents(rich(atGeneration(gen), 1e300), CATALOG[gen].models[0].id, 12));
      const full = stacked(gen);
      for (const state of [plain, full]) {
        for (const m of CATALOG[gen].models) {
          const card = modelCardSummary(state, m);
          const income = modelIncome(state, m);
          expect(card.income).toBe(income);
          if (income > 0) expect(relDiff(product(card), income)).toBeLessThan(1e-9);
          else expect(product(card)).toBe(0);
        }
      }
    }
  });

  it('на позднем Поколении разбивка названа по видам и ни одна строка не равна единице', () => {
    const state = stacked(LAST_GENERATION);
    const kinds = new Set<string>();
    for (const m of CATALOG[LAST_GENERATION].models) {
      for (const row of modelCardSummary(state, m).rows) {
        kinds.add(row.kind);
        expect(Number.isFinite(row.value)).toBe(true);
        if (row.kind !== 'base' && row.kind !== 'agents') expect(row.value).not.toBe(1);
      }
    }
    for (const kind of ['base', 'agents', 'upgrades', 'synergy', 'flagship', 'dataset', 'labPerk', 'genPerk', 'compute', 'crystals', 'covenant', 'challenge']) {
      expect(kinds, kind).toContain(kind);
    }
  });

  it('Прорыв стоит строкой разбивки той Модели, на которую упал, и больше ни на какой', () => {
    const gen = 3;
    const base = stacked(gen);
    const [target, other] = CATALOG[gen].models;
    const state: GameState = {
      ...base,
      lastTick: T0,
      event: { kind: 'surge', startedAt: T0 - 1000, red: false, modelId: target.id },
      eventCaughtAt: T0 - 1000,
    };
    const hit = modelCardSummary(state, target);
    expect(hit.rows.map((r) => r.kind)).toContain('surge');
    expect(relDiff(product(hit), modelIncome(state, target))).toBeLessThan(1e-9);
    expect(modelCardSummary(state, other).rows.map((r) => r.kind)).not.toContain('surge');
  });

  it('Температура — отдельное «сейчас»: не строка произведения, а множитель всего Дохода', () => {
    const state = { ...stacked(2), temp: 1.2, heat: 0.3 };
    const m = CATALOG[2].models[1];
    const card = modelCardSummary(state, m);
    expect(card.thermalMult).toBe(thermalRead(state).mult);
    expect(card.thermalMult).not.toBe(1);
    expect(relDiff(product(card), modelIncome(state, m))).toBeLessThan(1e-9);
  });

  it('пока Агентов нет, Доход Модели ноль, а один Агент приносит то, что обещает карточка', () => {
    const state = cold(newGame(T0));
    const m = CATALOG[0].models[2];
    const card = modelCardSummary(state, m);
    expect(card.income).toBe(0);
    const hired = { ...state, agents: { ...state.agents, [m.id]: 1 } };
    expect(card.perAgent).toBe(modelIncome(hired, m));
  });

  it('общие множители в разложении равны globalMult', () => {
    for (const state of [newGame(T0), stacked(1), stacked(LAST_GENERATION)]) {
      const p = globalFactors(state).reduce((acc, f) => acc * f.mult, 1);
      expect(relDiff(p, globalMult(state))).toBeLessThan(1e-12);
    }
  });
});

describe('карточка Модели: окупаемость и «доступно через»', () => {
  it('окупаемость — цена следующего Агента на его прирост Дохода, как в строке «к доходу»', () => {
    for (const gen of [0, 3, LAST_GENERATION]) {
      const state = stacked(gen);
      for (const m of CATALOG[gen].models) {
        const card = modelCardSummary(state, m);
        const owned = state.agents[m.id] ?? 0;
        const cost = bulkCost(m, owned, 1, discountMult(state));
        const gain = incomeGain(state, m.id, 1);
        expect(gain).toBeGreaterThan(0);
        expect(card.paybackSec).toBeCloseTo(cost / gain, 6);
      }
    }
  });

  it('доступно сейчас, через столько секунд, сколько Дохода не хватает, или «больше суток»', () => {
    const state = cold(buyAgents(rich(newGame(T0), 1e9), CATALOG[0].models[0].id, 25));
    const m = CATALOG[0].models[3];
    const owned = state.agents[m.id] ?? 0;
    const price = bulkCost(m, owned, 1, 1);
    const income = totalIncome(state);
    expect(income).toBeGreaterThan(0);

    expect(modelCardSummary({ ...state, tokens: price }, m).availability).toEqual({ kind: 'now' });
    const wait = modelCardSummary({ ...state, tokens: price - income * 30 }, m).availability;
    expect(wait.kind).toBe('wait');
    if (wait.kind === 'wait') expect(wait.seconds).toBeCloseTo(30, 6);
    const idle = { ...cold(newGame(T0)), tokens: 0 };
    expect(modelCardSummary(idle, m).availability.kind).toBe('long');
  });

  it('без Дохода или дальше суток ожидание читается как «больше суток», ровно сутки — ещё срок', () => {
    const state = { ...cold(newGame(T0)), tokens: 0 };
    expect(availabilityOf(state, 100, 0)).toEqual({ kind: 'long' });
    expect(availabilityOf(state, 100, 100 / AVAILABLE_CAP_SEC)).toEqual({ kind: 'wait', seconds: AVAILABLE_CAP_SEC });
    expect(availabilityOf(state, 100, 100 / (AVAILABLE_CAP_SEC + 1))).toEqual({ kind: 'long' });
  });
});

describe('карточка Модели: итог ×10, ×100 и Max', () => {
  const quoteOf = (card: ReturnType<typeof modelCardSummary>, amount: BulkAmount) => {
    const q = card.bulk.find((b) => b.amount === amount);
    if (!q) throw new Error(`нет строки ${amount}`);
    return q;
  };

  /** Что на самом деле списала покупка: число Агентов и Токены, ушедшие из кошелька. */
  const purchase = (state: GameState, m: Model, n: number | 'max') => {
    const after = buyAgents(state, m.id, n);
    return { bought: (after.agents[m.id] ?? 0) - (state.agents[m.id] ?? 0), spent: state.tokens - after.tokens };
  };
  /** Покупка спишет ту же сумму: вычитание из большого кошелька теряет младшие разряды, поэтому не побитово. */
  const expectSame = (got: { bought: number; spent: number }, want: { count: number; cost: number }) => {
    expect(got.bought).toBe(want.count);
    expect(relDiff(got.spent, want.cost) < 1e-9 || got.spent === want.cost).toBe(true);
  };

  it('×10 и ×100: итог — ровно то, что спишет покупка при кошельке вровень с ценой', () => {
    for (const gen of [0, 2, LAST_GENERATION]) {
      const base = stacked(gen);
      for (const m of CATALOG[gen].models) {
        for (const amount of [10, 100] as const) {
          const q = quoteOf(modelCardSummary(base, m), amount);
          expect(q.count).toBe(amount);
          const state = { ...base, tokens: q.cost };
          expect(quoteOf(modelCardSummary(state, m), amount).affordable).toBe(true);
          expectSame(purchase(state, m, amount), q);
          // На Токен меньше — покупка не проходит, и карточка говорит то же.
          const short = { ...base, tokens: q.cost * (1 - 1e-9) };
          expect(quoteOf(modelCardSummary(short, m), amount).affordable).toBe(false);
          expect(purchase(short, m, amount)).toEqual({ bought: 0, spent: 0 });
        }
      }
    }
  });

  it('Max: число Агентов и сумма совпадают с покупкой на любом кошельке, в том числе с пустым', () => {
    for (const gen of [0, 4, LAST_GENERATION]) {
      const base = stacked(gen);
      for (const m of CATALOG[gen].models) {
        const owned = base.agents[m.id] ?? 0;
        const one = bulkCost(m, owned, 1, discountMult(base));
        for (const wallet of [0, one * 0.5, one, one * 3.7, one * 250, one * 1e6]) {
          const state = { ...base, tokens: wallet };
          const q = quoteOf(modelCardSummary(state, m), 'max');
          expectSame(purchase(state, m, 'max'), q);
          expect(q.affordable).toBe(q.count > 0);
        }
      }
    }
  });

  it('стартовая скидка первых Агентов учтена в итоге так же, как в покупке', () => {
    const m = CATALOG[0].models[0];
    const fresh = rich(cold(newGame(T0)), 1e6);
    const q10 = quoteOf(modelCardSummary(fresh, m), 10);
    expectSame(purchase(fresh, m, 10), q10);
    const qMax = quoteOf(modelCardSummary(fresh, m), 'max');
    expectSame(purchase(fresh, m, 'max'), qMax);
  });
});

describe('карточка Модели: следующий Апгрейд', () => {
  const models = CATALOG[0].models;
  const youngest = models[0];
  const flagship = models[models.length - 1];
  const fresh = rich(cold(newGame(T0)), 1e300);

  it('называет ступень и число Агентов, которое её открывает, — у младшей раньше, чем у Флагмана', () => {
    expect(modelCardSummary(fresh, youngest).nextUpgrade).toEqual({ name: 'Fine-tuning', threshold: 1, ready: false });
    const one = (m: Model) => buyUpgrade(buyAgents(fresh, m.id, 1), modelUpgradeId(m.id, 0));
    // Пороги второй ступени — 4 у младшей и 7 у Флагмана (tierCurve.test.ts).
    expect(modelCardSummary(one(youngest), youngest).nextUpgrade).toEqual({ name: 'RLHF', threshold: 4, ready: false });
    expect(modelCardSummary(one(flagship), flagship).nextUpgrade).toEqual({ name: 'RLHF', threshold: 7, ready: false });
  });

  it('говорит «готово», когда ступень открыта, но не куплена, и молчит, когда куплены все', () => {
    const open = buyAgents(fresh, youngest.id, 4);
    expect(modelCardSummary(open, youngest).nextUpgrade).toEqual({ name: 'Fine-tuning', threshold: 1, ready: true });
    let all = buyAgents(fresh, youngest.id, 70);
    for (let tier = 0; tier < 5; tier++) all = buyUpgrade(all, modelUpgradeId(youngest.id, tier));
    expect(all.upgrades).toHaveLength(5);
    expect(modelCardSummary(all, youngest).nextUpgrade).toBeNull();
  });
});
