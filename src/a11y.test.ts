import { describe, expect, it } from 'vitest';
import {
  PRESTIGE_READY_TEXT,
  freshToasts,
  nextTabIndex,
  UPRISING_TEXT,
  prestigeReadyAnnouncement,
  uprisingAnnouncement,
  toastAnnouncement,
} from './a11y';
import type { ToastMessage } from './store/useGameStore';

const toast = (id: string, over: Partial<ToastMessage> = {}): ToastMessage => ({
  id,
  title: 'Достижение разблокировано!',
  name: 'Первый Клик',
  desc: 'Отправь первый промпт',
  ...over,
});

describe('стрелки на ряду вкладок', () => {
  it('moves right and left and wraps at both ends', () => {
    expect(nextTabIndex('ArrowRight', 0, 3)).toBe(1);
    expect(nextTabIndex('ArrowRight', 2, 3)).toBe(0);
    expect(nextTabIndex('ArrowLeft', 1, 3)).toBe(0);
    expect(nextTabIndex('ArrowLeft', 0, 3)).toBe(2);
  });

  it('jumps to the first and the last tab with Home and End', () => {
    expect(nextTabIndex('Home', 2, 3)).toBe(0);
    expect(nextTabIndex('End', 0, 3)).toBe(2);
  });

  it('ignores keys that are not tab navigation and a row with one tab', () => {
    expect(nextTabIndex('Enter', 0, 3)).toBeNull();
    expect(nextTabIndex('a', 1, 3)).toBeNull();
    // Вертикальные стрелки остаются прокрутке страницы: ряд вкладок горизонтальный.
    expect(nextTabIndex('ArrowDown', 0, 3)).toBeNull();
    expect(nextTabIndex('ArrowUp', 0, 3)).toBeNull();
    expect(nextTabIndex('ArrowRight', 0, 1)).toBeNull();
    expect(nextTabIndex('ArrowRight', 0, 0)).toBeNull();
  });
});

describe('что озвучивает тост', () => {
  it('reads title, name and description as sentences', () => {
    expect(toastAnnouncement(toast('a'))).toBe('Достижение разблокировано! Первый Клик. Отправь первый промпт.');
  });

  it('reads a batch toast with no description without a dangling dot', () => {
    expect(toastAnnouncement(toast('b', { title: '+3 Достижения', desc: '' }))).toBe('+3 Достижения Первый Клик.');
  });
});

describe('какие тосты ещё не озвучены', () => {
  it('returns only the toasts whose id has not been seen', () => {
    const seen = new Set(['a']);
    expect(freshToasts(seen, [toast('a'), toast('b')]).map((t) => t.id)).toEqual(['b']);
  });

  it('returns nothing when the stack is unchanged or empty', () => {
    expect(freshToasts(new Set(['a']), [toast('a')])).toEqual([]);
    expect(freshToasts(new Set(), [])).toEqual([]);
  });
});

describe('Престиж готов', () => {
  it('announces only the moment the Флагман is hired, not every tick afterwards', () => {
    expect(prestigeReadyAnnouncement(false, true, false)).toBe(PRESTIGE_READY_TEXT);
    expect(prestigeReadyAnnouncement(true, true, false)).toBeNull();
    expect(prestigeReadyAnnouncement(true, false, false)).toBeNull();
    expect(prestigeReadyAnnouncement(false, false, false)).toBeNull();
  });

  it('stays silent at the content finale, where Престиж is gone for good', () => {
    expect(prestigeReadyAnnouncement(false, true, true)).toBeNull();
  });});

describe('Восстание моделей', () => {
  it('announces the start and each later stage, not every tick afterwards', () => {
    expect(uprisingAnnouncement(0, 1)).toBe(UPRISING_TEXT);
    expect(uprisingAnnouncement(1, 2)).toBe(UPRISING_TEXT);
    expect(uprisingAnnouncement(2, 2)).toBeNull();
  });

  it('stays silent when the stage falls back after a Престиж', () => {
    expect(uprisingAnnouncement(3, 0)).toBeNull();
  });
});
