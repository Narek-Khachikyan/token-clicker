import { CATALOG } from './catalog';
import { isUpgradeUnlocked, UPGRADES_BY_GEN } from './upgrades';
import type { GameState } from './state';

/**
 * Что из интерфейса открыто игроку.
 *
 * Выводится из прогресса, как `coachStep`, и нигде не хранится: ни поля в `GameState`, ни bump
 * `SAVE_VERSION`. Поэтому импорт позднего сохранения открывает ровно то, что открыл бы сам
 * Забег, а «открытое не прячется снова» держится не флагом, а тем, что каждый признак ниже
 * опирается на счётчик, который в Забеге только растёт (`runTokens`, купленные Апгрейды,
 * Достижения), или на факт, переживающий Престиж.
 *
 * Счётчик, Клик и Температура открыты с первой секунды и сюда не входят: это не вкладки.
 */
export interface OpenUi {
  /** Сколько Моделей с начала списка показывает магазин: список открывается сверху вниз. */
  models: number;
  /** Вкладка «Апгрейды» в магазине. */
  upgradesTab: boolean;
  /** Вкладка «Престиж» в магазине. */
  prestigeTab: boolean;
}

/**
 * Игрок уже проходил Престиж: механики знакомы, и новый Забег не прячет их заново.
 * Тот же признак, что у `coachDone`.
 */
export function hasPrestiged(state: GameState): boolean {
  return state.prestiges > 0 || state.generation > 0 || state.maxGeneration > 0;
}

export function openUi(state: GameState): OpenUi {
  const models = CATALOG[state.generation].models;

  if (hasPrestiged(state)) {
    return { models: models.length, upgradesTab: true, prestigeTab: true };
  }

  // Следующая Модель появляется, когда за Забег заработано на предыдущую: цель видна на один
  // шаг лестницы раньше, чем до неё можно дотянуться. `runTokens` не уменьшают ни покупки, ни
  // продажа, поэтому список не схлопывается. Уже нанятые Модели открыты всегда: импорт и
  // тесты могут дать Агентов при пустом счётчике Забега.
  let shown = 1;
  while (shown < models.length && state.runTokens >= models[shown - 1].baseCost) shown++;
  models.forEach((m, i) => {
    if ((state.agents[m.id] ?? 0) > 0) shown = Math.max(shown, i + 1);
  });

  // Первый Апгрейд («Fine-tuning») открывает первый нанятый Агент. «Первый Агент» — Достижение,
  // а Достижения не пропадают, поэтому продажа Агента вкладку не закрывает.
  const upgradesTab =
    state.upgrades.length > 0 ||
    state.achievements.includes('agents_1') ||
    UPGRADES_BY_GEN[state.generation].some((u) => isUpgradeUnlocked(state, u));

  return { models: shown, upgradesTab, prestigeTab: shown >= models.length };
}
