import { describe, expect, it } from 'vitest';
import { CATALOG } from './catalog';
import { buyAgents, prestige, prestigePreview } from './engine';
import { chooseCourse, courseMissing, coursePool } from './course';
import { newGame, type GameState } from './state';
import { exportSave, importSave, migrate, serialize } from './save';
import { COURSES, OWN_COURSES } from '../data/courses';
import { LABS } from '../data/labs';
import { GENERATION_RULES } from '../data/generationRules';

const T0 = 1_700_000_000_000;

/** Забег Поколения `generation`, где Флагман ещё не нанят; `seed` задаёт начало игры, а с ним и зерно Престижа. */
const runAt = (generation: number, seed = 0, prestiges = generation): GameState => ({
  ...newGame(T0 + seed),
  generation,
  maxGeneration: generation,
  prestiges,
  tokens: 1e300,
});

/** Тот же Забег в тот миг, когда нанят Флагман: Престиж доступен, предложение Курса лежит в состоянии. */
const ready = (generation: number, seed = 0, prestiges = generation): GameState =>
  buyAgents(runAt(generation, seed, prestiges), CATALOG[generation].flagship.id, 1);

describe('Курс: предложение трёх вариантов', () => {
  it('появляется, как только нанят Флагман: три разных Курса из таблицы', () => {
    const s = ready(0);
    expect(s.courseOffer).toHaveLength(3);
    expect(new Set(s.courseOffer).size).toBe(3);
    for (const id of s.courseOffer) expect(COURSES.map((c) => c.id)).toContain(id);
  });

  it('не появляется раньше Флагмана: до него Престиж недоступен, выбирать нечего', () => {
    expect(runAt(0).courseOffer).toEqual([]);
    const cheap = buyAgents(runAt(0), CATALOG[0].models[0].id, 1);
    expect(cheap.courseOffer).toEqual([]);
  });

  it('не меняется от второго найма Флагмана и от повторной покупки после продажи', () => {
    const s = ready(0, 3);
    const again = buyAgents(s, CATALOG[0].flagship.id, 1);
    expect(again.courseOffer).toEqual(s.courseOffer);
  });

  it('переживает перезагрузку и перенос кодом: те же три варианта', () => {
    const s = ready(2, 5);
    expect(migrate(JSON.parse(serialize(s)), s.lastTick).courseOffer).toEqual(s.courseOffer);
    expect(importSave(exportSave(s), s.lastTick)?.courseOffer).toEqual(s.courseOffer);
  });

  it('определено зерном Престижа, а не случаем: тот же Забег в другой раз даёт тот же набор', () => {
    const a = ready(3, 11);
    const b = ready(3, 11);
    expect(b.courseOffer).toEqual(a.courseOffer);
  });

  it('у разных игр и разных Престижей наборы разные, а не один на всех', () => {
    const triples = new Set<string>();
    for (let seed = 0; seed < 40; seed++) triples.add(ready(3, seed * 7919).courseOffer.join('|'));
    expect(triples.size).toBeGreaterThan(10);
    const byPrestige = new Set<string>();
    for (let p = 0; p < 40; p++) byPrestige.add(ready(3, 1, p).courseOffer.join('|'));
    expect(byPrestige.size).toBeGreaterThan(10);
  });

  it('при первом Престиже предлагает только собственные Курсы: пройденных Правил ещё нет', () => {
    const own = new Set(OWN_COURSES.map((c) => c.id));
    for (let seed = 0; seed < 30; seed++) {
      for (const id of ready(0, seed).courseOffer) expect(own.has(id)).toBe(true);
    }
  });

  it('добавляет в пул Правило каждого пройденного Поколения и только их', () => {
    for (const g of [1, 3, 6]) {
      const pool = coursePool(runAt(g)).map((c) => c.id);
      const passed = GENERATION_RULES.filter((r) => r.generation <= g).map((r) => `rule:${r.id}`);
      const future = GENERATION_RULES.filter((r) => r.generation > g).map((r) => `rule:${r.id}`);
      for (const id of passed) expect(pool, `Поколение ${g}`).toContain(id);
      for (const id of future) expect(pool, `Поколение ${g}`).not.toContain(id);
      for (const c of OWN_COURSES) expect(pool).toContain(c.id);
    }
  });

  it('не предлагает Правило, которое и так действует в следующем Забеге', () => {
    for (let g = 0; g < CATALOG.length - 1; g++) {
      const target = GENERATION_RULES.find((r) => r.generation === g + 1);
      if (!target) continue;
      expect(coursePool(runAt(g)).map((c) => c.id), `Престиж из Поколения ${g}`).not.toContain(`rule:${target.id}`);
    }
  });

  it('после Престижа с Финала пул тот же, что при первом проходе: Правила впереди в него не попадают', () => {
    // Возврат с Финала не должен менять, какие Курсы бывают: каждое Поколение проходят тем же пулом, что
    // и в первый раз. Иначе Курс Правила Фронтира (Поколение 6) ломал бы полосу окупаемости своего Поколения.
    const last = CATALOG.length - 1;
    for (let k = 0; k < last; k++) {
      const afterFinale = coursePool({ generation: k, maxGeneration: last }).map((c) => c.id);
      const firstPass = coursePool(runAt(k)).map((c) => c.id);
      expect(afterFinale, `Поколение ${k}`).toEqual(firstPass);
    }
  });

  it('любой Курс пула может выпасть', () => {
    const g = 6;
    const seen = new Set<string>();
    for (let seed = 0; seed < 400; seed++) for (const id of ready(g, seed * 104729).courseOffer) seen.add(id);
    expect([...seen].sort()).toEqual(coursePool(runAt(g)).map((c) => c.id).sort());
  });
});

describe('Курс: выбор до Престижа', () => {
  it('принимает только один из трёх предложенных', () => {
    const s = ready(1, 2);
    const foreign = COURSES.map((c) => c.id).find((id) => !s.courseOffer.includes(id)) ?? '';
    expect(chooseCourse(s, foreign)).toBe(s);
    expect(chooseCourse(s, 'нет-такого')).toBe(s);
    const picked = chooseCourse(s, s.courseOffer[1]);
    expect(picked.courseNext).toBe(s.courseOffer[1]);
    expect(picked.courseOffer).toEqual(s.courseOffer);
  });

  it('позволяет передумать до подтверждения Престижа', () => {
    const s = ready(1, 2);
    const first = chooseCourse(s, s.courseOffer[0]);
    expect(chooseCourse(first, s.courseOffer[2]).courseNext).toBe(s.courseOffer[2]);
  });

  it('не принимает выбор, когда предложения нет: внутри Забега Курс не сменить', () => {
    const mid = runAt(2);
    expect(chooseCourse(mid, OWN_COURSES[0].id)).toBe(mid);
    const next = prestige(chooseCourse(ready(1, 2), ready(1, 2).courseOffer[0]), T0 + 1000);
    expect(next.courseOffer).toEqual([]);
    for (const c of COURSES) expect(chooseCourse(next, c.id)).toBe(next);
  });

  it('называет Престиж без выбора Курса не готовым к подтверждению', () => {
    const s = ready(1, 2);
    expect(courseMissing(s)).toBe(true);
    expect(prestigePreview(s).needsCourse).toBe(true);
    expect(prestigePreview(chooseCourse(s, s.courseOffer[0])).needsCourse).toBe(false);
  });

  it('Престиж делает выбранный Курс действующим и очищает предложение', () => {
    const s = ready(1, 2);
    const chosen = s.courseOffer[2];
    const next = prestige(chooseCourse(s, chosen), T0 + 5000);
    expect(next.course).toBe(chosen);
    expect(next.courseNext).toBeNull();
    expect(next.courseOffer).toEqual([]);
    expect(next.generation).toBe(2);
  });

  it('Курс держится весь Забег: ни покупки, ни время его не меняют', () => {
    const s = ready(1, 2);
    const next = prestige(chooseCourse(s, s.courseOffer[0]), T0 + 5000);
    const later = buyAgents(next, CATALOG[2].models[0].id, 1);
    expect(later.course).toBe(next.course);
  });

  it('следующий Престиж заменяет Курс новым выбором из нового предложения', () => {
    const first = prestige(chooseCourse(ready(0, 4), ready(0, 4).courseOffer[0]), T0 + 1000);
    const again = buyAgents({ ...first, tokens: 1e300 }, CATALOG[1].flagship.id, 1);
    expect(again.courseOffer).toHaveLength(3);
    const second = prestige(chooseCourse(again, again.courseOffer[1]), T0 + 9000);
    expect(second.course).toBe(again.courseOffer[1]);
  });

  it('предыдущая версия сохранения без Курса грузится как Забег без Курса и без предложения', () => {
    const fresh = newGame(T0);
    const legacy: Record<string, unknown> = { ...fresh, version: 12 };
    delete legacy.course;
    delete legacy.courseOffer;
    delete legacy.courseNext;
    const loaded = migrate(legacy, T0);
    expect([loaded.course, loaded.courseOffer, loaded.courseNext]).toEqual([null, [], null]);
  });
});

describe('Курсы: таблица', () => {
  it('не повторяет id, а собственных Курсов хватает на первый Престиж, где пройденных Правил ещё нет', () => {
    const ids = COURSES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(OWN_COURSES.length).toBeGreaterThanOrEqual(4);
  });

  it('называет каждый Курс, объясняет его и озвучивает голосом существующего Маскота', () => {
    for (const c of COURSES) {
      expect(c.name.length, c.id).toBeGreaterThan(0);
      expect(c.summary.length, c.id).toBeGreaterThan(0);
      expect(c.quip.length, c.id).toBeGreaterThan(0);
      expect(LABS[c.lab], c.id).toBeDefined();
    }
  });

  it('не пользуется словами, которых CONTEXT.md избегает', () => {
    const banned = new Set(['доктрина', 'стратегия', 'билд', 'уровень', 'бонус', 'бонусы', 'монета', 'монеты', 'тап', 'здание', 'юнит', 'сессия', 'ран']);
    for (const c of COURSES) {
      const words = [c.name, c.summary, c.quip].join(' ').toLowerCase().split(/[^а-яёa-z]+/);
      expect(words.filter((w) => banned.has(w)), c.id).toEqual([]);
    }
  });

  it('берёт каждое Правило Поколения отдельным Курсом, с теми же названием и описанием', () => {
    for (const r of GENERATION_RULES) {
      const c = COURSES.find((x) => x.id === `rule:${r.id}`);
      expect(c, r.id).toBeDefined();
      expect(c?.name).toBe(r.name);
      expect(c?.summary).toBe(r.summary);
    }
  });
});
