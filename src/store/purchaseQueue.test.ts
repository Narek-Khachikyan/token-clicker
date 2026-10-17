import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from './useGameStore';
import { CATALOG } from '../economy/catalog';
import { OFFLINE_THRESHOLD_SEC } from '../economy/engine';
import { playBuySound } from '../audio/sound';
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
const AGENTIC = 5;
const models = CATALOG[AGENTIC].models;

/** Забег в «Агентной» с полным кошельком; Температура и окна События/Глюка убраны, чтобы тик не вмешивался. */
const freshAgentic = (over: Partial<GameState> = {}): void => {
  store().resetGame();
  useGameStore.setState({
    state: {
      ...newGame(T0),
      generation: AGENTIC,
      maxGeneration: AGENTIC,
      temp: 0,
      heat: 0,
      nextEventAt: T0 + 3_600_000,
      nextGlitchAt: T0 + 3_600_000,
      tokens: 1e40,
      runTokens: 1e40,
      ...over,
    },
    toasts: [],
    buyAmount: 1,
    lastQuip: null,
    lastBoughtModelId: null,
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(playBuySound).mockClear();
  freshAgentic();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Очередь закупок в сторе', () => {
  it('ставит Агентов в очередь действием игрока и снимает по одному', () => {
    store().queueAgent(models[0].id);
    store().queueAgent(models[2].id);
    expect(state().purchaseQueue).toEqual([models[0].id, models[2].id]);
    store().unqueueAgent(0);
    expect(state().purchaseQueue).toEqual([models[2].id]);
    store().clearQueue();
    expect(state().purchaseQueue).toEqual([]);
  });

  it('исполняется на живом тике: Агент нанят, запись снята, покупка звучит один раз', () => {
    store().queueAgent(models[0].id);
    store().queueAgent(models[1].id);
    store().tick(0.05);
    expect(state().purchaseQueue).toEqual([]);
    expect(state().agents[models[0].id]).toBe(1);
    expect(state().agents[models[1].id]).toBe(1);
    expect(playBuySound).toHaveBeenCalledTimes(1);
  });

  it('молчит, пока нечего исполнять: тик без записей не звучит', () => {
    store().tick(0.05);
    expect(playBuySound).not.toHaveBeenCalled();
  });

  it('не исполняется на длинном тике простоя и ждёт живого', () => {
    store().queueAgent(models[0].id);
    store().tick(OFFLINE_THRESHOLD_SEC + 5);
    expect(state().purchaseQueue).toEqual([models[0].id]);
    expect(state().agents).toEqual({});
    expect(playBuySound).not.toHaveBeenCalled();
    store().tick(0.05);
    expect(state().purchaseQueue).toEqual([]);
    expect(state().agents[models[0].id]).toBe(1);
  });

  it('Флагман из очереди поднимает Восстание, как ручная покупка', () => {
    const flagship = CATALOG[AGENTIC].flagship;
    expect(state().uprising).toBe(0);
    store().queueAgent(flagship.id);
    store().tick(0.05);
    expect(state().agents[flagship.id]).toBe(1);
    expect(state().uprising).toBeGreaterThan(0);
  });
});
