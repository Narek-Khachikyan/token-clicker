import { describe, expect, it } from 'vitest';
import { coachTarget, type CoachTarget, type CoachView } from './coach';
import { CATALOG } from './economy/catalog';
import { newGame, type GameState } from './economy/state';
import type { ActiveTab } from './store/useGameStore';

const T0 = 1_000_000;
const at = (patch: Partial<GameState>): GameState => ({ ...newGame(T0), ...patch });
const hired = { [CATALOG[0].models[0].id]: 1 };

describe('onboarding arrow', () => {
  const desktop: CoachView = { single: false, tab: 'click' };
  const phone = (tab: ActiveTab): CoachView => ({ single: true, tab });
  const first = at({});
  const clicked = at({ clicks: 1 });
  const hiredState = at({ clicks: 1, agents: hired });

  it('points at the element the current hint talks about on desktop', () => {
    expect(coachTarget(first, desktop)).toBe<CoachTarget>('click-button');
    expect(coachTarget(clicked, desktop)).toBe<CoachTarget>('first-model');
    expect(coachTarget(hiredState, desktop)).toBe<CoachTarget>('tab-upgrades');
  });

  it('points at the element itself on the phone screen that holds it', () => {
    expect(coachTarget(first, phone('click'))).toBe<CoachTarget>('click-button');
    expect(coachTarget(clicked, phone('shop'))).toBe<CoachTarget>('first-model');
    expect(coachTarget(hiredState, phone('shop'))).toBe<CoachTarget>('tab-upgrades');
  });

  it('points at the bottom tab that leads to the element when the phone shows another screen', () => {
    expect(coachTarget(first, phone('office'))).toBe<CoachTarget>('tab-click');
    expect(coachTarget(clicked, phone('click'))).toBe<CoachTarget>('tab-shop');
    expect(coachTarget(clicked, phone('office'))).toBe<CoachTarget>('tab-shop');
    expect(coachTarget(hiredState, phone('office'))).toBe<CoachTarget>('tab-shop');
  });

  it('points at nothing once the hint is gone', () => {
    expect(coachTarget(at({ prestiges: 1 }), desktop)).toBeNull();
    expect(coachTarget(at({ clicks: 3, agents: hired, eventsSeen: 1 }), phone('click'))).toBeNull();
  });
});
