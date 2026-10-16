import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { coachTarget, type CoachTarget } from '../economy/onboarding';
import { Icon } from './Icon';

/** Сторона, куда смотрит стрелка: поворот пиксельной стрелки на 90° остаётся на сетке. */
export type ArrowDir = 'down' | 'up' | 'left' | 'right';

/**
 * Стрелка подсказки новичку у элемента, о котором говорит подсказка (coachStep).
 *
 * Стоит там, куда указывает, а не в карточке подсказки: на десктопе карточка в левой колонке, а
 * первая Модель — в правой, и стрелка из карточки показывала бы через весь экран. Какой элемент
 * сейчас цель, решает чистая функция `coachTarget`; здесь только отметка. `single` — режим одной
 * колонки: на телефоне цель может лежать на другом экране, и тогда стрелка встаёт на нижнюю
 * вкладку, которая к ней ведёт.
 *
 * Родитель обязан быть `position: relative`: стрелка абсолютная и клики не перехватывает. Узел
 * снаружи кнопки — у `.pixel-btn` стоит clip-path, ребёнок кнопки обрезался бы по её контуру.
 */
export const CoachArrow: React.FC<{
  target: CoachTarget;
  single: boolean;
  dir?: ArrowDir;
}> = ({ target, single, dir = 'down' }) => {
  // Подписка на строку-цель, а не на состояние: тик её не меняет, и стрелка не перерисовывается.
  const current = useGameStore((s) => coachTarget(s.state, { single, tab: s.activeTab }));
  if (current !== target) return null;

  return (
    <span className={`coach-arrow coach-arrow--${dir}`} aria-hidden="true">
      <span className="coach-arrow__glyph">
        <Icon name="arrow" size={24} />
      </span>
    </span>
  );
};
