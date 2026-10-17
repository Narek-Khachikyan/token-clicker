/**
 * Политика внимательного игрока (тикет #125): второй игрок для `tools/sim.ts --policy attentive`.
 *
 * Зачем. Жадная политика (`tools/greedyPolicy.ts`) задаёт НИЖНЮЮ границу темпа: она не ловит События,
 * не лопает Глюки, не закладывает Исследования и мгновенно, с точностью до тика, покупает всё
 * доступное. Настоящий внимательный игрок ловит Золотые Токены, но не мгновенно; это верхняя граница
 * того, чего игрок может добиться кликами. Эта политика — между ними: она моделирует человека, который
 * смотрит на экран, реагирует с задержкой и ошибается по времени, но не пропускает то, что видит.
 *
 * Допущения (каждое — число в коде ниже, не магия; меняйте здесь, а не в замерах):
 *  1. Клики. Игрок кликает непрерывно, `cps` Кликов в секунду (по умолчанию 4: устойчивый темп
 *     человека, не пиковый 10/с удержания Пробела). Клики не сверяются по кадрам: за тик набирается
 *     дробная доля, как у жадной политики, но без привязки к концу тика.
 *  2. Задержка реакции на Золотой Токен. Событие заметно не в тот же тик, в который появилось: игрок
 *     замечает его через `EVENT_REACTION_S` (равномерно 2–4 с) после появления и кликает. Если окно
 *     закрылось раньше — Токен упущен. Окна: Волна хайпа 77 с, Клик-рывок 13 с, Грант 15 с, Прорыв 30 с:
 *     задержка до 4 с укладывается во все четыре, но Грант теряет до 4 с из 15. Ловит КАЖДОЕ обычное
 *     Событие, которое успел заметить; вероятность «не заметил» не моделируется (верхняя граница по ловле).
 *  3. Глюки. Новый Глюк игрок замечает через `GLITCH_REACTION_S` (равномерно 2–5 с), затем бьёт его
 *     три раза с паузой `GLITCH_HIT_GAP_S` = 0,35 с (темп человеческого клика по одной цели). Третий
 *     удар лопает Глюка, выплата идёт через `earnTokens`, как в сторе.
 *  4. Покупки и Исследования — по расписанию человека, а не каждый тик. Раз в `SCAN_S` (равномерно 2–4 с)
 *     игрок «осматривает» офис: собирает готовое Исследование, закладывает свободный слот, покупает всё,
 *     что по карману (Апгрейды, Агенты, Перки — тем же порядком, что жадная `spend`), решает про Престиж.
 *     Внутри осмотра покупки мгновенны. Итог: между осмотрами Токены копятся, и покупка задерживается
 *     до 4 с: это и есть отличие от жадной политики, которая тратит в каждом тике.
 *  5. Исследования. Слот 1 — «Временное усиление» на 30 минут (`boost`, ×1,5 на 6 минут): оно
 *     ускоряет кампанию и не требует выбора. Слот 2 — «Постоянное открытие» (`unlock`, 30 минут),
 *     пока есть следующее открытие (`nextOpening`): оно живёт дальше Престижа и расширяет пул Курсов и
 *     Испытаний; когда открытий нет — второй слот тоже «усиление». Заготовки Файнтюна (`finetune`) не
 *     берутся: игрок не запускает Файнтюн, а Заготовка без применения — потерянный слот.
 *  6. Курсы. При Престиже из трёх предложенных берётся первый по `COURSE_PRIORITY`; если из предложенных
 *     ни один не в списке — первый предложенный. Порядок списка выбран замером на контрольных зёрнах 6–8
 *     (см. докблок `COURSE_PRIORITY`), не догадкой. Правила Поколений в список не входят.
 *  7. Испытания Забега. Берутся только на свежем Забеге, как и в игре (`canStartChallenge`), и только
 *     когда есть Перк «Посевной раунд» (`startTokens`): без него Забег без Кликов не наймёт ни одного
 *     Агента, и игрок застрянет (то же правило, что у жадного `takeChallenges`). Набор `CHALLENGE_SET`
 *     пуст: на контрольных зёрнах 6–8 ни одно Испытание не окупилось (см. докблок `CHALLENGE_SET`).
 *  8. Престиж по скорости Compute. Compute, который дал бы Престиж сейчас, — непрерывная величина
 *     `(Токены Забега / делитель Поколения)^(1/3) × множитель Испытаний`: без `floor`, как в игре, но
 *     с той же формой. Скорость — прирост этой величины за окно `RATE_WINDOW_S` (5 минут), в единицах
 *     Compute в минуту. Игрок следит за скоростью: она растёт в начале Забега, достигает пика и начинает
 *     падать (Агенты дорожают, а Токены копятся медленнее). Престиж — когда скорость упала ниже
 *     `FALL_FRAC` (85%) пика и держится так `FALL_HOLD_S` (3 минуты), либо пик не обновлялся
 *     `STALL_S` (10 минут). Оба условия требуют хотя бы одного Compute в запасе (`prestigeGain >= 1`) и
 *     Флагмана. Проверка делается только на осмотре, то есть с той же задержкой, что и покупки.
 *     Фиксированного порога в 40 Compute нет.
 *  9. Температура не крутится (`thermal: off`), как у жадной политики: внимательный игрок её не
 *     настраивает, а это отдельная механика; замер её не учитывает и не занижает темп сверх жадного.
 * 10. Оффлайн и простои не моделируются: игрок всё время в игре, ни один Золотой Токен не пропущен
 *     по отходу от окна. Это удерживает замер на верхней границе внимательности.
 * 11. Перки покупаются тем же правилом, что у жадной политики (самый дорогой доступный, с запасом
 *     `reserve`): дерево Перков — отдельная задача ветвления, здесь не выбирается вручную.
 *
 * Политика НЕ меняет игру: только читает состояние и зовёт те же функции движка, что стор. Её
 * случайность — отдельный генератор (`seeded(seed + 1000003)`), чтобы реакции не сдвигали розыгрыш
 * Событий движка: один и тот же `seed` даёт одно и то же расписание Событий у обеих политик.
 */
import type { GameState } from '../src/economy/state';
import { prestigeDivisor } from '../src/economy/catalog';
import { advanceTime, canPrestige, click, earnTokens, isContentFinale, prestige, prestigeGain, totalIncome } from '../src/economy/engine';
import { grantAmount, isEventActive, isEventCaught } from '../src/economy/events';
import { hitGlitch } from '../src/economy/glitches';
import { chooseCourse, offerCourse } from '../src/economy/course';
import { challengeComputeMult, toggleChallenge, type ChallengeDef } from '../src/economy/challenges';
import { collectResearch, nextOpening, plantResearch, researchSlots } from '../src/economy/research';
import { perkEffects } from '../src/economy/perks';
import { DEFAULT_POLICY, DT, newSession, seeded, spend, T0, type PolicyOptions, type Session } from './greedyPolicy';

/**
 * Приоритет Курсов. Замер `--course-priority` на контрольных зёрнах 6–8 (Финал контента, минут; зёрна 6 / 7 / 8,
 * среднее): Бережливость первой 94,5 / 94,0 / 101,6 → 96,7; Ручная работа первой 93,5 / 96,1 / 106,1 → 98,6;
 * Охота за сигналом первой 101,0 / 88,5 / 107,5 → 99,0; Масштабирование первой 101,0 / 88,5 / 107,5 → 99,0;
 * Холодная голова первой 104,1 / 100,9 / 96,4 → 100,5; первый предложенный (без списка) 92,8 / 86,9 / 121,2 → 100,3.
 * Разброс ≤4% и смешан с зерном, поэтому выбрана самая быстрая в среднем — Бережливость, дальше Ручная работа.
 * Зёрна отчёта 1–5 в выборе не участвуют.
 */
export const COURSE_PRIORITY: readonly string[] = ['frugal', 'manual', 'signal', 'scale', 'cool'];

/**
 * Испытания Забега. Замер `--challenge-set <id>` на зёрнах 6–8 (Финал, минут; без Испытаний 101,0 / 88,5 / 107,5):
 * «Забег без Кликов» 105,2 / 91,2 / 129,6; «Стена данных» 101,6 / 101,9 / 107,5; «Забег без Температуры» 101,6 / 101,9 / 107,5;
 * «Забег без Синергий» 106,2 / 90,3 / 114,0; «Забег без Перков» 107,1 / 87,4 / 110,7. Ни одно не быстрее «без Испытаний»
 * на всех трёх зёрнах (Перки: быстрее на зерне 7, медленнее на 6 и 8), поэтому набор пуст. Испытание окупается
 * в замере, а не в догадке: если кривая сдвинется, пересчитайте этим же флагом.
 */
export const CHALLENGE_SET: readonly string[] = [];

/** Окна реакции и осмотра, в секундах игры. */
export const EVENT_REACTION_S: readonly [number, number] = [2, 4];
export const GLITCH_REACTION_S: readonly [number, number] = [2, 5];
export const GLITCH_HIT_GAP_S = 0.35;
export const SCAN_S: readonly [number, number] = [2, 4];

/** Престиж по скорости Compute; см. допущение 8. */
export const RATE_WINDOW_S = 300;
export const SAMPLE_S = 30;
export const FALL_FRAC = 0.85;
export const FALL_HOLD_S = 180;
export const STALL_S = 600;

export interface AttentiveOptions {
  cps: number;
  reserve: number;
  seed: number;
  coursePriority: readonly string[];
  challengeSet: readonly string[];
}

export const ATTENTIVE_DEFAULTS: AttentiveOptions = {
  cps: 4,
  reserve: DEFAULT_POLICY.reserve,
  seed: DEFAULT_POLICY.seed,
  coursePriority: COURSE_PRIORITY,
  challengeSet: CHALLENGE_SET,
};

/** Что внимательный игрок помнит между тиками; жадная политика этих полей не знает. */
interface Memory {
  opts: AttentiveOptions;
  rnd: () => number;
  /** Ждёт ли Глюк своего удара: первый раз замеченный и число ударов. */
  glitches: Map<number, { nextHitAt: number }>;
  /** Начало События, которое игрок уже увидел, и когда он его поймает. */
  seenEventAt: number;
  catchAt: number;
  nextScanAt: number;
  nextSampleAt: number;
  /** Выборки potential для скорости: игровая секунда и величина. */
  history: { t: number; pot: number }[];
  peakRate: number;
  peakAt: number;
  /** С какой секунды скорость держится ниже FALL_FRAC × пик; null — не ниже. */
  belowSince: number | null;
  /** Решение о Престиже, принятое на осмотре и отданное `prestigeDue` на том же тике. */
  due: boolean;
}

const memories = new WeakMap<Session, Memory>();

function memory(w: Session): Memory {
  const m = memories.get(w);
  if (!m) throw new Error('attentive: нет памяти игрока — сессия не из newAttentiveSession');
  return m;
}

const between = (rnd: () => number, [lo, hi]: readonly [number, number]) => lo + (hi - lo) * rnd();

/** Непрерывная величина Compute: та же формула, что `computeGain`, но без `floor`. */
function potential(s: GameState): number {
  return Math.cbrt(s.runTokens / prestigeDivisor(s.generation)) * challengeComputeMult(s);
}

/** Скорость роста potential в Compute в минуту за последние `RATE_WINDOW_S`; null — окна ещё нет. */
function rate(m: Memory, s: GameState, t: number): number | null {
  for (let i = m.history.length - 1; i >= 0; i--) {
    const ref = m.history[i];
    if (ref.t <= t - RATE_WINDOW_S) return (potential(s) - ref.pot) / ((t - ref.t) / 60);
  }
  return null;
}

/** Ловит Золотой Токен, когда игрок его заметил: тот же эффект, что у `catchEvent` в жадной политике. */
function catchWhenNoticed(s: GameState, m: Memory, t: number): GameState {
  const event = s.event;
  if (!event) return s;
  if (event.startedAt !== m.seenEventAt) {
    m.seenEventAt = event.startedAt;
    m.catchAt = t + between(m.rnd, EVENT_REACTION_S);
    return s;
  }
  if (t < m.catchAt || event.red || isEventCaught(s) || !isEventActive(event, s.lastTick)) return s;
  const marked = { ...s, eventCaughtAt: event.startedAt };
  return event.kind === 'grant' ? earnTokens(marked, grantAmount(s.tokens, totalIncome(s))) : marked;
}

/** Бьёт замеченные Глюки по одному удару в `GLITCH_HIT_GAP_S`; третий лопает, выплата — через `earnTokens`. */
function hitNoticedGlitches(s: GameState, m: Memory, t: number): GameState {
  let next = s;
  for (const g of s.glitches) {
    let seen = m.glitches.get(g.id);
    if (!seen) {
      seen = { nextHitAt: t + between(m.rnd, GLITCH_REACTION_S) };
      m.glitches.set(g.id, seen);
    }
    if (t < seen.nextHitAt) continue;
    const hit = hitGlitch(next, g.id);
    next = hit.popped ? earnTokens(hit.state, hit.payout) : hit.state;
    seen.nextHitAt = t + GLITCH_HIT_GAP_S;
  }
  for (const id of [...m.glitches.keys()]) if (!s.glitches.some((g) => g.id === id)) m.glitches.delete(id);
  return next;
}

/**
 * Исследования на осмотре: собирает готовое (с конца, чтобы индексы не съехали) и закладывает свободные
 * слоты по допущению 5. Одновременно идёт не больше одного «открытия»: второе ждало бы первого зря.
 */
function researchOnScan(s: GameState): GameState {
  let next = s;
  for (let i = next.research.length - 1; i >= 0; i--) next = collectResearch(next, i, next.lastTick);
  while (next.research.length < researchSlots(next)) {
    const wantUnlock = nextOpening(next) !== null && !next.research.some((j) => j.kind === 'unlock');
    const planted = plantResearch(next, wantUnlock ? 'unlock' : 'boost', '30m', next.lastTick);
    if (planted === next) break;
    next = planted;
  }
  return next;
}

/** Курс на Престиже: первый по приоритету из предложенных; без предложения — Забег без Курса. */
function pickAttentiveCourse(s: GameState, priority: readonly string[]): GameState {
  const offered = offerCourse(s);
  if (offered.courseOffer.length === 0) return offered;
  const best = priority.find((id) => offered.courseOffer.includes(id)) ?? offered.courseOffer[0];
  return chooseCourse(offered, best);
}

/** Испытания на свежем Забеге: только с Перком «Посевной раунд» (допущение 7). */
function takeAttentiveChallenges(s: GameState, set: readonly string[]): GameState {
  if (set.length === 0) return s;
  if (!perkEffects(s.perks).some((e) => e.kind === 'startTokens')) return s;
  return set.reduce((run, id) => toggleChallenge(run, id as ChallengeDef['id']), s);
}

/** Один тик внимательного игрока. Клики — непрерывно; всё, что требует внимания, — по задержкам. */
export function attentiveTick(w: Session): void {
  const m = memory(w);
  const t = w.t;
  w.s = hitNoticedGlitches(w.s, m, t);
  w.clickCarry += m.opts.cps * DT;
  while (w.clickCarry >= 1) { w.clickCarry -= 1; w.s = click(w.s); }
  w.s = advanceTime(w.s, DT, w.rnd);
  w.s = catchWhenNoticed(w.s, m, t);
  if (canPrestige(w.s) && w.flagshipAt === null) w.flagshipAt = t;

  if (t >= m.nextSampleAt) {
    m.history.push({ t, pot: potential(w.s) });
    m.nextSampleAt = t + SAMPLE_S;
  }

  if (t >= m.nextScanAt) {
    m.nextScanAt = t + between(m.rnd, SCAN_S);
    w.s = researchOnScan(w.s);
    w.s = spend(w.s, m.opts.reserve);
    const r = rate(m, w.s, t);
    if (r !== null) {
      if (r > m.peakRate) { m.peakRate = r; m.peakAt = t; }
      if (r < FALL_FRAC * m.peakRate) m.belowSince ??= t;
      else m.belowSince = null;
    }
    const falling = m.belowSince !== null && t - m.belowSince >= FALL_HOLD_S;
    const stalled = m.peakRate > 0 && t - m.peakAt >= STALL_S;
    m.due = canPrestige(w.s) && !isContentFinale(w.s) && prestigeGain(w.s) >= 1 && (falling || stalled);
  }
  w.t += DT;
}

/** Нажимает Престиж, если осмотр решил, что пора. Вызывается сразу после тика. */
export function attentivePrestigeDue(w: Session): boolean {
  const m = memory(w);
  const due = m.due;
  m.due = false;
  return due && !isContentFinale(w.s);
}

/** Престиж внимательного игрока: Курс по приоритету, Престиж, Испытания на свежем Забеге. */
export function attentiveDoPrestige(w: Session): { generation: number; minutes: number } {
  const m = memory(w);
  const generation = w.s.generation;
  w.s = pickAttentiveCourse(w.s, m.opts.coursePriority);
  w.s = prestige(w.s, T0 + w.t * 1000);
  w.s = takeAttentiveChallenges(w.s, m.opts.challengeSet);
  const minutes = (w.t - w.genStart) / 60;
  w.genStart = w.t;
  w.flagshipAt = null;
  m.history = [];
  m.peakRate = 0;
  m.peakAt = w.t;
  m.belowSince = null;
  m.nextSampleAt = w.t;
  return { generation, minutes };
}

/** Сессия внимательного игрока: движок тот же, что у жадной, память — в отдельной таблице. */
export function newAttentiveSession(opts: Partial<AttentiveOptions> = {}): Session {
  const o = { ...ATTENTIVE_DEFAULTS, ...opts };
  const policy: PolicyOptions = { ...DEFAULT_POLICY, cps: o.cps, reserve: o.reserve, seed: o.seed, course: 'none', challenges: 'none' };
  const w = newSession(policy);
  const rnd = seeded(o.seed + 1000003);
  memories.set(w, {
    opts: o,
    rnd,
    glitches: new Map(),
    seenEventAt: 0,
    catchAt: Infinity,
    nextScanAt: between(rnd, SCAN_S),
    nextSampleAt: 0,
    history: [],
    peakRate: 0,
    peakAt: 0,
    belowSince: null,
    due: false,
  });
  return w;
}

/** Тот же интерфейс игрока, что у жадной политики, — `tools/sim.ts` выбирает одного из двух. */
export interface PlayerPolicy {
  newSession(): Session;
  tick(w: Session): void;
  prestigeDue(w: Session): boolean;
  doPrestige(w: Session): { generation: number; minutes: number };
}

export const attentivePlayer = (opts: Partial<AttentiveOptions>): PlayerPolicy => ({
  newSession: () => newAttentiveSession(opts),
  tick: attentiveTick,
  prestigeDue: attentivePrestigeDue,
  doPrestige: attentiveDoPrestige,
});
