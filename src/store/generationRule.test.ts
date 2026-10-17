import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from './useGameStore';
import { CATALOG } from '../economy/catalog';
import { newsPool } from '../economy/news';
import { newGame, type GameState } from '../economy/state';
import { GENERATION_RULES } from '../data/generationRules';

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

/** Престиж так, как его делает игрок: Курс выбирается до подтверждения, без выбора стор не пускает. */
const prestigeNow = (): void => {
  store().chooseCourse(state().courseOffer[0]);
  store().triggerPrestige();
};

/** Игрок, стоящий на Флагмане Поколения `index` и готовый к Престижу в следующее. */
const atFlagship = (index: number): void => {
  freshStore();
  useGameStore.setState({ state: { ...state(), generation: index, maxGeneration: index } });
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

describe('вход в Поколение с Правилом', () => {
  for (const rule of GENERATION_RULES) {
    it(`«${rule.name}»: лента и реплика Модели объявляют Правило при Престиже`, () => {
      atFlagship(rule.generation - 1);
      expect(state().generation).toBe(rule.generation - 1);
      prestigeNow();
      expect(state().generation).toBe(rule.generation);
      expect(store().news).toBe(rule.news);
      expect(store().lastQuip?.text).toBe(rule.quip.text);
      expect(store().lastQuip?.lab).toBe(rule.quip.lab);
    });

    it(`«${rule.name}»: реплика Правила не попадает в Переписку и гаснет сама`, () => {
      atFlagship(rule.generation - 1);
      const heardBefore = state().quipsSeen;
      prestigeNow();
      expect(state().quipsSeen).toEqual(heardBefore);
      expect(store().lastQuip).not.toBeNull();
      vi.advanceTimersByTime(60_000);
      expect(store().lastQuip).toBeNull();
    });

    it(`«${rule.name}»: Новостная лента держит строку Правила весь Забег, и только в своём Поколении`, () => {
      const inRule: GameState = { ...newGame(T0), generation: rule.generation };
      expect(newsPool(inRule)).toContain(rule.news);
      for (const g of CATALOG) {
        if (g.index === rule.generation) continue;
        expect(newsPool({ ...newGame(T0), generation: g.index })).not.toContain(rule.news);
      }
    });
  }

  it('«Рассвет» остаётся без Правила: ни ленты, ни реплики Правила в нём нет', () => {
    freshStore();
    expect(state().generation).toBe(0);
    expect(GENERATION_RULES.some((r) => r.generation === 0)).toBe(false);
    for (const r of GENERATION_RULES) expect(newsPool(state())).not.toContain(r.news);
    expect(store().lastQuip).toBeNull();
  });
});
