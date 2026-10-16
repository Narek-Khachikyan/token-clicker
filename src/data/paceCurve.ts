/**
 * Целевая кривая темпа кампании (план `docs/plans/deepening.md`, слой 0).
 *
 * Одна таблица для всех, кто меряет темп: `tools/sim.ts` печатает против неё время каждого
 * Поколения, а дешёвая проверка в `npm test` читает отсюда же. Числа живут здесь, а не в коде
 * симулятора, чтобы правка кривой была правкой данных.
 *
 * `minutes` — сколько игровых минут жадная политика проводит в Поколении: от входа в него до
 * Престижа (у последнего — до покупки Флагмана, то есть до Финала контента). Первый Престиж
 * должен лечь в окно 30–45 минут, дальше Поколения растут к ~120 минутам, всего около 10 часов.
 * Выбрано без смещения вверх: 38 — середина окна первого Престижа, остальное — ровный рост
 * 45 → 120, дающий 608 минут. Подгонка баланса под кривую — задача следующих слоёв, не этой таблицы.
 */
export interface PaceTarget {
  /** Индекс Поколения, как в `CATALOG` и `GameState.generation`. */
  generation: number;
  minutes: number;
}

export const PACE_CURVE: readonly PaceTarget[] = [
  { generation: 0, minutes: 38 },
  { generation: 1, minutes: 45 },
  { generation: 2, minutes: 55 },
  { generation: 3, minutes: 65 },
  { generation: 4, minutes: 80 },
  { generation: 5, minutes: 95 },
  { generation: 6, minutes: 110 },
  { generation: 7, minutes: 120 },
];

/** Окно, в которое должен лечь первый Престиж, в минутах от начала игры. */
export const FIRST_PRESTIGE_WINDOW_MIN = { from: 30, to: 45 } as const;

/** Минут от начала кампании до Финала контента по кривой. */
export function paceTotalMinutes(): number {
  return PACE_CURVE.reduce((sum, p) => sum + p.minutes, 0);
}
