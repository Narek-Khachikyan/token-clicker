import React from 'react';

/**
 * Голое число внутри строки.
 *
 * Шрифт оно не выбирает (ADR-0009): на пиксельной ступени (`pixel-22/33/44`) число стоит в
 * Departure Mono вместе со словами рядом, в обычном тексте — в Nunito. Раньше число было
 * пиксельным, а слово Nunito, потому что в Pixelify Sans нет букв «О» и «П»; Departure Mono
 * покрывает обе части, и строку больше не нужно разбирать на два узла по шрифтам. Примитив
 * остался ради табличных цифр (`.num`) и микро-отклика.
 *
 * `bump` — тактильный микро-отклик на смену значения (.num-bump), а при reducedMotion только
 * opacity-всплеск. Он ВЫКЛЮЧЕН по умолчанию и включается только там, где значение меняется
 * редко: тик идёт 20 раз в секунду, любое число, завязанное на кошелёк («не хватает N»
 * меняется на каждом тике), при пересоздании узла по key дёргалось бы непрерывно. Отклик
 * должен быть событием, а не фоном.
 */
export const Num: React.FC<{ children: React.ReactNode; className?: string; bump?: boolean }> = ({
  children,
  className,
  bump = false,
}) => {
  const textKey =
    bump && (typeof children === 'string' || typeof children === 'number')
      ? String(children)
      : undefined;

  return (
    <span
      key={textKey}
      className={`num${bump ? ' num-bump' : ''}${className ? ` ${className}` : ''}`}
    >
      {children}
    </span>
  );
};
