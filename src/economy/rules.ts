import { CATALOG, type Model } from './catalog';
import type { GameState } from './state';
import { GENERATION_RULES, type GenerationRule } from '../data/generationRules';
import type { LabId } from '../data/labs';

/** Правило Поколения с индексом `generation`; `null` у «Рассвета» и у Поколений, чьё Правило ещё не написано. */
export function generationRule(generation: number): GenerationRule | null {
  return GENERATION_RULES.find((r) => r.generation === generation) ?? null;
}

/** Правило, действующее в Забеге сейчас: только своего Поколения (ADR-0013), других источников пока нет. */
export function activeRule(state: GameState): GenerationRule | null {
  return generationRule(state.generation);
}

/**
 * Во сколько раз Правило меняет цену Моделей. Единица вне «Ценовой войны».
 *
 * Время Забега берётся из часов самого состояния — `lastTick − runStartedAt`, — тех же, по которым
 * идёт тик. Отдельного счётчика в сохранении нет: Правило выводится из полей, которые уже
 * переживают перезагрузку, и миграции не просит. Минуты целые: цена не дрожит между тиками, а
 * карточки магазина перерисовываются раз в минуту. Дно держит цену выше нуля при любом простое:
 * скидка не бесконечна, и долгое отсутствие даёт её один раз, а не растущую.
 */
export function rulePriceMult(state: GameState): number {
  const effect = activeRule(state)?.effect;
  if (effect?.kind !== 'priceDecay') return 1;
  const minutes = Math.floor(Math.max(0, state.lastTick - state.runStartedAt) / 60_000);
  return effect.floor + (1 - effect.floor) * Math.pow(0.5, minutes / effect.halfLifeMin);
}

/** Сколько разных Лабораторий нанято: ключ кэша — ссылка на `agents`, которая меняется покупкой, а не тиком. */
let rosterCache: { agents: GameState['agents']; generation: number; labs: number } | null = null;

function labsInOffice(state: GameState): number {
  if (rosterCache?.agents === state.agents && rosterCache.generation === state.generation) return rosterCache.labs;
  const labs = new Set<string>();
  for (const m of CATALOG[state.generation].models) if ((state.agents[m.id] ?? 0) > 0) labs.add(m.lab);
  rosterCache = { agents: state.agents, generation: state.generation, labs: labs.size };
  return labs.size;
}

/**
 * Во сколько раз Правило меняет Доход Модели `model`. Единица вне «Разнообразия» и «Роутера».
 *
 * Обе надбавки не зависят от времени: «Разнообразие» — от состава офиса, «Роутер» — от Ранга
 * Модели, поэтому, как Синергия, они достаются и Оффлайн-доходу: офис за время отсутствия не
 * меняется. Минутные эффекты Правил в оффлайн не попадают. `model` нужна только «Роутеру»;
 * без неё он молчит, а «Разнообразие» общее для всех Моделей.
 */
export function ruleIncomeMult(state: GameState, model?: Model): number {
  const effect = activeRule(state)?.effect;
  if (effect?.kind === 'labVariety') return 1 + effect.perLab * Math.max(0, labsInOffice(state) - 1);
  if (effect?.kind === 'topRouter' && model) {
    return model.rank >= CATALOG[state.generation].models.length - effect.top ? 1 : effect.rest;
  }
  return 1;
}

/** Лаборатории Поколения в порядке первого появления в каталоге: порядок один и тот же при каждой загрузке. */
function labsOfGeneration(generation: number): LabId[] {
  return [...new Set(CATALOG[generation].models.map((m) => m.lab))];
}

/** Mulberry32 от 32-битного зерна: тот же вход — тот же перебор, без `Math.random`. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Перестановка Лабораторий для круга номер `circle`: у каждого Забега своя, у одного Забега всегда одна. */
function arenaCircle(labs: readonly LabId[], runStartedAt: number, circle: number): LabId[] {
  const rnd = seededRandom(((runStartedAt % 0x100000000) >>> 0) ^ Math.imul(circle + 1, 0x9e3779b1));
  const order = [...labs];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** Лидер периода номер `period`: круг перестановки, в котором каждая Лаборатория лидирует один раз. */
function arenaLeaderOf(labs: readonly LabId[], runStartedAt: number, period: number): LabId {
  const size = labs.length;
  if (size < 3) return labs[period % size];
  const circle = Math.floor(period / size);
  const order = arenaCircle(labs, runStartedAt, circle);
  // Стык кругов: лидер последнего периода прошлого круга не должен открыть следующий, иначе
  // «смена» оставила бы прежнего лидера. Меняются местами первая и вторая позиции круга, а
  // последняя (она и кончает прошлый круг) при size >= 3 остаётся на месте.
  if (circle > 0 && order[0] === arenaCircle(labs, runStartedAt, circle - 1)[size - 1]) {
    [order[0], order[1]] = [order[1], order[0]];
  }
  return order[period % size];
}

export interface ArenaOutlook {
  leader: LabId;
  /** Лидер следующего периода: он известен всегда, но игроку его называют только в окне предупреждения. */
  next: LabId;
  /** Секунд до смены лидера, целых и округлённых вверх. */
  secondsLeft: number;
  /** Идёт ли окно предупреждения: последние `warnSec` секунд периода. */
  warning: boolean;
}

/**
 * Лидер Арены и ближайшая смена; `null` вне «Лидера Арены».
 *
 * Выводится из часов состояния (`lastTick − runStartedAt`) и начала Забега, как цена «Ценовой
 * войны»: в сохранении под него нет ни поля, ни миграции, а перезагрузка называет того же лидера в
 * тот же момент. Простой тоже сдвигает `lastTick`, поэтому лидер на возвращении — тот, кто
 * лидировал бы, не закрывай игрок вкладку; прибыли это не создаёт, потому что в Оффлайн-доход
 * надбавка лидера не входит.
 */
export function arenaOutlook(state: GameState, now: number = state.lastTick): ArenaOutlook | null {
  const effect = activeRule(state)?.effect;
  if (effect?.kind !== 'arenaLeader') return null;
  const labs = labsOfGeneration(state.generation);
  const periodMs = effect.periodMin * 60_000;
  const elapsed = Math.max(0, now - state.runStartedAt);
  const period = Math.floor(elapsed / periodMs);
  const secondsLeft = Math.ceil((periodMs - (elapsed - period * periodMs)) / 1000);
  return {
    leader: arenaLeaderOf(labs, state.runStartedAt, period),
    next: arenaLeaderOf(labs, state.runStartedAt, period + 1),
    secondsLeft,
    warning: secondsLeft <= effect.warnSec,
  };
}

/**
 * Во сколько раз Правило меняет Доход Модели, пока игрок в игре. Единица вне «Лидера Арены».
 *
 * Отдельно от `ruleIncomeMult`: та часть входит в Оффлайн-доход, а надбавка лидера живёт минуты и
 * платится только живому тику (как событие и Температура). Часы приходят от вызывающего, чтобы
 * тик и подпись в магазине читали один и тот же момент.
 */
export function ruleLiveIncomeMult(state: GameState, model: Model, now: number = state.lastTick): number {
  const effect = activeRule(state)?.effect;
  if (effect?.kind !== 'arenaLeader') return 1;
  return arenaOutlook(state, now)?.leader === model.lab ? effect.bonus : 1;
}
