import { NO_INSETS, type SafeInsets } from '../layout';

/**
 * Небезопасные края окна в пикселях: вырез, скруглённые углы, полоса жестов.
 *
 * CSS держит их в `--safe-*` (`env(safe-area-inset-*)` на корне), но в JS тот же `env()` числом не
 * выдаётся, а кастомное свойство читается строкой «env(…)». Поэтому в корне стоит невидимый зонд
 * `.safe-probe` с отступами из этих переменных, и его вычисленный отступ — уже пиксели. Нужен
 * тем, кто ставит что-то по координатам окна (подсказка), а не вёрсткой внутри полос.
 */
export function readSafeInsets(): SafeInsets {
  if (typeof document === 'undefined') return NO_INSETS;
  const probe = document.querySelector('.safe-probe');
  if (!probe) return NO_INSETS;
  const style = getComputedStyle(probe);
  const px = (v: string): number => Number.parseFloat(v) || 0;
  return {
    top: px(style.paddingTop),
    right: px(style.paddingRight),
    bottom: px(style.paddingBottom),
    left: px(style.paddingLeft),
  };
}
