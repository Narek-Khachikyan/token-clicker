/**
 * Куда смотрит стрелка подсказки новичка. Шаг подсказки — дело экономики (`economy/onboarding.ts`),
 * а элемент экрана, на который она указывает, — дело интерфейса: поэтому функция живёт здесь и
 * знает вкладки стора, а экономика про них не знает.
 */

import { coachStep, STEP_FIRST_AGENT, STEP_FIRST_CLICK } from './economy/onboarding';
import type { GameState } from './economy/state';
import type { ActiveTab } from './store/useGameStore';

/** Элемент экрана, на который указывает стрелка подсказки. */
export type CoachTarget = 'click-button' | 'tab-click' | 'tab-shop' | 'first-model' | 'tab-upgrades';

/** Что видит игрок: одна колонка (телефон) или три, и какой экран открыт. */
export interface CoachView {
  single: boolean;
  tab: ActiveTab;
}

const SHOP_SCREENS: readonly ActiveTab[] = ['shop', 'upgrades', 'prestige'];

/**
 * На десктопе все три колонки на виду, и стрелка стоит на самом элементе. На телефоне видна
 * одна колонка: если нужный элемент на другом экране, стрелка указывает на нижнюю вкладку,
 * которая к нему ведёт, — иначе она показывала бы на то, чего на экране нет.
 */
export function coachTarget(state: GameState, view: CoachView): CoachTarget | null {
  const step = coachStep(state);
  if (!step) return null;

  const onClick = !view.single || view.tab === 'click';
  const onShop = !view.single || SHOP_SCREENS.includes(view.tab);

  switch (step.id) {
    case STEP_FIRST_CLICK.id:
      return onClick ? 'click-button' : 'tab-click';
    case STEP_FIRST_AGENT.id:
      return onShop ? 'first-model' : 'tab-shop';
    default:
      // Вкладка «Апгрейды» открыта первым Агентом (reveal.ts): шаг идёт только после него.
      return onShop ? 'tab-upgrades' : 'tab-shop';
  }
}
