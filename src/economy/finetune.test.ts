import { describe, expect, it } from 'vitest';
import { CATALOG } from './catalog';
import { modelIncome, offlineIncome, prestige } from './engine';
import {
  applyFinetune,
  FINETUNE_ARCHETYPES,
  FINETUNE_HEAT_FLOOR,
  FINETUNE_SPEC,
  finetuneHeatMult,
  finetuneIncomeMult,
  finetuneName,
  finetuneOf,
  pickFinetuneQuip,
} from './finetune';
import { modelCardSummary } from './modelCard';
import { newGame, type FinetuneArchetype, type GameState } from './state';
import { safeTemp } from './thermal';
import { FINETUNE_QUIPS } from '../data/finetuneQuips';

const T0 = 1_000_000;
const first = CATALOG[0].models[0];
const second = CATALOG[0].models[1];
const flagship = CATALOG[0].flagship;

/** Игрок нанял `modelId` (по умолчанию первую Модель) и держит `stock` Заготовок. */
const withStock = (stock = 1, modelId = first.id): GameState => ({
  ...newGame(T0),
  finetuneStock: stock,
  agents: { [modelId]: 1 },
});

describe('применение Заготовки Файнтюна', () => {
  it('записывает архетип Модели и списывает Заготовку', () => {
    const s = applyFinetune(withStock(2), first.id, 'thinking');
    expect(finetuneOf(s, first.id)).toBe('thinking');
    expect(s.finetuneStock).toBe(1);
  });

  it('не применяется без Заготовки: тот же объект', () => {
    const s = withStock(0);
    expect(applyFinetune(s, first.id, 'turbo')).toBe(s);
  });

  it('не применяется к Модели, которую игрок не нанял', () => {
    const s = withStock(1);
    expect(applyFinetune(s, second.id, 'thinking')).toBe(s);
  });

  it('второй Файнтюн той же Модели не ставится и Заготовку не тратит', () => {
    const once = applyFinetune(withStock(2), first.id, 'thinking');
    expect(applyFinetune(once, first.id, 'turbo')).toBe(once);
    expect(once.finetuneStock).toBe(1);
  });

  it('не применяется к Модели другого Поколения, даже если её Агенты есть', () => {
    const other = CATALOG[1].models[0];
    const s = { ...withStock(1), agents: { [other.id]: 1 } };
    expect(applyFinetune(s, other.id, 'thinking')).toBe(s);
  });

  it('не применяет неизвестный архетип и чужой id, не читая мусорных полей', () => {
    const s = withStock(1);
    expect(applyFinetune(s, first.id, 'boost' as unknown as FinetuneArchetype)).toBe(s);
    expect(applyFinetune(s, 'constructor', 'thinking')).toBe(s);
  });
});

describe('Файнтюн меняет Доход Модели и жар офиса', () => {
  it('Thinking поднимает Доход своей Модели, соседние Модели не трогает', () => {
    const plain = { ...newGame(T0), agents: { [first.id]: 1, [second.id]: 1 } };
    const tuned = applyFinetune({ ...plain, finetuneStock: 1 }, first.id, 'thinking');
    expect(modelIncome(tuned, first) / modelIncome(plain, first)).toBeCloseTo(FINETUNE_SPEC.thinking.incomeMult, 10);
    expect(modelIncome(tuned, second)).toBe(modelIncome(plain, second));
  });

  it('Turbo режет Доход своей Модели', () => {
    const plain = withStock(0);
    plain.agents = { [first.id]: 1 };
    const tuned = applyFinetune({ ...plain, finetuneStock: 1 }, first.id, 'turbo');
    expect(modelIncome(tuned, first) / modelIncome(plain, first)).toBeCloseTo(FINETUNE_SPEC.turbo.incomeMult, 10);
  });

  it('Файнтюн входит в оффлайн-доход, как Апгрейд Модели', () => {
    const plain = withStock(0);
    const tuned = applyFinetune({ ...plain, finetuneStock: 1 }, first.id, 'thinking');
    expect(offlineIncome(tuned) / offlineIncome(plain)).toBeCloseTo(FINETUNE_SPEC.thinking.incomeMult, 10);
  });

  it('Thinking делает безопасную Температуру офиса ниже, Turbo — выше', () => {
    const base = newGame(T0);
    const thinking = { ...base, finetunes: { [first.id]: 'thinking' as const } };
    const turbo = { ...base, finetunes: { [first.id]: 'turbo' as const } };
    expect(safeTemp(thinking)).toBeLessThan(safeTemp(base));
    expect(safeTemp(turbo)).toBeGreaterThan(safeTemp(base));
  });

  it('жар складывается по Файнтюнам офиса', () => {
    expect(finetuneHeatMult({ finetunes: {} })).toBe(1);
    const two = { finetunes: { [first.id]: 'thinking' as const, [second.id]: 'thinking' as const } };
    expect(finetuneHeatMult(two)).toBeCloseTo(1 + 2 * FINETUNE_SPEC.thinking.heatDelta, 10);
  });

  it('Turbo не охлаждает ниже пола, сколько бы их ни было', () => {
    const many: Record<string, FinetuneArchetype> = Object.fromEntries(CATALOG[0].models.map((m) => [m.id, 'turbo' as const]));
    expect(finetuneHeatMult({ finetunes: many })).toBe(FINETUNE_HEAT_FLOOR);
  });

  it('показывает Файнтюн строкой разбивки карточки Модели, и разбивка сходится с Доходом', () => {
    const s = applyFinetune({ ...withStock(0), agents: { [first.id]: 1 }, finetuneStock: 1 }, first.id, 'thinking');
    const card = modelCardSummary(s, first);
    expect(card.rows).toContainEqual({ kind: 'finetune', value: FINETUNE_SPEC.thinking.incomeMult });
    expect(finetuneIncomeMult(s, first.id)).toBe(FINETUNE_SPEC.thinking.incomeMult);
  });
});

describe('Престиж: Заготовки остаются, Файнтюны сгорают', () => {
  it('Престиж сбрасывает Файнтюны Забега, а Заготовки переживают его', () => {
    const base = newGame(T0);
    const s: GameState = {
      ...base,
      agents: { [flagship.id]: 1, [first.id]: 1 },
      finetunes: { [first.id]: 'thinking' },
      finetuneStock: 3,
    };
    const next = prestige(s, T0);
    expect(next.generation).toBe(1);
    expect(next.finetunes).toEqual({});
    expect(next.finetuneStock).toBe(3);
  });
});

describe('имя с архетипом и реплика', () => {
  it('Модель с архетипом называется «имя + архетип», без архетипа — имя как есть', () => {
    expect(finetuneName('Claude Sonnet 4.5', 'thinking')).toBe('Claude Sonnet 4.5 Thinking');
    expect(finetuneName('Claude Sonnet 4.5', 'turbo')).toBe('Claude Sonnet 4.5 Turbo');
    expect(finetuneName('Claude Sonnet 4.5', null)).toBe('Claude Sonnet 4.5');
  });

  it('у каждого архетипа есть реплика, и выбирается она именно для своего архетипа', () => {
    for (const archetype of FINETUNE_ARCHETYPES) {
      expect(FINETUNE_QUIPS.some((q) => q.archetype === archetype)).toBe(true);
      for (const salt of [0, 1, 2, 3, 7, 1_000_003]) {
        expect(pickFinetuneQuip(archetype, salt)?.archetype).toBe(archetype);
      }
    }
  });

  it('реплики Файнтюна не пишут чисел и не используют запрещённых синонимов', () => {
    const banned = ['монета', 'тап', 'здание', 'юнит', 'сессия', 'уровень', 'бонус', 'улучшение'];
    for (const q of FINETUNE_QUIPS) {
      expect(q.text).not.toMatch(/\d/);
      const words = q.text.toLowerCase().split(/[^а-яёa-z]+/);
      expect(words.filter((w) => banned.includes(w)), q.id).toEqual([]);
    }
  });
});
