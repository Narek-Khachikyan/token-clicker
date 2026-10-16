import { describe, expect, it } from 'vitest';
import { holdClickAllowed, isHoldKey, type HoldKeyTarget } from './holdClickKeys';

const on = (patch: Partial<HoldKeyTarget>): HoldKeyTarget => ({
  tag: 'DIV',
  editable: false,
  role: null,
  isClickButton: false,
  dialogOpen: false,
  ...patch,
});

describe('когда удержание Пробела и Enter становится Кликом', () => {
  it('works on an empty page and on the Клик button itself', () => {
    expect(holdClickAllowed(on({ tag: 'BODY' }))).toBe(true);
    expect(holdClickAllowed(on({ tag: 'BUTTON', isClickButton: true }))).toBe(true);
  });

  it('stays out of text fields, in every spelling of one', () => {
    expect(holdClickAllowed(on({ tag: 'INPUT' }))).toBe(false);
    expect(holdClickAllowed(on({ tag: 'textarea' }))).toBe(false);
    expect(holdClickAllowed(on({ editable: true }))).toBe(false);
    expect(holdClickAllowed(on({ role: 'textbox' }))).toBe(false);
  });

  it('leaves the press to any other control that has focus', () => {
    expect(holdClickAllowed(on({ tag: 'BUTTON' }))).toBe(false);
    expect(holdClickAllowed(on({ tag: 'A' }))).toBe(false);
    expect(holdClickAllowed(on({ tag: 'DIV', role: 'tab' }))).toBe(false);
    expect(holdClickAllowed(on({ tag: 'SELECT' }))).toBe(false);
  });

  it('does nothing while a window is open, even with the Клик button focused', () => {
    expect(holdClickAllowed(on({ tag: 'BODY', dialogOpen: true }))).toBe(false);
    expect(holdClickAllowed(on({ tag: 'BUTTON', isClickButton: true, dialogOpen: true }))).toBe(false);
  });

  it('answers only to Space and Enter without a modifier', () => {
    const key = (k: string, m: Partial<Record<'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey', boolean>> = {}) =>
      isHoldKey({ key: k, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...m });
    expect(key(' ')).toBe(true);
    expect(key('Enter')).toBe(true);
    expect(key('a')).toBe(false);
    expect(key('Enter', { ctrlKey: true })).toBe(false);
    expect(key(' ', { metaKey: true })).toBe(false);
  });
});
