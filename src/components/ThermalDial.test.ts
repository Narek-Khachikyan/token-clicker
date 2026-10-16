import { describe, expect, it } from 'vitest';
import { THERMAL_STATE_LABEL, type ThermalStateId } from '../data/thermalCopy';
import { ICON_NAMES } from './Icon';
import { STATE_ICON } from './ThermalDial';

const STATES = Object.keys(THERMAL_STATE_LABEL) as ThermalStateId[];

describe('Temperature state marks', () => {
  it('draws every state with its own existing icon, so the state reads without colour', () => {
    expect(STATES).toHaveLength(4);
    const icons = STATES.map((s) => STATE_ICON[s]);
    for (const icon of icons) expect(ICON_NAMES).toContain(icon);
    // Четыре состояния — четыре разные формы: общий значок оставил бы различие одному цвету.
    expect(new Set(icons).size).toBe(STATES.length);
  });

  it('gives every state its own word in the Russian of the glossary', () => {
    const words = STATES.map((s) => THERMAL_STATE_LABEL[s]);
    expect(new Set(words).size).toBe(STATES.length);
    for (const word of words) expect(word).toMatch(/^[А-ЯЁ][а-яё]+$/);
  });
});
