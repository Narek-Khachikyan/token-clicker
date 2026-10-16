/**
 * Горячие клавиши: какая клавиша какое действие несёт. Чистые функции над описанием нажатия —
 * DOM-событие сюда не приходит, поэтому правило проверяется в node. Решение «можно ли сейчас»
 * (поле ввода, открытое окно) принимает не этот модуль, а `holdClickKeys.ts`: охранник у обеих
 * групп клавиш один. Само действие — `runHotkey` в сторе.
 *
 * Пробел/Enter (Клик) и Ctrl + ←/→ (Температура) здесь не живут: первое — слушатель `ClickColumn`
 * с потолком в секунду, второе — клавиатура шкалы `ThermalDial`. Карточка «?» описывает все.
 */

import type { BuyAmount, ShopTab } from './store/useGameStore';

/** Нажатие в том виде, в каком его читает keymap: ровно поля `KeyboardEvent`, которые нужны. */
export interface KeyPress {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  /** Автоповтор удержанной клавиши: вкладка и карточка срабатывают на нажатие, а не на удержание. */
  repeat: boolean;
}

export type HotkeyCommand = { kind: 'shopTab'; tab: ShopTab } | { kind: 'help' };

const SHOP_TAB_KEYS: Record<string, ShopTab> = { '1': 'models', '2': 'upgrades', '3': 'perks' };

/**
 * Действие для нажатия или null, если клавиша ничего не значит.
 *
 * Ctrl/Cmd/Alt отдают клавишу браузеру и системе (Ctrl+1 переключает вкладку браузера), поэтому
 * с ними цифры молчат. Shift нужен только знаку «?», который им и набирается; Shift + цифра
 * («!», «@») не вкладка. Раскладку не угадываем: читаем `key`, а не `code`, и «?» набирается
 * одинаково и на русской раскладке (Shift+7), и на английской (Shift+/).
 */
export function hotkeyCommand(e: KeyPress): HotkeyCommand | null {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.key === '?') return { kind: 'help' };
  if (e.shiftKey) return null;
  const tab = SHOP_TAB_KEYS[e.key];
  return tab ? { kind: 'shopTab', tab } : null;
}

/**
 * Сколько Агентов берёт эта покупка. Ctrl или Cmd — Max, Shift — ×10, иначе то, что выбрано
 * кнопками ×1/×10/×100/Max. Max сильнее Shift: пара «Shift + Ctrl» не должна молча уменьшать
 * покупку.
 */
export function buyAmountFor(
  chosen: BuyAmount,
  mods: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
): BuyAmount {
  if (mods.ctrlKey || mods.metaKey) return 'max';
  if (mods.shiftKey) return 10;
  return chosen;
}

/** Строка карточки «?»: клавиши (каждая — своя «кнопка»), как их соединять, и что они делают. */
export interface HotkeyHelpRow {
  keys: string[];
  /** «или» — любая из клавиш, «+» — вместе. */
  sep: 'или' | '+';
  what: string;
}

/**
 * Всё, что умеет клавиатура. Тест сверяет, что каждая клавиша keymap здесь названа: молчаливая
 * горячая клавиша, которой нет в карточке, была бы той самой справкой, которую не прочесть.
 */
export const HOTKEY_HELP: readonly HotkeyHelpRow[] = [
  { keys: ['Пробел', 'Enter'], sep: 'или', what: 'Клик. Удерживай — Клики повторяются, до десяти в секунду.' },
  { keys: ['1', '2', '3'], sep: 'или', what: 'Вкладки магазина: Модели, Апгрейды, Престиж.' },
  { keys: ['Shift'], sep: '+', what: '+ нажатие на «Купить» (или «Продать») — сразу ×10.' },
  { keys: ['Ctrl', 'Cmd'], sep: 'или', what: '+ нажатие на «Купить» (или «Продать») — сразу Max.' },
  { keys: ['Ctrl', '←', '→'], sep: '+', what: 'Температура, когда шкала в фокусе. С Shift — крупный шаг.' },
  { keys: ['?'], sep: 'или', what: 'Эта карточка.' },
  { keys: ['Esc'], sep: 'или', what: 'Закрыть окно.' },
];
