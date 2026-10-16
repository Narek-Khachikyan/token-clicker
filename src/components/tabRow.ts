import type React from 'react';
import { nextTabIndex } from '../a11y';

/**
 * Клавиши ряда вкладок (`role="tablist"`): стрелки, Home и End переносят фокус на соседнюю
 * вкладку и сразу выбирают её. Выбор следует за фокусом, потому что переключение вкладки здесь
 * мгновенное и ничего не стоит; вкладки при этом не лежат в порядке Tab все подряд — в него входит
 * только выбранная (`tabIndex` 0, остальные −1), а между вкладками ходят стрелки.
 *
 * Список вкладок читается из DOM ряда, а не из массива: часть вкладок появляется по ходу Забега
 * (Апгрейды, Престиж), и стрелки обязаны обходить ровно то, что сейчас на экране.
 */
export function onTabRowKeyDown(e: React.KeyboardEvent<HTMLElement>): void {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
  const from = tabs.indexOf(e.target as HTMLElement);
  if (from < 0) return;
  const to = nextTabIndex(e.key, from, tabs.length);
  if (to === null) return;
  e.preventDefault();
  tabs[to].focus();
  tabs[to].click();
}
