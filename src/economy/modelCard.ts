import type { Model } from './catalog';
import {
  bulkCost,
  discountMult,
  incomeGain,
  modelFactors,
  modelIncome,
  purchaseQuote,
  totalIncome,
  type IncomeFactorKind,
} from './engine';
import type { GameState } from './state';
import { surgeMultFor } from './events';
import { thermalRead } from './thermal';

/**
 * Сводка Модели для карточки в магазине: из чего складывается её Доход, за сколько секунд
 * окупается следующий Агент, через сколько Модель станет доступна и что купят ×10, ×100 и Max.
 *
 * Всё здесь — вопросы к движку, а не свои формулы: разбивку отдаёт тот же `modelMultiplier`,
 * из которого платит тик, цены и число Агентов — тот же `purchaseQuote`, что у `buyAgents`, а
 * прирост Дохода — тот же `incomeGain`, что стоит в строке «к доходу» на карточке. Карточка не
 * может разойтись с экономикой, потому что экономика ей и отвечает.
 *
 * Метки «выгоднее всего» нет намеренно: окупаемость выровнена по Рангу (ADR-0001), и метка
 * прыгала бы от Модели к Модели.
 */

/** Потолок «доступно через»: дальше суток срок перестаёт быть ответом и читается как «никогда». */
export const AVAILABLE_CAP_SEC = 24 * 3600;

/** Множители карточки, которые строка разбивки показывает, а не прячет единицей. */
export type BreakdownKind = 'base' | 'agents' | IncomeFactorKind;

export interface BreakdownRow {
  kind: BreakdownKind;
  /** Токены в секунду для `base` (Доход одного Агента без множителей), число для `agents`, множитель для остальных. */
  value: number;
}

export type Availability =
  /** Следующий Агент по карману уже сейчас. */
  | { kind: 'now' }
  /** Накопится при текущем Доходе через столько секунд. */
  | { kind: 'wait'; seconds: number }
  /** Дохода нет или ждать дольше `AVAILABLE_CAP_SEC`. */
  | { kind: 'long' };

export type BulkAmount = 10 | 100 | 'max';

export interface BulkQuote {
  amount: BulkAmount;
  /** Сколько Агентов купит кнопка с этим множителем (для Max — сколько позволяет кошелёк). */
  count: number;
  /** Сколько спишет покупка. Для ×10 и ×100 — цена желаемого, даже когда кошелёк пуст. */
  cost: number;
  /** Покупка пройдёт прямо сейчас. */
  affordable: boolean;
}

export interface ModelCardSummary {
  /** Разбивка Дохода Модели; произведение значений равно `income`. Множители, равные единице, опущены. */
  rows: BreakdownRow[];
  /** Доход Модели: то, что платит она в тике до Температуры, События на всех и Глюков; равен `modelIncome`. */
  income: number;
  /** Доход одного Агента при тех же множителях: нужен, пока Агентов ещё нет и `income` равен нулю. */
  perAgent: number;
  /** Множитель Температуры сейчас: на Доход всех Моделей сразу, поэтому не строка произведения. */
  thermalMult: number;
  /** Секунд до возврата цены следующего Агента; null, пока он Дохода не прибавляет. */
  paybackSec: number | null;
  availability: Availability;
  bulk: BulkQuote[];
}

const BULK_AMOUNTS: readonly BulkAmount[] = [10, 100, 'max'];

/**
 * Склеивает шаги умножения одного вида в строку: пять Апгрейдов Модели — одна строка «×32», а не
 * пять «×2». Единица молчит: Перк, которого нет, не повод занимать строку.
 */
function groupFactors(steps: { kind: IncomeFactorKind; mult: number }[]): BreakdownRow[] {
  const byKind = new Map<IncomeFactorKind, number>();
  for (const { kind, mult } of steps) byKind.set(kind, (byKind.get(kind) ?? 1) * mult);
  return [...byKind].filter(([, mult]) => mult !== 1).map(([kind, value]) => ({ kind, value }));
}

export function availabilityOf(state: GameState, cost: number, income: number): Availability {
  if (state.tokens >= cost) return { kind: 'now' };
  if (!(income > 0)) return { kind: 'long' };
  const seconds = (cost - state.tokens) / income;
  return seconds > AVAILABLE_CAP_SEC ? { kind: 'long' } : { kind: 'wait', seconds };
}

export function modelCardSummary(state: GameState, model: Model, now: number = state.lastTick): ModelCardSummary {
  const owned = state.agents[model.id] ?? 0;
  const steps = modelFactors(state, model);
  const rows: BreakdownRow[] = [
    { kind: 'base', value: model.baseIncome },
    { kind: 'agents', value: owned },
    ...groupFactors(steps),
  ];

  // Прорыв — множитель этой Модели на время События, поэтому он в произведении; Температура,
  // Событие на всех и Глюки стоят над суммой всех Моделей и в произведение одной не входят.
  const surge = surgeMultFor(state, model.id, now);
  if (surge !== 1) rows.push({ kind: 'surge', value: surge });

  // `perAgent` — произведение строк разбивки без числа Агентов: пока Агентов нет, Доход Модели равен
  // нулю, а это число говорит, чего ждать от первого.
  let perAgent = 1;
  for (const { kind, value } of rows) if (kind !== 'agents') perAgent *= value;

  const discount = discountMult(state);
  const nextCost = bulkCost(model, owned, 1, discount);
  const income = modelIncome(state, model, now);
  const gain = incomeGain(state, model.id, 1, now);

  return {
    rows,
    income,
    perAgent,
    thermalMult: thermalRead(state, now).mult,
    paybackSec: gain > 0 ? nextCost / gain : null,
    availability: availabilityOf(state, nextCost, totalIncome(state, now)),
    bulk: BULK_AMOUNTS.map((amount) => {
      const { count, cost } = purchaseQuote(state, model, amount);
      return { amount, count, cost, affordable: count > 0 && cost <= state.tokens };
    }),
  };
}
