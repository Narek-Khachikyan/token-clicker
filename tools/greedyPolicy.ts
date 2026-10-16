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
  isContentFinale,
  prestige,
  prestigeGain,
} from '../src/economy/engine';
import { availableUpgrades } from '../src/economy/upgrades';
import { PERKS } from '../src/economy/perks';
import { migrate } from '../src/economy/save';

export const T0 = 1_700_000_000_000;
/** Шаг симуляции, секунд: двадцать тиков в секунду, как у игры. */
export const DT = 1 / 20;

export interface PolicyOptions {
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
}

/**
 * Сколько Compute должен принести Престиж, чтобы политика его нажала: около сорока — столько
 * обещал первому Престижу докблок над `PRESTIGE_DIVISOR_UNITS`, «на два Перка из двадцати трёх».
 */
export const PRESTIGE_WORTH_COMPUTE = 40;

export const DEFAULT_POLICY: PolicyOptions = {
  cps: 5,
  reserve: 25,
  minGain: PRESTIGE_WORTH_COMPUTE,
  farmSec: 0,
  seed: 1,
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

/** Покупает Перк, если хватает Compute сверх запаса. Дороже — раньше: дешёвые кончаются первыми. */
function buyAffordablePerk(s: GameState, reserve: number): GameState {
  const free = s.compute - s.computeSpent - reserve;
  const sorted = [...PERKS].sort((a, b) => b.cost - a.cost);
  for (const p of sorted) {
    if (p.cost <= free && !s.perks.includes(p.id)) return buyPerk(s, p.id);
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

/** Один тик: клики, время движка, покупки. */
export function tick(w: Session): void {
  w.clickCarry += w.opts.cps * DT;
  while (w.clickCarry >= 1) { w.clickCarry -= 1; w.s = click(w.s); }
  w.s = advanceTime(w.s, DT, w.rnd);
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

/** Нажимает Престиж; возвращает, сколько минут заняло ушедшее Поколение. */
export function doPrestige(w: Session): { generation: number; minutes: number } {
  const generation = w.s.generation;
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
