import { describe, expect, it } from 'vitest';
import { CATALOG } from './catalog';
import { ACHIEVEMENTS } from './achievements';
import { thermalRead } from './thermal';
import {
  canStartChallenge,
  challengeComputeMult,
  challengeIncomeMult,
  CHALLENGES,
  RISK_MULT_MAX,
  riskClass,
  riskMult,
  toggleChallenge,
  type ChallengeDef,
} from './challenges';
import {
  advance,
  buyAgents,
  buyUpgrade,
  buyPerk,
  click,
  clickValue,
  datasetMult,
  discountMult,
  globalMult,
  modelIncome,
  offlineCapHours,
  prestige,
  prestigeGain,
  totalIncome,
} from './engine';
import { migrate } from './save';
import { newGame, SAVE_VERSION, type GameState } from './state';
import {
  SYNERGY_MIN_AGENTS,
  labAgents,
  datasetUpgradeId,
  modelUpgradeId,
  synergyUpgradeId,
  UPGRADES_BY_GEN,
  type Upgrade,
} from './upgrades';

const T0 = 1_000_000;
const g0 = CATALOG[0];
const first = g0.models[0];
const rich = (s: GameState, tokens = 1e50): GameState => ({ ...s, tokens, runTokens: tokens });
/** Свежий забег с выбранным Испытанием: стартовать можно только до первой покупки и клика. */
const challenged = (...ids: ChallengeDef['id'][]): GameState =>
  ids.reduce((s, id) => toggleChallenge(s, id), newGame(T0));

describe('canStartChallenge', () => {
  it('allows a challenge only on a fresh run: no agents, no upgrades, no clicks', () => {
    expect(canStartChallenge(newGame(T0))).toBe(true);
    // Клик — уже не свежий забег, даже без покупок.
    expect(canStartChallenge(click(newGame(T0)))).toBe(false);
    // Агент — уже не свежий забег.
    expect(canStartChallenge(buyAgents(rich(newGame(T0)), first.id, 1))).toBe(false);
    // Апгрейд — уже не свежий забег.
    let s = buyAgents(rich(newGame(T0)), first.id, 10);
    s = buyUpgrade(s, modelUpgradeId(first.id, 0));
    expect(s.upgrades.length).toBe(1);
    expect(canStartChallenge(s)).toBe(false);
  });
});

describe('toggleChallenge', () => {
  it('takes a challenge on a fresh run and puts it back', () => {
    const taken = toggleChallenge(newGame(T0), 'no-synergy');
    expect(taken.activeChallenges).toEqual(['no-synergy']);
    expect(toggleChallenge(taken, 'no-synergy').activeChallenges).toEqual([]);
  });
  it('takes several challenges at once, in the order of the table', () => {
    const s = challenged('no-click', 'no-synergy');
    expect(s.activeChallenges).toEqual(['no-click', 'no-synergy']);
  });
  it('returns the same object when the run is no longer fresh', () => {
    const s = click(newGame(T0));
    expect(toggleChallenge(s, 'no-click')).toBe(s);
    const hired = buyAgents(rich(newGame(T0)), first.id, 1);
    expect(toggleChallenge(hired, 'no-click')).toBe(hired);
  });
  it('returns the same object for an unknown id', () => {
    const fresh = newGame(T0);
    expect(toggleChallenge(fresh, 'unknown' as never)).toBe(fresh);
  });
});

describe('risk class', () => {
  it('is the sum of the weights of the taken challenges', () => {
    expect(riskClass(newGame(T0))).toBe(0);
    for (const def of CHALLENGES) expect(riskClass(challenged(def.id)), def.id).toBe(def.weight);
    const all = challenged(...CHALLENGES.map((c) => c.id));
    expect(riskClass(all)).toBe(CHALLENGES.reduce((sum, c) => sum + c.weight, 0));
  });
  it('gives every challenge a whole positive weight', () => {
    for (const def of CHALLENGES) {
      expect(Number.isInteger(def.weight), def.id).toBe(true);
      expect(def.weight, def.id).toBeGreaterThan(0);
    }
  });
  it('multiplies Compute by a factor that grows with the class and stops at the ceiling', () => {
    expect(riskMult(0)).toBe(1);
    let prev = 1;
    let reached = -1;
    for (let c = 1; c <= 40; c++) {
      const m = riskMult(c);
      expect(m, `класс ${c}`).toBeGreaterThanOrEqual(prev);
      expect(m, `класс ${c}`).toBeLessThanOrEqual(RISK_MULT_MAX);
      if (reached < 0 && m === RISK_MULT_MAX) reached = c;
      prev = m;
    }
    // Растёт, пока не упрётся в потолок, и после этого стоит.
    expect(riskMult(1)).toBeGreaterThan(1);
    expect(reached).toBeGreaterThan(1);
    expect(riskMult(reached - 1)).toBeLessThan(RISK_MULT_MAX);
    expect(riskMult(1000)).toBe(RISK_MULT_MAX);
  });
  it('reaches the ceiling with the challenges the table offers', () => {
    const top = CHALLENGES.reduce((sum, c) => sum + c.weight, 0);
    expect(riskMult(top)).toBe(RISK_MULT_MAX);
  });
  it('multiplies the Compute a Prestige pays', () => {
    const base = buyAgents(rich(newGame(T0), 1e16), g0.flagship.id, 1);
    // 1e16 Токенов Забега при делителе 4,5e11: корень из 22222 — 28,1 Compute без Испытаний.
    expect(prestigeGain(base)).toBe(28);
    for (const def of CHALLENGES) {
      const taken = { ...base, activeChallenges: [def.id] };
      expect(prestigeGain(taken), def.id).toBe(Math.floor(28.1 * riskMult(def.weight)));
      expect(challengeComputeMult(taken), def.id).toBe(riskMult(def.weight));
    }
    expect(challengeComputeMult(base)).toBe(1);
  });
  it('pays the Compute of the run that was played under the challenge, and the player gets it on Prestige', () => {
    const base = buyAgents(rich(challenged('no-synergy', 'no-click'), 1e15), g0.flagship.id, 1);
    const gain = prestigeGain(base);
    expect(gain).toBeGreaterThan(prestigeGain({ ...base, activeChallenges: [] }));
    expect(prestige(base, T0 + 1).compute).toBe(base.compute + gain);
  });
});

describe('no-click enforcement', () => {
  it('pays zero for clicks but keeps counting them', () => {
    let s = buyAgents(rich(challenged('no-click')), first.id, 10);
    const before = s.tokens;
    expect(clickValue(s)).toBe(0);
    s = click(s);
    // Выплаты нет, а счётчики растут — по ним стор выдаёт реплики и пишет Переписку.
    expect(s.tokens).toBe(before);
    expect(s.clicks).toBe(1);
    expect(s.runClicks).toBe(1);
  });
  it('keeps passive income flowing while clicks pay nothing', () => {
    const s = buyAgents(rich(challenged('no-click')), first.id, 10);
    expect(totalIncome(s)).toBeGreaterThan(0);
    expect(clickValue(s)).toBe(0);
  });
  it('gives autoclicks no income while still counting them', () => {
    const hired = buyAgents(rich(challenged('no-click')), first.id, 10);
    const withBot: GameState = { ...hired, perks: ['autoclick'] };
    const plain = advance({ ...hired, perks: [] }, 1);
    const auto = advance(withBot, 1);
    // Автоклик в Испытании не доплачивает: Токенов ровно столько же, сколько без него.
    expect(auto.tokens).toBe(plain.tokens);
    expect(auto.runClicks).toBe(1);
    expect(plain.runClicks).toBe(0);
  });
});

describe('no-synergy enforcement', () => {
  it('holds the lab synergy multiplier at 1 while model upgrades still apply', () => {
    const lab = first.lab;
    let s = buyAgents(rich(challenged('no-synergy')), first.id, SYNERGY_MIN_AGENTS);
    const plain = modelIncome(s, first);
    s = buyUpgrade(s, synergyUpgradeId(0, lab));
    expect(s.upgrades.length).toBe(1);
    // Апгрейд куплен, но в Испытании он молчит: Доход тот же, что без него.
    expect(modelIncome(s, first)).toBe(plain);
    // А обычный Апгрейд Модели ×2 в Испытании работает: испытание отменяет Синергии, а не всё.
    const doubled = buyUpgrade(s, modelUpgradeId(first.id, 0));
    expect(modelIncome(doubled, first)).toBe(plain * 2);
  });
  it('holds the pair synergy multiplier at 1', () => {
    type PairSynergy = Extract<Upgrade, { kind: 'synergy' }> & { pairLab: NonNullable<Extract<Upgrade, { kind: 'synergy' }>['pairLab']> };
    const pair = UPGRADES_BY_GEN[0].find(
      (u): u is PairSynergy => u.kind === 'synergy' && u.pairLab !== undefined,
    )!;
    const cheapest = (lab: string) =>
      g0.models.filter((m) => m.lab === lab).sort((a, b) => a.baseCost - b.baseCost)[0];
    const a = cheapest(pair.lab);
    const b = cheapest(pair.pairLab);
    let s = challenged('no-synergy');
    s = buyAgents(rich(s), a.id, SYNERGY_MIN_AGENTS);
    s = buyAgents(s, b.id, SYNERGY_MIN_AGENTS);
    expect(labAgents(s, pair.lab)).toBeGreaterThanOrEqual(SYNERGY_MIN_AGENTS);
    const plain = modelIncome(s, a);
    s = buyUpgrade(s, pair.id);
    expect(s.upgrades.length).toBe(1);
    expect(modelIncome(s, a)).toBe(plain);
  });
});

describe('no-dataset enforcement', () => {
  const lit = (extra: Partial<GameState> = {}): GameState => {
    const base: GameState = {
      ...rich(newGame(T0)),
      achievements: ACHIEVEMENTS.slice(0, 10).map((a) => a.id),
      temp: 0,
      ...extra,
    };
    return buyUpgrade(buyAgents(base, first.id, 4), datasetUpgradeId(0, 0));
  };
  it('silences the Dataset on income and on the flat part of a click, and gives it back after the run', () => {
    const open = lit();
    expect(datasetMult(open)).toBeGreaterThan(1);
    const walled = lit({ activeChallenges: ['no-dataset'] });
    expect(datasetMult(walled)).toBe(1);
    expect(totalIncome(walled)).toBeCloseTo(totalIncome(open) / datasetMult(open));
    expect(clickValue(walled)).toBeLessThan(clickValue(open));
    // Достижения при этом остались: Испытание гасит действие Датасета, а не отбирает коллекцию.
    expect(walled.achievements).toEqual(open.achievements);
  });
});

describe('no-perks enforcement', () => {
  const owned = (extra: Partial<GameState> = {}): GameState => ({
    ...buyAgents(rich(newGame(T0)), first.id, 4),
    perks: ['click_x2', 'discount', `lab_${first.lab}`, 'legacy', 'start_tokens'],
    maxGeneration: 3,
    temp: 0,
    ...extra,
  });
  it('turns off every Perk that earns or saves, and keeps the Perks the player owns', () => {
    const open = owned();
    const bare = owned({ activeChallenges: ['no-perks'] });
    expect(totalIncome(bare)).toBeLessThan(totalIncome(open));
    expect(totalIncome(bare)).toBeCloseTo(totalIncome(owned({ perks: [] })));
    expect(clickValue(bare)).toBe(clickValue(owned({ perks: [] })));
    expect(discountMult(bare)).toBe(discountMult(owned({ perks: [] })));
    expect(bare.perks).toEqual(open.perks);
  });
  it('turns off the autoclick and the Perks of the thermal scale too', () => {
    const bot = buyAgents(rich(newGame(T0)), first.id, 10);
    const withBot: GameState = { ...bot, perks: ['click_x2', 'autoclick'], activeChallenges: ['no-perks'] };
    expect(advance(withBot, 1).runClicks).toBe(0);
    expect(advance({ ...withBot, activeChallenges: [] }, 1).runClicks).toBe(1);
    const tuned: GameState = { ...newGame(T0), perks: ['oc_tuning'], temp: 1 };
    expect(thermalRead({ ...tuned, activeChallenges: ['no-perks'] }).mult).toBeLessThan(thermalRead(tuned).mult);
  });
  it('refuses to buy a Perk for the whole run, so the Compute is not spent on nothing', () => {
    const s: GameState = { ...newGame(T0), compute: 100, activeChallenges: ['no-perks'] };
    expect(buyPerk(s, 'click_x2')).toBe(s);
    expect(buyPerk({ ...s, activeChallenges: [] }, 'click_x2')).not.toBe(s);
  });
  it('does not touch the Offline cap or the starting Tokens a Prestige hands out', () => {
    const s = owned({ activeChallenges: ['no-perks'], perks: ['offline_rate_1', 'start_tokens'] });
    expect(offlineCapHours(s)).toBe(24);
    const flagship = buyAgents(rich({ ...s, tokens: 0 }, 1e15), g0.flagship.id, 1);
    expect(prestige(flagship, T0 + 1).tokens).toBeGreaterThan(0);
  });
});

describe('cold enforcement', () => {
  it('freezes the scale at zero when taken, with no accumulated heat', () => {
    const hot: GameState = { ...newGame(T0), temp: 1.2, heat: 0.6 };
    const s = toggleChallenge(hot, 'cold');
    expect(s.activeChallenges).toEqual(['cold']);
    expect([s.temp, s.heat]).toEqual([0, 0]);
  });
  it('reads the scale as cold whatever the stored value is: no yield from heat, no overheat, no Hallucination', () => {
    const forced: GameState = { ...buyAgents(rich(newGame(T0)), first.id, 5), activeChallenges: ['cold'], temp: 1.6 };
    const read = thermalRead(forced);
    expect([read.temp, read.mult, read.halluRate]).toEqual([0, 1, 0]);
    // Минута на «горячей» шкале: перегрев не копится, Токены не пропадают, Доход без прибавки жара.
    const after = advance(forced, 60, () => 0);
    expect(after.heat).toBe(0);
    expect(after.overheatedAt).toBe(0);
    expect(after.tokens).toBeCloseTo(forced.tokens + totalIncome({ ...forced, temp: 0 }) * 60);
  });
});

describe('inherited reward of the old challenges', () => {
  it('pays +10% per challenge closed before the Compute reward, deduplicated', () => {
    const inherit = (ids: string[]) => ({ ...newGame(T0), challengesInherited: ids });
    expect(challengeIncomeMult(newGame(T0))).toBe(1);
    expect(challengeIncomeMult(inherit(['no-synergy']))).toBeCloseTo(1.1);
    expect(challengeIncomeMult(inherit(['no-synergy', 'no-click']))).toBeCloseTo(1.2);
    expect(challengeIncomeMult(inherit(['no-click', 'no-click']))).toBeCloseTo(1.1);
  });
  it('is wired into globalMult next to the compute and crystal multipliers', () => {
    const s = newGame(T0);
    expect(globalMult({ ...s, challengesInherited: ['no-synergy'] })).toBeCloseTo(globalMult(s) * 1.1);
    expect(globalMult({ ...s, challengesInherited: ['no-synergy', 'no-click'] })).toBeCloseTo(globalMult(s) * 1.2);
  });
  it('does not grow when a challenge is closed now: the new reward is Compute, not a permanent share of Income', () => {
    const run = buyAgents(rich(challenged('no-click'), 1e15), g0.flagship.id, 1);
    const closed = prestige(run, T0 + 1);
    expect(closed.challengesInherited).toEqual([]);
    expect(challengeIncomeMult(closed)).toBe(1);
  });
});

describe('prestige closes challenges', () => {
  it('writes every taken challenge into challengesDone and clears the list', () => {
    const s = buyAgents(rich(challenged('no-click', 'no-synergy')), g0.flagship.id, 1);
    const p = prestige(s, T0 + 1);
    expect(p.challengesDone.sort()).toEqual(['no-click', 'no-synergy']);
    expect(p.activeChallenges).toEqual([]);
  });
  it('lists a challenge once however many times it is closed', () => {
    const s: GameState = {
      ...buyAgents(rich(newGame(T0), 1e15), g0.flagship.id, 1),
      activeChallenges: ['no-click'],
      challengesDone: ['no-click'],
    };
    expect(prestige(s, T0 + 1).challengesDone).toEqual(['no-click']);
  });
  it('pays the Compute of the same challenge again on a repeat run: the reward is per Prestige', () => {
    const run = () => buyAgents(rich(challenged('no-click'), 1e15), g0.flagship.id, 1);
    const once = prestige(run(), T0 + 1);
    const again = prestige({ ...run(), challengesDone: once.challengesDone }, T0 + 1);
    expect(again.compute).toBe(once.compute);
  });
  it('leaves challengesDone alone without an active challenge', () => {
    const s = buyAgents(rich(newGame(T0), 1e15), g0.flagship.id, 1);
    const p = prestige(s, T0 + 1);
    expect(p.challengesDone).toEqual([]);
    expect(p.activeChallenges).toEqual([]);
  });
  it('kills the live event with the run but keeps the quips collection', () => {
    let s = buyAgents(rich(newGame(T0), 1e15), g0.flagship.id, 1);
    s = {
      ...s,
      event: { kind: 'hype', startedAt: T0, red: true },
      eventCaughtAt: T0,
      nextEventAt: T0 + 600_000,
      combo: 3,
      quipsSeen: ['q1'],
    };
    const p = prestige(s, T0 + 1);
    // Живое событие прошлого забега в новый не переезжает: иначе новый забег стартовал бы
    // с чужим бонусом или красным штрафом. Переписка переживает — коллекция на всю игру.
    expect(p.event).toBe(null);
    expect(p.eventCaughtAt).toBe(0);
    expect(p.nextEventAt).toBe(0);
    expect(p.combo).toBe(0);
    expect(p.quipsSeen).toEqual(['q1']);
  });
});

describe('challenges save contract', () => {
  it('upgrades a v5 save to the current version with challenge defaults', () => {
    const s = migrate({ version: 5, tokens: 500 }, T0);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.tokens).toBe(500);
    expect(s.activeChallenges).toEqual([]);
    expect(s.challengesDone).toEqual([]);
    expect(s.challengesInherited).toEqual([]);
  });
  it('keeps the closed ids like achievements: strings only, no table check, deduped', () => {
    const s = migrate({ version: 14, challengesDone: ['no-click', 'no-click', 'custom'] }, T0);
    expect(s.challengesDone).toEqual(['no-click', 'custom']);
    expect(migrate({ version: 14, challengesDone: 'nope' }, T0).challengesDone).toEqual([]);
  });
  it('keeps only known, distinct challenges as active: junk is an ordinary run, not a restriction nobody chose', () => {
    const s = migrate({ version: 14, activeChallenges: ['no-click', 'no-click', 'custom', 7, 'no-synergy'] }, T0);
    // Порядок списка — порядок таблицы, а не порядок в сохранении.
    expect(s.activeChallenges).toEqual(['no-click', 'no-synergy']);
    expect(migrate({ version: 14, activeChallenges: 42 }, T0).activeChallenges).toEqual([]);
  });
});
