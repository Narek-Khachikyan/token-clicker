import { MODEL_BY_ID } from './catalog';
import { FINETUNE_QUIPS, type FinetuneQuip } from '../data/finetuneQuips';
import type { FinetuneArchetype, GameState } from './state';

/**
 * ФАЙНТЮН (ТЗ #116): Заготовка Исследования, применённая к одной нанятой Модели текущего Забега.
 *
 * Архетип — решение о Температуре, а не ещё один ×2. «Thinking» даёт Модели больше Дохода и греет
 * офис сильнее; «Turbo» режет её Доход и охлаждает. Поправка к жару складывается по всем Файнтюнам
 * офиса, поэтому безопасная Температура сдвигается состав за составом. Архетип одинаков на всех
 * Рангах: цена и Доход растут с Рангом как раньше, и полоса окупаемости 3× держится (`finetuneLadder.test.ts`).
 *
 * Файнтюн живёт в состоянии Забега (`finetunes`) и сгорает с Престижем вместе с Агентами. Заготовка
 * (`finetuneStock`) переживает Престиж. Множитель Дохода постоянный, как Апгрейд Модели, поэтому
 * входит и в оффлайн-доход, а поправка жара — минутный эффект, как и сама Температура.
 */
export const FINETUNE_ARCHETYPES: readonly FinetuneArchetype[] = ['thinking', 'turbo'];

export interface FinetuneSpec {
  /** Слово в имени Модели: «Claude Sonnet 4.5 Thinking». */
  label: string;
  /** Множитель Дохода этой Модели; умножается вместе с её Апгрейдами. */
  incomeMult: number;
  /** Сдвиг множителя скорости перегрева офиса за эту Модель: +0,2 — жар копится быстрее. */
  heatDelta: number;
}

/**
 * Числа архетипов. Доход Модели ограничен полосой окупаемости 3× (AGENTS.md, правило 3): Файнтюн на самой
 * дешёвой по окупаемости Модели сокращает её окупаемость в `incomeMult` раз, и полоса ломается, как только
 * это множитель больше `3 / (самая широкая полоса каталога)`. Самое тесное Поколение (шестое, полоса 2,71×)
 * держит поправку лишь около ±8–9%; `finetuneLadder.test.ts` проверяет каждую Модель по отдельности. Поэтому
 * Доход Файнтюна мал, а весомый рычаг — жар: он в окупаемость не входит, и его можно двигать свободно.
 */
export const FINETUNE_SPEC: Record<FinetuneArchetype, FinetuneSpec> = {
  thinking: { label: 'Thinking', incomeMult: 1.08, heatDelta: 0.2 },
  turbo: { label: 'Turbo', incomeMult: 0.92, heatDelta: -0.2 },
};

/**
 * Пол множителя скорости перегрева офиса. Turbo охлаждает до этой доли и не дальше: без пола
 * пять-шесть Turbo обнуляли бы перегрев, и шкала перестала бы быть шкалой.
 */
export const FINETUNE_HEAT_FLOOR = 0.5;

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Архетип Файнтюна Модели или `null`, если Модель его не получала. */
export function finetuneOf(state: Pick<GameState, 'finetunes'>, modelId: string): FinetuneArchetype | null {
  return hasOwn(state.finetunes, modelId) ? state.finetunes[modelId] : null;
}

/** Множитель Дохода Модели от её Файнтюна; единица, пока Файнтюна нет. */
export function finetuneIncomeMult(state: Pick<GameState, 'finetunes'>, modelId: string): number {
  const archetype = finetuneOf(state, modelId);
  return archetype ? FINETUNE_SPEC[archetype].incomeMult : 1;
}

/**
 * Множитель скорости перегрева офиса от всех Файнтюнов: единица плюс сумма поправок, но не ниже
 * `FINETUNE_HEAT_FLOOR`. Единица, когда Файнтюнов нет.
 */
export function finetuneHeatMult(state: Pick<GameState, 'finetunes'>): number {
  let sum = 1;
  for (const archetype of Object.values(state.finetunes)) sum += FINETUNE_SPEC[archetype].heatDelta;
  return Math.max(FINETUNE_HEAT_FLOOR, sum);
}

/**
 * Применить Заготовку к Модели. Нужны: Заготовка в запасе, Модель текущего Поколения, которую игрок
 * уже нанял, и у неё ещё нет Файнтюна. Иначе — тот же объект: переход ничего не сделал, и стор молчит.
 */
export function applyFinetune(state: GameState, modelId: string, archetype: FinetuneArchetype): GameState {
  if (!hasOwn(FINETUNE_SPEC, archetype)) return state;
  if (state.finetuneStock < 1) return state;
  if (finetuneOf(state, modelId) !== null) return state;
  if (!hasOwn(MODEL_BY_ID, modelId) || MODEL_BY_ID[modelId].generation !== state.generation) return state;
  if ((state.agents[modelId] ?? 0) < 1) return state;
  return {
    ...state,
    finetuneStock: state.finetuneStock - 1,
    finetunes: { ...state.finetunes, [modelId]: archetype },
  };
}

/** Имя Модели с архетипом: «Claude Sonnet 4.5 Thinking». Без Файнтюна — имя как есть. */
export function finetuneName(name: string, archetype: FinetuneArchetype | null): string {
  return archetype ? `${name} ${FINETUNE_SPEC[archetype].label}` : name;
}

/**
 * Реплика Модели о новом архетипе; `null`, если такого архетипа в таблице нет. Выбор — по `salt`
 * (отметка времени), как у реплик Характера, а не `Math.random`: тот же миг даёт ту же строку.
 * Экономики у строки нет, и в «Переписку» она не попадает.
 */
export function pickFinetuneQuip(archetype: FinetuneArchetype, salt: number): FinetuneQuip | null {
  const rows = FINETUNE_QUIPS.filter((q) => q.archetype === archetype);
  if (rows.length === 0) return null;
  return rows[Math.abs(Math.floor(salt)) % rows.length];
}
