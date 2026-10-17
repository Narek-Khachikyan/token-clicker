import { LAB_IDS, LABS, type LabId } from '../data/labs';

export type PerkEffect =
  | { kind: 'startTokens' }
  /** `rate` — доля Дохода, начисляемая в оффлайне (1 = полный Доход), `hours` — окно простоя. */
  | { kind: 'offlineRate'; rate: number; hours: number }
  | { kind: 'labBoost'; lab: LabId; mult: number }
  | { kind: 'discount'; pct: number }
  | { kind: 'clickMult'; mult: number }
  | { kind: 'autoclick'; perSecond: number }
  /** Звук при появлении События: сам по себе он ничего не множит и читается в UI. */
  | { kind: 'eventAlert' }
  /** Третий слот Исследований (ТЗ #118): открывается, пока Перк держится в Забеге. */
  | { kind: 'researchSlot' }
  /** «Наследие поколений»: Доход всех Моделей текущего Забега растёт на `pctPerGeneration` за каждое
   *  пройденное Поколение (`maxGeneration`). Одинаков для всех Рангов, поэтому лестницу не переворачивает. */
  | { kind: 'legacyBoost'; pctPerGeneration: number }
  /** Доход всех Моделей сразу: верхний Перк Оркестратора. */
  | { kind: 'agentBoost'; mult: number }
  /** Перегрев копится в `mult` раза медленнее (mult < 1). */
  | { kind: 'heatSlow'; mult: number }
  /** Оглушение после перегрева длится в `mult` раза короче (mult < 1). */
  | { kind: 'stunShort'; mult: number }
  /** Жар поднимает Доход на `pct` сильнее. */
  | { kind: 'yieldBoost'; pct: number }
  /** Верхний Перк Оверклокера: жар поднимает Доход сильнее, но Галлюцинации приходят в `halluMult` раза чаще. */
  | { kind: 'overclock'; yieldPct: number; halluMult: number };

/** Ствол общий; три Ветви — стили игры (ADR-0012). */
export type PerkBranch = 'trunk' | 'prompt' | 'orchestra' | 'overclock';

export interface Perk {
  id: string;
  name: string;
  desc: string;
  cost: number;
  effect: PerkEffect;
  branch: PerkBranch;
  /** Предшественники: Перк продаётся, только когда куплены все. Стоят в `PERKS` раньше него. */
  requires: readonly string[];
  /** Верхний Перк Ветви: из трёх верхних можно купить один (ADR-0012). */
  top: boolean;
}

export interface BranchInfo {
  id: Exclude<PerkBranch, 'trunk'>;
  name: string;
  /** Для чего Ветвь, одной строкой в шапке. */
  focus: string;
}

export const BRANCHES: readonly BranchInfo[] = [
  { id: 'prompt', name: 'Промпт-инженер', focus: 'Клик и активная игра' },
  { id: 'orchestra', name: 'Оркестратор', focus: 'Агенты и Оффлайн-доход' },
  { id: 'overclock', name: 'Оверклокер', focus: 'Температура и риск' },
];

/** Стартовые Токены за Перк, в единицах масштаба Поколения. */
export const START_TOKENS_UNITS = 1000;

/** Сколько Дохода «Наследие поколений» добавляет за каждое пройденное Поколение. */
export const LEGACY_PCT_PER_GENERATION = 0.05;

// Порядок важен: предшественник стоит в списке раньше зависимого (тест держит это), а id старых
// Перков остаются прежними — они лежат в сохранениях, и новое имя означало бы потерянную покупку.
export const PERKS: Perk[] = [
  // ---------- Ствол ----------
  { id: 'start_tokens', name: 'Посевной раунд', desc: 'Начинай каждый забег с 1 000 токенов (× масштаб поколения)', cost: 5, effect: { kind: 'startTokens' }, branch: 'trunk', requires: [], top: false },
  {
    id: 'legacy', name: 'Наследие поколений',
    desc: `+${Math.round(LEGACY_PCT_PER_GENERATION * 100)}% к Доходу за каждое пройденное Поколение — в текущем Забеге`,
    cost: 40,
    effect: { kind: 'legacyBoost', pctPerGeneration: LEGACY_PCT_PER_GENERATION },
    branch: 'trunk', requires: ['start_tokens'], top: false,
  },
  // Дороже автокликера и всех Партнёрств: сигнал покупают после Престижа, когда события уже идут
  // минутами и мимо экрана проходят.
  { id: 'event_alert', name: 'Сигналка на события', desc: 'звук, когда появляется Событие', cost: 30, effect: { kind: 'eventAlert' }, branch: 'trunk', requires: [], top: false },
  // Третий слот Исследований: сам Доход не множит, а даёт ещё одну работу, которая созревает по стенным часам (ТЗ #118).
  { id: 'research_slot', name: 'Третий слот Исследований', desc: 'третий слот Исследований: заложить можно три сразу', cost: 25, effect: { kind: 'researchSlot' }, branch: 'trunk', requires: [], top: false },
  ...LAB_IDS.map<Perk>((lab) => ({
    id: `lab_${lab}`,
    name: `Партнёрство с ${LABS[lab].name}`,
    desc: `+10% к доходу всех моделей ${LABS[lab].name}`,
    cost: 15,
    effect: { kind: 'labBoost', lab, mult: 1.1 },
    branch: 'trunk' as const, requires: [], top: false,
  })),

  // ---------- Промпт-инженер: Клик ----------
  { id: 'click_x2', name: 'Чёткий промпт', desc: 'клик ×2 навсегда', cost: 3, effect: { kind: 'clickMult', mult: 2 }, branch: 'prompt', requires: [], top: false },
  { id: 'click_chain', name: 'Цепочка рассуждений', desc: 'клик ещё ×2', cost: 12, effect: { kind: 'clickMult', mult: 2 }, branch: 'prompt', requires: ['click_x2'], top: false },
  { id: 'autoclick', name: 'Скрипт-автокликер', desc: '1 клик в секунду автоматически', cost: 25, effect: { kind: 'autoclick', perSecond: 1 }, branch: 'prompt', requires: ['click_x2'], top: false },
  { id: 'pi_master', name: 'Мастер промптов', desc: 'клик ещё ×3', cost: 60, effect: { kind: 'clickMult', mult: 3 }, branch: 'prompt', requires: ['click_chain', 'autoclick'], top: true },

  // ---------- Оркестратор: Агенты и Оффлайн-доход ----------
  {
    id: 'offline_rate_1', name: 'Ночной конвейер', desc: 'Оффлайн-доход 75% Дохода, но не дольше 24 ч',
    cost: 4,
    effect: { kind: 'offlineRate', rate: 0.75, hours: 24 },
    branch: 'orchestra', requires: [], top: false,
  },
  {
    // id остаётся прежним, хотя Перк теперь про долю Дохода, а не про лимит часов: он уже
    // может лежать в сохранении игрока, а migrate отбрасывает неизвестные id — с новым именем
    // Перк бы тихо исчез вместе со своей покупкой.
    id: 'offline_24h', name: 'Три смены', desc: 'Оффлайн-доход 90% Дохода, но не дольше 72 ч',
    cost: 10,
    effect: { kind: 'offlineRate', rate: 0.9, hours: 72 },
    branch: 'orchestra', requires: ['offline_rate_1'], top: false,
  },
  { id: 'discount', name: 'Оптовые GPU', desc: 'агенты дешевле на 5%', cost: 20, effect: { kind: 'discount', pct: 0.05 }, branch: 'orchestra', requires: [], top: false },
  { id: 'orch_swarm', name: 'Рой Агентов', desc: 'Доход всех Моделей ×1,25', cost: 60, effect: { kind: 'agentBoost', mult: 1.25 }, branch: 'orchestra', requires: ['offline_24h', 'discount'], top: true },

  // ---------- Оверклокер: Температура и риск ----------
  { id: 'oc_cooling', name: 'Жидкостное охлаждение', desc: 'перегрев копится на 15% медленнее', cost: 12, effect: { kind: 'heatSlow', mult: 0.85 }, branch: 'overclock', requires: [], top: false },
  { id: 'oc_stun', name: 'Мягкий сброс', desc: 'после перегрева Доход душится вдвое короче', cost: 15, effect: { kind: 'stunShort', mult: 0.5 }, branch: 'overclock', requires: ['oc_cooling'], top: false },
  { id: 'oc_tuning', name: 'Тонкая настройка частот', desc: 'жар поднимает Доход на 15% сильнее', cost: 20, effect: { kind: 'yieldBoost', pct: 0.15 }, branch: 'overclock', requires: [], top: false },
  {
    id: 'oc_overclock', name: 'Разгон до предела',
    desc: 'жар поднимает Доход ещё на 35% сильнее, но Галлюцинации приходят в полтора раза чаще',
    cost: 60,
    effect: { kind: 'overclock', yieldPct: 0.35, halluMult: 1.5 },
    branch: 'overclock', requires: ['oc_stun', 'oc_tuning'], top: true,
  },
];

/** Сколько Compute стоит всё дерево целиком: больше, чем даёт кампания, — отсюда выбор. */
export const treeCost = (): number => PERKS.reduce((n, p) => n + p.cost, 0);

/** Сколько Перков можно держать одновременно: все, кроме верхних чужих Ветвей. */
export const MAX_OWNED_PERKS = PERKS.length - (PERKS.filter((p) => p.top).length - 1);

/** Глубина Перка в дереве: 0 у корней, на единицу больше самого глубокого предшественника. */
export function perkDepth(id: string): number {
  const p = PERK_BY_ID[id];
  if (!p || p.requires.length === 0) return 0;
  return 1 + Math.max(...p.requires.map(perkDepth));
}

/** Почему Перк сейчас не продаётся по правилам дерева; `null` — правила пускают. */
export type PerkLock =
  | { kind: 'owned' }
  | { kind: 'needs'; ids: readonly string[] }
  | { kind: 'rival'; id: string };

/** Правила дерева без цены: предшественники и взаимоисключение верхних Перков. */
export function perkLock(owned: readonly string[], id: string): PerkLock | null {
  const p = PERK_BY_ID[id];
  if (!p) return null;
  if (owned.includes(id)) return { kind: 'owned' };
  const missing = p.requires.filter((r) => !owned.includes(r));
  if (missing.length > 0) return { kind: 'needs', ids: missing };
  if (p.top) {
    const rival = owned.find((o) => PERK_BY_ID[o]?.top);
    if (rival) return { kind: 'rival', id: rival };
  }
  return null;
}

export const PERK_BY_ID: Record<string, Perk> = Object.fromEntries(PERKS.map((p) => [p.id, p]));

/**
 * Разбор купленных Перков в их эффекты: один вызов на тик давал по новому объекту на каждый купленный Перк,
 * а на тик таких вызовов до тридцати восьми — по два на каждую Модель Поколения.
 *
 * Результат кэшируется по ССЫЛКЕ на список `owned`, и это корректно ровно так же, как кэш
 * Апгрейдов в движке: список никогда не меняется на месте — покупка Перка заменяет его целиком
 * (`[...state.perks, id]`), — поэтому та же ссылка означает то же содержимое. Все девять мест
 * вызова только читают результат (`reduce`, `for…of`, `some`); мутация выдачи сделала бы кэш
 * общим для всех и тихо испортила бы Доход.
 */
let effectsCache: { owned: readonly string[]; effects: PerkEffect[] } | null = null;

export function perkEffects(owned: string[]): PerkEffect[] {
  if (effectsCache?.owned === owned) return effectsCache.effects;
  const effects = owned.map((id) => PERK_BY_ID[id]?.effect).filter((e): e is PerkEffect => !!e);
  effectsCache = { owned, effects };
  return effects;
}
