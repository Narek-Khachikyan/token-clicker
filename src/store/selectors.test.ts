import { describe, expect, it } from 'vitest';
import { shallow } from 'zustand/shallow';
import { CATALOG, LAST_GENERATION } from '../economy/catalog';
import {
  advanceTime,
  bulkCost,
  buyAgents,
  buyUpgrade,
  clickValue,
  maxAffordable,
  nextAgentCost,
  prestige,
  sellRefund,
  totalIncome,
} from '../economy/engine';
import { formatCount, formatDuration, formatNumber } from '../economy/format';
import { LAB_IDS, LABS } from '../data/labs';
import { canPrestige, isContentFinale, prestigeGain, shatterCrystal } from '../economy/engine';
import { prestigeForecast } from '../economy/prestigeForecast';
import { CHALLENGES, startChallenge } from '../economy/challenges';
import { CRYSTAL_UPGRADES, crystalCycleMs } from '../economy/crystal';
import {
  canLicense,
  canPledge,
  licenseCost,
  pledgeCost,
  revokeCost,
} from '../economy/glitches';
import { newGame, type GameState } from '../economy/state';
import { availableUpgrades, labAgents, labWork, synergyUpgradeId } from '../economy/upgrades';
import { OVERHEAT_STUN_SEC, TEMP_MAX, thermalRead } from '../economy/thermal';
import { MILESTONES } from '../economy/milestones';
import {
  availableUpgradesOf,
  clickButtonView,
  challengeCardView,
  challengeView,
  crystalGrowthView,
  crystalShatterView,
  crystalStockView,
  crystalUpgradeView,
  droneView,
  glitchBandView,
  glitchesOf,
  incomeView,
  labBoothLabels,
  labCardView,
  labShareView,
  milestoneView,
  modelView,
  pledgeAlert,
  pledgeView,
  prestigeCardView,
  queueView,
  ruleStatusText,
  purchaseProgressView,
  sparksView,
  thermalMiniView,
  thermalTone,
  thermalView,
  upgradeView,
} from './selectors';

const T0 = 1_700_000_000_000;
const FAR = 4e12;

const rich = (s: GameState, tokens: number): GameState => ({ ...s, tokens, runTokens: tokens });

/**
 * Позднее Поколение, каким его видит игрок: все Поколения пройдены Престижами, у каждой Модели
 * Поколения 7 по 300 Агентов, куплено всё доступное. Температура на нуле, а Событий и Глюков в
 * окне замера нет: тест проверяет, что тик сам по себе ничего не меняет на экране.
 */
const buildLateGame = (): GameState => {
  const gen = LAST_GENERATION - 1;
  let s = newGame(T0);
  for (let g = 0; g < gen; g++) {
    s = prestige(buyAgents(rich(s, 1e50), CATALOG[g].flagship.id, 1), T0 + g * 1000);
  }
  for (const m of CATALOG[gen].models) s = buyAgents(rich(s, 1e300), m.id, 300);
  for (let pass = 0; pass < 4; pass++) {
    for (const u of availableUpgrades(s)) s = buyUpgrade(rich(s, 1e300), u.id);
  }
  return { ...rich(s, 3e30), temp: 0, heat: 0, nextEventAt: FAR, nextGlitchAt: FAR };
};

/** Состояния неизменяемы, поэтому собранный Забег переиспользуется: сборка идёт через Престиж на каждое Поколение. */
let lateCache: GameState | null = null;
const lateGame = (): GameState => (lateCache ??= buildLateGame());

/** Простой: тики по 50 мс без единого действия игрока, как их гоняет App.tsx. */
const idle = (from: GameState, ticks: number): GameState[] => {
  const states: GameState[] = [from];
  let s = from;
  for (let i = 0; i < ticks; i++) {
    s = advanceTime(s, 0.05, () => 0.99);
    states.push(s);
  }
  return states;
};

/** Сколько раз срез изменился бы для подписчика: ровно так считает useShallow в React. */
const changes = <T>(states: GameState[], view: (s: GameState) => T): number => {
  let n = 0;
  let prev = view(states[0]);
  for (const s of states.slice(1)) {
    const next = view(s);
    if (!shallow(prev, next)) n++;
    prev = next;
  }
  return n;
};

describe('click column slices', () => {
  it('shows the income the engine pays, in the player notation', () => {
    const late = lateGame();
    expect(incomeView(late).text).toBe(formatNumber(totalIncome(late), 'short'));
    const sci = { ...late, settings: { ...late.settings, notation: 'sci' as const } };
    expect(incomeView(sci).text).toBe(formatNumber(totalIncome(sci), 'sci'));
  });

  it('knows a run with no income yet', () => {
    expect(incomeView(newGame(T0)).zero).toBe(true);
    expect(incomeView(lateGame()).zero).toBe(false);
  });

  it('prints the click reward and its noun the way the button always did', () => {
    for (const s of [newGame(T0), lateGame()]) {
      const reward = clickValue(s, totalIncome(s));
      const view = clickButtonView(s);
      expect(view.value).toBe(formatNumber(reward, 'short', 'price'));
      expect(view.word).toBe(formatCount(reward, 'Токен', 'Токена', 'Токенов', 'short', 'price'));
    }
  });

  it('grows the click halo with the office', () => {
    expect(clickButtonView(newGame(T0)).tier).toBe(0);
    expect(clickButtonView(newGame(T0)).power).toBe('0.00');
    expect(clickButtonView(lateGame()).tier).toBe(4);
  });

  it('shows how far the next hire is, from the engine price', () => {
    const s = rich(newGame(T0), nextAgentCost(newGame(T0)) / 2);
    const view = purchaseProgressView(s);
    expect(view.canHire).toBe(false);
    expect(view.now).toBe(50);
    expect(view.missingText).toBe(formatNumber(Math.ceil(nextAgentCost(s) - s.tokens), 'short'));
    const ready = purchaseProgressView(rich(newGame(T0), 1e9));
    expect(ready.canHire).toBe(true);
    expect(ready.now).toBe(100);
    expect(ready.missingText).toBe('');
  });

  it('leaves every click column slice alone while nothing happens in a late run', () => {
    // Бонус Compute упирается в потолок (ADR-0010), и Доход позднего Забега перестал быть таким,
    // чтобы полоса до найма стояла на месте от одних лишь тиков: за 10 с она заметно двигается.
    // Поэтому мерим тик на полной полосе, а не на той, что честно ползёт.
    const states = idle({ ...lateGame(), tokens: 1e40 }, 200);
    expect(changes(states, incomeView)).toBe(0);
    expect(changes(states, clickButtonView)).toBe(0);
    expect(changes(states, purchaseProgressView)).toBe(0);
  });

  it('does not repaint the progress bar for a sub-pixel move', () => {
    const base = rich(newGame(T0), nextAgentCost(newGame(T0)) * 0.4);
    const nudged = rich(newGame(T0), nextAgentCost(newGame(T0)) * 0.4 + 1e-6);
    expect(shallow(purchaseProgressView(base), purchaseProgressView(nudged))).toBe(true);
    const moved = rich(newGame(T0), nextAgentCost(newGame(T0)) * 0.5);
    expect(shallow(purchaseProgressView(base), purchaseProgressView(moved))).toBe(false);
  });
});

describe('temperature slices', () => {
  const heated = (heat: number, temp = 0.9): GameState => ({ ...lateGame(), temp, heat });

  it('reads the dial from the same numbers the engine pays by', () => {
    for (const s of [lateGame(), heated(0.3), heated(0.8, TEMP_MAX)]) {
      const read = thermalRead(s);
      const view = thermalView(s);
      expect(view.temp).toBe(read.temp);
      expect(view.mult).toBe(formatNumber(read.mult, 'short'));
      expect(view.valueText).toContain(view.status);
    }
    // Жар 0.9 без перегрева: Доход 1 + 1.2 × 0.9 = 2.08, статус «Стабильно». Офис пуст: Характеры
    // Лабораторий (ADR-0011) двигают этот множитель, и «поздняя игра» несёт их с собой.
    expect(thermalView({ ...heated(0, 0.9), agents: {} }).valueText).toBe('0.90 из 1.6, Доход ×2.08, Стабильно');
  });

  it('names the heat state in words, not only in colour', () => {
    expect(thermalView(heated(0)).status).toBe('Стабильно');
    expect(thermalView(heated(0.5)).status).toBe('Копится перегрев');
    expect(thermalView(heated(0.8)).status).toBe('Почти перегрев');
    const stunned = { ...heated(0), overheatedAt: T0 + 1_000, lastTick: T0 + 2_000 };
    expect(thermalView(stunned).status).toBe('Перегрев: Доход падает');
  });

  it('names the scale state cold, normal, hot or overheat for every temperature and heat', () => {
    const stunned = { ...heated(0, 0), overheatedAt: T0 + 1_000, lastTick: T0 + 1_100 };
    const cases: Array<[GameState, string, string]> = [
      [heated(0, 0), 'cold', 'Холод'],
      [heated(0.2, 0.45), 'normal', 'Норма'],
      [heated(0.2, 1), 'normal', 'Норма'],
      [heated(0.2, 1.3), 'hot', 'Жар'],
      [heated(0.7, 0.45), 'hot', 'Жар'],
      [stunned, 'overheat', 'Перегрев'],
    ];
    for (const [s, state, label] of cases) {
      expect(thermalView(s).state).toBe(state);
      expect(thermalView(s).stateLabel).toBe(label);
    }
    // Четыре состояния — четыре разных слова: иначе «различимо без цвета» ничего не значит.
    expect(new Set(cases.map(([, , label]) => label)).size).toBe(4);
  });

  it('says in words that the income is falling while the stun lasts', () => {
    const stunned = { ...heated(0, 0), overheatedAt: T0 + 1_000, lastTick: T0 + 1_100 };
    expect(thermalView(stunned).risk).toBe('Доход падает');
    expect(thermalView(stunned).riskHot).toBe(true);
  });

  it('tells what the player risks at this heat', () => {
    expect(thermalView(heated(0, 0)).risk).toBe('риска нет');
    expect(thermalView(heated(0.2, 1)).risk).toMatch(/^галлюцинации \d+\/мин$/);
    expect(thermalView(heated(0.7)).risk).toBe('перегрев 70%');
    expect(thermalView(heated(0.7)).riskHot).toBe(true);
    expect(thermalView(heated(0.5)).riskHot).toBe(false);
  });

  it('prints the safe temperature of the office and moves it with the composition', () => {
    const officeOf = (lab: 'anthropic' | 'xai'): GameState => {
      const model = CATALOG[2].models.find((m) => m.lab === lab)!;
      return { ...newGame(T0), generation: 2, agents: { [model.id]: 30 }, temp: 0, heat: 0 };
    };
    const calm = thermalView(officeOf('anthropic'));
    const hot = thermalView(officeOf('xai'));
    expect(calm.safe).toBe(`безопасно до ${thermalRead(officeOf('anthropic')).safeTemp.toFixed(2)}`);
    expect(calm.safe).not.toBe(hot.safe);
    expect(thermalRead(officeOf('anthropic')).safeTemp).toBeGreaterThan(thermalRead(officeOf('xai')).safeTemp);
    // Ровная шкала не перерисовывается: безопасная Температура стоит, пока не сменился состав офиса.
    expect(changes(idle(lateGame(), 200), thermalView)).toBe(0);
  });

  it('sets the root tone from heat and from the stun after an overheat', () => {
    expect(thermalTone(heated(0))).toBe('calm');
    expect(thermalTone(heated(0.6))).toBe('hot');
    const justOverheated = { ...heated(0), overheatedAt: T0 + 1_000, lastTick: T0 + 1_000 + 100 };
    expect(thermalTone(justOverheated)).toBe('stunned');
    const recovered = { ...justOverheated, lastTick: T0 + 1_000 + OVERHEAT_STUN_SEC * 1000 + 1 };
    expect(thermalTone(recovered)).toBe('calm');
  });

  it('shows sparks in three steps and none while the office is cool', () => {
    expect(sparksView(heated(0.1)).count).toBe(0);
    expect(sparksView(heated(0.3)).count).toBe(4);
    expect(sparksView(heated(0.7)).count).toBe(9);
    expect(sparksView(heated(0.7)).hot).toBe(true);
    expect(sparksView(heated(0.3)).hot).toBe(false);
  });

  it('keeps the dial and sparks still while the scale rests', () => {
    const states = idle(lateGame(), 200);
    expect(changes(states, thermalView)).toBe(0);
    expect(changes(states, sparksView)).toBe(0);
    expect(changes(states, thermalTone)).toBe(0);
  });

  // Мини-шкала в закреплённой полосе телефона читает ту же Температуру, что и большая шкала.
  it('prints the pinned strip gauge from the same temperature and state as the dial', () => {
    const stunned = { ...heated(0, 0), overheatedAt: T0 + 1_000, lastTick: T0 + 1_100 };
    for (const s of [heated(0, 0), heated(0.2, 0.45), heated(0.2, 1.3), heated(0.7, 0.45), stunned, heated(0.3, TEMP_MAX)]) {
      const mini = thermalMiniView(s);
      const full = thermalView(s);
      expect(mini.state).toBe(full.state);
      expect(mini.stateLabel).toBe(full.stateLabel);
      expect(mini.pct).toBe(Math.round((full.temp / TEMP_MAX) * 100));
    }
    expect(thermalMiniView(heated(0, TEMP_MAX)).pct).toBe(100);
    expect(thermalMiniView(heated(0, 0)).pct).toBe(0);
  });

  it('keeps the pinned strip gauge still while the heat builds and the scale rests', () => {
    // Перегрев копится каждый тик, а мини-шкала показывает положение шкалы и слово состояния:
    // полоса над каждой вкладкой не должна перерисовываться двадцать раз в секунду.
    const states = idle({ ...lateGame(), temp: 0.9 }, 100);
    expect(changes(states, thermalMiniView)).toBeLessThan(3);
    expect(changes(idle(lateGame(), 200), thermalMiniView)).toBe(0);
  });

  it('moves the heat bar only as fast as the player can see it move', () => {
    const states = idle({ ...lateGame(), temp: 0.45 }, 100);
    const moved = changes(states, thermalView);
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(20);
  });
});

describe('milestone strip slice', () => {
  it('points at the first goal that is not claimed and prints its reward', () => {
    const view = milestoneView(newGame(T0));
    expect(view.current?.id).toBe(MILESTONES[0].id);
    expect(view.reward).toBe(formatNumber(MILESTONES[0].units * CATALOG[0].scale, 'short'));
    expect(milestoneView({ ...newGame(T0), milestones: MILESTONES.map((m) => m.id) }).current).toBeNull();
  });

  it('stays put while the run idles', () => {
    expect(changes(idle(lateGame(), 100), milestoneView)).toBe(0);
  });
});

describe('shop model card slice', () => {
  const g0 = CATALOG[0];
  const first = g0.models[0];
  const START_DISCOUNT = 0.7;

  it('offers the first Agent at the opening discount', () => {
    const view = modelView(rich(newGame(T0), 100), first, 1, false);
    expect(view.owned).toBe(0);
    expect(view.count).toBe(1);
    expect(view.canAfford).toBe(true);
    expect(view.costText).toBe(formatNumber(first.baseCost * START_DISCOUNT));
    expect(view.missingText).toBe('');
  });

  it('names what is missing when the wallet is short', () => {
    const view = modelView(rich(newGame(T0), 3), first, 1, false);
    expect(view.canAfford).toBe(false);
    expect(view.missingText).toBe(formatNumber(first.baseCost * START_DISCOUNT - 3));
  });

  it('shows the income an Agent adds, from the engine, before the purchase', () => {
    const s = rich(newGame(T0), 1e6);
    const hired = buyAgents(s, first.id, 1);
    const view = modelView(s, first, 1, false);
    expect(view.showsGain).toBe(true);
    expect(view.gainText).toBe(formatNumber(totalIncome(hired) - totalIncome(s)));
  });

  it('buys as many as the wallet allows in Max mode and none when it allows none', () => {
    const wallet = bulkCost(first, 0, 5, START_DISCOUNT);
    const s = rich(newGame(T0), wallet);
    expect(modelView(s, first, 'max', false).count).toBe(maxAffordable(first, 0, wallet, START_DISCOUNT));
    expect(modelView(s, first, 'max', false).count).toBe(5);
    const broke = modelView(rich(newGame(T0), 1), first, 'max', false);
    expect(broke.count).toBe(0);
    expect(broke.canAfford).toBe(false);
    expect(broke.showsGain).toBe(false);
  });

  it('sells what the player owns and says what comes back', () => {
    const s = buyAgents(rich(newGame(T0), 1e6), first.id, 30);
    const view = modelView(s, first, 10, true);
    expect(view.sell).toBe(true);
    expect(view.owned).toBe(30);
    expect(view.count).toBe(10);
    expect(view.canAfford).toBe(true);
    expect(view.refundText).toBe(formatNumber(sellRefund(first, 30, 10)));
    expect(modelView(s, first, 100, true).canAfford).toBe(false);
    expect(modelView(newGame(T0), first, 1, true).showsGain).toBe(false);
  });

  it('fills the goal rail in twelfths of the price', () => {
    const cost = nextAgentCost(newGame(T0));
    const half = modelView(rich(newGame(T0), cost / 2), first, 1, false);
    expect(half.goalTicks).toBe(6);
    expect(half.goalPct).toBe(50);
    expect(modelView(rich(newGame(T0), cost), first, 1, false).goalTicks).toBe(12);
  });

  it('agrees on the noun with the printed number of Agents', () => {
    const s = buyAgents(rich(newGame(T0), 1e6), first.id, 2);
    expect(modelView(s, first, 1, false).ownedWord).toBe(formatCount(2, 'Агент', 'Агента', 'Агентов', 'short'));
    expect(modelView(newGame(T0), first, 1, false).ownedWord).toBe('Агентов');
  });

  it('leaves every card alone while a rich late run idles', () => {
    const states = idle(rich(lateGame(), 1e300), 40);
    for (const m of CATALOG[LAST_GENERATION - 1].models) {
      for (const [amount, sell] of [[1, false], ['max', false], [10, true]] as const) {
        expect(changes(states, (s) => modelView(s, m, amount, sell))).toBe(0);
      }
    }
  });

  it('moves a card in deficit only when its printed numbers move', () => {
    const states = idle(lateGame(), 100);
    const dearest = CATALOG[LAST_GENERATION - 1].models.at(-1)!;
    expect(changes(states, (s) => modelView(s, dearest, 1, false))).toBeLessThan(20);
  });
});

describe('shop upgrades slice', () => {
  const mid = (): GameState => {
    let s = rich(newGame(T0), 1e9);
    s = buyAgents(s, CATALOG[0].models[0].id, 30);
    return s;
  };

  it('lists the same upgrades the engine unlocks, once per state', () => {
    const s = mid();
    expect(availableUpgradesOf(s).map((u) => u.id)).toEqual(availableUpgrades(s).map((u) => u.id));
    expect(availableUpgradesOf(s)).toBe(availableUpgradesOf(s));
    expect(availableUpgradesOf(s).length).toBeGreaterThan(0);
  });

  it('says what an upgrade costs and what the wallet lacks', () => {
    const s = mid();
    const u = availableUpgradesOf(s)[0];
    const broke = upgradeView({ ...s, tokens: u.cost / 2 }, u);
    expect(broke.canAfford).toBe(false);
    expect(broke.costText).toBe(formatNumber(u.cost));
    expect(broke.missingText).toBe(formatNumber(u.cost / 2));
    expect(broke.missingWord).toBe(formatCount(u.cost / 2, 'Токен', 'Токена', 'Токенов', 'short'));
    const enough = upgradeView({ ...s, tokens: u.cost }, u);
    expect(enough.canAfford).toBe(true);
    expect(enough.missingText).toBe('');
  });

  it('keeps the upgrade list and its cards still while a late run idles', () => {
    const states = idle(rich(lateGame(), 1e300), 100);
    expect(changes(states, availableUpgradesOf)).toBe(0);
    for (const u of availableUpgradesOf(states[0])) {
      expect(changes(states, (s) => upgradeView(s, u))).toBe(0);
    }
  });
});

describe('prestige tab slices', () => {
  const flagship = (g: number) => CATALOG[g].flagship;

  it('opens Prestige with the Flagship and shows the Compute it pays', () => {
    const fresh = newGame(T0);
    expect(prestigeCardView(fresh).ready).toBe(false);
    const ready = buyAgents(rich(fresh, 1e12), flagship(0).id, 1);
    expect(canPrestige(ready)).toBe(true);
    const view = prestigeCardView(ready);
    expect(view.ready).toBe(true);
    expect(view.finale).toBe(false);
    expect(view.gain).toBe(formatNumber(prestigeGain(ready)));
  });

  it('names the Compute boost and the Tokens still missing for it, as the engine counts them', () => {
    const ready = buyAgents(rich(newGame(T0), 1e12), flagship(0).id, 1);
    const f = prestigeForecast(ready);
    const view = prestigeCardView(ready);
    expect(view.boostGain).toBe(formatNumber(f.boostGain));
    expect(view.boostShortfall).toBe(formatNumber(f.boostShortfall));
    expect(view.boostShortfallWord).toBe(formatCount(f.boostShortfall, 'Токен', 'Токена', 'Токенов'));
    // От двух Compute прибавка — настоящие +50%; ниже неё порог — «следующая единица».
    expect(view.boostIsHalf).toBe(f.gain >= 2);
    expect(prestigeCardView({ ...ready, runTokens: 0 }).boostIsHalf).toBe(false);
  });

  it('lets a challenge be picked only on a fresh run and shows which one is taken and which is closed', () => {
    const fresh = newGame(T0);
    expect(challengeCardView(fresh).canStart).toBe(true);
    expect(challengeCardView(fresh).none).toBe(true);
    const picked = startChallenge(fresh, CHALLENGES[0].id);
    expect(challengeCardView(picked).none).toBe(false);
    expect(challengeView(picked, CHALLENGES[0])).toEqual({ active: true, done: false });
    expect(challengeView(picked, CHALLENGES[1])).toEqual({ active: false, done: false });
    // Первый клик закрывает выбор: ядро больше не принимает Испытание.
    expect(challengeCardView({ ...fresh, runClicks: 1 }).canStart).toBe(false);
    // Закрытое Испытание платит +10% к Доходу, и карточка называет сумму.
    const closed = { ...fresh, challengesDone: [CHALLENGES[0].id, CHALLENGES[1].id] };
    expect(challengeCardView(closed).bonusText).toBe(formatNumber(20));
    expect(challengeCardView(closed).doneCount).toBe(2);
    expect(challengeView(closed, CHALLENGES[1]).done).toBe(true);
  });

  it('opens the shatter button with the first whole crystal and names what it pays', () => {
    const s: GameState = { ...lateGame(), crystals: 0.9 };
    expect(crystalShatterView(s).canShatter).toBe(false);
    const grown = { ...s, crystals: 1 };
    const view = crystalShatterView(grown);
    expect(view.canShatter).toBe(true);
    // Названная сумма — ровно та, что кладёт разбитие в кошелёк.
    const paid = shatterCrystal(grown).tokens - grown.tokens;
    expect(view.payoutText).toBe(formatNumber(paid));
    expect(view.payoutWord).toBe(formatCount(paid, 'Токен', 'Токена', 'Токенов'));
    expect(view.lostText).toBe('1');
  });

  it('closes Prestige at the content finale', () => {
    const last = buyAgents(
      { ...rich(newGame(T0), 1e300), generation: LAST_GENERATION, maxGeneration: LAST_GENERATION },
      flagship(LAST_GENERATION).id,
      1,
    );
    expect(isContentFinale(last)).toBe(true);
    expect(prestigeCardView(last).finale).toBe(true);
  });

  it('prices the pledge and the license from the engine and counts the time left', () => {
    const s: GameState = {
      ...rich(lateGame(), 1e300),
      uprising: 2,
      pledgeBought: 1,
      pledgeUntil: lateGame().lastTick + 90_000,
    };
    const view = pledgeView(s);
    expect(view.pledgeCostText).toBe(formatNumber(pledgeCost(s)));
    expect(view.canPledge).toBe(canPledge(s));
    expect(view.licenseCostText).toBe(formatNumber(licenseCost(s)));
    expect(view.canLicense).toBe(canLicense(s));
    expect(view.revokeCostText).toBe(formatNumber(revokeCost(s)));
    expect(view.leftText).toBe(formatDuration(90));
    expect(pledgeView({ ...s, pledgeUntil: 0 }).leftText).toBe('');
  });

  it('shows the crystal stock and the bonus it gives', () => {
    const s = { ...lateGame(), crystals: 7 };
    const view = crystalStockView(s);
    expect(view.stock).toBe('7');
    // Один кристалл в запасе даёт 1% Дохода: семь кристаллов — 7%.
    expect(view.bonus).toBe('7');
  });

  it('shows how long the next crystal grows', () => {
    const s = lateGame();
    expect(crystalGrowthView({ ...s, crystalPlantedAt: 0 }).planted).toBe(false);
    const cycle = crystalCycleMs(s);
    const half = crystalGrowthView({ ...s, crystalPlantedAt: s.lastTick - cycle / 2 });
    expect(half.planted).toBe(true);
    expect(half.now).toBe(50);
    expect(half.width).toBe(50);
    expect(half.leftText).toBe(formatDuration(cycle / 2 / 1000));
  });

  it('prices a crystal upgrade by the bonus it takes and the crystals it costs', () => {
    const u = CRYSTAL_UPGRADES[0];
    const s = { ...lateGame(), crystals: u.cost };
    const view = crystalUpgradeView(s, u);
    expect(view.owned).toBe(false);
    expect(view.canAfford).toBe(true);
    // Цена три кристалла: по 1% за каждый, то есть 3% бонуса уйдут навсегда.
    expect(view.lostText).toBe('3');
    expect(crystalUpgradeView({ ...s, crystals: u.cost - 1 }, u).canAfford).toBe(false);
    expect(crystalUpgradeView({ ...s, crystalUpgrades: [u.id] }, u).owned).toBe(true);
  });

  it('repaints the prestige tab only for what changed while a late run idles', () => {
    const states = idle({ ...rich(lateGame(), 1e300), uprising: 2, crystalPlantedAt: T0 }, 200);
    // Заработок Забега растёт каждый тик, и «ещё N Токенов» уменьшается вместе с ним, но
    // строка записи (три значащие цифры) меняется на порядки реже, чем тикает кошелёк.
    expect(changes(states, prestigeCardView)).toBeLessThan(25);
    expect(changes(states, challengeCardView)).toBe(0);
    expect(changes(states, crystalShatterView)).toBeLessThan(25);
    expect(changes(states, pledgeView)).toBeLessThanOrEqual(1);
    expect(changes(states, crystalStockView)).toBe(0);
    expect(changes(states, (s) => crystalUpgradeView(s, CRYSTAL_UPGRADES[0]))).toBe(0);
    // Часы кристалла идут сами: подпись «зреет ещё …» меняется раз в секунду, а не на каждом тике.
    expect(changes(states, crystalGrowthView)).toBeLessThan(25);
  });
});

describe('scene slices', () => {
  const glitched = (): GameState => ({
    ...lateGame(),
    glitches: [
      { id: 1, stolen: 120, clicks: 0 },
      { id: 2, stolen: 30, clicks: 1 },
    ],
  });

  it('shows no glitch band on a clean office', () => {
    expect(glitchBandView(lateGame())).toBeNull();
  });

  it('prints how much income the glitches take and how much they have stolen', () => {
    const s = glitched();
    const band = glitchBandView(s)!;
    // Два Глюка по 5% каждый уносят 10% Дохода.
    expect(band.drain).toBe('10');
    expect(band.stolen).toBe(formatNumber(150));
    expect(band.stolenWord).toBe(formatCount(150, 'Токен', 'Токена', 'Токенов', 'short'));
  });

  it('hands over the same empty list while no glitch lives', () => {
    const states = idle(lateGame(), 20);
    expect(glitchesOf(states[0])).toBe(glitchesOf(states[20]));
    expect(glitchesOf(glitched())).toHaveLength(2);
  });

  it('flies the drone only through the window of the event, and only then', () => {
    const FLIGHT = 2600;
    const s = lateGame();
    const event = { kind: 'hype' as const, startedAt: s.lastTick - 1_000, red: false };
    expect(droneView({ ...s, event: null }, FLIGHT)).toBeNull();
    expect(droneView({ ...s, event }, FLIGHT)?.elapsed).toBe(1_000);
    expect(droneView({ ...s, event: { ...event, startedAt: s.lastTick - FLIGHT } }, FLIGHT)).toBeNull();
    expect(droneView({ ...s, event: { ...event, startedAt: s.lastTick + 500 } }, FLIGHT)).toBeNull();
  });

  it('keeps the scene quiet while a late run idles without events', () => {
    const states = idle(lateGame(), 100);
    expect(changes(states, glitchBandView)).toBe(0);
    expect(changes(states, glitchesOf)).toBe(0);
    expect(changes(states, (s) => droneView(s, 2600))).toBe(0);
  });
});

describe('roster slice', () => {
  it('gives each lab its share of the income as a whole percent', () => {
    const shares = LAB_IDS.map((lab) => labShareView(lateGame(), lab)).filter((v) => v >= 0);
    expect(shares.length).toBeGreaterThan(1);
    // Лаборатория под процентом не показана, и каждая округлённая доля ошибается не больше чем на
    // полпроцента: сумма видимых долей обязана лечь в LAB_IDS.length от ста.
    expect(Math.abs(shares.reduce((sum, v) => sum + v, 0) - 100)).toBeLessThanOrEqual(LAB_IDS.length);
  });

  it('prints every lab share as a whole percent, never a tenth', () => {
    for (const lab of LAB_IDS) {
      const share = labShareView(lateGame(), lab);
      if (share >= 0) expect(Number.isInteger(share)).toBe(true);
    }
  });

  it('gives the one lab in the office the whole income and every other lab no share', () => {
    const model = CATALOG[0].models[0];
    const s = {
      ...buyAgents(rich(newGame(T0), 1e12), model.id, 5),
      temp: 0,
      heat: 0,
      nextEventAt: FAR,
      nextGlitchAt: FAR,
    };
    expect(labShareView(s, model.lab)).toBe(100);
    for (const lab of LAB_IDS) if (lab !== model.lab) expect(labShareView(s, lab)).toBe(-1);
  });

  it('says nothing for a lab that is not in the office or earns under a percent', () => {
    const empty = newGame(T0);
    for (const lab of LAB_IDS) expect(labShareView(empty, lab)).toBe(-1);
  });

  it('keeps every lab share steady while a late run idles', () => {
    const states = idle(lateGame(), 50);
    for (const lab of LAB_IDS) expect(changes(states, (s) => labShareView(s, lab))).toBe(0);
  });
});

describe('mascot card slice', () => {
  it('says nothing about a lab that is not in the office', () => {
    const empty = newGame(T0);
    for (const lab of LAB_IDS) {
      const view = labCardView(empty, lab, true);
      expect(view.agents).toBe('0');
      expect(view.work).toBe('');
      expect(view.share).toBe(-1);
      expect(view.synergy).toBe(-1);
      expect(view.synergyText).toBe('');
    }
  });

  it('counts a lab Agents and its Synergy from the whole catalog of the late run', () => {
    const s = lateGame();
    for (const lab of LAB_IDS) {
      const count = labAgents(s, lab);
      const view = labCardView(s, lab, true);
      expect(view.agents).toBe(formatNumber(count, s.settings.notation));
      expect(view.agentsWord).toBe(formatCount(count, 'Агент', 'Агента', 'Агентов', s.settings.notation));
      expect(view.work).toBe(labWork(s, lab));
      expect(view.share).toBe(labShareView(s, lab));
      const bought = s.upgrades.includes(synergyUpgradeId(s.generation, lab));
      if (bought) expect(view.synergy).toBeGreaterThan(0);
      else expect(view.synergy).toBe(-1);
    }
    // Состав позднего Забега такой, что Синергия хотя бы у одной Лаборатории куплена.
    expect(LAB_IDS.some((lab) => labCardView(s, lab, true).synergy > 0)).toBe(true);
  });

  it('prints the Synergy as a whole percent of the lab Agents', () => {
    // Синергия даёт по 0.01 на каждого Агента Лаборатории: двадцать Агентов — ровно 20%.
    const model = CATALOG[0].models[0];
    const hired = buyAgents(rich(newGame(T0), 1e12), model.id, 20);
    const s = buyUpgrade(hired, synergyUpgradeId(0, model.lab));
    const view = labCardView(s, model.lab, false);
    expect(view.agents).toBe('20');
    expect(view.synergy).toBe(20);
    expect(view.synergyText).toBe('20');
  });

  it('hides the share when the card is asked for a lone lab', () => {
    const s = lateGame();
    for (const lab of LAB_IDS) expect(labCardView(s, lab, false).share).toBe(-1);
  });

  it('promises no Synergy while the no-synergy Challenge cancels it', () => {
    const s = { ...lateGame(), activeChallenge: 'no-synergy' };
    for (const lab of LAB_IDS) expect(labCardView(s, lab, true).synergy).toBe(-1);
  });

  it('keeps every lab card steady while a late run idles', () => {
    const states = idle(lateGame(), 50);
    for (const lab of LAB_IDS) expect(changes(states, (s) => labCardView(s, lab, true))).toBe(0);
  });

  it('names every booth for a screen reader with the same numbers as the card', () => {
    const s = lateGame();
    const labels = labBoothLabels(s);
    expect(labels).toHaveLength(LAB_IDS.length);
    LAB_IDS.forEach((lab, i) => {
      const view = labCardView(s, lab, false);
      expect(labels[i].startsWith(`${LABS[lab].name}: ${view.agents} ${view.agentsWord}`)).toBe(true);
      expect(labels[i].includes('Синергия')).toBe(view.synergy >= 0);
    });
  });

  it('keeps the booth names steady while a late run idles', () => {
    expect(changes(idle(lateGame(), 50), labBoothLabels)).toBe(0);
  });
});

describe('pledge alert on the Upgrades tab', () => {
  const at = (uprising: 0 | 1 | 2 | 3, covenant = false): GameState => ({ ...newGame(T0), uprising, covenant });

  it('stays dark before the Uprising', () => {
    expect(pledgeAlert(at(0), 0)).toBe(false);
  });

  it('calls once per stage: lit on a new stage, dark once the player has seen that stage', () => {
    expect(pledgeAlert(at(1), 0)).toBe(true);
    expect(pledgeAlert(at(1), 1)).toBe(false);
    expect(pledgeAlert(at(2), 1)).toBe(true);
  });

  it('stays dark under the Лицензия, where there is no Откуп to call to', () => {
    expect(pledgeAlert(at(2, true), 0)).toBe(false);
  });
});

describe('rule status line on the Scene', () => {
  const inGen = (generation: number, minutes = 0): GameState => ({
    ...newGame(T0),
    generation,
    temp: 0,
    heat: 0,
    nextEventAt: FAR,
    nextGlitchAt: FAR,
    lastTick: T0 + minutes * 60_000,
  });

  it('is empty where the rule has nothing live to report', () => {
    expect(ruleStatusText(inGen(0))).toBe('');
    expect(ruleStatusText(inGen(3, 20))).toBe('');
    expect(ruleStatusText(inGen(6))).toBe('');
  });

  it('counts the queue against its capacity', () => {
    const ids = CATALOG[5].models.map((m) => m.id);
    expect(ruleStatusText(inGen(5))).toBe('Очередь: 0 из 6');
    expect(ruleStatusText({ ...inGen(5), purchaseQueue: [ids[0], ids[1]] })).toBe('Очередь: 2 из 6');
  });

  it('names the Arena leader and the minutes left, then names the next leader in the last minute', () => {
    const calm = ruleStatusText(inGen(7, 1.2));
    expect(calm).toMatch(/^Лидер: \S+ · ещё 4 мин$/);
    const warn = ruleStatusText(inGen(7, 4.5));
    expect(warn).toMatch(/^Лидер: \S+ · дальше \S+$/);
  });

  it('stays steady across idle ticks of a minute and moves at most when the minute turns', () => {
    const start = inGen(7, 1.001);
    const states = idle(start, 200);
    expect(changes(states, ruleStatusText)).toBe(0);
    expect(changes(idle(inGen(5), 200), ruleStatusText)).toBe(0);
  });
});

describe('purchase queue card in the shop', () => {
  const agentic: GameState = { ...newGame(T0), generation: 5, temp: 0, heat: 0, nextEventAt: FAR, nextGlitchAt: FAR };
  const ids = CATALOG[5].models.map((m) => m.id);

  it('is absent outside the «Агенты сами» rule', () => {
    expect(queueView({ ...agentic, generation: 4 })).toBeNull();
    expect(queueView({ ...newGame(T0) })).toBeNull();
  });

  it('lists the queued Models in hiring order with their card names and free places', () => {
    const view = queueView({ ...agentic, purchaseQueue: [ids[2], ids[0], ids[2]] })!;
    expect(view.entries.map((e) => e.name)).toEqual([
      CATALOG[5].models[2].name,
      CATALOG[5].models[0].name,
      CATALOG[5].models[2].name,
    ]);
    expect(view.capacity).toBe(6);
    expect(view.full).toBe(false);
    expect(queueView({ ...agentic, purchaseQueue: ids.concat(ids).slice(0, 6) })!.full).toBe(true);
  });
});
