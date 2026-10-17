import { MODEL_BY_ID } from './catalog';
import { ruleEffect } from './rules';
import type { GameState } from './state';

/**
 * Очередь закупок Правила «Агенты сами» (ADR-0013, слой 3): чистые переходы над
 * `GameState.purchaseQueue`. Исполняет очередь не этот файл, а `advance` в `engine.ts`, и только
 * в живом тике: путь простоя (`applyOffline`) её не зовёт, поэтому очередь не обходит потолок
 * Оффлайн-дохода.
 *
 * Постановка и снятие живут отдельно от движка, чтобы не замыкать круг импортов: движку нужен
 * `rules.ts`, а этому файлу — только он и каталог.
 */

/** Сколько мест в очереди у действующего Правила; ноль вне «Агентов сами». */
export function queueCapacity(state: GameState): number {
  return ruleEffect(state, 'purchaseQueue')?.capacity ?? 0;
}

/**
 * Ставит в конец очереди одного Агента Модели. Отказ (тот же объект) вне Правила, при полной
 * очереди и для Модели не из текущего Поколения: id из повреждённого сохранения или чужого
 * экрана очередь не засоряет.
 */
export function queueAgent(state: GameState, modelId: string): GameState {
  const model = MODEL_BY_ID[modelId];
  if (!model || model.generation !== state.generation) return state;
  if (state.purchaseQueue.length >= queueCapacity(state)) return state;
  return { ...state, purchaseQueue: [...state.purchaseQueue, modelId] };
}

/** Снимает запись с номером `index`; чужой номер — тот же объект. */
export function unqueueAgent(state: GameState, index: number): GameState {
  if (!Number.isInteger(index) || index < 0 || index >= state.purchaseQueue.length) return state;
  return { ...state, purchaseQueue: state.purchaseQueue.filter((_, i) => i !== index) };
}

/** Снимает все записи; пустая очередь — тот же объект. */
export function clearQueue(state: GameState): GameState {
  return state.purchaseQueue.length === 0 ? state : { ...state, purchaseQueue: [] };
}
