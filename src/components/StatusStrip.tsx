import React from 'react';
import { useStateSlice } from '../store/useGameStore';
import { thermalMiniView } from '../store/selectors';
import { STATUS_COUNTER_STEP } from '../layout';
import { Icon } from './Icon';
import { IncomeLine, TokenCounter } from './ClickColumn';
import { STATE_COLOR, STATE_ICON } from './ThermalDial';

/**
 * Мини-индикатор Температуры: значок и слово состояния справа от Токенов, шкала по нижнему краю
 * полосы. Только чтение: управляет Температурой большая шкала в причале вкладки Клика, а эта
 * полоса стоит на любой вкладке и отвечает на вопрос «горячо ли сейчас».
 *
 * Состояние названо словом и значком, а не цветом, как и у большой шкалы: четыре значка, четыре
 * слова, цвет только подкрепляет.
 */
const ThermalMini: React.FC = () => {
  const { state, stateLabel, pct } = useStateSlice(thermalMiniView);
  return (
    <span
      className="status-strip__thermal"
      style={{ color: STATE_COLOR[state] }}
      // Слово читает озвучка, а полоса над вкладками не меняется каждый тик: срез меняется
      // только со сменой слова и сдвигом шкалы.
      role="img"
      aria-label={`Температура: ${stateLabel}`}
    >
      <Icon name={STATE_ICON[state]} size={16} />
      <span className="status-strip__thermal-word">{stateLabel}</span>
      <span
        className="status-strip__gauge"
        // Ширина заливки — число, а не слово: полоса показывает положение, слово — состояние.
        style={{ ['--gauge-pct' as string]: `${pct}%` }}
      />
    </span>
  );
};

/**
 * Закреплённая полоса телефона: Токены, Доход и Температура на любой нижней вкладке.
 *
 * Стоит в оболочке над рабочей областью, а не в колонке, поэтому прокрутка вкладки её не уносит.
 * Класс `click-counter` оставлен намеренно: по нему стопка тостов находит низ счётчика и не
 * ложится на Токены и Доход, а на телефоне счётчик в колонке Клика не рисуется — полоса и есть
 * счётчик. Высота — `STATUS_STRIP_H` из модуля раскладки.
 */
export const StatusStrip: React.FC = () => (
  <div className="status-strip click-counter" role="group" aria-label="Токены, Доход и Температура">
    <div className="status-strip__row status-strip__tokens">
      {/* Подписи «Токенов» в полосе нет — места нет, — но озвучка не должна читать голое число. */}
      <span className="visually-hidden">Токенов</span>
      <TokenCounter step={STATUS_COUNTER_STEP} caption={false} />
    </div>
    <div className="status-strip__row status-strip__income">
      <IncomeLine compact />
    </div>
    <ThermalMini />
  </div>
);
