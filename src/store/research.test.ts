import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from './useGameStore';
import { newGame, type GameState } from '../economy/state';
import { isResearchReady, RESEARCH_BOOST_WINDOW_MS, RESEARCH_DURATION_MS, RESEARCH_FINETUNE_YIELD } from '../economy/research';
import { CATALOG } from '../economy/catalog';
import { FINETUNE_QUIPS } from '../data/finetuneQuips';
import { playAchievementSound, playUpgradeSound } from '../audio/sound';

/** Звук заглушен: в node нет AudioContext, а здесь важно только, что игрок получил сигнал. */
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

const freshStore = (s: GameState = newGame(T0)): void => {
  store().resetGame();
  useGameStore.setState({ state: { ...s, temp: 0, heat: 0 }, toasts: [], buyAmount: 1, lastQuip: null, lastBoughtModelId: null });
};

beforeEach(() => {
  vi.useFakeTimers();
  freshStore();
  vi.mocked(playUpgradeSound).mockClear();
  vi.mocked(playAchievementSound).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Исследование в сторе', () => {
  it('закладка берёт часы игры и занимает слот, а звук и сохранение идут сразу', () => {
    store().plantResearch('2h');
    expect(state().research).toEqual([{ kind: 'boost', term: '2h', startedAt: state().lastTick }]);
    expect(vi.mocked(playUpgradeSound)).toHaveBeenCalledTimes(1);
  });

  it('закладка при занятых слотах не меняет состояние и не звучит', () => {
    store().plantResearch('30m');
    store().plantResearch('8h');
    const before = state();
    store().plantResearch('2h');
    expect(state()).toBe(before);
    expect(vi.mocked(playUpgradeSound)).toHaveBeenCalledTimes(2);
  });

  it('сбор готового выдаёт усиление, освобождает слот и звучит наградой', () => {
    store().plantResearch('30m');
    const planted = state().lastTick;
    useGameStore.setState({ state: { ...state(), lastTick: planted + RESEARCH_DURATION_MS['30m'] } });
    store().collectResearch(0);
    expect(state().research).toEqual([]);
    expect(state().researchBoostUntil).toBe(planted + RESEARCH_DURATION_MS['30m'] + RESEARCH_BOOST_WINDOW_MS['30m']);
    expect(vi.mocked(playAchievementSound)).toHaveBeenCalledTimes(1);
  });

  it('сбор не созревшего ничего не меняет и молчит', () => {
    store().plantResearch('2h');
    const before = state();
    store().collectResearch(0);
    expect(state()).toBe(before);
    expect(vi.mocked(playAchievementSound)).not.toHaveBeenCalled();
  });

  it('готовое ждёт сбора: тики сорок минут не забирают его, а слот занят', () => {
    store().plantResearch('30m');
    // Тики по 9 с — ниже порога простоя, то есть живой ход игры, как у App.tsx.
    for (let i = 0; i < 300; i++) store().tick(9);
    expect(state().lastTick - T0).toBeGreaterThanOrEqual(RESEARCH_DURATION_MS['30m']);
    expect(state().research).toHaveLength(1);
    expect(state().researchBoostUntil).toBe(0);
  });

  it('закладка с видом «Заготовка» попадает в слот с этим видом', () => {
    store().plantResearch('2h', 'finetune');
    expect(state().research).toEqual([{ kind: 'finetune', term: '2h', startedAt: state().lastTick }]);
  });

  it('сбор Заготовки кладёт её в запас, а не в усиление', () => {
    store().plantResearch('30m', 'finetune');
    const planted = state().lastTick;
    useGameStore.setState({ state: { ...state(), lastTick: planted + RESEARCH_DURATION_MS['30m'] } });
    store().collectResearch(0);
    expect(state().finetuneStock).toBe(RESEARCH_FINETUNE_YIELD['30m']);
    expect(state().researchBoostUntil).toBe(0);
  });
});

describe('Файнтюн в сторе (ТЗ #116)', () => {
  const hired = CATALOG[0].models[0];

  const withStock = (stock: number) =>
    useGameStore.setState({ state: { ...state(), finetuneStock: stock, agents: { [hired.id]: 1 } } });

  it('применение списывает Заготовку, записывает архетип и звучит, а Модель отвечает репликой своей Лаборатории', () => {
    withStock(1);
    store().applyFinetune(hired.id, 'thinking');
    expect(state().finetunes).toEqual({ [hired.id]: 'thinking' });
    expect(state().finetuneStock).toBe(0);
    expect(vi.mocked(playUpgradeSound)).toHaveBeenCalledTimes(1);
    expect(store().lastQuip?.lab).toBe(hired.lab);
    const lines = FINETUNE_QUIPS.filter((q) => q.archetype === 'thinking').map((q) => q.id);
    expect(lines).toContain(store().lastQuip?.id);
  });

  it('реплика Файнтюна не попадает в «Переписку» и гаснет по своему таймеру', () => {
    withStock(1);
    store().applyFinetune(hired.id, 'turbo');
    expect(state().quipsSeen).toEqual([]);
    expect(store().lastQuip).not.toBeNull();
    vi.advanceTimersByTime(4500);
    expect(store().lastQuip).toBeNull();
  });

  it('без Заготовки применение молчит: ни состояния, ни звука, ни реплики', () => {
    withStock(0);
    const before = state();
    store().applyFinetune(hired.id, 'thinking');
    expect(state()).toBe(before);
    expect(vi.mocked(playUpgradeSound)).not.toHaveBeenCalled();
    expect(store().lastQuip).toBeNull();
  });
});

describe('ускорение Исследования в сторе', () => {
  it('тратит кристалл, сдвигает готовность на четверть срока и звучит как трата', () => {
    useGameStore.setState({ state: { ...state(), crystals: 2 } });
    store().plantResearch('2h');
    vi.mocked(playUpgradeSound).mockClear();
    store().hasteResearch(0);
    expect(state().crystals).toBe(1);
    // Срок 2 часа, четверть — полчаса: готовность от закладки в T0 наступает на 90-й минуте, а не на 120-й.
    expect(isResearchReady(state().research[0], T0 + 90 * 60_000 - 1)).toBe(false);
    expect(isResearchReady(state().research[0], T0 + 90 * 60_000)).toBe(true);
    expect(vi.mocked(playUpgradeSound)).toHaveBeenCalledTimes(1);
  });

  it('без целого кристалла ничего не меняет и молчит', () => {
    store().plantResearch('2h');
    const before = state();
    vi.mocked(playUpgradeSound).mockClear();
    store().hasteResearch(0);
    expect(state()).toBe(before);
    expect(vi.mocked(playUpgradeSound)).not.toHaveBeenCalled();
  });
});
