import { describe, expect, it } from 'vitest';
import { buyAmountFor, HOTKEY_HELP, hotkeyCommand, type KeyPress } from './hotkeys';

const press = (key: string, mods: Partial<KeyPress> = {}): KeyPress => ({
  key,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  repeat: false,
  ...mods,
});

describe('какое действие несёт нажатая клавиша', () => {
  it('maps 1, 2 and 3 to the three tabs of the shop', () => {
    expect(hotkeyCommand(press('1'))).toEqual({ kind: 'shopTab', tab: 'models' });
    expect(hotkeyCommand(press('2'))).toEqual({ kind: 'shopTab', tab: 'upgrades' });
    expect(hotkeyCommand(press('3'))).toEqual({ kind: 'shopTab', tab: 'prestige' });
  });

  it('maps ? to the key card, with the Shift it is typed with', () => {
    expect(hotkeyCommand(press('?', { shiftKey: true }))).toEqual({ kind: 'help' });
    expect(hotkeyCommand(press('?'))).toEqual({ kind: 'help' });
  });

  it('leaves browser shortcuts alone: Ctrl/Cmd/Alt + digit is not a tab of the shop', () => {
    expect(hotkeyCommand(press('1', { ctrlKey: true }))).toBeNull();
    expect(hotkeyCommand(press('2', { metaKey: true }))).toBeNull();
    expect(hotkeyCommand(press('3', { altKey: true }))).toBeNull();
    expect(hotkeyCommand(press('?', { ctrlKey: true }))).toBeNull();
  });

  it('ignores keys that are not hotkeys, key repeat, and Shift + digit', () => {
    expect(hotkeyCommand(press('4'))).toBeNull();
    expect(hotkeyCommand(press('a'))).toBeNull();
    expect(hotkeyCommand(press(' '))).toBeNull();
    expect(hotkeyCommand(press('!', { shiftKey: true }))).toBeNull();
    expect(hotkeyCommand(press('1', { repeat: true }))).toBeNull();
    expect(hotkeyCommand(press('?', { repeat: true }))).toBeNull();
  });
});

describe('сколько Агентов берёт покупка с модификатором', () => {
  const mods = (m: Partial<Record<'shiftKey' | 'ctrlKey' | 'metaKey', boolean>>) => ({
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    ...m,
  });

  it('keeps the chosen amount with no modifier', () => {
    for (const base of [1, 10, 100, 'max'] as const) expect(buyAmountFor(base, mods({}), false)).toBe(base);
  });

  it('Shift buys ×10 and Ctrl or Cmd buys Max, whatever the chosen amount is', () => {
    for (const base of [1, 10, 100, 'max'] as const) {
      expect(buyAmountFor(base, mods({ shiftKey: true }), false)).toBe(10);
      expect(buyAmountFor(base, mods({ ctrlKey: true }), false)).toBe('max');
      expect(buyAmountFor(base, mods({ metaKey: true }), false)).toBe('max');
    }
  });

  it('Max wins when Shift is held together with Ctrl or Cmd', () => {
    expect(buyAmountFor(1, mods({ shiftKey: true, ctrlKey: true }), false)).toBe('max');
    expect(buyAmountFor(1, mods({ shiftKey: true, metaKey: true }), false)).toBe('max');
  });

  it('a sale ignores the modifiers: a stray Ctrl-click never sells every Агент at once', () => {
    for (const base of [1, 10, 100, 'max'] as const) {
      for (const m of [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }]) {
        expect(buyAmountFor(base, mods(m), true)).toBe(base);
      }
    }
  });
});

describe('карточка «?»', () => {
  it('describes every key the keymap answers to', () => {
    const described = new Set(HOTKEY_HELP.flatMap((row) => row.keys));
    for (const k of ['1', '2', '3', '?', 'Пробел', 'Enter', 'Shift', 'Ctrl', 'Cmd']) {
      expect(described.has(k)).toBe(true);
    }
  });
});
