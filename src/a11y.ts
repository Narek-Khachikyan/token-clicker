import type { ToastMessage } from './store/useGameStore';

/**
 * Что скринридер узнаёт, не глядя на экран: куда ведут стрелки на ряду вкладок и что стоит
 * озвучить. Всё чистое, без React и DOM, — компоненты только вызывают.
 */

/**
 * Куда уходит фокус ряда вкладок по клавише. Ряд горизонтальный: влево и вправо по кругу, Home и
 * End — на края; вертикальные стрелки не трогаем, они прокручивают страницу. `null` — клавиша не
 * про вкладки (или вкладка одна, и идти некуда).
 */
export function nextTabIndex(key: string, index: number, count: number): number | null {
  if (count < 2) return null;
  switch (key) {
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/** Тост — это Достижение; озвучивается теми же словами, что и на карточке, предложениями. */
export function toastAnnouncement(toast: ToastMessage): string {
  const parts = [toast.title, `${toast.name}.`];
  if (toast.desc) parts.push(`${toast.desc}.`);
  return parts.join(' ');
}

/** Тосты, которых озвучка ещё не видела: опознаются по id, потому что стек урезается и сдвигается. */
export function freshToasts(seen: ReadonlySet<string>, toasts: readonly ToastMessage[]): ToastMessage[] {
  return toasts.filter((t) => !seen.has(t.id));
}

export const PRESTIGE_READY_TEXT = 'Престиж готов: Флагман нанят, можно перейти в следующее Поколение.';

/**
 * Озвучивается переход «Престиж стал доступен», а не само состояние: тик двадцать раз в секунду
 * подтверждает, что оно держится, и повторять его — шум. На финале контента Престиж недоступен
 * навсегда, поэтому там тишина.
 */
export function prestigeReadyAnnouncement(wasReady: boolean, ready: boolean, finale: boolean): string | null {
  return ready && !wasReady && !finale ? PRESTIGE_READY_TEXT : null;
}
