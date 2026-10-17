import { MODEL_BY_ID, type Model } from '../economy/catalog';
import { LABS, LAB_IDS, type LabId } from '../data/labs';
import {
  bulkCost,
  clickValue,
  discountMult,
  incomeGain,
  labIncomeShare,
  maxAffordable,
  nextAgentCost,
  progressToNextAgent,
  sellRefund,
  shatterPayout,
  shortfall,
  totalIncome,
} from '../economy/engine';
import { canStartChallenge, challengeComputeMult, hasChallenge, INHERITED_REWARD_PCT, riskClass, RISK_MULT_MAX, type ChallengeDef } from '../economy/challenges';
import { crystalCycleMs, crystalIncomeMult, CRYSTAL_PER_STOCK_BONUS, type CrystalUpgrade } from '../economy/crystal';
import { formatCount, formatDuration, formatNumber } from '../economy/format';
import {
  canLicense,
  canPledge,
  glitchDrainMult,
  licenseCost,
  LICENSE_INCOME_TAX,
  pledgeCost,
  revokeCost,
} from '../economy/glitches';
import { THERMAL_HOT_HEAT, THERMAL_STATE_LABEL, thermalState, type ThermalStateId } from '../data/thermalCopy';
import { prestigeForecast } from '../economy/prestigeForecast';
import { milestoneHint, milestoneReward, nextMilestone, type Milestone } from '../economy/milestones';
import { queueCapacity } from '../economy/purchaseQueue';
import { arenaOutlook, buyStreakNow, ruleEffect, thoughtOutlook } from '../economy/rules';
import type { GameState, Glitch, ResearchTermId } from '../economy/state';
import {
  isResearchReady,
  RESEARCH_BOOST_MULT,
  RESEARCH_DURATION_MS,
  researchBoostActive,
} from '../economy/research';
import { TEMP_MAX, thermalRead } from '../economy/thermal';
import {
  availableUpgrades,
  labAgents,
  labWork,
  SYNERGY_PER_AGENT,
  synergyUpgradeId,
  type Upgrade,
} from '../economy/upgrades';
import type { BuyAmount } from './useGameStore';

/**
 * Срезы состояния для компонентов: что именно видит игрок, а не всё, из чего оно считается.
 *
 * Тик идёт двадцать раз в секунду и каждый раз кладёт в стор новый `GameState`: растут Токены,
 * двигаются часы. Компонент, подписанный на `s.state` целиком, перерисовывался бы на каждом тике,
 * даже если на экране не изменилась ни одна цифра. Поэтому каждая функция здесь возвращает то, что
 * компонент рисует — готовые строки, округлённые доли, булевы признаки, — и подписчик с
 * `useShallow` перерисовывается, только когда изменилась сама картинка. Отсюда два правила:
 *
 * - срез плоский и состоит из примитивов (или ссылок на неизменные таблицы): вложенный объект
 *   сломал бы поверхностное сравнение и вернул перерисовку на каждый тик;
 * - число, которое игрок читает форматом, отдаётся форматом: `formatNumber` меняет строку на
 *   порядки реже, чем сам кошелёк меняет значение.
 *
 * Деньги по-прежнему считает `src/economy/`: здесь только вызовы движка и форматирование.
 */

/**
 * Запоминает ответ по самому объекту состояния. Стор кладёт новое состояние на каждый тик, а
 * срезов у одного состояния десятки (по одному на карточку магазина, строку ростера и так далее),
 * поэтому общий для них расчёт — Доход, список Апгрейдов — делается один раз за тик, а не по разу
 * на подписчика. WeakMap не удерживает прошлые тики: состояние уходит в сборку мусора вместе с ключом.
 */
const memoByState = <T>(fn: (s: GameState) => T): ((s: GameState) => T) => {
  const cache = new WeakMap<GameState, T>();
  return (s) => {
    if (cache.has(s)) return cache.get(s) as T;
    const value = fn(s);
    cache.set(s, value);
    return value;
  };
};

/** Доход состояния: один расчёт на тик для всех, кто его показывает. */
export const incomeOf = memoByState((s) => totalIncome(s));

/**
 * Апгрейды, доступные к покупке. Список нужен и бейджу вкладки, и самой вкладке, а считает его
 * полный проход по таблице с сортировкой, поэтому на тик он один. Элементы — записи таблицы, и
 * поверхностное сравнение видит, что список тот же, пока никто не открылся и не куплен.
 */
export const availableUpgradesOf = memoByState((s) => availableUpgrades(s));

// ---------- Колонка Клика ----------

export interface IncomeView {
  /** Доход в нотации игрока, как под счётчиком Токенов. */
  text: string;
  /** Дохода ещё нет: под счётчиком вместо тишины стоит подсказка про магазин. */
  zero: boolean;
}

export function incomeView(s: GameState): IncomeView {
  const income = incomeOf(s);
  return { text: formatNumber(income, s.settings.notation), zero: income === 0 };
}

export interface ClickButtonView {
  /** Награда за Клик цифрами, режимом `price`: тот же формат, что у подписи в магазине. */
  value: string;
  /** Существительное в форме, согласованной с цифрами выше. */
  word: string;
  /** Ступень ореола кнопки: от 0 (пустой офис) до 4. */
  tier: 0 | 1 | 2 | 3 | 4;
  /** Сила ореола 0..1 с двумя знаками: CSS-переменная получает именно строку. */
  power: string;
}

export function clickButtonView(s: GameState): ClickButtonView {
  const income = incomeOf(s);
  const reward = clickValue(s, income);
  const notation = s.settings.notation;

  // Сила Клика: честный расчёт из существующего состояния (число Агентов и Доход).
  const agents = Object.values(s.agents).reduce((sum, n) => sum + n, 0);
  const tier =
    agents >= 200 || income >= 2500
      ? 4
      : agents >= 50 || income >= 100
        ? 3
        : agents >= 10 || income >= 5
          ? 2
          : agents >= 1 || income > 0
            ? 1
            : 0;
  // Нормализованная сила 0..1 для плавной интерполяции ореола через CSS-переход.
  const power = agents === 0 && income === 0 ? 0 : Math.min(1, Math.log10(agents + 1) / 2.6);

  return {
    value: formatNumber(reward, notation, 'price'),
    word: formatCount(reward, 'Токен', 'Токена', 'Токенов', notation, 'price'),
    tier,
    power: power.toFixed(2),
  };
}

export interface PurchaseProgressView {
  /** Хватает на самую дешёвую Модель: вместо дефицита подпись зовёт в магазин. */
  canHire: boolean;
  /** Ширина полосы в процентах с шагом 0.1: меньше доли пикселя полосой не читается. */
  width: number;
  /** Целые проценты для озвучки: aria-valuenow. */
  now: number;
  /** Сколько Токенов не хватает; пусто, когда хватает. */
  missingText: string;
  missingWord: string;
}

export function purchaseProgressView(s: GameState): PurchaseProgressView {
  const notation = s.settings.notation;
  const cost = nextAgentCost(s);
  // Math.ceil защищает от обещания нехватки целого, когда списание дробное: formatNumber
  // режет дробную часть вниз (Math.floor), поэтому без округления вверх на дробной цене
  // игрок накопил бы на единицу меньше необходимого.
  const missing = Math.ceil(shortfall(cost, s.tokens));
  const progress = cost > 0 ? Math.min(1, s.tokens / cost) : 0;
  const canHire = cost > 0 && s.tokens >= cost;
  return {
    canHire,
    width: Math.round(progress * 1000) / 10,
    now: Math.round(progress * 100),
    missingText: canHire ? '' : formatNumber(missing, notation),
    // Нотация обязательна: форма считается по цифрам той же записи, что и число.
    missingWord: canHire ? '' : formatCount(missing, 'Токен', 'Токена', 'Токенов', notation),
  };
}

/** Полоса вех: веха, подпись, награда и забранные деления. Меняется на выплате, а не на тике. */
export interface MilestoneView {
  /** Следующая цель; null, когда все вехи забраны и полоса не нужна. */
  current: Milestone | null;
  hint: string;
  /** Награда в нотации игрока. */
  reward: string;
  /** Забранные вехи: ссылка на список из состояния, он меняется только на выплате. */
  done: readonly string[];
}

export function milestoneView(s: GameState): MilestoneView {
  const current = nextMilestone(s);
  return {
    current,
    hint: current ? milestoneHint(s, current) : '',
    reward: current ? formatNumber(milestoneReward(s, current), s.settings.notation) : '',
    done: s.milestones,
  };
}

// ---------- Температура ----------

export type ThermalTone = 'stunned' | 'hot' | 'calm';

/** Тон корня и шкалы: оглушение важнее жара, жар важнее покоя. */
export function thermalTone(s: GameState): ThermalTone {
  const read = thermalRead(s);
  return read.stunned ? 'stunned' : read.heat > THERMAL_HOT_HEAT ? 'hot' : 'calm';
}

export interface ThermalView {
  /** Температура шкалы после зажима: от неё ручка, шаг клавиатуры и озвучка. */
  temp: number;
  stunned: boolean;
  tone: ThermalTone;
  /** Состояние шкалы: холод, норма, жар, перегрев. Значок и слово у шкалы идут от него. */
  state: ThermalStateId;
  /** Слово состояния для подписи: «Холод», «Норма», «Жар», «Перегрев». */
  stateLabel: string;
  /** Слово состояния: цвет один не различают, поэтому оно всегда стоит рядом со шкалой. */
  status: string;
  /** Ширина полосы перегрева в процентах с шагом 0.5: у полосы переход в 0.25 с, и полпроцента
   *  на ширине колонки — меньше двух пикселей, поэтому шаг глазом не читается, а перерисовок
   *  вместо двадцати в секунду остаётся одна-две. */
  heatBar: number;
  /** Безопасная Температура офиса словами: её двигают Характеры Лабораторий и Перки. */
  safe: string;
  /** Целые проценты перегрева для озвучки и подписи. */
  heatNow: number;
  /** Перегрев за 0.75: полоса переходит на цвет жара. */
  heatHigh: boolean;
  /** Множитель Дохода от жара в нотации игрока. */
  mult: string;
  /** Подпись ползунка для озвучки: положение, множитель и слово состояния. */
  valueText: string;
  /** Чем рискует игрок: перегрев, галлюцинации или ничем. */
  risk: string;
  /** Перегрев за 0.6: подпись риска красится жаром. */
  riskHot: boolean;
}

export function thermalView(s: GameState): ThermalView {
  const read = thermalRead(s);
  const heatPct = read.heat * 100;
  const state = thermalState(read.temp, read.heat, read.stunned);
  const status = read.stunned
    ? 'Перегрев: Доход падает'
    : read.heat > 0.75
      ? 'Почти перегрев'
      : read.heat > 0.4
        ? 'Копится перегрев'
        : 'Стабильно';
  return {
    temp: read.temp,
    stunned: read.stunned,
    tone: read.stunned ? 'stunned' : read.heat > THERMAL_HOT_HEAT ? 'hot' : 'calm',
    state,
    stateLabel: THERMAL_STATE_LABEL[state],
    status,
    heatBar: Math.round(heatPct * 2) / 2,
    heatNow: Math.round(heatPct),
    safe: `безопасно до ${read.safeTemp.toFixed(2)}`,
    heatHigh: read.heat > 0.75,
    mult: formatNumber(read.mult, s.settings.notation),
    valueText: `${read.temp.toFixed(2)} из ${TEMP_MAX}, Доход ×${read.mult.toFixed(2)}, ${status}`,
    risk: read.stunned
      ? 'Доход падает'
      : read.heat > 0.6
        ? `перегрев ${Math.round(heatPct)}%`
        : read.halluRate > 0
          ? `галлюцинации ${Math.round(read.halluRate * 60)}/мин`
          : 'риска нет',
    riskHot: read.stunned || read.heat > 0.6,
  };
}

export interface ThermalMiniView {
  /** Состояние шкалы: от него значок и цвет слова в закреплённой полосе. */
  state: ThermalStateId;
  /** Слово состояния рядом со значком: цвет один не различают. */
  stateLabel: string;
  /** Положение шкалы в целых процентах: мини-шкала шириной в окно телефона не различит меньше. */
  pct: number;
}

/**
 * Температура для закреплённой полосы телефона: слово состояния и положение шкалы, без
 * перегрева и множителя. Перегрев копится каждый тик, а полоса стоит над всеми вкладками, и
 * срез с ним перерисовывал бы её двадцать раз в секунду ради цифры, которой в полосе нет.
 */
export function thermalMiniView(s: GameState): ThermalMiniView {
  const read = thermalRead(s);
  const state = thermalState(read.temp, read.heat, read.stunned);
  return { state, stateLabel: THERMAL_STATE_LABEL[state], pct: Math.round((read.temp / TEMP_MAX) * 100) };
}

/** Три ступени количества: непрерывный ряд из двадцати частиц бьёт по кадру на 20 тиках
 *  в секунду, а ступени дают читаемый «больше жара — больше искр» без рваного счёта. */
const SPARK_TIERS = [0, 4, 9] as const;

/** Порог жара для каждой ступени. Верхняя ступень включается на 0.55 перегрева — раньше
 *  перегрева, чтобы игрок видел искры до того, как увидит шкалу целиком. */
const SPARK_TIER_AT = [0, 0.22, 0.55];

export interface SparksView {
  /** Сколько искр летит; 0 — ни одной, и слой не монтируется. */
  count: number;
  /** Жар выше 0.6: искры красятся жаром, а не акцентом Поколения. */
  hot: boolean;
  /** Срок жизни искры: чем горячее, тем короче. Строка, потому что в таком виде она и уходит в CSS. */
  duration: string;
  /** Яркость искр от Температуры шкалы. */
  opacity: number;
}

const NO_SPARKS: SparksView = { count: 0, hot: false, duration: '', opacity: 0 };

export function sparksView(s: GameState): SparksView {
  const count = SPARK_TIERS[SPARK_TIER_AT.filter((at) => s.heat >= at).length - 1];
  if (count === 0) return NO_SPARKS;
  return {
    count,
    hot: s.heat > 0.6,
    duration: (0.5 - s.heat * 0.24).toFixed(2),
    opacity: 0.5 + Math.min(0.5, s.temp / TEMP_MAX),
  };
}

// ---------- Магазин: карточка Модели ----------

/**
 * Деления рельса цели в карточке Модели.
 *
 * Двенадцать, а не «сколько поместится»: число делений — это разрешение шкалы, и оно должно
 * быть одинаковым на всех Моделях, иначе сравнивать карточки между собой нечем.
 */
export const GOAL_TICK_COUNT = 12;

export interface ModelView {
  owned: number;
  /** «Агент», «Агента» или «Агентов» под числом: форма считается по напечатанным цифрам. */
  ownedWord: string;
  /** Режим продажи: красит прирост и кнопку. */
  sell: boolean;
  /** Сколько Агентов купит или продаст кнопка при текущем множителе. */
  count: number;
  /** Кнопка живая: хватает Токенов (покупка) или есть что продавать (продажа). */
  canAfford: boolean;
  /** Строка прироста Дохода нужна: «+0 к доходу» и «−0 к доходу» не говорят ничего. */
  showsGain: boolean;
  gainText: string;
  /** Цена покупки в кнопке. */
  costText: string;
  /** Сколько вернёт продажа. */
  refundText: string;
  /** Сколько не хватает; пусто, когда хватает или идёт продажа. */
  missingText: string;
  /** Заполненные деления рельса цели из двенадцати. */
  goalTicks: number;
  /** Целые проценты пути до следующего Агента для озвучки рельса. */
  goalPct: number;
}

/** Числа карточки Модели до форматирования: то, что печатает `modelView`, и то, что покажет полная запись. */
export interface ModelFigures {
  owned: number;
  count: number;
  cost: number;
  canAfford: boolean;
  showsGain: boolean;
  /** Прирост общего Дохода от этой покупки; 0, пока строка прироста не показывается. */
  gain: number;
  refund: number;
  /** Сколько не хватает; 0, когда хватает или идёт продажа. */
  missing: number;
}

/**
 * Сырые числа карточки Модели при данных множителе и режиме. Прирост Дохода — единственное дорогое
 * число (два полных Дохода на каждую Модель), поэтому считается только когда его строка видна.
 *
 * Отдельно от `modelView` потому, что полная запись числа при наведении читает те же значения:
 * цена, прирост и дефицит в подсказке обязаны быть теми, что напечатаны на кнопке, а не
 * пересчитанными вторично другой формулой.
 */
export function modelFigures(s: GameState, m: Model, buyAmount: BuyAmount, sellMode: boolean): ModelFigures {
  const d = discountMult(s);
  const owned = s.agents[m.id] ?? 0;
  const count = buyAmount === 'max' ? (sellMode ? owned : maxAffordable(m, owned, s.tokens, d)) : buyAmount;
  const cost = bulkCost(m, owned, count, d);
  const canAfford = !sellMode ? count > 0 && cost <= s.tokens : owned >= count && count > 0;

  // Дефицит: при фиксированном множителе он считается на всю сумму покупки, а при Max
  // с пустым кошельком покупки нет вообще — тогда показываем, чего стоит одна единица.
  const missing =
    sellMode || canAfford ? 0 : shortfall(count > 0 ? cost : bulkCost(m, owned, 1, d), s.tokens);

  // Строка прироста описывает действие, которое кнопка действительно выполнит. Продать нечего —
  // и обе цифры, и кнопка были бы пустыми.
  const showsGain = sellMode ? owned > 0 : count > 0;
  return {
    owned,
    count,
    cost,
    canAfford,
    showsGain,
    // Прирост общего Дохода именно от этой покупки, посчитанный движком. Продажа ограничена тем,
    // что есть: sellAgents берёт min(n, owned), и подпись про большую сделку, чем возможна,
    // вводила бы в заблуждение.
    gain: showsGain ? incomeGain(s, m.id, sellMode ? Math.min(count, owned) : count, s.lastTick, incomeOf(s)) : 0,
    refund: sellRefund(m, owned, count, d),
    missing,
  };
}

/**
 * Что показывает карточка Модели при данных множителе и режиме.
 *
 * Кошелёк входит во всё, но наружу выходит форматом и делениями рельса, поэтому карточка
 * перерисовывается, когда меняется напечатанное, а не когда Токенов стало на тик больше.
 */
export function modelView(s: GameState, m: Model, buyAmount: BuyAmount, sellMode: boolean): ModelView {
  const notation = s.settings.notation;
  const f = modelFigures(s, m, buyAmount, sellMode);
  // Доля для полосы цели — из движка, по той же цене, что и покупка.
  const missingShare = progressToNextAgent(s, m);

  return {
    owned: f.owned,
    ownedWord: formatCount(f.owned, 'Агент', 'Агента', 'Агентов', notation),
    sell: sellMode,
    count: f.count,
    canAfford: f.canAfford,
    showsGain: f.showsGain,
    gainText: f.showsGain ? formatNumber(f.gain, notation) : '',
    costText: formatNumber(f.cost, notation),
    refundText: formatNumber(f.refund, notation),
    missingText: !f.canAfford && f.missing > 0 ? formatNumber(f.missing, notation) : '',
    // Двенадцать делений, а не десять: при десяти на Моделях ранга 1 шаг заметно грубее, чем у
    // поздних. Точное число читается в подписи для скринридера, поэтому рельс округляет.
    goalTicks: Math.round((1 - missingShare) * GOAL_TICK_COUNT),
    goalPct: Math.round((1 - missingShare) * 100),
  };
}

// ---------- Магазин: Апгрейды ----------

export interface UpgradeView {
  canAfford: boolean;
  costText: string;
  /** Сколько Токенов не хватает; пусто, когда хватает. */
  missingText: string;
  missingWord: string;
}

export function upgradeView(s: GameState, u: Upgrade): UpgradeView {
  const notation = s.settings.notation;
  const canAfford = s.tokens >= u.cost;
  const missing = canAfford ? 0 : shortfall(u.cost, s.tokens);
  return {
    canAfford,
    costText: formatNumber(u.cost, notation),
    missingText: missing > 0 ? formatNumber(missing, notation) : '',
    // Нотация обязательна: форма считается по цифрам той же записи, что и число.
    missingWord: missing > 0 ? formatCount(missing, 'Токен', 'Токена', 'Токенов', notation) : '',
  };
}

// ---------- Магазин: вкладка «Престиж» ----------

export interface PrestigeCardView {
  /** Финал контента: Престиж недоступен навсегда. */
  finale: boolean;
  /** Флагман нанят: Престиж открыт. */
  ready: boolean;
  /** Сколько Compute заплатит Престиж сейчас, в нотации игрока. */
  gain: string;
  /** Compute, при котором прибавка заметна (+50%, но не меньше единицы). */
  boostGain: string;
  /** Прибавка ровно +50%, а не «следующая единица»: при Compute меньше двух +50% не набираются. */
  boostIsHalf: boolean;
  /** Сколько Токенов Забега ещё нужно заработать до `boostGain`. */
  boostShortfall: string;
  boostShortfallWord: string;
}

export function prestigeCardView(s: GameState): PrestigeCardView {
  const notation = s.settings.notation;
  const f = prestigeForecast(s);
  return {
    finale: f.finale,
    ready: f.ready,
    gain: formatNumber(f.gain, notation),
    boostGain: formatNumber(f.boostGain, notation),
    boostIsHalf: f.gain >= 2,
    boostShortfall: formatNumber(f.boostShortfall, notation),
    boostShortfallWord: formatCount(f.boostShortfall, 'Токен', 'Токена', 'Токенов', notation),
  };
}

export interface ChallengeView {
  /** Это Испытание взято на текущий Забег. */
  active: boolean;
  /** Оно уже закрыто Престижем: награда — Compute того Престижа, списком — память. */
  done: boolean;
}

export function challengeView(s: GameState, def: ChallengeDef): ChallengeView {
  return { active: hasChallenge(s, def.id), done: s.challengesDone.includes(def.id) };
}

export interface ChallengeCardView {
  /** Забег свежий: Испытания ещё можно брать или класть обратно. */
  canStart: boolean;
  /** Взятых Испытаний нет: обычный Забег без Класса риска. */
  none: boolean;
  /** Класс риска Забега: сумма тяжести взятых Испытаний. */
  risk: number;
  /** Множитель Compute за этот Престиж от Класса риска, отформатированный для показа. */
  multText: string;
  /** Множитель упёрся в потолок: лишняя тяжесть Compute уже не прибавляет. */
  capped: boolean;
  /** Награда Испытаний, закрытых до Compute-награды, в процентах — +10% за каждое. */
  inheritedText: string;
  /** Сколько Испытаний Престиж хоть раз закрывал; память для игрока, не награда. */
  doneCount: number;
}

export function challengeCardView(s: GameState): ChallengeCardView {
  const notation = s.settings.notation;
  const inherited = new Set(s.challengesInherited).size;
  const mult = challengeComputeMult(s);
  return {
    canStart: canStartChallenge(s),
    none: s.activeChallenges.length === 0,
    risk: riskClass(s),
    multText: formatNumber(mult, notation),
    capped: mult >= RISK_MULT_MAX,
    inheritedText: formatNumber(inherited * INHERITED_REWARD_PCT, notation),
    doneCount: new Set(s.challengesDone).size,
  };
}

/**
 * Метка «!» на вкладке «Апгрейды». Тоста о Восстании нет (тосты — только Достижения), и о новой
 * стадии игроку говорит метка — пока он не заглянул во вкладку на этой стадии. Под «Лицензией»
 * красных Событий нет, и звать к Откупу незачем.
 */
export function pledgeAlert(s: GameState, uprisingSeen: number): boolean {
  return s.uprising > uprisingSeen && !s.covenant;
}

export interface PledgeView {
  covenant: boolean;
  pledgeBought: number;
  pledgeCostText: string;
  canPledge: boolean;
  /** Сколько ещё глушит «Лобби»; пусто, когда не глушит. Часы игровые, как у всего окна События. */
  leftText: string;
  licenseCostText: string;
  canLicense: boolean;
  revokeCostText: string;
  canRevoke: boolean;
  /** Налог «Лицензии» в процентах, в нотации игрока. */
  taxText: string;
}

export function pledgeView(s: GameState): PledgeView {
  const notation = s.settings.notation;
  const leftMs = Math.max(0, s.pledgeUntil - s.lastTick);
  return {
    covenant: s.covenant,
    pledgeBought: s.pledgeBought,
    pledgeCostText: formatNumber(pledgeCost(s), notation),
    canPledge: canPledge(s),
    leftText: leftMs > 0 ? formatDuration(leftMs / 1000) : '',
    licenseCostText: formatNumber(licenseCost(s), notation),
    canLicense: canLicense(s),
    revokeCostText: formatNumber(revokeCost(s), notation),
    canRevoke: s.tokens >= revokeCost(s),
    taxText: formatNumber(Math.round(LICENSE_INCOME_TAX * 100), notation),
  };
}

export interface CrystalStockView {
  /** Целые кристаллы в запасе. */
  stock: string;
  /** Бонус к Доходу за запас в процентах. */
  bonus: string;
}

export function crystalStockView(s: GameState): CrystalStockView {
  const notation = s.settings.notation;
  return {
    stock: formatNumber(s.crystals, notation),
    bonus: formatNumber(Math.round((crystalIncomeMult(s) - 1) * 100), notation),
  };
}

export interface CrystalShatterView {
  /** В запасе есть целый кристалл: кнопка разбития доступна. */
  canShatter: boolean;
  /** Сколько Токенов даст разбитие сейчас. */
  payoutText: string;
  payoutWord: string;
  /** Сколько процентов Дохода уйдёт вместе с кристаллом. */
  lostText: string;
}

export function crystalShatterView(s: GameState): CrystalShatterView {
  const notation = s.settings.notation;
  const payout = shatterPayout(s);
  return {
    canShatter: Math.floor(s.crystals) >= 1,
    payoutText: formatNumber(payout, notation),
    payoutWord: formatCount(payout, 'Токен', 'Токена', 'Токенов', notation),
    lostText: formatNumber(Math.round(CRYSTAL_PER_STOCK_BONUS * 100), notation),
  };
}

export interface CrystalGrowthView {
  /** Кристалл посажен: до первого тика его нет, и подпись говорит, что он только сеется. */
  planted: boolean;
  /** Сколько зреть ещё, словами. */
  leftText: string;
  /** Ширина полосы в процентах с шагом 0.1. */
  width: number;
  now: number;
}

export function crystalGrowthView(s: GameState): CrystalGrowthView {
  // Зреет максимум один кристалл за раз, поэтому «следующий» — единственный, а обе величины
  // считаются по lastTick: у него же стор двигает рост кристалла.
  const cycle = crystalCycleMs(s);
  const grownMs = s.crystalPlantedAt === 0 ? 0 : Math.max(0, s.lastTick - s.crystalPlantedAt);
  const leftSec = Math.max(0, cycle - grownMs) / 1000;
  const progress = cycle > 0 ? Math.min(1, grownMs / cycle) : 0;
  return {
    planted: s.crystalPlantedAt !== 0,
    leftText: s.crystalPlantedAt === 0 ? '' : formatDuration(leftSec),
    width: Math.round(progress * 1000) / 10,
    now: Math.round(progress * 100),
  };
}

/** Срок Исследования словами: подпись слота. */
export const RESEARCH_TERM_TEXT: Record<ResearchTermId, string> = { '30m': '30 минут', '2h': '2 часа', '8h': '8 часов' };

/**
 * Один слот Исследований. Плоский объект, а не массив: слот подписывается отдельно, и `useShallow`
 * перерисовывает его только при смене одного из полей. Процент целый, поэтому полоса не дёргается каждый
 * тик, а меняется раз в долю срока, и текст «осталось» меняется раз в минуту, а не на каждом тике.
 */
export interface ResearchSlotView {
  /** В слоте лежит Исследование: оно созревает или уже ждёт сбора. */
  busy: boolean;
  /** Созрело: сбор уже можно нажать. */
  ready: boolean;
  termText: string;
  /** Сколько осталось созревать; «готово», когда созрело, пусто в пустом слоте. */
  leftText: string;
  /** Целый процент созревания 0..100. */
  progress: number;
}

/** Слот Исследований по индексу, часы — `lastTick`, тот же, которым читает тик. Пустой слот — без подписей. */
export function researchSlotView(s: GameState, index: number): ResearchSlotView {
  const job = s.research[index];
  if (!job) return { busy: false, ready: false, termText: '', leftText: '', progress: 0 };
  const duration = RESEARCH_DURATION_MS[job.term];
  const elapsed = Math.max(0, s.lastTick - job.startedAt);
  const ready = isResearchReady(job, s.lastTick);
  return {
    busy: true,
    ready,
    termText: RESEARCH_TERM_TEXT[job.term],
    leftText: ready ? 'готово' : formatDuration(Math.ceil((duration - elapsed) / 1000)),
    progress: ready ? 100 : Math.floor((elapsed / duration) * 100),
  };
}

/** Временное усиление: идёт ли оно, на сколько поднят Доход и сколько ещё. */
export interface ResearchBoostView {
  active: boolean;
  /** Во сколько раз поднят живой Доход, с запятой: «1,5». */
  multText: string;
  /** Сколько осталось до конца окна; пусто вне окна. */
  leftText: string;
}

export function researchBoostView(s: GameState): ResearchBoostView {
  const active = researchBoostActive(s, s.lastTick);
  return {
    active,
    multText: String(RESEARCH_BOOST_MULT).replace('.', ','),
    leftText: active ? formatDuration(Math.ceil((s.researchBoostUntil - s.lastTick) / 1000)) : '',
  };
}

export interface CrystalUpgradeView {
  owned: boolean;
  canAfford: boolean;
  /** Сколько процентов бонуса за запас уйдёт навсегда. */
  lostText: string;
  costText: string;
  costWord: string;
}

export function crystalUpgradeView(s: GameState, u: CrystalUpgrade): CrystalUpgradeView {
  const notation = s.settings.notation;
  const owned = s.crystalUpgrades.includes(u.id);
  // Цена ускорителя: сколько процентов бонуса за запас уйдёт навсегда. Это разница двух
  // бонусов от самой экономики, а не «цена ×1%», посчитанная в компоненте, — правило «сколько
  // даёт целый кристалл в запасе» живёт поэтому в одном месте, в crystalIncomeMult.
  // Запас для обеих точек берётся равным цене, а не текущему: ускоритель покупают, когда
  // кристаллов хватает, и до тех пор его цена не должна скакать вместе с кошельком.
  const lost = Math.round(
    (crystalIncomeMult({ ...s, crystals: u.cost }) - crystalIncomeMult({ ...s, crystals: 0 })) * 100,
  );
  return {
    owned,
    canAfford: !owned && s.crystals >= u.cost,
    lostText: formatNumber(lost, notation),
    costText: formatNumber(u.cost, notation, 'price'),
    costWord: formatCount(u.cost, 'кристалл', 'кристалла', 'кристаллов', notation, 'price'),
  };
}

// ---------- Сцена ----------

export interface GlitchBandView {
  /** Какую долю Дохода уносят Глюки, в процентах. */
  drain: string;
  /** Сколько Токенов уже унесли. */
  stolen: string;
  stolenWord: string;
  /** Перегрев красит полосу и спрайт: он единственное, что здесь меняется между тиками. */
  heat: number;
}

/** Полоса кражи под HUD Сцены; null, пока на Сцене нет ни одного Глюка. */
export function glitchBandView(s: GameState): GlitchBandView | null {
  if (s.glitches.length === 0) return null;
  const notation = s.settings.notation;
  const stolen = s.glitches.reduce((sum, g) => sum + g.stolen, 0);
  return {
    drain: formatNumber(Math.round((1 - glitchDrainMult(s)) * 100), notation),
    stolen: formatNumber(stolen, notation),
    stolenWord: formatCount(stolen, 'Токен', 'Токена', 'Токенов', notation),
    heat: s.heat,
  };
}

const NO_GLITCHES: readonly Glitch[] = [];

/**
 * Глюки на Сцене. Пока их нет, возвращается один и тот же пустой список: тик собирает новый
 * `[]` каждый раз, и по ссылке «Глюков нет» выглядело бы как изменение на каждом тике.
 */
export function glitchesOf(s: GameState): readonly Glitch[] {
  return s.glitches.length === 0 ? NO_GLITCHES : s.glitches;
}

export interface DroneView {
  /** Сколько мс прошло с начала окна События: от него считается полёт Дрона. */
  elapsed: number;
  heat: number;
  red: boolean;
}

/**
 * Дрон в воздухе: только пока идёт пролёт (`flightMs` с начала окна), иначе null. Окно События
 * живёт дольше пролёта, и подписка на часы весь остаток окна перерисовывала бы пустой слой.
 */
export function droneView(s: GameState, flightMs: number): DroneView | null {
  const startedAt = s.event?.startedAt ?? 0;
  const elapsed = s.lastTick - startedAt;
  if (startedAt <= 0 || elapsed < 0 || elapsed >= flightMs) return null;
  return { elapsed, heat: s.heat, red: s.event?.red ?? false };
}

/**
 * Ниже этой доли процент не различает Лаборатории: на восьми такая метка повторялась бы
 * пять раз из восьми и читалась бы как «у всех всё одинаково».
 */
const SHARE_MIN = 0.01;

/** Доля Лаборатории в Доходе целым процентом; -1, когда метку не показывают (меньше процента). */
export function labShareView(s: GameState, lab: LabId): number {
  const share = labIncomeShare(s, lab, incomeOf(s));
  return share >= SHARE_MIN ? Math.round(share * 100) : -1;
}

/**
 * Что карточка Маскота говорит о его Лаборатории: Агенты, работа, доля в Доходе и Синергия.
 * Плоский срез из примитивов — тик карточку не перерисовывает.
 *
 * `synergy` — процент, который Синергия даёт всем Моделям Лаборатории, или -1, пока она не
 * куплена или Испытание «Забег без Синергий» её гасит: карточка не обещает бонуса, которого
 * движок не начислит.
 */
export interface LabCardView {
  /** Агенты Лаборатории готовой записью («1,5 К»). */
  agents: string;
  /** Слово при числе Агентов: «Агент», «Агента», «Агентов». */
  agentsWord: string;
  /** Название работы Лаборатории по её высшему Апгрейду; пусто, пока Апгрейдов нет. */
  work: string;
  /** Доля в Доходе целым процентом; -1, когда её не показывают. */
  share: number;
  /** Бонус Синергии целым процентом; -1, когда её нет. */
  synergy: number;
  /** Бонус Синергии готовой записью. */
  synergyText: string;
}

export function labCardView(s: GameState, lab: LabId, showShare: boolean): LabCardView {
  const notation = s.settings.notation;
  const count = labAgents(s, lab);
  const synergyOn =
    !hasChallenge(s, 'no-synergy') && s.upgrades.includes(synergyUpgradeId(s.generation, lab));
  const synergy = synergyOn ? Math.round(count * SYNERGY_PER_AGENT * 100) : -1;
  return {
    agents: formatNumber(count, notation),
    agentsWord: formatCount(count, 'Агент', 'Агента', 'Агентов', notation),
    work: labWork(s, lab),
    share: showShare ? labShareView(s, lab) : -1,
    synergy,
    synergyText: synergy >= 0 ? formatNumber(synergy, notation) : '',
  };
}

/**
 * Подписи мест Маскотов для чтеца с экрана, по одной на Лабораторию в порядке `LAB_IDS`:
 * «Anthropic: 15 Агентов, Синергия +15%». Карточка над Маскотом для чтеца скрыта, потому что
 * говорит то же самое, и числа в обеих записях идут из одного `labCardView`.
 */
export function labBoothLabels(s: GameState): string[] {
  return LAB_IDS.map((lab) => {
    const view = labCardView(s, lab, false);
    const synergy = view.synergy >= 0 ? `, Синергия +${view.synergyText}%` : '';
    return `${LABS[lab].name}: ${view.agents} ${view.agentsWord}${synergy}`;
  });
}

export interface QueueView {
  /** Записи в порядке найма; `index` нужен кнопке «снять». */
  entries: { index: number; name: string }[];
  capacity: number;
  full: boolean;
}

/** Записи очереди с именами Моделей; чистая функция от списка id, чтобы компонент считал её в `useMemo`. */
export function queueEntries(ids: readonly string[]): QueueView['entries'] {
  return ids.map((id, index) => ({ index, name: MODEL_BY_ID[id]?.name ?? id }));
}

/**
 * Карточка очереди закупок в магазине; `null` вне «Агентов сами». Вложенный `entries` — новый
 * массив на каждый вызов, поэтому в `useStateSlice` его не отдают: компонент читает плоские
 * `queueSlots` и ссылку `purchaseQueue`, а записи собирает `queueEntries` в `useMemo`.
 */
export function queueView(s: GameState): QueueView | null {
  const capacity = queueCapacity(s);
  if (capacity === 0) return null;
  return { entries: queueEntries(s.purchaseQueue), capacity, full: s.purchaseQueue.length >= capacity };
}

/**
 * Живая строка Правила Поколения на Сцене: то, что в нём сейчас меняется. Пустая строка — у
 * Правил, где живого нет (цена и Доход сами читаются с карточек), и HUD оставляет там описание.
 *
 * «Лидер Арены» называет лидера и минуты до смены; в последнюю минуту — следующего лидера, как и
 * лента. Минуты целые, поэтому строка перерисовывается раз в минуту, а не двадцать раз в секунду.
 */
export function ruleStatusText(s: GameState): string {
  const arena = arenaOutlook(s);
  if (arena) {
    const leader = LABS[arena.leader].name;
    return arena.warning
      ? `Лидер: ${leader} · дальше ${LABS[arena.next].name}`
      : `Лидер: ${leader} · ещё ${Math.ceil(arena.secondsLeft / 60)} мин`;
  }
  const capacity = queueCapacity(s);
  if (capacity > 0) return `Очередь: ${s.purchaseQueue.length} из ${capacity}`;
  const scarcity = scarcityView(s);
  return scarcity.extra > 0 ? `Цены +${scarcity.extra}%` : '';
}

export interface ScarcityView {
  /** Действует ли «Дефицит GPU» в этом Поколении. */
  active: boolean;
  /** Надбавка к цене в целых процентах; 0 — ряд покупок не идёт или остыл. */
  extra: number;
  /** Секунд до остывания цены, целых вверх; 0 — надбавки нет. */
  seconds: number;
}

/**
 * Карточка «Дефицита GPU» в магазине: на сколько процентов подорожали Модели и когда цена остынет.
 * Считается теми же `buyStreakNow` и параметрами Правила, что цена покупки, поэтому подпись не
 * может разойтись с карточками Моделей. Секунды меняют срез раз в секунду, и только пока надбавка
 * жива: после паузы срез неподвижен.
 */
export function scarcityView(s: GameState): ScarcityView {
  const effect = ruleEffect(s, 'buyStreak');
  if (!effect) return { active: false, extra: 0, seconds: 0 };
  const streak = buyStreakNow(s);
  if (streak === 0) return { active: true, extra: 0, seconds: 0 };
  return {
    active: true,
    extra: Math.round(Math.min(effect.maxExtra, effect.perAgent * streak) * 100),
    seconds: Math.max(0, Math.ceil((s.lastBuyAt + effect.resetSec * 1000 - s.lastTick) / 1000)),
  };
}

export interface ThoughtMeterView {
  /** Действует ли «Подумай ещё» в этом Поколении. */
  active: boolean;
  /** Идёт ли удержание: порция размышления пришла только что. */
  holding: boolean;
  /** Накопленные секунды с десятой долей, в нотации игрока. */
  seconds: string;
  /** Множитель выплаты за накопленное. */
  mult: string;
  /** Заполнение копилки в процентах, кратных пяти: полоса не дёргается на каждый тик. */
  width: number;
}

/**
 * Полоса размышления под кнопкой Клика. Секунды печатаются с десятой долью, поэтому срез меняется
 * десять раз в секунду, но только пока идёт удержание; в покое он неподвижен.
 */
export function thoughtMeterView(s: GameState): ThoughtMeterView {
  const effect = ruleEffect(s, 'heldThought');
  const outlook = thoughtOutlook(s);
  if (!effect || !outlook) {
    return { active: false, holding: false, seconds: '', mult: '', width: 0 };
  }
  const notation = s.settings.notation;
  return {
    active: true,
    holding: outlook.holding,
    seconds: formatNumber(Math.round(outlook.seconds * 10) / 10, notation),
    mult: formatNumber(Math.round(outlook.mult * 10) / 10, notation),
    width: Math.round((outlook.seconds / effect.maxSec) * 20) * 5,
  };
}

/** Плоский срез очереди для карточек Моделей: есть ли она и осталось ли в ней место. */
export function queueSlots(s: GameState): { active: boolean; full: boolean; capacity: number; count: number } {
  const capacity = queueCapacity(s);
  return { active: capacity > 0, full: s.purchaseQueue.length >= capacity, capacity, count: s.purchaseQueue.length };
}
