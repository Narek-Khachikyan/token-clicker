/**
 * Ворота Исследований (ТЗ #118): Курс и Испытание с `gated` входят в свой пул и в список взятых только после
 * того, как их id лежит в `researchUnlocks`. Открытие переживает Престиж, поэтому раз открытое остаётся открытым.
 *
 * Одно правило для обоих видов: и Курсы (`coursePool`), и Испытания (`challengePool`, `toggleChallenge`,
 * разбор сохранения) читают его отсюда. Модуль без импортов, чтобы `challenges.ts` и `course.ts` не
 * тянули друг друга через `research.ts`, а тот импортирует оба.
 */
export const openedByResearch = (entry: { id: string; gated?: true }, researchUnlocks: readonly string[]): boolean =>
  !entry.gated || researchUnlocks.includes(entry.id);
