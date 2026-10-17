import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from './useGameStore';
import { CATALOG } from '../economy/catalog';
import { clickValue, totalIncome } from '../economy/engine';
import { newGame, type GameState } from '../economy/state';

/** Звук и музыка заглушены: в node нет AudioContext, а проверяется здесь только то, что видит игрок. */
vi.mock('../audio/sound', () => ({
  playAchievementSound: vi.fn(),
  playBuySound: vi.fn(),
  playClickSound: vi.fn(),
  playCrashSound: vi.fn(),
  playEventAlertSound: vi.fn(),
  playFinaleSound: vi.fn(),
  playGlitchHitSound: vi.fn(),
  playGlitchPopSound: vi.fn(),
  playPrestigeSound: vi.fn(),
  playQuipSound: vi.fn(),
  playRestartSound: vi.fn(),
  playUpgradeSound: vi.fn(),
  playVoice: vi.fn(),
  audioBus: vi.fn(() => null),
  setAudioHidden: vi.fn(),
}));
vi.mock('../audio/sfx', () => ({
  playCrystalSound: vi.fn(),
  playMilestoneSound: vi.fn(),
  playPrestigeConfirmSound: vi.fn(),
  playToggleSound: vi.fn(),
}));
vi.mock('../audio/music', () => ({ duckMusic: vi.fn() }));
vi.mock('../audio/thermal', () => ({
  updateThermalAudio: vi.fn(),
  playCoolingSound: vi.fn(),
  playHallucinationSound: vi.fn(),
}));

const T0 = 1_700_000_000_000;
const store = () => useGameStore.getState();
const state = () => store().state;
const REASONING = 4;

/** Забег Reasoning с тремя Агентами: Клик стоит больше масштаба, Температура и События не вмешиваются. */
const reasoningRun = (): void => {
  store().resetGame();
  const s: GameState = {
    ...newGame(T0),
    generation: REASONING,
    maxGeneration: REASONING,
    agents: { [CATALOG[REASONING].models[0].id]: 3 },
    temp: 0,
    heat: 0,
    nextEventAt: T0 + 1e12,
    nextGlitchAt: T0 + 1e12,
  };
  vi.setSystemTime(T0);
  useGameStore.setState({ state: s, floaters: [], toasts: [] });
};

/** Одна секунда игры тиками по 0,1 с, на каждом из которых клавиша «повторяется». */
const holdKeyFor = (sec: number): void => {
  for (let t = 0; t < Math.round(sec * 10); t++) {
    vi.setSystemTime(Date.now() + 100);
    store().tick(0.1);
    store().holdClick(10, 10, true);
  }
};

beforeEach(() => {
  vi.useFakeTimers();
  reasoningRun();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('«Подумай ещё»: удержание клавиши', () => {
  it('первое нажатие — обычный Клик, как и вне Правила', () => {
    const price = clickValue(state());
    const before = state().tokens;
    expect(store().holdClick(10, 10)).toBe(true);
    expect(state().tokens - before).toBe(price);
    expect(state().clicks).toBe(1);
  });

  it('повтор удержанной клавиши не платит по Клику, а копит размышление', () => {
    store().holdClick(10, 10);
    const clicks = state().clicks;
    holdKeyFor(1);
    expect(state().clicks).toBe(clicks);
    expect(state().thought).toBeGreaterThan(0.5);
  });

  it('после отпускания платит одним ударом, и всплывающее число называет выплату', () => {
    store().holdClick(10, 10);
    holdKeyFor(2);
    const held = state();
    const heldSec = held.thought;
    expect(heldSec).toBeGreaterThan(1.5);
    useGameStore.setState({ floaters: [] });
    const price = clickValue(held);
    const tokens = held.tokens;
    // Клавишу отпустили: ни одной порции, тики идут дальше и закрывают удержание.
    for (let i = 0; i < 8; i++) {
      vi.setSystemTime(Date.now() + 100);
      store().tick(0.1);
    }
    const after = state();
    expect(after.thought).toBe(0);
    const earnedByIncome = totalIncome(held) * 0.8;
    const paid = after.tokens - tokens - earnedByIncome;
    // 8 Кликов в секунду × секунды × надбавка (1 + 0,25 × секунды) — по таблице Правила.
    expect(paid / price).toBeCloseTo(8 * heldSec * (1 + 0.25 * heldSec), 0);
    expect(store().floaters.length).toBe(1);
    expect(store().floaters[0].text.startsWith('+')).toBe(true);
  });

  it('вне Reasoning повтор клавиши остаётся обычным Кликом', () => {
    useGameStore.setState({ state: { ...state(), generation: 3 } });
    const price = clickValue(state());
    const before = state().tokens;
    expect(store().holdClick(10, 10, true)).toBe(true);
    expect(state().tokens - before).toBe(price);
    expect(state().thought).toBe(0);
  });

  it('длинный тик простоя размышление не трогает', () => {
    store().holdClick(10, 10);
    holdKeyFor(1);
    const { thought, thoughtAt } = state();
    store().tick(3600);
    expect(state().thought).toBe(thought);
    expect(state().thoughtAt).toBe(thoughtAt);
  });
});

describe('«Подумай ещё»: удержание пальцем и мышью', () => {
  const press = (on: boolean): void => store().setPointerHold(on, 10, 10);
  const idle = (sec: number): void => {
    for (let t = 0; t < Math.round(sec * 10); t++) {
      vi.setSystemTime(Date.now() + 100);
      store().tick(0.1);
    }
  };

  it('короткое нажатие остаётся обычным Кликом: отпускание не гасится', () => {
    press(true);
    idle(0.1);
    press(false);
    expect(store().consumeHeldClick()).toBe(false);
    expect(state().thought).toBe(0);
  });

  it('долгое нажатие копит размышление, а отпускание не добавляет обычного Клика', () => {
    press(true);
    idle(2);
    expect(state().thought).toBeGreaterThan(1);
    press(false);
    expect(store().consumeHeldClick()).toBe(true);
    // Отметка одноразовая: следующий обычный Клик уже не гасится.
    expect(store().consumeHeldClick()).toBe(false);
    idle(1);
    expect(state().thought).toBe(0);
    expect(state().clicks).toBeGreaterThan(0);
  });

  it('вне Reasoning нажатие ничего не копит', () => {
    useGameStore.setState({ state: { ...state(), generation: 3 } });
    press(true);
    idle(2);
    expect(state().thought).toBe(0);
    press(false);
    expect(store().consumeHeldClick()).toBe(false);
  });
});
