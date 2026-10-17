import { computeGain, prestigeDivisor } from './catalog';
import { challengeComputeMult } from './challenges';
import { canPrestige, isContentFinale, prestigeGain } from './engine';
import type { GameState } from './state';

/**
 * Прогноз Престижа для вкладки «Престиж»: сколько Compute заплатит переход сейчас и сколько
 * Токенов Забега не хватает до заметной прибавки.
 *
 * Чистая функция от состояния и ничего не хранит: карточка обязана называть то число, которое
 * платит сам Престиж, поэтому `gain` берётся из `prestigeGain`, а не пересчитывается.
 */

/** Заметная прибавка к Compute: +50% к тому, что Престиж платит сейчас. */
export const BOOST_SHARE = 0.5;

export interface PrestigeForecast {
  /** Compute, который начислит Престиж прямо сейчас. */
  gain: number;
  /** Compute, при котором прибавка заметна: +50% к `gain`, но не меньше одной единицы. */
  boostGain: number;
  /** Сколько Токенов ещё нужно заработать в этом Забеге до `boostGain`. */
  boostShortfall: number;
  /** Флагман нанят: Престиж открыт. */
  ready: boolean;
  /** Финал контента: Престиж недоступен навсегда. */
  finale: boolean;
}

/**
 * Порог `boostGain` в Токенах Забега — обратная величина к `computeGain`: прирост считается как
 * floor(cbrt(runTokens / divisor)), поэтому минимальный заработок для `g` равен g³ × divisor.
 * Кубический корень в double не всегда возвращает целое на точном кубе, поэтому порог
 * подталкивается на шаг-другой вверх, пока сам `computeGain` не подтвердит его. Тест держит это
 * обещание на всех Поколениях и до 1e300: карточка не вправе назвать порог, на котором Престиж
 * ещё не платит обещанного.
 */
function boostShortfallFor(state: GameState, boostGain: number): number {
  const divisor = prestigeDivisor(state.generation);
  // Класс риска множит корень (`computeGain`), поэтому порог для g — корень g / m, а не g.
  const mult = challengeComputeMult(state);
  let needed = Math.pow(boostGain / mult, 3) * divisor;
  const shortfallOf = (n: number): number => Math.max(0, n - state.runTokens);
  for (let i = 0; i < 8; i++) {
    if (computeGain(state.runTokens + shortfallOf(needed), state.generation, mult) >= boostGain) break;
    needed *= 1 + 4 * Number.EPSILON;
  }
  return shortfallOf(needed);
}

export function prestigeForecast(state: GameState): PrestigeForecast {
  const gain = prestigeGain(state);
  const boostGain = Math.max(gain + 1, Math.ceil(gain * (1 + BOOST_SHARE)));
  return {
    gain,
    boostGain,
    boostShortfall: boostShortfallFor(state, boostGain),
    ready: canPrestige(state),
    finale: isContentFinale(state),
  };
}

/** Строка списка «сбросится / останется» и поля `GameState`, которые она обещает. */
export interface PrestigeEffect {
  label: string;
  /** Поля состояния: тест сверяет их с настоящим переходом, поэтому список не может соврать. */
  fields: readonly (keyof GameState)[];
}

export const PRESTIGE_RESETS: readonly PrestigeEffect[] = [
  { label: 'Токены Забега', fields: ['tokens', 'runTokens', 'runClicks'] },
  { label: 'Агенты', fields: ['agents'] },
  { label: 'Апгрейды', fields: ['upgrades'] },
  { label: 'Взятые Испытания Забега (Престиж закрывает их и платит за них Compute)', fields: ['activeChallenges'] },
  { label: 'Предложение Курса и выбор (выбранный Курс начнёт следующий Забег)', fields: ['courseOffer', 'courseNext'] },
  { label: 'Идущее Событие и цепочка пойманных', fields: ['event', 'eventCaughtAt', 'nextEventAt', 'combo'] },
  { label: 'Временное усиление Исследования (окно принадлежит Забегу)', fields: ['researchBoostUntil'] },
];

export const PRESTIGE_KEEPS: readonly PrestigeEffect[] = [
  { label: 'Compute и купленные Перки', fields: ['computeSpent', 'perks'] },
  { label: 'Награда Испытаний, закрытых раньше (+10% к Доходу за каждое)', fields: ['challengesInherited'] },
  { label: 'Достижения и Датасет', fields: ['achievements'] },
  { label: 'Compute-кристаллы и ускорители', fields: ['crystals', 'crystalPlantedAt', 'crystalUpgrades'] },
  { label: 'Исследования в слотах: срок и часы закладки', fields: ['research'] },
  { label: 'Вехи', fields: ['milestones'] },
  { label: 'Переписка', fields: ['quipsSeen'] },
  { label: 'Температура', fields: ['temp', 'heat', 'overheatedAt'] },
  {
    label: 'Откупы и Глюки',
    fields: ['uprising', 'pledgeUntil', 'pledgeBought', 'covenant', 'glitches', 'glitchSeq', 'nextGlitchAt'],
  },
];

/**
 * Поля, которых карточка не называет: счётчики и часы, которые переход двигает или оставляет по
 * своим причинам. Они здесь, чтобы тест видел каждое поле `GameState` ровно в одном списке: новое
 * поле, которого нет ни в одном, красит тест и просит решить, что с ним делает Престиж.
 */
export const PRESTIGE_BOOKKEEPING: readonly (keyof GameState)[] = [
  'version',
  'generation',
  'maxGeneration',
  'totalTokens',
  'clicks',
  'compute',
  'prestiges',
  // Отметка «сброс дерева Перков использован» снимается Престижем: сброс снова доступен.
  'perkResetUsed',
  // Очередь закупок сгорает вместе с Агентами, которых ставила: отдельной строки в карточке у неё нет.
  'purchaseQueue',
  // Ряд покупок «Дефицита GPU» и размышление «Подумай ещё» живут в своём Поколении и обнуляются Престижем:
  // карточке нечего о них сказать, пока игрок не в этом Правиле.
  'buyStreak',
  'lastBuyAt',
  'thought',
  'thoughtAt',
  // Курс Забега не сбрасывается в пустоту, а заменяется выбранным из предложения: карточка называет это
  // строкой про предложение выше.
  'course',
  'challengesDone',
  'catchUpPaid',
  'eventsSeen',
  'lastTick',
  'startedAt',
  'runStartedAt',
  'settings',
];
