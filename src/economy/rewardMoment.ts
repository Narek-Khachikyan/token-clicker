import { CATALOG, MODEL_BY_ID } from './catalog';
import type { LabId } from '../data/labs';
import type { GameState } from './state';
import { labAgents } from './upgrades';

/**
 * Момент награды на Сцене: ступени лестницы «покупка < новая Лаборатория < Достижение <
 * Флагман < Престиж», которые покупка Агентов задаёт сама. Покупка без момента — это просто
 * покупка (прыжок Маскота); Достижение и Престиж объявляют свои каналы стора.
 */
export interface RewardMoment {
  /** Лаборатория купленной Модели: на её месте Сцена показывает отклик. */
  lab: LabId;
  /** Первый Агент Лаборатории в этом Поколении: Маскот входит на Сцену. */
  entry: boolean;
  /** Первый Агент Флагмана: праздник на Сцене и загорание кнопки Престижа. */
  flagship: boolean;
}

/**
 * Какой момент награды принесла покупка Агентов `modelId`: `before` и `after` — состояние до и
 * после неё. null — момента нет.
 *
 * Читается по переходу «было ноль — стало больше», а не по флагу: ни в сохранении, ни в
 * GameState для него нет места, и миграция не нужна. Покупка сразу пачкой (×10, Max) — один
 * момент, а не десять. Продажа, Престиж и импорт сюда не заходят: функцию зовёт только
 * покупка, поэтому загрузка сохранения не заставляет Маскотов входить заново.
 */
export function rewardMoment(before: GameState, after: GameState, modelId: string): RewardMoment | null {
  const model = MODEL_BY_ID[modelId];
  if (!model || after === before || model.generation !== after.generation) return null;
  const entry = labAgents(before, model.lab) === 0 && labAgents(after, model.lab) > 0;
  const flagship =
    modelId === CATALOG[after.generation].flagship.id &&
    (before.agents[modelId] ?? 0) === 0 &&
    (after.agents[modelId] ?? 0) >= 1;
  return entry || flagship ? { lab: model.lab, entry, flagship } : null;
}
