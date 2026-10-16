import { describe, expect, it } from 'vitest';
import { CATALOG } from './catalog';
import { buyAgents } from './engine';
import { rewardMoment } from './rewardMoment';
import { newGame, type GameState } from './state';

const T0 = 1_000_000;
const rich = (s: GameState): GameState => ({ ...s, tokens: 1e300, runTokens: 1e300 });
const at = (generation: number): GameState => ({ ...newGame(T0), generation, maxGeneration: generation });

describe('rewardMoment', () => {
  it('lets the first Agent of a Лаборатория enter, in every Поколение and for every Модель', () => {
    for (const gen of CATALOG) {
      for (const model of gen.models) {
        const before = rich(at(gen.index));
        const after = buyAgents(before, model.id, 1);
        const moment = rewardMoment(before, after, model.id);
        expect(moment, `${model.id}: первый Агент Лаборатории ${model.lab}`).not.toBeNull();
        expect(moment?.lab).toBe(model.lab);
        expect(moment?.entry).toBe(true);
        expect(moment?.flagship).toBe(model.id === gen.flagship.id);
      }
    }
  });

  it('stays quiet for a second Agent of the same Модель and for a second Модель of a Лаборатория', () => {
    for (const gen of CATALOG) {
      for (const lab of new Set(gen.models.map((m) => m.lab))) {
        const own = gen.models.filter((m) => m.lab === lab);
        let s = rich(at(gen.index));
        s = buyAgents(s, own[0].id, 1);
        const again = buyAgents(s, own[0].id, 1);
        expect(rewardMoment(s, again, own[0].id), `${own[0].id}: второй Агент`).toBeNull();
        for (const other of own.slice(1)) {
          if (other.id === gen.flagship.id) continue;
          const next = buyAgents(s, other.id, 1);
          expect(rewardMoment(s, next, other.id), `${other.id}: вторая Модель Лаборатории`).toBeNull();
        }
      }
    }
  });

  it('celebrates the first Флагман once, without a second entry when the Лаборатория already stands', () => {
    for (const gen of CATALOG) {
      const flagship = gen.flagship;
      const other = gen.models.find((m) => m.lab === flagship.lab && m.id !== flagship.id);
      let s = rich(at(gen.index));
      if (other) s = buyAgents(s, other.id, 1);
      const hired = buyAgents(s, flagship.id, 1);
      const moment = rewardMoment(s, hired, flagship.id);
      expect(moment?.flagship, `${flagship.id}: первый Агент Флагмана`).toBe(true);
      expect(moment?.entry).toBe(!other);
      const second = buyAgents(hired, flagship.id, 1);
      expect(rewardMoment(hired, second, flagship.id), `${flagship.id}: второй Агент Флагмана`).toBeNull();
    }
  });

  it('treats a bulk purchase of the first Agents as one moment', () => {
    const gen = CATALOG[0];
    const before = rich(at(0));
    const after = buyAgents(before, gen.flagship.id, 10);
    expect(rewardMoment(before, after, gen.flagship.id)).toEqual({ lab: gen.flagship.lab, entry: true, flagship: true });
  });

  it('does not celebrate a purchase that changed nothing', () => {
    const gen = CATALOG[0];
    const broke = { ...at(0), tokens: 0 };
    const after = buyAgents(broke, gen.flagship.id, 1);
    expect(after).toBe(broke);
    expect(rewardMoment(broke, after, gen.flagship.id)).toBeNull();
  });

  it('never celebrates a Флагман of another Поколение', () => {
    const before = rich(at(1));
    const foreign = { ...before, agents: { [CATALOG[0].flagship.id]: 1 } };
    expect(rewardMoment(before, foreign, CATALOG[0].flagship.id)).toBeNull();
  });
});
