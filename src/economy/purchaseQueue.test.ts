import { describe, expect, it } from 'vitest';
import { CATALOG } from './catalog';
import { advanceTime, applyOffline, buyAgents, OFFLINE_THRESHOLD_SEC, prestige, purchaseQuote } from './engine';
import { clearQueue, queueAgent, queueCapacity, unqueueAgent } from './purchaseQueue';
import { newGame, type GameState } from './state';
import { GENERATION_RULES } from '../data/generationRules';

const T0 = 1_700_000_000_000;
const AGENTIC = 5;
const models = CATALOG[AGENTIC].models;
const [cheap, mid, dear] = [models[0], models[2], models[4]];

/** Забег в «Агентной» без Температуры и событий: проверяется только очередь. */
const agentic = (over: Partial<GameState> = {}): GameState => ({
  ...newGame(T0),
  generation: AGENTIC,
  maxGeneration: AGENTIC,
  temp: 0,
  heat: 0,
  nextEventAt: T0 + 3_600_000,
  nextGlitchAt: T0 + 3_600_000,
  ...over,
});

const queued = (s: GameState, ...ids: string[]): GameState => ids.reduce((acc, id) => queueAgent(acc, id), s);

/** Живой тик без случая: ставка Температуры и Глюков не вмешивается. */
const liveTick = (s: GameState, dt = 0.05): GameState => advanceTime(s, dt, () => 0.99);

describe('Очередь закупок: кто и сколько может поставить', () => {
  it('есть только у Правила «Агенты сами»: в других Поколениях очередь пуста и не принимает Моделей', () => {
    for (const g of CATALOG) {
      const s = { ...newGame(T0), generation: g.index };
      const after = queueAgent(s, g.models[0].id);
      if (g.index === AGENTIC) {
        expect(after.purchaseQueue).toEqual([g.models[0].id]);
        expect(queueCapacity(s)).toBe(6);
      } else {
        expect(after).toBe(s);
        expect(queueCapacity(s)).toBe(0);
      }
    }
  });

  it('держит порядок постановки, повторы одной Модели и не больше шести мест', () => {
    const s = queued(agentic(), cheap.id, mid.id, cheap.id, cheap.id, dear.id, mid.id);
    expect(s.purchaseQueue).toEqual([cheap.id, mid.id, cheap.id, cheap.id, dear.id, mid.id]);
    expect(queueAgent(s, cheap.id)).toBe(s);
  });

  it('не принимает Модель чужого Поколения и несуществующий id', () => {
    const s = agentic();
    expect(queueAgent(s, CATALOG[AGENTIC - 1].models[0].id)).toBe(s);
    expect(queueAgent(s, 'нет-такой-модели')).toBe(s);
  });

  it('убирает запись по номеру и освобождает место; чужой номер ничего не меняет', () => {
    const s = queued(agentic(), cheap.id, mid.id, dear.id);
    expect(unqueueAgent(s, 1).purchaseQueue).toEqual([cheap.id, dear.id]);
    expect(unqueueAgent(s, 3)).toBe(s);
    expect(unqueueAgent(s, -1)).toBe(s);
    expect(unqueueAgent(agentic(), 0).purchaseQueue).toEqual([]);
  });

  it('очищается целиком и не трогает пустую очередь', () => {
    const s = queued(agentic(), cheap.id, mid.id);
    expect(clearQueue(s).purchaseQueue).toEqual([]);
    const empty = agentic();
    expect(clearQueue(empty)).toBe(empty);
  });
});

describe('Очередь закупок исполняется в живом тике', () => {
  it('нанимает Агента, когда хватает Токенов, по цене ручной покупки, и снимает запись', () => {
    const s = queued(agentic({ tokens: 1e30 }), cheap.id);
    const price = purchaseQuote(s, cheap, 1).cost;
    const next = liveTick(s);
    expect(next.purchaseQueue).toEqual([]);
    expect(next.agents[cheap.id]).toBe(1);
    const manual = buyAgents(s, cheap.id, 1);
    expect(manual.tokens).toBeCloseTo(s.tokens - price, -10);
    // Тик платит Доход, а не очередь: разница с ручной покупкой — только прибавка этого тика.
    expect(next.tokens).toBeGreaterThanOrEqual(manual.tokens);
  });

  it('идёт строго по порядку: дорогая запись во главе ждёт и не пропускает дешёвую за собой', () => {
    const s = queued(agentic({ tokens: purchaseQuote(agentic(), cheap, 1).cost * 3 }), dear.id, cheap.id);
    const next = liveTick(s);
    expect(next.purchaseQueue).toEqual([dear.id, cheap.id]);
    expect(next.agents).toEqual({});
  });

  it('за один тик исполняет сколько хватает: две записи подряд при кошельке на обе', () => {
    const s = queued(agentic({ tokens: 1e30 }), cheap.id, cheap.id, mid.id);
    const next = liveTick(s);
    expect(next.purchaseQueue).toEqual([]);
    expect(next.agents[cheap.id]).toBe(2);
    expect(next.agents[mid.id]).toBe(1);
  });

  it('копит Токены, пока не хватит, и исполняет на тике, где хватило', () => {
    let s = queued({ ...agentic({ tokens: 0 }), agents: { [models[1].id]: 10 } }, mid.id);
    let steps = 0;
    while (s.purchaseQueue.length > 0 && steps < 200_000) {
      s = liveTick(s);
      steps++;
    }
    expect(s.purchaseQueue).toEqual([]);
    expect(s.agents[mid.id]).toBe(1);
    expect(steps).toBeGreaterThan(1);
  });

  it('молчит без записей: пустая очередь ничего не меняет в составе офиса', () => {
    const s = agentic({ tokens: 1e30 });
    expect(liveTick(s).agents).toEqual({});
  });
});

describe('Очередь закупок никогда не исполняется в оффлайне', () => {
  const rich = () => queued(agentic({ tokens: 1e30, agents: { [models[1].id]: 3 } }), cheap.id, mid.id);

  it('applyOffline начисляет Доход, но очередь и состав офиса остаются прежними', () => {
    const s = rich();
    const away = applyOffline(s, s.lastTick + 2 * 3600_000);
    expect(away.earned).toBeGreaterThan(0);
    expect(away.state.purchaseQueue).toEqual(s.purchaseQueue);
    expect(away.state.agents).toEqual(s.agents);
    expect(away.state.tokens).toBeCloseTo(s.tokens + away.earned, -20);
  });

  it('длинный тик идёт веткой простоя: очередь не трогается, а Доход режется потолком', () => {
    const s = rich();
    const long = advanceTime(s, OFFLINE_THRESHOLD_SEC + 1, () => 0.99);
    expect(long.purchaseQueue).toEqual(s.purchaseQueue);
    expect(long.agents).toEqual(s.agents);
    const veryLong = advanceTime(s, 30 * 3600, () => 0.99);
    expect(veryLong.purchaseQueue).toEqual(s.purchaseQueue);
    expect(veryLong.agents).toEqual(s.agents);
  });

  it('исполняется уже на первом живом тике после возвращения, на тех Токенах, что простой уже выплатил', () => {
    const s = rich();
    const back = advanceTime(s, 3600, () => 0.99);
    const live = liveTick(back);
    expect(live.purchaseQueue).toEqual([]);
    expect(live.agents[cheap.id]).toBe(1);
  });
});

describe('Очередь закупок и Престиж', () => {
  it('сгорает вместе с составом офиса при Престиже', () => {
    const flagship = CATALOG[AGENTIC].flagship;
    let s = queued(agentic({ tokens: 1e60 }), cheap.id);
    s = buyAgents(s, flagship.id, 1);
    const next = prestige(s);
    expect(next.generation).toBe(AGENTIC + 1);
    expect(next.purchaseQueue).toEqual([]);
  });
});

describe('Правило с очередью стоит в таблице один раз', () => {
  it('«Агенты сами» — Правило Агентной', () => {
    expect(GENERATION_RULES.find((r) => r.generation === AGENTIC)?.id).toBe('agents');
  });
});
