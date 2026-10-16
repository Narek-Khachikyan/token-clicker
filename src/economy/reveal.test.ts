import { describe, expect, it } from 'vitest';
import { CATALOG } from './catalog';
import { buyAgents, buyUpgrade, prestige } from './engine';
import { openUi } from './reveal';
import { newGame, type GameState } from './state';

const T0 = 1_000_000;
const at = (patch: Partial<GameState>): GameState => ({ ...newGame(T0), ...patch });
const gen0 = CATALOG[0].models;
const flagship = CATALOG[0].flagship;

describe('open interface', () => {
  it('shows only the first Model and no extra tabs on a fresh run', () => {
    expect(openUi(newGame(T0))).toEqual({ models: 1, upgradesTab: false, prestigeTab: false });
  });

  it('opens the next Model once the previous one has been within reach this run', () => {
    expect(openUi(at({ runTokens: gen0[0].baseCost - 1 })).models).toBe(1);
    expect(openUi(at({ runTokens: gen0[0].baseCost })).models).toBe(2);
    expect(openUi(at({ runTokens: gen0[1].baseCost })).models).toBe(3);
  });

  it('opens the Upgrades tab with the first Agent, the moment the first Upgrade is available', () => {
    const hired = buyAgents(at({ tokens: 1e6 }), gen0[0].id, 1);
    expect(openUi(hired).upgradesTab).toBe(true);
  });

  it('keeps the Upgrades tab open after the Agent is sold or the Upgrade is bought', () => {
    const bought = buyUpgrade(buyAgents(at({ tokens: 1e9, runTokens: 1e9 }), gen0[0].id, 1), `m:${gen0[0].id}:0`);
    expect(bought.upgrades.length).toBe(1);
    expect(openUi({ ...bought, agents: {} }).upgradesTab).toBe(true);
    expect(openUi({ ...at({}), achievements: ['agents_1'] }).upgradesTab).toBe(true);
  });

  it('opens the Prestige tab when the Flagship appears in the shop, not before', () => {
    const beforeLast = gen0[gen0.length - 2].baseCost;
    expect(openUi(at({ runTokens: beforeLast - 1 })).prestigeTab).toBe(false);
    const shown = openUi(at({ runTokens: beforeLast }));
    expect(shown.models).toBe(gen0.length);
    expect(shown.prestigeTab).toBe(true);
  });

  it('never closes anything as the run goes on, over every Generation', () => {
    for (const gen of CATALOG) {
      let prev = openUi(at({ generation: gen.index, maxGeneration: gen.index, prestiges: 0 }));
      for (const m of gen.models) {
        const next = openUi(at({ generation: gen.index, maxGeneration: gen.index, runTokens: m.baseCost * 3 }));
        expect(next.models).toBeGreaterThanOrEqual(prev.models);
        expect(Number(next.upgradesTab)).toBeGreaterThanOrEqual(Number(prev.upgradesTab));
        expect(Number(next.prestigeTab)).toBeGreaterThanOrEqual(Number(prev.prestigeTab));
        prev = next;
      }
    }
  });

  it('shows everything after a Prestige, with an empty new run', () => {
    const s = prestige(buyAgents(at({ tokens: 1e300, runTokens: 1e300 }), flagship.id, 1), T0 + 1);
    expect(s.prestiges).toBe(1);
    expect(s.runTokens).toBe(0);
    expect(openUi(s)).toEqual({ models: CATALOG[s.generation].models.length, upgradesTab: true, prestigeTab: true });
  });

  it('shows everything on an imported late save, whatever its Generation', () => {
    for (const gen of CATALOG.slice(1)) {
      const late = at({ generation: gen.index, maxGeneration: gen.index, prestiges: gen.index });
      expect(openUi(late)).toEqual({ models: gen.models.length, upgradesTab: true, prestigeTab: true });
    }
  });

  it('opens every Model the player already owns, even with an empty run counter', () => {
    const owned = at({ agents: { [gen0[3].id]: 1 } });
    expect(openUi(owned).models).toBe(4);
    expect(openUi(at({ agents: { [flagship.id]: 1 } })).prestigeTab).toBe(true);
  });
});
