import { CATALOG, type Model } from './catalog';
import { hasChallenge } from './challenges';
import type { GameState } from './state';
import { courseById } from '../data/courses';
import { GENERATION_RULES, type GenerationRule, type RuleEffect } from '../data/generationRules';
import type { LabId } from '../data/labs';

/** Правило Поколения с индексом `generation`; `null` у «Рассвета» и у Поколений, чьё Правило ещё не написано. */
export function generationRule(generation: number): GenerationRule | null {
  return GENERATION_RULES.find((r) => r.generation === generation) ?? null;
}

/** Правило своего Поколения: оно действует в каждом Забеге Поколения, что бы ни выбрал Курс. */
export function activeRule(state: Pick<GameState, 'generation'>): GenerationRule | null {
  return generationRule(state.generation);
}

/** Правило пройденного Поколения, которое игрок взял Курсом; `null`, если Курс другой или его нет. */
export function courseRule(state: Pick<GameState, 'course'>): GenerationRule | null {
  const effect = courseById(state.course)?.effect;
  return effect?.kind === 'rule' ? (GENERATION_RULES.find((r) => r.id === effect.rule) ?? null) : null;
}

/**
 * Правила, действующие в Забеге: своё Правило Поколения и Правило, взятое Курсом (ADR-0013).
 * Курс берёт Правило пройденного Поколения, а не текущего, поэтому виды эффектов у двух не
 * совпадают: каждый вид читается из единственного места (`ruleEffect`), и надбавки не удваиваются.
 */
export function activeRules(state: Pick<GameState, 'generation' | 'course'>): GenerationRule[] {
  const own = activeRule(state);
  const taken = courseRule(state);
  return own && taken ? [own, taken] : own ? [own] : taken ? [taken] : [];
}

/**
 * Эффект Правила вида `kind`, если он сейчас действует в Забеге: своего Поколения или взятого Курсом.
 * Единственная точка, через которую экономика, сохранение и интерфейс спрашивают про Правила, —
 * поэтому Курс с Правилом включает его везде, где оно читается, а не в одном месте.
 */
export function ruleEffect<K extends RuleEffect['kind']>(
  state: Pick<GameState, 'generation' | 'course'>,
  kind: K,
): Extract<RuleEffect, { kind: K }> | null {
  for (const rule of activeRules(state)) if (rule.effect.kind === kind) return rule.effect as Extract<RuleEffect, { kind: K }>;
  return null;
}

/** Правило, чей эффект вида `kind` действует: нужно подписям, которые называют Правило по имени. */
export function ruleOfKind(state: Pick<GameState, 'generation' | 'course'>, kind: RuleEffect['kind']): GenerationRule | null {
  return activeRules(state).find((r) => r.effect.kind === kind) ?? null;
}

/**
 * Длина ряда покупок «Дефицита GPU» на момент `now`: Агенты, нанятые подряд, если с последнего
 * найма прошло не больше паузы Правила. Нуль вне Правила и после паузы.
 *
 * Ряд выводится из двух полей состояния и часов, а не обнуляется тиком: пауза в игре и пауза за
 * время простоя (часы `lastTick` уходят вперёд при возвращении) читаются одним и тем же сравнением.
 */
export function buyStreakNow(state: GameState, now: number = state.lastTick): number {
  const effect = ruleEffect(state, 'buyStreak');
  if (!effect || state.buyStreak <= 0 || state.lastBuyAt <= 0) return 0;
  return now - state.lastBuyAt > effect.resetSec * 1000 ? 0 : state.buyStreak;
}

/**
 * Состояние после найма `count` Агентов в этот момент: «Дефицит GPU» продлевает ряд и ставит
 * отметку времени; вне Правила — тот же объект.
 */
export function noteHire(state: GameState, count: number): GameState {
  const effect = ruleEffect(state, 'buyStreak');
  if (!effect || count <= 0) return state;
  return { ...state, buyStreak: Math.min(buyStreakLimit(effect), buyStreakNow(state) + count), lastBuyAt: state.lastTick };
}

/** Длина ряда, дальше которой цена не растёт: счёт останавливается на ней, и поле не уходит в бесконечность. */
export function buyStreakLimit(effect: Extract<RuleEffect, { kind: 'buyStreak' }>): number {
  return Math.ceil(effect.maxExtra / effect.perAgent - 1e-9);
}

/**
 * Во сколько раз Правило меняет цену Моделей. Единица вне «Ценовой войны» и «Дефицита GPU».
 *
 * «Ценовая война»: время Забега берётся из часов самого состояния — `lastTick − runStartedAt`, —
 * тех же, по которым идёт тик. Отдельного счётчика в сохранении нет: Правило выводится из полей,
 * которые уже переживают перезагрузку, и миграции не просит. Минуты целые: цена не дрожит между
 * тиками, а карточки магазина перерисовываются раз в минуту. Дно держит цену выше нуля при любом
 * простое: скидка не бесконечна, и долгое отсутствие даёт её один раз, а не растущую.
 *
 * «Дефицит GPU»: `1 + perAgent · ряд`, не выше `1 + maxExtra`. Множитель один на все Модели, поэтому
 * лестница Ранга цен не переворачивается. Цена следующей покупки считается по ряду до неё: пачка
 * из десяти стоит как десять подряд с одной и той же надбавкой, а дорожает уже следующая.
 */
export function rulePriceMult(state: GameState): number {
  // Две надбавки цены независимы: Курс с «Дефицитом GPU» в Поколении «Ценовой войны» множит обе.
  let mult = 1;
  const streak = ruleEffect(state, 'buyStreak');
  if (streak) mult *= 1 + Math.min(streak.maxExtra, streak.perAgent * buyStreakNow(state));
  const decay = ruleEffect(state, 'priceDecay');
  if (decay) {
    const minutes = Math.floor(Math.max(0, state.lastTick - state.runStartedAt) / 60_000);
    mult *= decay.floor + (1 - decay.floor) * Math.pow(0.5, minutes / decay.halfLifeMin);
  }
  return mult;
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
  let mult = 1;
  const variety = ruleEffect(state, 'labVariety');
  if (variety) mult *= 1 + variety.perLab * Math.max(0, labsInOffice(state) - 1);
  const router = ruleEffect(state, 'topRouter');
  if (router && model && model.rank < CATALOG[state.generation].models.length - router.top) mult *= router.rest;
  return mult;
}

/** Лаборатории Поколения в порядке первого появления в каталоге: порядок один и тот же при каждой загрузке. */
function labsOfGeneration(generation: number): LabId[] {
  return [...new Set(CATALOG[generation].models.map((m) => m.lab))];
}

/** Mulberry32 от 32-битного зерна: тот же вход — тот же перебор, без `Math.random`. */
export function seededRandom(seed: number): () => number {
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
  const effect = ruleEffect(state, 'arenaLeader');
  if (!effect) return null;
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
  const effect = ruleEffect(state, 'arenaLeader');
  if (!effect) return 1;
  return arenaOutlook(state, now)?.leader === model.lab ? effect.bonus : 1;
}

/**
 * Порция размышления «Подумай ещё»: игрок держит Клик. Первая порция только открывает удержание, дальше
 * в копилку идёт время, прошедшее с прошлой порции, но не больше предела. Часы — игровые (`lastTick`),
 * те же, по которым платит тик, поэтому две порции в одном тике не копят ничего и повтор клавиши не
 * накручивает больше, чем идёт время.
 *
 * Не платит ничего: платит `settleThought` в `engine.ts`, когда удержание оборвалось. Пока удержание
 * оборвано дольше паузы Правила, а выплаты ещё не было, порция отказывает (тот же объект): тик вот-вот
 * выплатит накопленное, и дописывать в уже закрытое удержание нельзя. Вне Правила и в Испытании «без
 * Кликов» — тот же объект.
 */
export function holdThought(state: GameState): GameState {
  const effect = ruleEffect(state, 'heldThought');
  if (!effect || hasChallenge(state, 'no-click')) return state;
  const now = state.lastTick;
  if (state.thoughtAt === 0) return { ...state, thoughtAt: now };
  const gap = (now - state.thoughtAt) / 1000;
  if (gap > effect.releaseSec || gap <= 0) return state;
  return { ...state, thought: Math.min(effect.maxSec, state.thought + gap), thoughtAt: now };
}

/** Во сколько раз размышление в `seconds` секунд умножает выплату. */
export function thoughtMult(effect: Extract<RuleEffect, { kind: 'heldThought' }>, seconds: number): number {
  return 1 + effect.bonusPerSec * seconds;
}

export interface ThoughtOutlook {
  /** Накопленные секунды размышления. */
  seconds: number;
  /** Во сколько раз умножится выплата, если отпустить сейчас. */
  mult: number;
  /** Идёт ли удержание: порция была не дольше паузы Правила назад. */
  holding: boolean;
}

/** Размышление для HUD и подсказки; `null` вне «Подумай ещё». */
export function thoughtOutlook(state: GameState, now: number = state.lastTick): ThoughtOutlook | null {
  const effect = ruleEffect(state, 'heldThought');
  if (!effect) return null;
  return {
    seconds: state.thought,
    mult: thoughtMult(effect, state.thought),
    holding: state.thoughtAt !== 0 && now - state.thoughtAt <= effect.releaseSec * 1000,
  };
}
