import { describe, expect, it } from 'vitest';
import { CATALOG } from './catalog';
import { newGame } from './state';
import { advanceTime, applyOffline, buyAgents, prestige, totalIncome } from './engine';
import {
  collectResearch,
  isResearchReady,
  plantResearch,
  RESEARCH_BOOST_MULT,
  RESEARCH_BOOST_WINDOW_MS,
  RESEARCH_DURATION_MS,
  RESEARCH_FINETUNE_YIELD,
} from './research';

const T0 = 1_700_000_000_000;
const MIN = 60_000;

/** Игра с наёмом: Доход есть, и он не нулевой ни в какой момент. */
const earning = () => buyAgents({ ...newGame(T0), tokens: 1e12 }, CATALOG[0].models[0].id, 5);

describe('закладка Исследования', () => {
  it('занимает свободный слот со своим сроком и часами закладки', () => {
    const s = plantResearch(newGame(T0), 'boost', '30m', T0);
    expect(s.research).toEqual([{ kind: 'boost', term: '30m', startedAt: T0 }]);
  });

  it('держит два слота: третья закладка при занятых слотах не меняет состояние', () => {
    let s = plantResearch(newGame(T0), 'boost', '30m', T0);
    s = plantResearch(s, 'boost', '2h', T0 + MIN);
    expect(s.research).toHaveLength(2);
    expect(plantResearch(s, 'boost', '8h', T0 + 2 * MIN)).toBe(s);
  });

  it('не принимает неизвестный вид или срок', () => {
    const s = newGame(T0);
    expect(plantResearch(s, 'nope' as unknown as 'boost', '30m', T0)).toBe(s);
    expect(plantResearch(s, 'boost', '1h' as unknown as '30m', T0)).toBe(s);
  });
});

describe('созревание по стенным часам', () => {
  // Сроки — из ТЗ #115 (30 минут, 2 часа, 8 часов), а не из кода: тест проверяет именно их.
  it.each([
    ['30m', 30 * MIN],
    ['2h', 120 * MIN],
    ['8h', 480 * MIN],
  ] as const)('срок %s: не готово до конца и готово ровно в срок', (term, durationMs) => {
    const job = plantResearch(newGame(T0), 'boost', term, T0).research[0];
    expect(isResearchReady(job, T0 + durationMs - 1)).toBe(false);
    expect(isResearchReady(job, T0 + durationMs)).toBe(true);
  });
});

describe('готовое Исследование ждёт сбора', () => {
  it('тик не забирает готовое само: слот занят, пока игрок не нажмёт сбор', () => {
    let s = plantResearch(newGame(T0), 'boost', '30m', T0);
    // Час игры тиками по 9 с (ниже порога простоя): срок прошёл, игрок не нажимал.
    for (let i = 0; i < 400; i++) s = advanceTime(s, 9, () => 0.99);
    expect(s.research).toHaveLength(1);
    expect(isResearchReady(s.research[0], s.lastTick)).toBe(true);
    expect(s.researchBoostUntil).toBe(0);
  });
});

describe('Исследования и Оффлайн-доход', () => {
  it('не меняют результат applyOffline: ни закладка, ни готовое, ни действующее усиление', () => {
    const plain = earning();
    const withJobs = {
      ...plain,
      research: [
        { kind: 'boost' as const, term: '30m' as const, startedAt: T0 },
        { kind: 'boost' as const, term: '8h' as const, startedAt: T0 },
      ],
      researchBoostUntil: T0 + 5 * MIN,
    };
    const later = T0 + 3 * 3600 * 1000;
    const a = applyOffline(plain, later);
    const b = applyOffline(withJobs, later);
    expect(b.seconds).toBe(a.seconds);
    expect(b.earned).toBe(a.earned);
    expect(b.state.tokens).toBe(a.state.tokens);
  });

  it('готовое Исследование не начисляет Доход, пока его не собрали', () => {
    const plain = earning();
    const waiting = plantResearch(plain, 'boost', '30m', T0);
    let a = plain;
    let b = waiting;
    // Полчаса тиками по 9 с: срок вышел, а усиление не выдано.
    for (let i = 0; i < 200; i++) {
      a = advanceTime(a, 9, () => 0.99);
      b = advanceTime(b, 9, () => 0.99);
    }
    expect(b.tokens).toBe(a.tokens);
    expect(b.researchBoostUntil).toBe(0);
  });
});

describe('откат часов', () => {
  it('закладка и усиление из будущего притягиваются к сейчас, а не растут впереди часов', () => {
    const s = {
      ...earning(),
      lastTick: T0 + 60 * MIN,
      research: [{ kind: 'boost' as const, term: '30m' as const, startedAt: T0 + 90 * MIN }],
      researchBoostUntil: T0 + 200 * MIN,
    };
    const back = applyOffline(s, T0 + 30 * MIN).state;
    expect(back.research).toEqual([{ kind: 'boost', term: '30m', startedAt: T0 + 30 * MIN }]);
    expect(back.researchBoostUntil).toBe(T0 + 30 * MIN);
  });
});

describe('Исследования и Престиж', () => {
  /** Игрок с Флагманом Поколения 0: только такой Забег может Престижиться. */
  const flagshipRun = () => buyAgents(earning(), CATALOG[0].flagship.id, 1);

  it('переживают Престиж с теми же сроками и часами закладки', () => {
    const s = plantResearch(plantResearch(flagshipRun(), 'boost', '2h', T0), 'boost', '8h', T0 + MIN);
    const after = prestige(s, T0 + 60 * MIN);
    expect(after.generation).toBe(1);
    expect(after.research).toEqual(s.research);
  });

  it('усиление заканчивается с Престижем: окно принадлежит Забегу', () => {
    const s = { ...flagshipRun(), researchBoostUntil: T0 + 50 * MIN };
    expect(prestige(s, T0 + 10 * MIN).researchBoostUntil).toBe(0);
  });

  it('готовое Исследование ждёт сбора и после Престижа', () => {
    const planted = plantResearch(flagshipRun(), 'boost', '30m', T0);
    const next = prestige(planted, T0 + 40 * MIN);
    const collected = collectResearch(next, 0, T0 + 40 * MIN);
    expect(collected.research).toEqual([]);
    expect(collected.researchBoostUntil).toBe(T0 + 40 * MIN + RESEARCH_BOOST_WINDOW_MS['30m']);
  });
});

describe('сбор готового Исследования', () => {
  it('даёт временное усиление на окно из таблицы и освобождает слот', () => {
    const planted = plantResearch(earning(), 'boost', '30m', T0);
    const now = T0 + 30 * MIN;
    const s = collectResearch(planted, 0, now);
    expect(s.research).toEqual([]);
    // Окно короче самого срока: отдача растёт медленнее времени, а не догоняет его.
    expect(s.researchBoostUntil).toBe(now + RESEARCH_BOOST_WINDOW_MS['30m']);
    expect(RESEARCH_BOOST_WINDOW_MS['30m']).toBeGreaterThan(0);
    expect(RESEARCH_BOOST_WINDOW_MS['30m']).toBeLessThan(30 * MIN);
  });

  it('не сбирает то, что ещё не созрело, и пустой индекс: состояние то же', () => {
    const planted = plantResearch(earning(), 'boost', '2h', T0);
    expect(collectResearch(planted, 0, T0 + 2 * MIN)).toBe(planted);
    expect(collectResearch(planted, 3, T0 + 300 * MIN)).toBe(planted);
  });

  it('пока усиление действует, Доход растёт в RESEARCH_BOOST_MULT раз и возвращается после окна', () => {
    const base = earning();
    const until = T0 + RESEARCH_BOOST_WINDOW_MS['30m'];
    const boosted = { ...base, researchBoostUntil: until };
    expect(totalIncome(boosted, T0)).toBeCloseTo(totalIncome(base, T0) * RESEARCH_BOOST_MULT, 6);
    expect(totalIncome(boosted, until)).toBeCloseTo(totalIncome(base, until), 6);
  });
});

describe('Заготовка Файнтюна как результат Исследования (ТЗ #116)', () => {
  it('закладывается с видом «Заготовка» и срок сохраняет', () => {
    const s = plantResearch(newGame(T0), 'finetune', '2h', T0);
    expect(s.research).toEqual([{ kind: 'finetune', term: '2h', startedAt: T0 }]);
  });

  it('созревает по стенным часам, а не по Доходу: до срока сбор ничего не даёт', () => {
    const planted = plantResearch(earning(), 'finetune', '2h', T0);
    expect(collectResearch(planted, 0, T0 + RESEARCH_DURATION_MS['2h'] - 1)).toBe(planted);
  });

  it.each(['30m', '2h', '8h'] as const)('сбор по сроку %s кладёт Заготовки из таблицы и не трогает усиление', (term) => {
    const planted = plantResearch(earning(), 'finetune', term, T0);
    const now = T0 + RESEARCH_DURATION_MS[term];
    const s = collectResearch(planted, 0, now);
    expect(s.finetuneStock).toBe(RESEARCH_FINETUNE_YIELD[term]);
    expect(s.research).toEqual([]);
    expect(s.researchBoostUntil).toBe(0);
  });

  it('Заготовки растут от запаса, а не заменяют его', () => {
    const planted = { ...plantResearch(earning(), 'finetune', '30m', T0), finetuneStock: 3 };
    expect(collectResearch(planted, 0, T0 + 30 * MIN).finetuneStock).toBe(3 + RESEARCH_FINETUNE_YIELD['30m']);
  });

  it('длиннее срок — больше Заготовок, но не в разы на каждый час срока', () => {
    const per = (term: '30m' | '2h' | '8h') => RESEARCH_FINETUNE_YIELD[term] / (RESEARCH_DURATION_MS[term] / 3_600_000);
    expect(RESEARCH_FINETUNE_YIELD['2h']).toBeGreaterThan(RESEARCH_FINETUNE_YIELD['30m']);
    expect(RESEARCH_FINETUNE_YIELD['8h']).toBeGreaterThan(RESEARCH_FINETUNE_YIELD['2h']);
    expect(per('8h')).toBeLessThan(per('30m'));
  });
});
