import { CATALOG, LAST_GENERATION } from './catalog';
import { generationRule, seededRandom } from './rules';
import type { GameState } from './state';
import { COURSES, courseById, type Course, type CourseEffect } from '../data/courses';
import { GENERATION_RULES } from '../data/generationRules';

/**
 * КУРС (ADR-0013, слой 4): на каждом Престиже игрок выбирает Курс нового Забега из трёх
 * предложенных, а сменить его до следующего Престижа нельзя.
 *
 * Состояние — три поля. `courseOffer` — три варианта на ближайший Престиж: появляется, когда нанят
 * Флагман, и лежит в сохранении до выбора, чтобы перезагрузка его не перебросила. `courseNext` —
 * выбор игрока, который можно менять до подтверждения Престижа. `course` — действующий Курс; пишет
 * его только Престиж (`takeCourse`), поэтому внутри Забега он остаётся тем, что выбрали.
 *
 * Случайность только в предложении, и она не случайна: набор определён зерном Престижа
 * (`courseSeed`), то есть повторим по состоянию. Выбранный Курс действует предсказуемо.
 *
 * Модуль не импортирует `engine.ts`: движок зовёт его при покупке и при Престиже, и круг
 * замкнул бы оба. Поэтому «Флагман нанят» проверяется здесь по каталогу, как в `canPrestige`.
 */

/** Сколько Курсов предлагается на Престиж. */
export const COURSE_OFFER_SIZE = 3;

/** Нанят ли Флагман Поколения: ровно условие `canPrestige`, повторённое ради порядка импортов. */
function flagshipHired(state: Pick<GameState, 'generation' | 'agents'>): boolean {
  return (state.agents[CATALOG[state.generation].flagship.id] ?? 0) >= 1;
}

/** Идёт ли сейчас Престиж, к которому предлагают Курс: Флагман нанят, и это не Финал контента. */
function prestigeOpen(state: Pick<GameState, 'generation' | 'agents'>): boolean {
  return flagshipHired(state) && state.generation < LAST_GENERATION;
}

/**
 * Курсы, из которых собирается предложение: собственные и Правило каждого Поколения, через которое
 * игрок проходит до текущего включительно (то есть то, что отдал бы пул при первом проходе).
 * Правило Поколения, куда ведёт Престиж, в пул не входит: оно и так начнёт действовать, и Курс
 * с ним удвоил бы не выбор, а повтор.
 *
 * Пул читает только `generation`, а не `maxGeneration`: после Престижа с Финала контента
 * `maxGeneration` последнее, и если бы пул брал его, в Поколения впереди попали бы Правила, Курсы
 * которых ломают полосу окупаемости (ADR-0013, слой 5; `courseLadder.test.ts`). Поле оставлено в
 * типе, чтобы вызовы остались прежними.
 */
export function coursePool(state: Pick<GameState, 'generation' | 'maxGeneration'>): Course[] {
  const target = Math.min(state.generation + 1, LAST_GENERATION);
  const ownRule = generationRule(target)?.id;
  return COURSES.filter((c) => {
    if (c.effect.kind !== 'rule') return true;
    const ruleId = c.effect.rule;
    const rule = GENERATION_RULES.find((r) => r.id === ruleId);
    return !!rule && rule.generation <= state.generation && rule.id !== ownRule;
  });
}

/** Перемешивающий хеш 32 бит (финализатор murmur3): соседние зёрна расходятся по всему диапазону. */
function mix(x: number): number {
  let h = x >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Зерно Престижа: начало игры (оно не меняется ни Престижем, ни перезагрузкой), число Престижей и
 * Поколение. Два Престижа одной игры получают разные зёрна, две игры — разные, а один и тот же
 * Престиж одной игры — всегда одно и то же, поэтому предложение воспроизводимо.
 */
export function courseSeed(state: Pick<GameState, 'startedAt' | 'prestiges' | 'generation'>): number {
  const start = Math.floor(state.startedAt);
  return mix(mix(start % 0x100000000) ^ mix(Math.floor(start / 0x100000000) + 0x9e3779b1) ^ mix(Math.imul(state.prestiges + 1, 0x85ebca6b)) ^ mix(state.generation + 0x27d4eb2f));
}

/** Три разных Курса из пула по зерну Престижа: частичная перетасовка Фишера — Йейтса. */
export function drawCourseOffer(state: Pick<GameState, 'startedAt' | 'prestiges' | 'generation' | 'maxGeneration'>): string[] {
  const pool = coursePool(state).map((c) => c.id);
  const rnd = seededRandom(courseSeed(state));
  const take = Math.min(COURSE_OFFER_SIZE, pool.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rnd() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, take);
}

/**
 * Кладёт в состояние предложение Курса, если Престиж открыт, а предложения нет. Остальное — тот же
 * объект: уже лежащее предложение не пересчитывается, поэтому не меняется ни от нового найма
 * Флагмана, ни от продажи и покупки заново.
 */
export function offerCourse(state: GameState): GameState {
  if (state.courseOffer.length > 0 || !prestigeOpen(state)) return state;
  const offer = drawCourseOffer(state);
  return offer.length === 0 ? state : { ...state, courseOffer: offer };
}

/**
 * Выбирает Курс из предложенных. Чужой id и выбор без предложения — тот же объект: пока предложения
 * нет (то есть всё время внутри Забега), сменить Курс нечем. Повторный выбор до подтверждения
 * Престижа заменяет прежний.
 */
export function chooseCourse(state: GameState, id: string): GameState {
  if (!state.courseOffer.includes(id) || state.courseNext === id) return state;
  return { ...state, courseNext: id };
}

/** Нужен ли выбор перед Престижем: предложение лежит, а Курс не выбран. */
export function courseMissing(state: Pick<GameState, 'courseOffer' | 'courseNext'>): boolean {
  return state.courseOffer.length > 0 && state.courseNext === null;
}

/**
 * Поля Курса после Престижа: выбранный становится действующим, предложение и выбор очищаются.
 * Без выбора (Престиж, у которого предложения не было) Забег идёт без Курса.
 */
export function takeCourse(state: Pick<GameState, 'courseNext'>): Pick<GameState, 'course' | 'courseOffer' | 'courseNext'> {
  return { course: courseById(state.courseNext) ? state.courseNext : null, courseOffer: [], courseNext: null };
}

/** Эффект действующего Курса; `null` без Курса. Правило как Курс читает `rules.ts`, не этот вид. */
export function courseEffect(state: Pick<GameState, 'course'>): CourseEffect | null {
  return courseById(state.course)?.effect ?? null;
}

/** Во сколько раз Курс меняет цену покупки; единица без Курса «Бережливость». */
export function coursePriceMult(state: Pick<GameState, 'course'>): number {
  const e = courseEffect(state);
  return e?.kind === 'price' ? e.mult : 1;
}

/** Во сколько раз Курс меняет Доход всех Моделей; единица без Курса «Масштабирование». */
export function courseIncomeMult(state: Pick<GameState, 'course'>): number {
  const e = courseEffect(state);
  return e?.kind === 'income' ? e.mult : 1;
}

/** Во сколько раз Курс меняет Клик; единица без Курса «Ручная работа». */
export function courseClickMult(state: Pick<GameState, 'course'>): number {
  const e = courseEffect(state);
  return e?.kind === 'click' ? e.mult : 1;
}

/** Поправки Температуры от Курса «Холодная голова»: скорость перегрева и частота Галлюцинаций, ×. */
export function courseThermalMods(state: Pick<GameState, 'course'>): { heat: number; hallu: number } {
  const e = courseEffect(state);
  return e?.kind === 'cool' ? { heat: e.heat, hallu: e.hallu } : { heat: 1, hallu: 1 };
}

/** Во сколько раз Курс сокращает паузу между Событиями; единица без Курса «Охота за сигналом». */
export function courseEventWindowMult(state: Pick<GameState, 'course'>): number {
  const e = courseEffect(state);
  return e?.kind === 'signal' ? e.windowMult : 1;
}
