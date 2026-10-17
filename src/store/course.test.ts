import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from './useGameStore';
import { CATALOG } from '../economy/catalog';
import { newGame, type GameState } from '../economy/state';
import { serialize } from '../economy/save';
import { COURSE_BY_ID } from '../data/courses';

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

const freshStore = (s: GameState = newGame(T0)): void => {
  store().resetGame();
  useGameStore.setState({ state: { ...s, temp: 0, heat: 0 }, toasts: [], buyAmount: 1, lastQuip: null, lastBoughtModelId: null });
};

/** Игрок, стоящий на Флагмане Поколения `index`: Престиж открыт, три Курса лежат в состоянии. */
const atFlagship = (index: number): void => {
  freshStore();
  useGameStore.setState({ state: { ...state(), generation: index, maxGeneration: index, prestiges: index } });
  useGameStore.setState({ state: { ...state(), tokens: 1e50, runTokens: 1e50 }, buyAmount: 1 });
  store().buyAgents(CATALOG[index].flagship.id);
};

beforeEach(() => {
  vi.useFakeTimers();
  freshStore();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Курс в сторе: выбор до Престижа', () => {
  it('найм Флагмана кладёт три варианта в состояние', () => {
    atFlagship(0);
    expect(state().courseOffer).toHaveLength(3);
    expect(state().courseNext).toBeNull();
  });

  it('Престиж без выбранного Курса не выполняется: Поколение, Агенты и Compute на месте', () => {
    atFlagship(1);
    const before = state();
    store().triggerPrestige();
    expect(state()).toBe(before);
    expect(store().burst?.kind).not.toBe('prestige');
  });

  it('выбранный Курс озвучивает Маскот его Лаборатории, и реплика не попадает в Переписку', () => {
    atFlagship(1);
    const seen = state().quipsSeen;
    const id = state().courseOffer[0];
    store().chooseCourse(id);
    expect(state().courseNext).toBe(id);
    expect(store().lastQuip?.text).toBe(COURSE_BY_ID[id].quip);
    expect(store().lastQuip?.lab).toBe(COURSE_BY_ID[id].lab);
    expect(state().quipsSeen).toEqual(seen);
  });

  it('Престиж после выбора делает Курс действующим и оставляет его на весь Забег', () => {
    atFlagship(1);
    const id = state().courseOffer[2];
    store().chooseCourse(id);
    store().triggerPrestige();
    expect(state().generation).toBe(2);
    expect(state().course).toBe(id);
    expect(state().courseOffer).toEqual([]);
    expect(state().courseNext).toBeNull();
    expect(store().burst?.kind).toBe('prestige');
  });

  it('внутри Забега Курс не сменить: выбор без предложения молчит, состояние то же', () => {
    atFlagship(1);
    store().chooseCourse(state().courseOffer[0]);
    store().triggerPrestige();
    const mid = state();
    const quip = store().lastQuip;
    for (const id of Object.keys(COURSE_BY_ID)) store().chooseCourse(id);
    expect(state()).toBe(mid);
    expect(state().course).not.toBeNull();
    expect(store().lastQuip).toBe(quip);
  });

  it('чужой Курс не принимается: ни выбора, ни новой реплики', () => {
    atFlagship(1);
    const foreign = Object.keys(COURSE_BY_ID).find((id) => !state().courseOffer.includes(id))!;
    const before = state();
    const quip = store().lastQuip;
    store().chooseCourse(foreign);
    expect(state()).toBe(before);
    expect(store().lastQuip).toBe(quip);
  });

  it('передумать можно до подтверждения: последний выбор побеждает', () => {
    atFlagship(1);
    const [a, , c] = state().courseOffer;
    store().chooseCourse(a);
    store().chooseCourse(c);
    store().triggerPrestige();
    expect(state().course).toBe(c);
  });
});

describe('Курс в сторе: путь к выбору', () => {
  it('окно Престижа ведёт к выбору Курса: закрывается, открывается подраздел «Престиж» вкладки «Престиж»', () => {
    atFlagship(1);
    useGameStore.setState({ prestigePrompt: true, activeTab: 'click', shopTab: 'models', prestigeSection: 'perks' });
    store().openCourseChoice();
    expect(store().prestigePrompt).toBe(false);
    expect(store().activeTab).toBe('shop');
    expect(store().shopTab).toBe('prestige');
    expect(store().prestigeSection).toBe('prestige');
    expect(state().courseNext).toBeNull();
  });
});

describe('Курс в сторе: перезагрузка между предложением и выбором', () => {
  /** Загрузка читает localStorage и Date.now(), поэтому окно и хранилище подставляются. */
  const reloadWith = async (save: string) => {
    vi.stubGlobal('window', { innerWidth: 800, innerHeight: 600 });
    vi.stubGlobal('localStorage', { getItem: () => save, setItem: () => {}, removeItem: () => {} });
    vi.resetModules();
    const reloaded = await import('./useGameStore');
    const snapshot = reloaded.useGameStore.getState();
    vi.unstubAllGlobals();
    return snapshot;
  };

  it('не меняет три варианта и не теряет сделанный выбор', async () => {
    vi.useRealTimers();
    atFlagship(2);
    const offer = state().courseOffer;
    const now = Date.now();
    const asSaved = { ...state(), lastTick: now };

    const afterOffer = await reloadWith(serialize(asSaved));
    expect(afterOffer.state.courseOffer).toEqual(offer);
    expect(afterOffer.state.courseNext).toBeNull();

    const picked = { ...asSaved, courseNext: offer[1] };
    const afterPick = await reloadWith(serialize(picked));
    expect(afterPick.state.courseOffer).toEqual(offer);
    expect(afterPick.state.courseNext).toBe(offer[1]);
  });
});
