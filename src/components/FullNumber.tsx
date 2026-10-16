import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { formatFull } from '../economy/format';
import type { GameState } from '../economy/state';
import { Hint } from './Hint';

/**
 * Полная запись сокращённого числа при наведении (на тач — по нажатию вне кнопок).
 *
 * «4,67 Sx» прячет порядок, и игрок, который хочет понять масштаб, наводит на число. Число
 * приходит либо готовым (`value`), либо функцией от состояния (`read`): счётчик Токенов и Доход
 * не перерисовываются от тика, и подсказка узнаёт актуальное значение сама — в момент
 * наведения, а пока открыта, следит за ним подпиской. Меньше тысячи число напечатано как есть,
 * и подсказка молчит.
 *
 * Фокуса у числа нет: оно не орган управления, и двадцать лишних остановок Tab в магазине хуже
 * подсказки. Карточка Модели открывается по фокусу, а скринридер читает число в его печатной
 * записи.
 */

/** Число, с которого запись сокращается: ниже него короткая запись и полная совпадают. */
const ABBREVIATED_FROM = 1000;

type Source = number | ((s: GameState) => number);

const valueOf = (source: Source): number =>
  typeof source === 'number' ? source : source(useGameStore.getState().state);

const FullBody: React.FC<{ source: Source }> = ({ source }) => {
  // Подписка на примитив: перерисовка — только когда сама величина изменилась.
  const live = useGameStore((s) => (typeof source === 'number' ? source : source(s.state)));
  return <span className="num hint-pop__number">{formatFull(live)}</span>;
};

export const FullNumber: React.FC<{
  value: Source;
  children: React.ReactNode;
  /** Цель — блок на всю ширину (счётчик) или строчный узел внутри строки. */
  as?: 'div' | 'span';
  style?: React.CSSProperties;
}> = ({ value, children, as = 'span', style }) => (
  <Hint
    as={as}
    variant="text"
    style={style}
    canOpen={() => Math.abs(valueOf(value)) >= ABBREVIATED_FROM}
    content={<FullBody source={value} />}
  >
    {children}
  </Hint>
);
