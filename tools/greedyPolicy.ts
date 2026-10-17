/**
 * Жадная политика игрока на настоящем движке: общая для `tools/sim.ts` и проверки темпа в
 * `npm test` (`src/economy/pace.test.ts`), чтобы обе меряли одного и того же игрока.
 *
 * Политика осознанно простая: кликает, скупает всё доступное, престижит, когда Престиж стоит
 * нажатия. Настоящий игрок крутит Температуру и ловит События, политика — нет: она задаёт
 * МИНИМАЛЬНЫЙ темп, а шкала может только его ускорить.
 *
 * «Стоит нажатия» — это `minGain` Compute. Без этого условия Престиж ложился бы на первый же
 * Флагман (около 15-й минуты), а его время — это лестница Ранга (ADR-0001), которую ручки
 * баланса не двигают. С условием делитель Престижа решает, когда Престиж впервые приносит
 * заметный Compute, и именно им настраивается темп.
 */
import { CATALOG } from '../src/economy/catalog';
import type { GameState } from '../src/economy/state';
import {
  advanceTime,
  buyAgents,
  buyPerk,
  buyUpgrade,
  canPrestige,
  click,
  earnTokens,
  totalIncome,
  isContentFinale,
  prestige,
  prestigeGain,
} from '../src/economy/engine';
import { grantAmount, isEventActive, isEventCaught } from '../src/economy/events';
import { availableUpgrades } from '../src/economy/upgrades';
import { PERKS, perkLock } from '../src/economy/perks';
import { clampTemp, safeTemp, TEMP_MAX } from '../src/economy/thermal';
import { migrate } from '../src/economy/save';
import { chooseCourse, coursePool, offerCourse } from '../src/economy/course';

export const T0 = 1_700_000_000_000;
/** Шаг симуляции, секунд: двадцать тиков в секунду, как у игры. */
export const DT = 1 / 20;

/**
 * Как политика крутит Температуру. `off` — не трогает (по умолчанию: так мерится минимальный темп
 * и так играет `pace.test.ts`): шкала остаётся на стартовых 0,45 до первого перегрева, потом в нуле.
 * `safe` — «поставил и забыл» на безопасной Температуре офиса (`safeTemp`): Характеры сдвигают её.
 * `ride` — держит 1,0 и возвращает шкалу туда же после каждого перегрева; `max` — то же на пределе.
 * `ride` и `max` — внимательный игрок, который мгновенно поднимает шкалу после сброса.
 */
export type ThermalPolicy = 'off' | 'safe' | 'ride' | 'max';

export interface PolicyOptions {
  /** Как политика крутит Температуру; см. `ThermalPolicy`. */
  thermal: ThermalPolicy;
  /** Кликов в секунду. */
  cps: number;
  /** Свободный Compute, который политика не тратит на Перки. */
  reserve: number;
  /** Престиж только если он даст не меньше стольких Compute (1 — сразу, как взят Флагман). */
  minGain: number;
  /** Секунд дофарма после взятого Флагмана перед Престижем. */
  farmSec: number;
  /** Зерно розыгрыша Событий: то же зерно — тот же прогон. */
  seed: number;
  /**
   * Какой Курс политика берёт на Престиже (ADR-0013). `none` — никакой: так меряется база и так играет
   * `pace.test.ts`. `first` — первый из трёх предложенных (предложение определено зерном Престижа, так
   * что это случайный Курс игры без выбора). Любой другой id — этот Курс, когда пул Престижа его
   * содержит; когда не содержит (Правило, которое ещё не пройдено), Забег идёт без Курса.
   */
  course: string;
  /**
   * Ловит ли политика каждое обычное (не красное) Событие, едва оно появилось. По умолчанию нет: так
   * меряется нижняя граница, и так играет `pace.test.ts`. Включённая — верхняя граница внимательного
   * игрока (Золотой Токен ловится всегда), нужна, чтобы замерить Курс «Охота за сигналом».
   */
  catchEvents: boolean;
}

/**
 * Сколько Compute должен принести Престиж, чтобы политика его нажала: около сорока — столько
 * обещал первому Престижу докблок над `PRESTIGE_DIVISOR_UNITS`, «на два Перка из двадцати трёх».
 */
export const PRESTIGE_WORTH_COMPUTE = 40;

export const DEFAULT_POLICY: PolicyOptions = {
  thermal: 'off',
  cps: 5,
  reserve: 25,
  minGain: PRESTIGE_WORTH_COMPUTE,
  farmSec: 0,
  seed: 1,
  course: 'none',
  catchEvents: false,
};

/** Mulberry32: одно зерно — один и тот же розыгрыш Событий, чтобы прогоны сравнивались. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Покупает Перк, если хватает Compute сверх запаса. Дороже — раньше: дешёвые кончаются первыми.
 * Перки, которые дерево пока не пускает (предшественники, верхний чужой Ветви), пропускаются:
 * политика не сбрасывает дерево и не выбирает Ветвь, она берёт самое дорогое из доступного.
 */
function buyAffordablePerk(s: GameState, reserve: number): GameState {
  const free = s.compute - s.computeSpent - reserve;
  const sorted = [...PERKS].sort((a, b) => b.cost - a.cost);
  for (const p of sorted) {
    if (p.cost <= free && !s.perks.includes(p.id) && !perkLock(s.perks, p.id)) return buyPerk(s, p.id);
  }
  return s;
}

/**
 * Один проход покупок: Перк, все доступные Апгрейды, затем Агенты по кругу.
 *
 * Несколько проходов, потому что покупка Агента может открыть Синергию, а та — новый
 * Апгрейд: один проход оставил бы на экране покупки, до которых игрок уже дорос.
 */
export function spend(s: GameState, reserve: number): GameState {
  let next = buyAffordablePerk(s, reserve);
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const u of availableUpgrades(next)) {
      if (u.cost <= next.tokens) {
        const after = buyUpgrade(next, u.id);
        if (after !== next) { next = after; changed = true; }
      }
    }
    // Агенты — по кругу, а не «все у лучшей Модели»: так растёт число Лабораторий в офисе,
    // а с ним и Синергия, и состав Сцены. Модели без Агентов пропускать нельзя, иначе
    // политика никогда не поднимется выше первой ступени.
    const models = CATALOG[next.generation].models
      .map((m) => ({ m, owned: next.agents[m.id] ?? 0 }))
      .sort((a, b) => (b.m.baseIncome / (b.m.baseCost * Math.pow(1.15, b.owned))) -
                     (a.m.baseIncome / (a.m.baseCost * Math.pow(1.15, a.owned))));
    for (const { m, owned } of models) {
      let after = buyAgents(next, m.id, 'max');
      while (after !== next) { next = after; after = buyAgents(next, m.id, 'max'); }
      if ((next.agents[m.id] ?? 0) !== owned) changed = true;
    }
    if (!changed) break;
  }
  return next;
}

/** Идущая игра политики: состояние движка плюс то, что политика помнит между тиками. */
export interface Session {
  s: GameState;
  /** Игровые секунды от начала игры. */
  t: number;
  opts: PolicyOptions;
  rnd: () => number;
  clickCarry: number;
  /** Когда в текущем Поколении взят Флагман: от него отсчитывается дофарм. */
  flagshipAt: number | null;
  /** Игровая секунда входа в текущее Поколение. */
  genStart: number;
}

export function newSession(opts: Partial<PolicyOptions> = {}): Session {
  const full = { ...DEFAULT_POLICY, ...opts };
  return {
    s: migrate(null, T0),
    t: 0,
    opts: full,
    rnd: seeded(full.seed),
    clickCarry: 0,
    flagshipAt: null,
    genStart: 0,
  };
}

/**
 * Запас под безопасной Температурой для `safe`. Ровно на ней перегрев не копится, но и не уходит:
 * тепло Галлюцинации (+0,3) осталось бы в шкале навсегда и душило Доход. На 85% шкала остывает.
 */
const SAFE_MARGIN = 0.85;

/** Температура, которую политика выставляет перед тиком; `null` — не трогать. */
function thermalTarget(s: GameState, policy: ThermalPolicy): number | null {
  if (policy === 'safe') return SAFE_MARGIN * safeTemp(s);
  if (policy === 'ride') return 1;
  if (policy === 'max') return TEMP_MAX;
  return null;
}

/**
 * Ловит живое обычное Событие так, как это делает стор (`catchEvent`): отмечает окно пойманным, а «Грант»
 * платит через `earnTokens`. Красные не ловятся — Восстание моделей игрок обходит.
 */
function catchEvent(s: GameState): GameState {
  const event = s.event;
  if (!event || event.red || isEventCaught(s) || !isEventActive(event, s.lastTick)) return s;
  const marked = { ...s, eventCaughtAt: event.startedAt };
  return event.kind === 'grant' ? earnTokens(marked, grantAmount(s.tokens, totalIncome(s))) : marked;
}

/** Один тик: клики, время движка, покупки. */
export function tick(w: Session): void {
  const target = thermalTarget(w.s, w.opts.thermal);
  if (target !== null && w.s.temp !== clampTemp(target)) w.s = { ...w.s, temp: clampTemp(target) };
  w.clickCarry += w.opts.cps * DT;
  while (w.clickCarry >= 1) { w.clickCarry -= 1; w.s = click(w.s); }
  w.s = advanceTime(w.s, DT, w.rnd);
  if (w.opts.catchEvents) w.s = catchEvent(w.s);
  w.s = spend(w.s, w.opts.reserve);
  if (canPrestige(w.s) && w.flagshipAt === null) w.flagshipAt = w.t;
  w.t += DT;
}

/** Стоит ли нажимать Престиж сейчас: Флагман взят, дофарм прошёл и прирост достаточен. */
export function prestigeDue(w: Session): boolean {
  const { s, opts } = w;
  if (!canPrestige(s) || isContentFinale(s) || w.flagshipAt === null) return false;
  if (w.t - w.flagshipAt < opts.farmSec) return false;
  return prestigeGain(s) >= opts.minGain;
}

/** Выбор Курса перед Престижем по правилу `PolicyOptions.course`. */
function pickCourse(s: GameState, rule: string): GameState {
  if (rule === 'none') return s;
  const offered = offerCourse(s);
  if (rule === 'first') return offered.courseOffer.length > 0 ? chooseCourse(offered, offered.courseOffer[0]) : offered;
  // Принудительный Курс подставляется в `courseNext` минуя предложение: измеряется Курс, а не удача выпадения.
  return coursePool(s).some((c) => c.id === rule) ? { ...offered, courseNext: rule } : offered;
}

/** Нажимает Престиж; возвращает, сколько минут заняло ушедшее Поколение. */
export function doPrestige(w: Session): { generation: number; minutes: number } {
  const generation = w.s.generation;
  w.s = pickCourse(w.s, w.opts.course);
  w.s = prestige(w.s, T0 + w.t * 1000);
  const minutes = (w.t - w.genStart) / 60;
  w.genStart = w.t;
  w.flagshipAt = null;
  return { generation, minutes };
}

/**
 * На какой минуте от начала игры политика нажимает первый Престиж; `null`, если не нажала за
 * `capMinutes`. Тот же прогон, что первая строка таблицы `tools/sim.ts --campaign`.
 */
export function firstPrestigeMinutes(capMinutes: number, opts: Partial<PolicyOptions> = {}): number | null {
  const w = newSession(opts);
  const steps = Math.round((capMinutes * 60) / DT);
  for (let i = 0; i < steps; i++) {
    tick(w);
    if (prestigeDue(w)) return w.t / 60;
  }
  return null;
}
