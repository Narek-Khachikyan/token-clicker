/**
 * Решение «этот Пробел/Enter — Клик, а не нажатие чего-то другого». Чистая функция над
 * описанием цели события: DOM-узел сюда не приходит, поэтому правило проверяется в node.
 */

export interface HoldKeyTarget {
  /** `tagName` узла в любом регистре; пусто для document/window. */
  tag: string;
  /** `contenteditable` — поле ввода без тега input. */
  editable: boolean;
  /** Атрибут `role`, если он задан. */
  role: string | null;
  /** Это сама кнопка Клика: на ней Пробел и Enter и есть Клик. */
  isClickButton: boolean;
  /** Открыто ли модальное окно (в DOM есть `aria-modal="true"`). */
  dialogOpen: boolean;
}

const INTERACTIVE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A', 'SUMMARY', 'OPTION']);
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'tab', 'checkbox', 'switch', 'slider', 'menuitem', 'option', 'textbox', 'radio', 'combobox',
]);

/**
 * Может ли удержание Пробела/Enter стать Кликом при такой цели события.
 *
 * Нет — в поле ввода, на любом другом управляющем элементе (его собственное нажатие важнее) и
 * при открытом окне. Да — на пустом месте страницы и на самой кнопке Клика.
 */
export function holdClickAllowed(t: HoldKeyTarget): boolean {
  if (t.dialogOpen) return false;
  if (t.isClickButton) return true;
  if (t.editable) return false;
  if (INTERACTIVE_TAGS.has(t.tag.toUpperCase())) return false;
  if (t.role && INTERACTIVE_ROLES.has(t.role)) return false;
  return true;
}

/** Клавиша, которая повторяет Клик при удержании. */
export const isHoldKey = (e: { key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean }): boolean =>
  (e.key === ' ' || e.key === 'Enter') && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;
