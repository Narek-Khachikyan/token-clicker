import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectAllowed, SAVE_INTERVAL_MS, SCENE_MOMENT_MS, useGameStore } from './useGameStore';
import { CATALOG } from '../economy/catalog';
import { QUIPS } from '../data/quips';
import { pickQuip } from '../economy/quips';
import { CRYSTAL_CYCLE_MS, CRYSTAL_PER_STOCK_BONUS, CRYSTAL_UPGRADES, crystalCycleMs, crystalIncomeMult } from '../economy/crystal';
import { ACHIEVEMENTS } from '../economy/achievements';
import { formatCount } from '../economy/format';
import {
  BASE_OFFLINE_HOURS,
  buyAgents as engineBuyAgents,
  canPrestige,
  clickValue,
  computeShortfall,
  isContentFinale,
  prestigeGain,
  totalIncome,
} from '../economy/engine';
import { EVENT_TABLES, grantAmount } from '../economy/events';
import { RED_TABLES } from '../economy/glitches';
import {
  GLITCH_CLICKS,
  glitchPayout,
  LICENSE_INCOME_TAX,
  licenseCost,
  PLEDGE_GROWTH,
  PLEDGE_MAX,
  PLEDGE_MS,
  pledgeCost,
  revokeCost,
} from '../economy/glitches';
import { PERKS } from '../economy/perks';
import { exportSave, CORRUPT_SAVE_KEY, SAVE_KEY, serialize } from '../economy/save';
import { newGame, type GameState } from '../economy/state';
import {
  playAchievementSound,
  playBuySound,
  playClickSound,
  playCrashSound,
  playEventAlertSound,
  playFinaleSound,
  playGlitchHitSound,
  playGlitchPopSound,
  playPrestigeSound,
  playQuipSound,
  playUpgradeSound,
} from '../audio/sound';
import { playCrystalSound, playPrestigeConfirmSound, playToggleSound } from '../audio/sfx';
import { duckMusic } from '../audio/music';

/**
 * Звук заглушен целиком: в node нет ни AudioContext, ни окна. `audioBus` отдаёт null — это
 * честный ответ «контекста нет», на который музыка и сигналы sfx.ts обязаны выходить молча.
 */
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

/** Сигналы sfx.ts и приглушение музыки — тоже стороны действий стора, которые здесь проверяются. */
vi.mock('../audio/sfx', () => ({
  playCrystalSound: vi.fn(),
  playMilestoneSound: vi.fn(),
  playPrestigeConfirmSound: vi.fn(),
  playToggleSound: vi.fn(),
}));
vi.mock('../audio/music', () => ({ duckMusic: vi.fn() }));

/** Голос Температуры тоже заглушен: он создаёт осцилляторы и шумовой буфер. */
vi.mock('../audio/thermal', () => ({
  updateThermalAudio: vi.fn(),
  playCoolingSound: vi.fn(),
  playHallucinationSound: vi.fn(),
}));

/** Реальный час, а не T0 из экономики: Престиж ставит lastTick из Date.now(), и часы разошлись бы. */
const T0 = 1_700_000_000_000;
const HOUR = 3600_000;
const g0 = CATALOG[0];
const first = g0.models[0];

const store = () => useGameStore.getState();
const state = () => store().state;
/** Тосты не о Достижениях: пачка Достижений, выданная теми же переходами, к ним не относится. */
const otherToasts = () =>
  store().toasts.filter((t) => t.title !== 'Достижение разблокировано!' && !/^\+\d+ Достижени/.test(t.title));
const rich = (s: GameState, tokens: number): GameState => ({ ...s, tokens, runTokens: tokens });

/**
 * Чистый магазин перед каждым тестом.
 *
 * `resetGame` вместо ручной расстановки: он возвращает и UI-слой (окно события, расписание
 * Глюков) к значениям модуля, поэтому тест не знает ни про один из них. Обращения к
 * localStorage внутри него за `typeof window` не доходят: в node окна нет.
 *
 * `temp: 0` — жар выключен, потому что этот файл проверяет действия стора, а не Температуру:
 * `newGame` стартует с `TEMP_START`, и множитель жара попал бы в те же цифры, что и проверяемое
 * действие. Температура имеет собственные проверки в economy.test.ts.
 */
const freshStore = (s: GameState = newGame(T0)): void => {
  store().resetGame();
  useGameStore.setState({ state: { ...s, temp: 0, heat: 0 }, toasts: [], buyAmount: 1, lastQuip: null, lastBoughtModelId: null });
};

/** Тик без стенного времени: он двигает только игровые часы, по 50 мс за шаг. */
const tick = (seconds = 0.05): void => {
  store().tick(seconds);
};

/** Кошелёк после Престижа пуст, а Агент или Флагман без Токенов не купить. */
const withTokens = (tokens = 1e50): void => {
  useGameStore.setState({ state: rich(state(), tokens) });
};

/** Агенты нужны не только ради Престижа: без них Доход нулевой и Глюку нечего красть. */
const hire = (modelId: string, n: 1 | 10 | 100 = 100): void => {
  withTokens();
  useGameStore.setState({ buyAmount: n });
  store().buyAgents(modelId);
};

/** Игрок, дошедший до Поколения index через честные покупки и Престиж. */
const reachedGeneration = (index: number): void => {
  freshStore();
  for (let g = 0; g < index; g++) {
    hire(CATALOG[g].flagship.id, 1);
    store().triggerPrestige();
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  freshStore();
});

describe('glitch schedule', () => {
  it('holds the first glitch back until the third screen', () => {
    reachedGeneration(2);
    expect(state().generation).toBe(2);
    // Первое окно планируется, а не открывается сразу: спавн на первом тике читался бы как ошибка.
    tick();
    expect(state().glitches).toEqual([]);
    expect(state().nextGlitchAt).toBeGreaterThan(state().lastTick);
  });

  it('spawns one glitch when the window comes, and moves the window into the future', () => {
    reachedGeneration(2);
    hire(CATALOG[2].models[0].id);
    tick();
    useGameStore.setState({ state: { ...state(), nextGlitchAt: state().lastTick } });
    tick();
    expect(state().glitches).toHaveLength(1);
    expect(state().nextGlitchAt).toBeGreaterThan(state().lastTick);
    // Окно сдвинуто, а не осталось в прошлом: иначе глюки сыпались бы каждый тик.
    for (let i = 0; i < 20; i++) tick();
    expect(state().glitches).toHaveLength(1);
  });

  it('spawns glitches without a single toast, the scene shows them', () => {
    reachedGeneration(2);
    hire(CATALOG[2].models[0].id);
    tick();
    useGameStore.setState({ state: { ...state(), nextGlitchAt: state().lastTick } });
    tick();
    expect(state().glitchSeq).toBe(1);
    expect(otherToasts()).toEqual([]);
    useGameStore.setState({ state: { ...state(), nextGlitchAt: state().lastTick } });
    useGameStore.setState({ toasts: [] });
    tick();
    expect(otherToasts()).toEqual([]);
  });

  it('has no schedule at all on the first screen', () => {
    for (let i = 0; i < 50; i++) tick();
    expect(state().glitches).toEqual([]);
    expect(state().nextGlitchAt).toBe(0);
  });
});

describe('uprising', () => {
  it('stays quiet on the first screen and rises with the flagship of the next one', () => {
    freshStore();
    // Флагман Поколения 0 — первый экран: стадия 0, и сплошь красные события на нём не выдаются.
    hire(CATALOG[0].flagship.id, 1);
    expect(state().uprising).toBe(0);
    store().triggerPrestige();
    // Флагман Поколения 1 — порог стадии 1.
    hire(CATALOG[1].flagship.id, 1);
    expect(state().uprising).toBe(1);
    expect(store().toasts.filter((t) => t.title !== 'Достижение разблокировано!' && !t.title.startsWith('+'))).toEqual([]);
  });

  it('raises once per generation and never twice for the same flagship', () => {
    reachedGeneration(2);
    expect(state().uprising).toBe(1);
    hire(CATALOG[2].flagship.id, 1);
    expect(state().uprising).toBe(2);
    // Второй Агент того же Флагмана и обычная Модель того же Поколения стадию не двигают:
    // переход возвращает тот же объект.
    hire(CATALOG[2].flagship.id, 1);
    hire(CATALOG[2].models[0].id);
    expect(state().uprising).toBe(2);
  });
});

/**
 * Кошелёк, с которым видна разница.
 *
 * 1e50 нужен, чтобы дойти до поздних Поколений, но прибавление выплаты к нему тонет в мантиссе:
 * шаг числа на этом порядке больше выплаты целиком, и проверка «стало больше» ничего бы не значила.
 */
const withVisibleWallet = (): void => {
  withTokens(1e6);
};

describe('catching an event', () => {
  const withEvent = (kind: 'grant' | 'hype', red = false): GameState => ({
    ...state(),
    event: { kind, startedAt: state().lastTick, red },
  });

  it('credits a one-off grant into all three counters, and only once per window', () => {
    freshStore();
    hire(first.id, 1);
    withVisibleWallet();
    useGameStore.setState({ state: withEvent('grant') });
    const before = state();
    store().catchEvent();
    // Разность двух чисел порядка миллиона теряет единицы на конце мантиссы, поэтому суммы
    // сверяются с допуском, а не тождеством: иначе проверка ловила бы округление, а не деньги.
    const wanted = grantAmount(before.tokens, totalIncome(before));
    expect(wanted).toBeGreaterThan(0);
    expect(state().tokens - before.tokens).toBeCloseTo(wanted, 6);
    expect(state().runTokens - before.runTokens).toBeCloseTo(wanted, 6);
    expect(state().totalTokens - before.totalTokens).toBeCloseTo(wanted, 6);
    // Второе нажатие на тот же Золотой Токен не платит дважды.
    store().catchEvent();
    expect(state().tokens - before.tokens).toBeCloseTo(wanted, 6);
    expect(store().eventCaught).toBe(true);
  });

  it('charges a crash only on the second press, and lets the player walk away from the window', () => {
    freshStore();
    hire(first.id, 1);
    withVisibleWallet();
    useGameStore.setState({ state: withEvent('grant', true) });
    const before = state();
    store().catchEvent();
    // Первое нажатие только спрашивает: «Крах» отнимает и от запаса, и столько же от Забега, то есть
    // прямо отодвигает Престиж, а второй кнопки у Золотого Токена нет — отказаться было нечем.
    expect(state().tokens).toBe(before.tokens);
    expect(state().eventCaughtAt).toBe(0);
    expect(store().crashArmedAt).toBe(before.event!.startedAt);
    // Взвод назван на самой карточке события (подпись «Списать −N%»), а не тостом.
    expect(otherToasts()).toEqual([]);
    // Ушёл — окно ушло, кошелёк цел: единственная кнопка так и не стала списанием. Доход за время
    // ожидания честно капает в плюс, поэтому сравнение идёт с ним, а не с нулём.
    tick(RED_TABLES.grant.durationMs / 1000 + 1);
    expect(state().tokens).toBeGreaterThan(before.tokens);
    expect(state().eventCaughtAt).toBe(0);

    // Следующее окно «Краха»: без нового подтверждения первое нажатие снова ничего не отнимает,
    // а второе — отнимает, и уже вместе с Забегом.
    useGameStore.setState({ state: withEvent('grant', true), crashArmedAt: 0, toasts: [] });
    const window2 = state();
    store().catchEvent();
    expect(state().tokens).toBe(window2.tokens);
    store().catchEvent();
    expect(state().tokens).toBeLessThan(window2.tokens);
    expect(state().runTokens).toBeLessThan(window2.runTokens);
    expect(state().totalTokens).toBeLessThan(window2.totalTokens);
    expect(state().eventCaughtAt).toBe(window2.event!.startedAt);
    // Окно поймано: третье нажатие не отнимает ничего.
    const charged = state().tokens;
    store().catchEvent();
    expect(state().tokens).toBe(charged);
  });

  it('keeps the catch fence through a reload, so one window can never pay twice', () => {
    freshStore();
    hire(first.id, 1);
    withVisibleWallet();
    useGameStore.setState({ state: withEvent('grant') });
    const before = state();
    store().catchEvent();
    const paid = state().tokens - before.tokens;
    expect(paid).toBeGreaterThan(0);
    // Импорт в середине окна привозит с собой отметку: тот же клик не платит второй раз.
    expect(store().importSaveData(exportSave(state()))).toBe(true);
    const imported = state();
    expect(imported.eventCaughtAt).toBe(imported.event!.startedAt);
    expect(store().eventCaught).toBe(true);
    store().catchEvent();
    expect(state().tokens).toBe(imported.tokens);
    // Объявление окна на первом тике после импорта не воскрешает кнопку: пойманное окно поймано.
    tick();
    expect(store().eventWindowAt).toBe(imported.event!.startedAt);
    expect(store().eventCaught).toBe(true);
    // За тик пришёл только Доход: выплаты за уже пойманное окно не было.
    expect(state().tokens - imported.tokens).toBeCloseTo(totalIncome(imported) * 0.05, 6);
  });

  it('returns the downtime window once for a burst of clicks, never once per click', () => {
    freshStore();
    hire(first.id, 10);
    const rate = totalIncome({ ...state(), event: null });
    const room = rate * RED_TABLES.clickRush.catchUpSec;
    useGameStore.setState({ state: { ...state(), event: { kind: 'clickRush', startedAt: state().lastTick, red: true } } });
    const before = state().tokens;
    for (let i = 0; i < 10; i++) store().clickPrompt(10, 10);
    // Десять Кликов плюс объём окна один раз: возврат за каждый Клик давал бы десять окон.
    expect(state().tokens - before).toBeLessThanOrEqual(10 * clickValue({ ...state(), event: null }) + room);
    expect(state().catchUpPaid).toBeCloseTo(room);
  });

  it('switches a temporary event on at the catch, and pays nothing lump-sum', () => {
    freshStore();
    hire(first.id, 1);
    withVisibleWallet();
    useGameStore.setState({ state: withEvent('hype') });
    const before = state();
    // Пока Золотой Токен не пойман, Волна хайпа не платит: Доход прежний.
    expect(totalIncome(before)).toBeCloseTo(totalIncome({ ...before, event: null }));
    store().catchEvent();
    // Разовой выплаты нет: Токены те же, событие то же, а множитель включился.
    expect(state().tokens).toBe(before.tokens);
    expect(state().event).toEqual(before.event);
    expect(totalIncome(state())).toBeCloseTo(totalIncome({ ...before, event: null }) * EVENT_TABLES.hype.incomeMult);
    expect(store().eventCaught).toBe(true);
    expect(otherToasts()).toEqual([]);
  });

  it('does nothing without a live event', () => {
    const before = state();
    store().catchEvent();
    expect(state()).toBe(before);
    expect(store().eventCaught).toBe(false);
  });

  it('does nothing after the window closed', () => {
    freshStore();
    hire(first.id, 1);
    withVisibleWallet();
    useGameStore.setState({ state: withEvent('grant') });
    tick(EVENT_TABLES.grant.durationMs / 1000 + 1);
    const before = state();
    store().catchEvent();
    expect(state().tokens).toBe(before.tokens);
    expect(store().eventCaught).toBe(false);
  });
});

describe('hitting a glitch', () => {
  it('pops on the third hit and pays what that one glitch stole into all three counters', () => {
    reachedGeneration(2);
    hire(CATALOG[2].models[0].id);
    withVisibleWallet();
    useGameStore.setState({ state: { ...state(), nextGlitchAt: state().lastTick } });
    tick();
    const id = state().glitches[0].id;
    for (let i = 1; i < GLITCH_CLICKS; i++) {
      store().hitGlitch(id);
      expect(state().glitches[0].clicks).toBe(i);
    }
    // Глюк должен что-то украсть, иначе выплата была бы нулевой и проверка ничего не значила.
    for (let i = 0; i < 200; i++) tick();
    const before = state();
    expect(before.glitches).toHaveLength(1);
    store().hitGlitch(id);
    const gained = state().tokens - before.tokens;
    expect(gained).toBeGreaterThan(0);
    expect(state().runTokens - before.runTokens).toBeCloseTo(gained, 6);
    expect(state().totalTokens - before.totalTokens).toBeCloseTo(gained, 6);
    expect(state().glitches).toEqual([]);
  });

  it('ignores a hit on a glitch that is not there', () => {
    reachedGeneration(2);
    const before = state();
    store().hitGlitch(999);
    expect(state()).toBe(before);
  });
});

describe('sounds of player actions', () => {
  it('thuds on a glitch hit and pops only on the last one', () => {
    reachedGeneration(2);
    hire(CATALOG[2].models[0].id);
    useGameStore.setState({ state: { ...state(), nextGlitchAt: state().lastTick } });
    tick();
    const id = state().glitches[0].id;
    for (let i = 1; i < GLITCH_CLICKS; i++) store().hitGlitch(id);
    expect(vi.mocked(playGlitchHitSound)).toHaveBeenCalledTimes(GLITCH_CLICKS - 1);
    expect(vi.mocked(playGlitchPopSound)).not.toHaveBeenCalled();
    store().hitGlitch(id);
    expect(vi.mocked(playGlitchPopSound)).toHaveBeenCalledTimes(1);
  });

  it('sounds the crash only when it is charged, not on the warning press', () => {
    hire(first.id, 1);
    withVisibleWallet();
    useGameStore.setState({ state: { ...state(), event: { kind: 'grant', startedAt: state().lastTick, red: true } } });
    store().catchEvent();
    expect(vi.mocked(playCrashSound)).not.toHaveBeenCalled();
    store().catchEvent();
    expect(vi.mocked(playCrashSound)).toHaveBeenCalledTimes(1);
  });

  it('chimes a crystal that ripens in front of the player, but not one ripened during an absence', () => {
    useGameStore.setState({ state: { ...state(), crystalPlantedAt: state().lastTick - CRYSTAL_CYCLE_MS } });
    tick();
    expect(state().crystals).toBe(1);
    expect(vi.mocked(playCrystalSound)).toHaveBeenCalledTimes(1);

    freshStore();
    vi.mocked(playCrystalSound).mockClear();
    useGameStore.setState({ state: { ...state(), crystalPlantedAt: state().lastTick - CRYSTAL_CYCLE_MS + 30_000 } });
    tick(60);
    expect(state().crystals).toBe(1);
    expect(vi.mocked(playCrystalSound)).not.toHaveBeenCalled();
  });

  it('plays the finale once, on the purchase that reaches it, and ducks the music under it', () => {
    reachedGeneration(CATALOG.length - 1);
    vi.mocked(duckMusic).mockClear();
    hire(CATALOG[CATALOG.length - 1].flagship.id, 1);
    expect(vi.mocked(playFinaleSound)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(duckMusic)).toHaveBeenCalled();
    hire(CATALOG[CATALOG.length - 1].flagship.id, 1);
    expect(vi.mocked(playFinaleSound)).toHaveBeenCalledTimes(1);
  });

  it('clicks the buy/sell switch only when it actually flips', () => {
    store().setSellMode(true);
    store().setSellMode(true);
    expect(vi.mocked(playToggleSound)).toHaveBeenCalledTimes(1);
    expect(store().sellMode).toBe(true);
  });

  it('latches the Prestige prompt with a click only when Prestige can go through', () => {
    store().requestPrestige();
    expect(store().prestigePrompt).toBe(true);
    expect(vi.mocked(playPrestigeConfirmSound)).not.toHaveBeenCalled();
    hire(g0.flagship.id, 1);
    store().requestPrestige();
    expect(vi.mocked(playPrestigeConfirmSound)).toHaveBeenCalledTimes(1);
  });
});

describe('collecting a rumor', () => {
  /**
   * Игрок, у которого выплата слуха считается от запаса Токенов.
   *
   * Агентов много, а кошелёк скромный: «Грант» берёт минимум из запаса Токенов и пятнадцати минут
   * Дохода, и при такой расстановке решает именно процент от запаса. Тогда уменьшение кошелька
   * видно в выплате, а не тонет под потолком Дохода, — иначе проверка «сумма считается в момент
   * нажатия» ничего бы не различала.
   */
  const rumorPlayer = (tokens: number): void => {
    freshStore();
    hire(first.id, 100);
    withTokens(tokens);
  };

  it('credits the payout into all three counters, says the sum, and pays a repeated id nothing', () => {
    rumorPlayer(1e4);
    const before = state();
    const wanted = grantAmount(before.tokens, totalIncome(before));
    expect(wanted).toBeGreaterThan(0);
    vi.mocked(playBuySound).mockClear();
    store().collectRumor(7);
    // Разности, а не тождества: прибавление выплаты к кошельку порядка 1e4 теряет единицы на
    // конце мантиссы, и точное сравнение ловило бы округление, а не деньги.
    expect(state().tokens - before.tokens).toBeCloseTo(wanted, 6);
    expect(state().runTokens - before.runTokens).toBeCloseTo(wanted, 6);
    expect(state().totalTokens - before.totalTokens).toBeCloseTo(wanted, 6);
    // Тостов о Слухах нет: выплату видно в счётчике, а клик отвечает звуком.
    expect(otherToasts()).toEqual([]);
    expect(vi.mocked(playBuySound)).toHaveBeenCalledTimes(1);
    // Тот же слух второй раз: ни Токенов, ни тоста, ни звука, и состояние остаётся тем же объектом.
    const paid = state();
    const toasts = store().toasts.length;
    vi.mocked(playBuySound).mockClear();
    store().collectRumor(7);
    expect(state()).toBe(paid);
    expect(store().toasts).toHaveLength(toasts);
    expect(vi.mocked(playBuySound)).not.toHaveBeenCalled();
    // Забор помечает конкретный слух, а не забег: пересозданная лента начинает свой счётчик с
    // единицы, и такой слух снова должен платить.
    store().collectRumor(1);
    expect(state().tokens).toBeGreaterThan(paid.tokens);
  });

  it('counts the amount at the click, so a wallet spent in between moves the payout with it', () => {
    rumorPlayer(1e4);
    const full = state();
    store().collectRumor(1);
    const firstPayout = state().tokens - full.tokens;
    expect(firstPayout).toBeCloseTo(grantAmount(full.tokens, totalIncome(full)), 6);
    // Игрок успел потратить Токены: следующий слух уже не может заплатить прежнее, иначе цифра,
    // которую видит игрок, разошлась бы с выплатой.
    withTokens(2e3);
    const spent = state();
    store().collectRumor(2);
    const secondPayout = state().tokens - spent.tokens;
    expect(secondPayout / firstPayout).toBeCloseTo(0.2, 6);
    expect(secondPayout).toBeCloseTo(grantAmount(spent.tokens, totalIncome(spent)), 6);
  });

  it('says that nothing came when there is nothing to share, and still marks the rumor taken', () => {
    freshStore();
    // Токены есть, а Дохода нет: без Агентов второй член минимума нулевой, и делиться нечем.
    withTokens(1e6);
    const before = state();
    expect(grantAmount(before.tokens, totalIncome(before))).toBe(0);
    vi.mocked(playBuySound).mockClear();
    store().collectRumor(1);
    expect(state().tokens).toBe(before.tokens);
    // Звука покупки на пустой выплате нет, но клик обязан быть услышан: молчание читается как
    // сломанная кнопка.
    expect(vi.mocked(playBuySound)).not.toHaveBeenCalled();
    expect(vi.mocked(playClickSound)).toHaveBeenCalledTimes(1);
    expect(store().toasts).toEqual([]);
    // Забор ставится и на пустой выплате: тот же слух второй раз всё равно молчит.
    expect(store().collectedRumorId).toBe(1);
  });
});

describe('compute threshold', () => {
  /** Забег на указанном числе Токенов: ничего не покупаем, меняется только счётчик забега. */
  const run = (runTokens: number): GameState => ({ ...state(), runTokens });

  it('is exactly the number of tokens missing to the next unit, checked against the gain itself', () => {
    freshStore();
    for (const runTokens of [0, 1e5, 1e12]) {
      const s = run(runTokens);
      const missing = computeShortfall(s);
      expect(missing).toBeGreaterThan(0);
      // Порог проверяется не формулой, а самим движком: ровно на этом числе забега прирост
      // Compute растёт на единицу, а на единицу меньше — ещё нет.
      const threshold = runTokens + missing;
      expect(prestigeGain(run(threshold))).toBe(prestigeGain(s) + 1);
      expect(prestigeGain(run(threshold - 1))).toBe(prestigeGain(s));
    }
  });

  it('stays a positive finite number on the numbers the game reaches', () => {
    freshStore();
    // Порядки от первых забегов до конца игры: это деньги, и ноль или бесконечность в строке
    // окна статистики читались бы как сломанная строка. Дальше ~1e50 разрыв до следующей единицы
    // уходит под точность double, и там нули — единственное представимое значение; за такой
    // суммой игра не доходит.
    for (const runTokens of [1e12, 1e27, 1e30, 1e50]) {
      const missing = computeShortfall(run(runTokens));
      expect(missing).toBeGreaterThan(0);
      expect(Number.isFinite(missing)).toBe(true);
    }
  });

  it('rises with the generation, because the divisor it comes from does', () => {
    freshStore();
    const gen0Missing = computeShortfall(run(0));
    reachedGeneration(1);
    expect(computeShortfall(run(0)) / gen0Missing).toBeCloseTo(CATALOG[1].scale, 6);
  });
});

/**
 * Игрок, дошедший до откупа.
 *
 * Третий экран, а не второй: Глюки заводятся не с первого, и раньше лицензии нечего было бы
 * лопнуть — выплата была бы нулём. Агенты нужны и для налога, и для кражи: без них Доход нулевой
 * и обе величины схлопываются в ноль. Событие на время проверки выключено — иначе «Волна хайпа»
 * умножила бы Доход, и налог измерялся бы вместе с множителем события, а не сам по себе.
 */
const risenPlayer = (): void => {
  reachedGeneration(2);
  hire(CATALOG[2].models[0].id);
  useGameStore.setState({ state: { ...state(), event: null, nextEventAt: state().lastTick + HOUR } });
};

describe('pledge and license', () => {
  it('prices every next lobby higher, extends the window and stops at the cap', () => {
    risenPlayer();
    // Кошелёк покрывает всю лестницу с запасом: проверяется цена, а не отказ по нехватке.
    withTokens(pledgeCost(state()) * PLEDGE_GROWTH ** PLEDGE_MAX);
    // Покупки Агентов и Престиж выше уже звучали, а считать здесь нужно покупки откупа.
    vi.mocked(playUpgradeSound).mockClear();
    const at = state().lastTick;
    let ladder = pledgeCost(state());
    for (let i = 0; i < PLEDGE_MAX; i++) {
      const before = state();
      expect(pledgeCost(before)).toBeCloseTo(ladder, 6);
      store().buyPledge();
      expect(state().tokens).toBeCloseTo(before.tokens - ladder, 6);
      expect(state().pledgeBought).toBe(i + 1);
      // Продление, а не замена: купленное время не сгорает при перекупке, и окно считается по
      // игровым часам — тем же lastTick, по которому его меряет isPledgeActive.
      expect(state().pledgeUntil).toBe(at + (i + 1) * PLEDGE_MS);
      ladder *= PLEDGE_GROWTH;
    }
    // Потолок исчерпан: ещё одно «Лобби» молча и не проходит.
    const atCap = state();
    store().buyPledge();
    expect(state()).toBe(atCap);
    // Звук покупки тот же, что у Перка, и ровно по одному разу на покупку.
    expect(vi.mocked(playUpgradeSound)).toHaveBeenCalledTimes(PLEDGE_MAX);
  });

  it('takes exactly 5% of the income and pops every glitch at once, paid into all three counters', () => {
    risenPlayer();
    const income = totalIncome(state());
    useGameStore.setState({ state: { ...state(), nextGlitchAt: state().lastTick } });
    tick();
    for (let i = 0; i < 200; i++) tick();
    expect(state().glitches).toHaveLength(1);
    // Кошелёк ровно в цену: после покупки на балансе остаётся одна выплата, и её не съедает
    // мантисса числа порядка 1e15. Снимок состояния снимается уже после кошелька, иначе выплата
    // считалась бы в чужой копилке.
    const cost = licenseCost(state());
    withTokens(cost);
    const before = state();
    store().buyLicense();
    expect(state().covenant).toBe(true);
    expect(state().glitches).toEqual([]);
    const payout = glitchPayout(before);
    expect(payout).toBeGreaterThan(0);
    // Доли, а не разности: выплата тут порядка 1e20, и её прибавление к копилке за заработок
    // съедается мантиссой задолго до шестой значащей цифры.
    expect(state().tokens / payout).toBeCloseTo(1, 6);
    expect((state().runTokens - before.runTokens) / payout).toBeCloseTo(1, 6);
    expect((state().totalTokens - before.totalTokens) / payout).toBeCloseTo(1, 6);
    // Глюки, снимавшие долю Дохода, исчезли, и остаётся ровно налог за «Лицензию».
    expect(totalIncome(state()) / income).toBeCloseTo(1 - LICENSE_INCOME_TAX, 6);
    // Тостов о Глюках нет, в том числе о «Лицензии».
    expect(otherToasts()).toEqual([]);
  });

  it('charges for the revoke and gives the taxed income back', () => {
    risenPlayer();
    const income = totalIncome(state());
    // Оба платежа в кошельке сразу: отзыв дороже покупки на два порядка, и кошелёк ниже цены
    // отзыва означал бы, что проверяется отказ, а не возврат Дохода.
    // Запас сверх цены отзыва обязателен, а не щедрость: кошелёк ровно в цену после вычитания
    // цены «Лицензии» проваливается на один ULP (при цене 1e17 это 16 Токенов), и отзыв молча
    // отказывался. Тест проверяет оплату, поэтому деньги должны её покрывать с запасом.
    withTokens(licenseCost(state()) + revokeCost(state()) * 1.01);
store().buyLicense();
    expect(totalIncome(state()) / income).toBeCloseTo(1 - LICENSE_INCOME_TAX, 6);
    const before = state();
    store().revokeLicense();
    expect(state().covenant).toBe(false);
    // Отношения, а не разности: кошелёк здесь порядка 1e18, то есть за пределом точного
    // целого у double (2^53 ≈ 9e15). Сложение двух цен и вычитание одной теряют единицы,
    // и сравнение «хватает ли ровно» стало бы проверкой округления, а не отзыва.
    expect(state().tokens / (before.tokens - revokeCost(before))).toBeCloseTo(1, 9);
    expect(totalIncome(state()) / income).toBeCloseTo(1, 6);
  });

  it('changes nothing when the wallet cannot pay, and stays silent', () => {
    // Откуп не продаётся, пока не идёт Восстание: глушить нечего, и обе цены недоступны.
    freshStore();
    hire(first.id, 1);
    withTokens(1e12);
    let before = state();
    store().buyPledge();
    store().buyLicense();
    expect(state()).toBe(before);

    risenPlayer();
    vi.mocked(playBuySound).mockClear();
    vi.mocked(playUpgradeSound).mockClear();
    // Под каждую покупку свой кошелёк, и он ниже цены. Доля, а не «минус один»: цена «Лицензии»
    // считается от Флагмана и в Поколении 2 переваливает за 1e19, где шаг double — тысячи Токенов,
    // и цена минус один равна цене.
    withTokens(pledgeCost(state()) - 1);
    before = state();
    store().buyPledge();
    expect(state()).toBe(before);

    withTokens(licenseCost(state()) / 2);
    before = state();
    store().buyLicense();
    expect(state()).toBe(before);

    // Отзыв без денег не отзывается, и налог остаётся.
    useGameStore.setState({ state: { ...state(), covenant: true } });
    withTokens(0);
    before = state();
    store().revokeLicense();
    expect(state()).toBe(before);
    expect(state().covenant).toBe(true);

    // Молчание обязательно: звук покупки на отказе читался бы как «можно купить».
    expect(vi.mocked(playUpgradeSound)).not.toHaveBeenCalled();
    expect(vi.mocked(playBuySound)).not.toHaveBeenCalled();
  });
});

describe('crystal speeder', () => {
  it('spends the stock, shortens the cycle and is not bought twice', () => {
    freshStore();
    hire(first.id, 100);
    const stock = 40;
    const speeder = CRYSTAL_UPGRADES[0];
    useGameStore.setState({ state: { ...state(), crystals: stock } });
    expect(crystalCycleMs(state())).toBe(CRYSTAL_CYCLE_MS);
    const before = state();
    store().buyCrystalUpgrade(speeder.id);
    expect(state().crystals).toBe(stock - speeder.cost);
    expect(state().crystalUpgrades).toEqual([speeder.id]);
    expect(crystalCycleMs(state())).toBe(speeder.cycleMs);
    // Размен настоящий: потраченные кристаллы больше не дают +1% к Доходу, и это видно и в запасе,
    // и в самом Доходе.
    expect(crystalIncomeMult(state())).toBeCloseTo(1 + (stock - speeder.cost) * CRYSTAL_PER_STOCK_BONUS, 10);
    expect(totalIncome(state())).toBeLessThan(totalIncome(before));
    // Повторная покупка уже купленного ускорителя не проходит.
    const bought = state();
    store().buyCrystalUpgrade(speeder.id);
    expect(state()).toBe(bought);
  });

  it('refuses a speeder the stock cannot pay for', () => {
    const speeder = CRYSTAL_UPGRADES[0];
    useGameStore.setState({ state: { ...state(), crystals: speeder.cost - 1 } });
    const before = state();
    store().buyCrystalUpgrade(speeder.id);
    expect(state()).toBe(before);
  });
});

describe('event window', () => {
  const liveEvent = (kind: 'grant' | 'hype' = 'grant', startedAt = state().lastTick): GameState => ({
    ...state(),
    event: { kind, startedAt, red: false },
  });

  it('notes a window the player has not seen once, and never with a toast', () => {
    reachedGeneration(2);
    useGameStore.setState({ state: liveEvent(), toasts: [] });
    tick();
    expect(store().eventWindowAt).toBe(state().event?.startedAt);
    expect(otherToasts()).toEqual([]);
    tick();
    expect(otherToasts()).toEqual([]);
  });

  it('lets a window expire uncaught without a farewell toast', () => {
    reachedGeneration(2);
    useGameStore.setState({ state: liveEvent(), toasts: [] });
    tick();
    // Активными шагами, а не одним длинным тиком: короткий тик идёт через обычный Доход, и
    // проверка не зависит от оффлайн-ветки.
    for (let i = 0; i < 5; i++) tick(5);
    expect(otherToasts()).toEqual([]);
  });

  it('makes no toasts on a single long tick, and notes the fresh window on the next active one', () => {
    freshStore();
    // Окно назрело, но его ещё нет: длинный тик создаст его в самом конце интервала.
    useGameStore.setState({
      state: { ...state(), nextEventAt: state().lastTick - 1000, event: null },
      toasts: [],
    });
    // Один тик через ветку простоя: окно, покрытое им целиком, игрок не видел.
    tick(3600);
    expect(store().toasts.filter((t) => t.title === 'Достижение разблокировано!' || t.title.startsWith('+'))).toHaveLength(
      store().toasts.length,
    );
    expect(store().toasts.length).toBeLessThanOrEqual(1);
    // Окно при этом создалось и ждёт замечания, а отметка «уже говорили» не сдвинута.
    expect(state().event).not.toBeNull();
    expect(store().eventWindowAt).not.toBe(state().event?.startedAt);
    // Следующий активный тик замечает ещё живое окно обычным порядком.
    tick();
    expect(store().eventWindowAt).toBe(state().event?.startedAt);
  });

  it('covers a whole live window in one long tick without a toast pair, the player was not there', () => {
    freshStore();
    const started = state().lastTick;
    // «Грант» живёт 15 с, а следующее окно далеко: длинный тик накроет окно целиком
    // и не создаст нового.
    useGameStore.setState({
      state: { ...liveEvent('grant', started), nextEventAt: started + HOUR },
      toasts: [],
    });
    tick();
    useGameStore.setState({ toasts: [] });
    tick(60);
    tick();
    tick();
    const events = store().toasts.filter((t) => t.title.startsWith('Событие'));
    expect(events).toEqual([]);
  });

  it('claims several milestones in one tick without any toast', () => {
    freshStore();
    store().clickPrompt(100, 100);
    hire(first.id, 10);
    // Четвёртая веха подряд требует жара: без него забралась бы только первая.
    useGameStore.setState({ state: { ...state(), temp: 0.8 }, toasts: [] });
    tick();
    expect(state().milestones.length).toBeGreaterThan(1);
    expect(store().toasts.filter((t) => t.title.startsWith('Вех'))).toEqual([]);
  });

  it('keeps the alert a perk instead of a base feature', () => {
    reachedGeneration(2);
    useGameStore.setState({ state: liveEvent(), toasts: [] });
    tick();
    expect(store().eventWindowAt).toBe(state().event?.startedAt);
    expect(vi.mocked(playEventAlertSound)).not.toHaveBeenCalled();

    // Следующее окно: стор о нём ещё не говорил, а Перк уже куплен — сигнал обязан прозвучать.
    const started = state().lastTick;
    useGameStore.setState({
      state: { ...state(), perks: ['event_alert'], event: { kind: 'hype', startedAt: started, red: false } },
      eventWindowAt: started - 1,
      toasts: [],
    });
    tick();
    expect(store().eventWindowAt).toBe(started);
    expect(vi.mocked(playEventAlertSound)).toHaveBeenCalledTimes(1);
  });
});

describe('prestige window', () => {
  it('asks first and leaves the run on the same object while it is open', () => {
    freshStore();
    // Флагман своего Поколения открывает Престиж: дальше окно обязано спрашивать, а не стирать.
    hire(CATALOG[0].flagship.id, 1);
    const before = state();
    expect(canPrestige(before)).toBe(true);
    store().requestPrestige();
    expect(store().prestigePrompt).toBe(true);
    // Окно — только вопрос: тот же объект состояния, а значит те же Токены, Агенты и Забег.
    expect(state()).toBe(before);
    store().dismissPrestigePrompt();
    expect(store().prestigePrompt).toBe(false);
    expect(state()).toBe(before);
  });

  it('carries the overlay the numbers of the run it just reset', () => {
    reachedGeneration(1);
    hire(CATALOG[1].flagship.id, 1);
    // Крупный заработок забега: прирост Compute от нулевого в оверлее ничего не показывает.
    withTokens(1e30);
    const before = state();
    const gain = prestigeGain(before);
    expect(gain).toBeGreaterThan(0);
    store().triggerPrestige();
    const burst = store().burst;
    expect(burst?.kind).toBe('prestige');
    // Оверлею нужно то, чего в состоянии уже нет: куда перешли и сколько заработали.
    expect(burst?.prestige?.generation).toBe(before.generation + 1);
    expect(burst?.prestige?.computeGain).toBe(gain);
    expect(state().generation).toBe(before.generation + 1);
  });

  it('keeps the run at the end of the content and stays silent', () => {
    const last = CATALOG.length - 1;
    reachedGeneration(last);
    // Без Флагмана Престиж и так закрыт, поэтому отказ проверяется на честном последнем Забеге.
    hire(CATALOG[last].flagship.id, 1);
    expect(isContentFinale(state())).toBe(true);
    const before = state();
    const burst = store().burst;
    vi.mocked(playPrestigeSound).mockClear();
    store().triggerPrestige();
    expect(state()).toBe(before);
    expect(store().burst).toBe(burst);
    expect(vi.mocked(playPrestigeSound)).not.toHaveBeenCalled();
  });
});

describe('achievement awards', () => {
  it('names an ordinary achievement from the table and stays quiet about the shadows', () => {
    freshStore();
    const before = state();
    vi.mocked(playAchievementSound).mockClear();
    // Найм Флагмана без единого Апгрейда закрывает обычное «Первый Агент» и тень «Чистый Забег»
    // разом: повод проверить, что объявляется только первое.
    hire(CATALOG[0].flagship.id, 1);
    const awarded = state().achievements.filter((id) => !before.achievements.includes(id));
    expect(awarded).toContain('agents_1');
    expect(awarded.length).toBeGreaterThan(1);
    const toasts = store().toasts.filter((t) => t.title === 'Достижение разблокировано!');
    expect(toasts).toHaveLength(1);
    // Название и описание берутся из таблицы, а не собираются из id: тост — единственное, что
    // игрок читает по этому поводу, и английский id в нём был бы непонятен.
    const agents1 = ACHIEVEMENTS.find((a) => a.id === 'agents_1');
    expect(toasts[0].name).toBe(agents1?.name);
    expect(toasts[0].desc).toBe(agents1?.desc);
    expect(vi.mocked(playAchievementSound)).toHaveBeenCalledTimes(1);
    expect(store().burst?.kind).toBe('achievement');
  });

  it('folds a batch of achievements from one tick into a single toast with the right plural', () => {
    reachedGeneration(2);
    hire(first.id, 100);
    // Достижения сняты, а условия остались выполненными: следующий тик выдаёт их пачкой.
    useGameStore.setState({ state: { ...state(), achievements: [], clicks: 10000 }, toasts: [] });
    const before = state();
    vi.mocked(playAchievementSound).mockClear();
    tick();
    const awarded = ACHIEVEMENTS.filter((a) => state().achievements.includes(a.id) && !before.achievements.includes(a.id));
    expect(awarded.length).toBeGreaterThan(1);
    // Одна карточка на пачку и один звук, а не стена карточек.
    expect(store().toasts).toHaveLength(1);
    expect(vi.mocked(playAchievementSound)).toHaveBeenCalledTimes(1);
    const toast = store().toasts[0];
    const n = awarded.length;
    expect(toast.title).toBe(`+${n} ${formatCount(n, 'Достижение', 'Достижения', 'Достижений')}`);
    // Названия урезаны до трёх, остальное — счётом: карточка обязана помещаться на 320 px.
    expect(toast.name.split(' · ')).toHaveLength(Math.min(n, 3));
    expect(toast.name.split(' · ')[0]).toBe(awarded[0].name);
    expect(toast.desc).toBe(n > 3 ? `и ещё ${n - 3}` : '');
  });

  it('prints a batch of two or three achievements with the «Достижения» form', () => {
    freshStore();
    useGameStore.setState({ state: { ...state(), clicks: 100 }, toasts: [] });
    tick();
    expect(store().toasts.map((t) => t.title)).toEqual(['+2 Достижения']);
    useGameStore.setState({ state: { ...state(), achievements: [], clicks: 1000 }, toasts: [] });
    tick();
    expect(store().toasts.map((t) => t.title)).toEqual(['+3 Достижения']);
  });

  it('keeps one achievement as its own card and joins a long tick batch into at most one toast', () => {
    reachedGeneration(2);
    hire(first.id, 100);
    useGameStore.setState({ state: { ...state(), achievements: [], clicks: 10000 }, toasts: [] });
    // Длинный тик (простой) тоже выдаёт пачку, но не стену карточек.
    tick(3600);
    expect(store().toasts.length).toBeLessThanOrEqual(1);
    expect(store().toasts.every((t) => t.title === 'Достижение разблокировано!' || t.title.startsWith('+'))).toBe(true);
  });

  it('makes toasts for achievements only, whatever else the player does', () => {
    reachedGeneration(2);
    hire(first.id, 10);
    useGameStore.setState({ toasts: [] });
    for (let i = 0; i < 30; i++) tick(1);
    store().clickPrompt(10, 10);
    store().buyLicense();
    store().shatterCrystal();
    store().collectRumor(1);
    store().catchEvent();
    const ok = (t: { title: string }) => t.title === 'Достижение разблокировано!' || /^\+\d+ Достижени/.test(t.title);
    expect(store().toasts.filter((t) => !ok(t))).toEqual([]);
  });

  it('keeps a shadow that was the only award, because the state still has to reach the save', () => {
    // Все Перки куплены, а Токенов и Агентов нет: тик не приносит ничего, лестница заработка не
    // мешает, и закрывается ровно тень «Всё куплено». Обычное «Инвестор» отмечено заранее —
    // условие тени тянет за собой и обычное, а проверять здесь надо молчание тени, а не пачку
    // обычных вперемешку с ней.
    freshStore();
    useGameStore.setState({
      state: { ...state(), perks: PERKS.map((p) => p.id), achievements: ['perk_1'] },
    });
    expect(state().achievements).not.toContain('shadow_all_perks');
    vi.mocked(playAchievementSound).mockClear();
    const before = state();
    tick();
    const awarded = state().achievements.filter((id) => !before.achievements.includes(id));
    // Тень читается обратно из магазина, а не из таблицы: `return s` вместо состояния с тенью
    // похоронил бы её до сериализации в localStorage, и ни тост, ни звук этого не показали бы.
    expect(awarded).toEqual(['shadow_all_perks']);
    expect(store().toasts).toEqual([]);
    expect(vi.mocked(playAchievementSound)).not.toHaveBeenCalled();
  });
});

describe('return report', () => {
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

  it('mentions a crystal that ripened during the absence, even with no income', async () => {
    const now = Date.now();
    const snapshot = await reloadWith(
      serialize({
        ...newGame(now - HOUR),
        tokens: 0,
        totalTokens: 1e9,
        lastTick: now - HOUR,
        crystalPlantedAt: now - CRYSTAL_CYCLE_MS - 1,
      }),
    );
    // Отчёт нужен из-за одного кристалла: дохода за простой не было (Агентов нет), а +1% Дохода
    // навсегда игрок всё равно получил.
    expect(snapshot.offlineReport?.crystals).toBe(1);
    expect(snapshot.offlineReport?.earned).toBe(0);
    // Допуск здесь — 2 с, а не стандартные 0.05: между этим `Date.now()` и тем, который берёт
    // стор при перезагрузке, стоит асинхронная запись в localStorage, и любая заминка машины
    // выпадала из 50-миллисекундного окна. Две секунды не спутать с ошибкой единиц: там был бы
    // промах в 3 600, а здесь — ровно час отсутствия плюс честная задержка.
    expect(Math.abs((snapshot.offlineReport?.seconds ?? 0) - HOUR / 1000)).toBeLessThan(2);
    expect(snapshot.state.crystals).toBe(1);
  });

  it('on load, says how much of the absence was credited and where it came from', async () => {
    const now = Date.now();
    const away = 30 * HOUR;
    const s: GameState = { ...newGame(now - away), tokens: 1e50, totalTokens: 1e9, lastTick: now - away, temp: 0, heat: 0 };
    const staffed = engineBuyAgents(s, g0.models[0].id, 5);
    const snapshot = await reloadWith(serialize({ ...staffed, lastTick: now - away }));
    const report = snapshot.offlineReport!;
    expect(report.seconds).toBe(BASE_OFFLINE_HOURS * 3600);
    expect(Math.abs(report.elapsed - away / 1000)).toBeLessThan(2);
    expect(report.rows.length).toBeGreaterThan(0);
    expect(Math.abs(report.rows.reduce((a, r) => a + r.earned, 0) - report.earned)).toBeLessThanOrEqual(report.earned * 1e-9);
  });

  it('says nothing when the absence brought nothing', async () => {
    const now = Date.now();
    const snapshot = await reloadWith(
      serialize({ ...newGame(now - HOUR), tokens: 0, totalTokens: 1e9, lastTick: now - HOUR }),
    );
    expect(snapshot.offlineReport).toBeNull();
  });
});

describe('compute rule notice', () => {
  /** Хранилище живёт между перезагрузками модуля: «показано один раз» проверяется только так. */
  const disk = new Map<string, string>();
  const boot = async () => {
    vi.stubGlobal('window', { innerWidth: 800, innerHeight: 600 });
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => disk.get(k) ?? null,
      setItem: (k: string, v: string) => void disk.set(k, v),
      removeItem: (k: string) => void disk.delete(k),
    });
    vi.resetModules();
    return (await import('./useGameStore')).useGameStore;
  };
  const saved = (patch: Partial<GameState>) => {
    const now = Date.now();
    disk.set(SAVE_KEY, serialize({ ...newGame(now), lastTick: now, ...patch }));
  };

  beforeEach(() => disk.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('tells a player with spent compute once why income fell, then never again', async () => {
    saved({ compute: 200, computeSpent: 120 });
    const first = await boot();
    // Было +200% от всего Compute, стало +80% от свободного.
    expect(first.getState().computeRuleNotice).toEqual({ before: 2, after: 0.8 });
    // Пока игрок не закрыл окно, оно возвращается: молча проглоченное объяснение не объяснение.
    expect((await boot()).getState().computeRuleNotice).not.toBeNull();
    (await boot()).getState().dismissComputeRuleNotice();
    expect((await boot()).getState().computeRuleNotice).toBeNull();
  });

  it('stays silent for a new player, even after they spend compute later', async () => {
    const fresh = await boot();
    expect(fresh.getState().computeRuleNotice).toBeNull();
    // Позже у новичка появился потраченный Compute: падение Дохода — следствие его покупки,
    // а не обновления, и объяснять нечего.
    saved({ compute: 200, computeSpent: 120 });
    expect((await boot()).getState().computeRuleNotice).toBeNull();
  });

  it('stays silent when nothing was spent, since the income did not change', async () => {
    saved({ compute: 50, computeSpent: 0 });
    expect((await boot()).getState().computeRuleNotice).toBeNull();
  });
});

describe('return report from a long tick', () => {
  const sumRows = () => (store().offlineReport?.rows ?? []).reduce((a, r) => a + r.earned, 0);
  /** Агенты в двух Лабораториях: разбивке есть что делить. */
  const staff = (): void => {
    for (const m of g0.models.slice(0, 3)) hire(m.id, 10);
  };

  it('breaks the pay down by source and counts how much of the absence was credited', () => {
    staff();
    const before = state().totalTokens;
    tick(3 * 3600);
    const report = store().offlineReport;
    expect(report).not.toBeNull();
    expect(report!.seconds).toBe(3 * 3600);
    expect(report!.elapsed).toBe(3 * 3600);
    // Сумма строк — это начисленное, а начисленное — это то, что реально легло в кошелёк.
    expect(report!.earned).toBeGreaterThan(0);
    expect(state().totalTokens - before).toBeCloseTo(report!.earned, -Math.floor(Math.log10(report!.earned)) + 6);
    expect(Math.abs(sumRows() - report!.earned)).toBeLessThanOrEqual(report!.earned * 1e-9);
  });

  it('says "credited 8 of 100 hours" when the absence hit the cap', () => {
    staff();
    tick(100 * 3600);
    const report = store().offlineReport!;
    expect(report.seconds).toBe(BASE_OFFLINE_HOURS * 3600);
    expect(report.elapsed).toBe(100 * 3600);
    expect(Math.abs(sumRows() - report.earned)).toBeLessThanOrEqual(report.earned * 1e-9);
  });

  it('opens nothing for a short pause', () => {
    staff();
    tick(5);
    expect(store().offlineReport).toBeNull();
  });

  it('does not open the screen when the tab is hidden and shown quickly', () => {
    staff();
    for (let i = 0; i < 5; i++) {
      store().setTabHidden(true);
      tick(1);
      store().setTabHidden(false);
    }
    expect(store().offlineReport).toBeNull();
  });

  it('opens one screen when the player returns, and never a second one on later switches', () => {
    staff();
    store().setTabHidden(true);
    // Скрытая вкладка просыпается раз в минуту: каждый такой тик — длинный.
    for (let i = 0; i < 3; i++) tick(60);
    expect(store().offlineReport).toBeNull();
    store().setTabHidden(false);
    const report = store().offlineReport;
    expect(report).not.toBeNull();
    expect(report!.elapsed).toBe(180);
    expect(Math.abs(sumRows() - report!.earned)).toBeLessThanOrEqual(report!.earned * 1e-9);

    store().dismissOfflineReport();
    for (let i = 0; i < 4; i++) {
      store().setTabHidden(true);
      store().setTabHidden(false);
    }
    expect(store().offlineReport).toBeNull();
  });

  it('adds a second long pause to the open screen instead of opening another', () => {
    staff();
    tick(3600);
    const first = store().offlineReport!.earned;
    tick(3600);
    expect(store().offlineReport!.elapsed).toBe(7200);
    expect(store().offlineReport!.earned).toBeGreaterThan(first);
  });

  it('keeps the shown-screen flag out of the save', () => {
    staff();
    tick(3600);
    expect(store().offlineReport).not.toBeNull();
    expect(Object.keys(state()).sort()).toEqual(Object.keys(newGame(T0)).sort());
  });

  it('forgets a pending absence when the run is reset', () => {
    staff();
    store().setTabHidden(true);
    tick(600);
    store().resetGame();
    store().setTabHidden(false);
    expect(store().offlineReport).toBeNull();
  });
});

describe('quips', () => {
  it('shows the speaking model bubble on the fourth click, even with no agents', () => {
    // До первой покупки lab null — и первая реплика всё равно видна.
    store().clickPrompt(10, 10);
    store().clickPrompt(10, 10);
    store().clickPrompt(10, 10);
    expect(store().lastQuip).toBeNull();
    store().clickPrompt(10, 10);
    const expected = pickQuip(null, 4, [])!;
    expect(store().lastQuip?.id).toBe(expected.id);
    expect(store().lastQuip?.text).toBe(expected.text);
    expect(state().quipsSeen).toEqual([expected.id]);
    expect(vi.mocked(playQuipSound)).toHaveBeenCalledTimes(1);
  });

  it('speaks with the lab of the last bought model', () => {
    hire(first.id, 1);
    const lab = CATALOG[0].models.find((m) => m.id === first.id)?.lab;
    for (let i = 0; i < 4; i++) store().clickPrompt(10, 10);
    expect(store().lastQuip?.lab).toBe(lab);
  });

  it('stays silent once every quip is heard, instead of replaying one as new', () => {
    const heard = QUIPS.map((q) => q.id);
    useGameStore.setState({ state: { ...state(), quipsSeen: heard } });
    for (let i = 0; i < 4; i++) store().clickPrompt(10, 10);
    expect(store().lastQuip).toBeNull();
    expect(state().quipsSeen).toEqual(heard);
    expect(vi.mocked(playQuipSound)).not.toHaveBeenCalled();
  });
});

describe('starting a challenge', () => {
  it('sets the challenge on a fresh run and sounds the upgrade', () => {
    freshStore();
    expect(state().activeChallenge).toBeNull();
    vi.mocked(playUpgradeSound).mockClear();
    store().startChallenge('no-synergy');
    expect(state().activeChallenge).toBe('no-synergy');
    // Испытание — не Достижение: тоста нет.
    expect(store().toasts).toEqual([]);
    expect(vi.mocked(playUpgradeSound)).toHaveBeenCalledTimes(1);
  });

  it('records declining without announcing it', () => {
    freshStore();
    store().startChallenge(null);
    expect(state().activeChallenge).toBeNull();
    // Отказ — тоже выбор, но объявлять его нечем: «принято» здесь врало бы.
    expect(store().toasts).toEqual([]);
  });

  it('stays silent on a stale run, because the kernel answers with the same object', () => {
    freshStore();
    // Забег уже не свежий: игрок кликал, и ядро запрещает старт тождеством.
    useGameStore.setState({ state: { ...state(), runClicks: 1 } });
    const before = state();
    vi.mocked(playUpgradeSound).mockClear();
    store().startChallenge('no-click');
    expect(state()).toBe(before);
    expect(store().toasts).toEqual([]);
    expect(vi.mocked(playUpgradeSound)).not.toHaveBeenCalled();
  });
});

describe('reward moments on the scene', () => {
  afterEach(() => vi.useRealTimers());

  it('announces the first Agent of a new Лаборатория and nothing for the second one', () => {
    freshStore();
    expect(store().sceneMoment).toBeNull();
    hire(first.id, 1);
    expect(store().sceneMoment).toMatchObject({ lab: first.lab, entry: true, flagship: false });
    const nonce = store().sceneMoment?.nonce;
    hire(first.id, 1);
    // Второй Агент той же Модели — обычная покупка: момент остаётся тем же, нового нет.
    expect(store().sceneMoment?.nonce).toBe(nonce);
  });

  it('gives every new Лаборатория its own moment', () => {
    freshStore();
    hire(first.id, 1);
    const firstNonce = store().sceneMoment?.nonce ?? 0;
    const newcomer = g0.models.find((m) => m.lab !== first.lab && m.id !== g0.flagship.id);
    if (!newcomer) throw new Error('в Поколении 0 одна Лаборатория');
    hire(newcomer.id, 1);
    expect(store().sceneMoment).toMatchObject({ lab: newcomer.lab, entry: true });
    expect(store().sceneMoment?.nonce).toBeGreaterThan(firstNonce);
  });

  it('celebrates the first Флагман once, and a second Агент of it is just a purchase', () => {
    freshStore();
    hire(g0.flagship.id, 1);
    expect(store().sceneMoment).toMatchObject({ lab: g0.flagship.lab, flagship: true });
    const nonce = store().sceneMoment?.nonce;
    hire(g0.flagship.id, 1);
    expect(store().sceneMoment?.nonce).toBe(nonce);
  });

  it('raises no moment for a purchase that did not go through', () => {
    freshStore();
    useGameStore.setState({ state: { ...state(), tokens: 0 } });
    store().buyAgents(g0.flagship.id);
    expect(store().sceneMoment).toBeNull();
  });

  it('lets go of the moment after its dwell, but only its own', () => {
    vi.useFakeTimers();
    freshStore();
    hire(first.id, 1);
    const old = store().sceneMoment?.nonce;
    vi.advanceTimersByTime(SCENE_MOMENT_MS - 100);
    const newcomer = g0.models.find((m) => m.lab !== first.lab);
    if (!newcomer) throw new Error('в Поколении 0 одна Лаборатория');
    hire(newcomer.id, 1);
    expect(store().sceneMoment?.nonce).not.toBe(old);
    // Срок первого момента вышел, но на сцене уже второй: первый таймер его не гасит.
    vi.advanceTimersByTime(150);
    expect(store().sceneMoment).not.toBeNull();
    vi.advanceTimersByTime(SCENE_MOMENT_MS);
    expect(store().sceneMoment).toBeNull();
  });

  it('is gone after a new run', () => {
    freshStore();
    hire(first.id, 1);
    store().resetGame();
    expect(store().sceneMoment).toBeNull();
  });

  it('is gone after a Престиж, so the new Поколение does not inherit the old celebration', () => {
    freshStore();
    hire(g0.flagship.id, 1);
    expect(store().sceneMoment?.flagship).toBe(true);
    store().triggerPrestige();
    expect(store().sceneMoment).toBeNull();
  });

  it('is gone after an import, which replaces the run instead of buying into it', () => {
    freshStore();
    const exported = exportSave(state());
    hire(g0.flagship.id, 1);
    expect(store().sceneMoment).not.toBeNull();
    expect(store().importSaveData(exported)).toBe(true);
    expect(store().sceneMoment).toBeNull();
  });
});

describe('the prestige tab section', () => {
  beforeEach(() => useGameStore.setState({ prestigeSection: 'prestige' }));

  it('opens on «Престиж» and remembers the section the player picked, whatever tab comes between', () => {
    store().setPrestigeSection('crystals');
    store().setActiveTab('click');
    store().setActiveTab('prestige');
    expect(store().prestigeSection).toBe('crystals');
    store().setPrestigeSection('perks');
    expect(store().prestigeSection).toBe('perks');
  });

  it('does not touch the game state or the save, since the section is only where the player looks', () => {
    const before = state();
    store().setPrestigeSection('perks');
    expect(state()).toBe(before);
  });
});

describe('the volume setting', () => {
  // Стор — единственный владелец состояния, поэтому границы держит он: значение приходит из
  // ползунка и из импортируемого файла, а volume: 9999 означал бы хрип вместо музыки.
  it('takes a value the player chose', () => {
    freshStore();
    store().setVolume(0.25);
    expect(state().settings.volume).toBe(0.25);
  });

  it('fences off junk from a slider or an imported file', () => {
    freshStore();
    store().setVolume(9999);
    expect(state().settings.volume).toBe(1);
    store().setVolume(-5);
    expect(state().settings.volume).toBe(0);
    store().setVolume(Number.NaN);
    // Не число — значит оставляем то, что уже стояло, а не сбрасываем громкость вслепую.
    expect(state().settings.volume).toBe(0);
  });

  it('keeps zero as a deliberate silence rather than switching to mute', () => {
    freshStore();
    store().setVolume(0);
    expect(state().settings.volume).toBe(0);
    expect(state().settings.muted).toBe(false);
  });
});

describe('the channel volume settings', () => {
  // Каналы музыки и эффектов лежат поверх общей громкости: общая остаётся мастером, а границы,
  // как и у неё, держит стор — значение приходит из ползунка и из импортируемого файла.
  it('takes a level the player chose for each channel without touching the other or the master', () => {
    freshStore();
    const master = state().settings.volume;
    store().setChannelVolume('music', 0.3);
    expect(state().settings.musicVolume).toBe(0.3);
    expect(state().settings.sfxVolume).toBe(1);
    store().setChannelVolume('sfx', 0.7);
    expect(state().settings.sfxVolume).toBe(0.7);
    expect(state().settings.musicVolume).toBe(0.3);
    expect(state().settings.volume).toBe(master);
  });

  it('fences off junk from a slider or an imported file', () => {
    freshStore();
    store().setChannelVolume('music', 9999);
    expect(state().settings.musicVolume).toBe(1);
    store().setChannelVolume('music', -5);
    expect(state().settings.musicVolume).toBe(0);
    store().setChannelVolume('sfx', 0.4);
    store().setChannelVolume('sfx', Number.NaN);
    // Не число — оставляем то, что уже стояло: сбросить канал вслепую значило бы громче или тише.
    expect(state().settings.sfxVolume).toBe(0.4);
  });

  it('keeps zero as a deliberate silence of its own channel, not a mute', () => {
    freshStore();
    store().setChannelVolume('music', 0);
    expect(state().settings.musicVolume).toBe(0);
    expect(state().settings.muted).toBe(false);
    expect(state().settings.sfxVolume).toBe(1);
  });
});

describe('the effect switches', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('flips one effect and leaves the others', () => {
    freshStore();
    store().setEffect('shake', false);
    expect(state().settings).toMatchObject({ particles: true, floaters: true, shake: false, ticker: true });
    store().setEffect('shake', true);
    expect(state().settings.shake).toBe(true);
  });

  /** Числа в воздухе от прошлых тестов не сбрасывает ни `resetGame`, ни `freshStore`: они живут 900 мс. */
  const freshAir = (): void => {
    freshStore();
    useGameStore.setState({ floaters: [] });
  };

  it('does not leave a floating number after a Клик while floaters are off, and does while they are on', () => {
    vi.useFakeTimers();
    freshAir();
    store().clickPrompt(10, 20);
    expect(store().floaters).toHaveLength(1);
    expect(store().floaters[0]).toMatchObject({ x: 10, y: 20 });
    vi.advanceTimersByTime(1000);
    expect(store().floaters).toHaveLength(0);

    store().setEffect('floaters', false);
    store().clickPrompt(10, 20);
    expect(store().floaters).toHaveLength(0);
    // Клик при этом засчитан: выключатель гасит число, а не отклик игры.
    expect(state().clicks).toBe(2);
  });

  it('takes away a floating number already in the air when the player switches floaters off', () => {
    vi.useFakeTimers();
    freshAir();
    store().clickPrompt(10, 20);
    store().clickPrompt(10, 20);
    expect(store().floaters).toHaveLength(2);
    store().setEffect('floaters', false);
    expect(store().floaters).toHaveLength(0);
  });

  describe('which effects may be made', () => {
    /** Система сообщает о движении так же, как браузер: через matchMedia. */
    const systemReduces = (reduce: boolean): void => {
      vi.stubGlobal('window', { matchMedia: (media: string) => ({ matches: reduce, media }) });
    };

    it('makes particles and shake while they are on and motion is allowed', () => {
      freshStore();
      systemReduces(false);
      expect(effectAllowed('particles')).toBe(true);
      expect(effectAllowed('shake')).toBe(true);
    });

    it('makes only what is switched on', () => {
      freshStore();
      systemReduces(false);
      store().setEffect('particles', false);
      expect(effectAllowed('particles')).toBe(false);
      expect(effectAllowed('shake')).toBe(true);
      store().setEffect('particles', true);
      store().setEffect('shake', false);
      expect(effectAllowed('particles')).toBe(true);
      expect(effectAllowed('shake')).toBe(false);
    });

    it('makes neither under less animation, whatever the switches say', () => {
      freshStore();
      systemReduces(false);
      store().setReducedMotion(true);
      expect(effectAllowed('particles')).toBe(false);
      expect(effectAllowed('shake')).toBe(false);
    });

    it('makes neither when the system asks for less motion, even with both switched on', () => {
      freshStore();
      systemReduces(true);
      expect(effectAllowed('particles')).toBe(false);
      expect(effectAllowed('shake')).toBe(false);
    });
  });
});

describe('the finale screen flag', () => {
  // Регрессия: комментарий обещал, что рестарт вернёт флаг, а код этого не делал — второе
  // прохождение до последнего Поколения встречало игрока молчащим финалом.
  it('comes back armed after a reset, so the next run shows the finale again', () => {
    freshStore();
    expect(store().finaleDismissed).toBe(false);
    store().dismissFinale();
    expect(store().finaleDismissed).toBe(true);
    store().resetGame();
    expect(store().finaleDismissed).toBe(false);
  });
});

describe('shattering a crystal', () => {
  it('pays the gain into the wallet and sounds the achievement', () => {
    freshStore();
    // Без Агентов Дохода нет, и впрыск — 15% кошелька: 150 из 1000.
    useGameStore.setState({ state: { ...state(), crystals: 2, tokens: 1000 } });
    const before = state();
    vi.mocked(playAchievementSound).mockClear();
    store().shatterCrystal();
    expect(state().crystals).toBe(1);
    expect(state().tokens - before.tokens).toBe(150);
    expect(state().runTokens - before.runTokens).toBe(150);
    expect(state().totalTokens - before.totalTokens).toBe(150);
    expect(store().toasts).toEqual([]);
    expect(vi.mocked(playAchievementSound)).toHaveBeenCalledTimes(1);
  });

  it('stays silent with an empty stock, because the kernel answers with the same object', () => {
    freshStore();
    expect(state().crystals).toBe(0);
    const before = state();
    vi.mocked(playAchievementSound).mockClear();
    store().shatterCrystal();
    expect(state()).toBe(before);
    expect(store().toasts).toEqual([]);
    expect(vi.mocked(playAchievementSound)).not.toHaveBeenCalled();
  });
});

/**
 * Сейв на настоящем окне.
 *
 * Запись идёт только при `typeof window !== 'undefined'`, поэтому подмена окна и хранилища —
 * единственный способ её увидеть. Хранилище здесь словарь в памяти теста: настоящий сейв игрока
 * тест не трогает и стереть не может.
 *
 * Модуль магазина перезагружается каждый раз намеренно: счётчики записи живут на уровне модуля,
 * и тест, начатый с чужого остатка, проверял бы не своё. Отсюда и `w.store`: это ДРУГОЙ магазин,
 * не тот, что импортирован наверху файла, и состояние ему надо задавать через него.
 */
describe('the save', () => {
  interface Windowed {
    store: typeof useGameStore;
    /** Всё, что ушло в хранилище, по порядку. */
    writes: string[];
    /** Что лежит в хранилище сейчас. */
    saved: () => GameState | null;
    /** Уход со страницы: скрытие вкладки или её закрытие. */
    leave: (how: 'hidden' | 'close') => void;
  }

  const windowed = async (storage?: Partial<Storage>): Promise<Windowed> => {
    const cell = new Map<string, string>();
    const writes: string[] = [];
    const listeners = new Map<string, (() => void)[]>();
    // Ключ — событие, а не носитель: магазин подписывается на document и на window, и тест
    // должен уметь вызвать оба, не различая, кто именно его держит.
    const add = (type: string, fn: () => void) => {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    };
    const listen = {
      addEventListener: add,
      removeEventListener: () => {},
    };
    vi.stubGlobal('window', { innerWidth: 800, innerHeight: 600, ...listen });
    vi.stubGlobal('document', { visibilityState: 'visible', ...listen });
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => cell.get(k) ?? null,
      setItem: (k: string, v: string) => {
        cell.set(k, v);
        // Считаются записи сейва: отметка объяснения нового правила — отдельный ключ.
        if (k === SAVE_KEY) writes.push(v);
      },
      removeItem: (k: string) => cell.delete(k),
      ...storage,
    });
    vi.resetModules();
    const mod = await import('./useGameStore');
    return {
      store: mod.useGameStore,
      writes,
      saved: () => {
        const raw = cell.get(SAVE_KEY);
        return raw ? (JSON.parse(raw) as GameState) : null;
      },
      leave: (how) => {
        const type = how === 'hidden' ? 'visibilitychange' : 'pagehide';
        for (const fn of listeners.get(type) ?? []) fn();
      },
    };
  };

  /** Токены на месте действия: без них переход состояния не состоится. */
  const funded = (w: Windowed, tokens = 1e12): void => {
    w.store.setState({
      state: { ...w.store.getState().state, tokens, runTokens: tokens, totalTokens: tokens },
    });
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('has the purchase in the save the moment it happened', async () => {
    const w = await windowed();
    funded(w);
    w.store.getState().buyAgents(first.id);
    // Покупка без немедленной записи означала бы, что вкладку можно закрыть между кликом и
    // ближайшей отложенной записью — и потерять купленного Агента вместе с деньгами.
    expect(w.saved()?.agents[first.id]).toBe(1);
    expect(w.saved()?.tokens).toBeLessThan(1e12);
  });

  it('has the upgrade and the perk in the save too', async () => {
    const w = await windowed();
    funded(w, 1e12);
    w.store.setState({ state: { ...w.store.getState().state, agents: { [first.id]: 100 }, compute: 50 } });
    w.store.getState().buyUpgrade(`m:${first.id}:0`);
    // Апгрейд стоит денег и живёт весь забег: потерянная покупка — потерянные деньги.
    expect(w.saved()?.upgrades).toEqual([`m:${first.id}:0`]);

    w.store.getState().buyPerk('click_x2');
    expect(w.saved()?.perks).toEqual(['click_x2']);
  });

  it('has the perk-tree reset in the save, once per run', async () => {
    const w = await windowed();
    funded(w, 1e12);
    w.store.setState({ state: { ...w.store.getState().state, compute: 50 } });
    w.store.getState().buyPerk('click_x2');
    w.store.getState().resetPerkTree();
    // Сброс переписывает деньги игрока: если он не дошёл до записи, вкладка закрылась бы с Перками и без Compute.
    expect(w.saved()?.perks).toEqual([]);
    expect(w.saved()?.computeSpent).toBe(0);
    expect(w.saved()?.perkResetUsed).toBe(true);
    // Второй сброс до Престижа ничего не меняет.
    w.store.getState().buyPerk('click_x2');
    w.store.getState().resetPerkTree();
    expect(w.saved()?.perks).toEqual(['click_x2']);
  });

  it('has the prestige in the save, because it is the only run-ending transition', async () => {
    const w = await windowed();
    funded(w);
    w.store.setState({ state: { ...w.store.getState().state, agents: { [g0.flagship.id]: 1 } } });
    w.store.getState().triggerPrestige();
    // Престиж стирает забег: если его след не записан, игрок вернётся в прошлый забег целиком.
    expect(w.saved()?.generation).toBe(1);
    expect(w.saved()?.prestiges).toBe(1);
    expect(w.saved()?.agents).toEqual({});
  });

  it('has the setting in the save, because settings live in GameState', async () => {
    const w = await windowed();
    w.store.getState().setNotation('sci');
    expect(w.saved()?.settings.notation).toBe('sci');
    w.store.getState().toggleMute();
    expect(w.saved()?.settings.muted).toBe(true);
  });

  it('has the effect switches and the channel levels in the save the moment they are touched', async () => {
    const w = await windowed();
    w.store.getState().setEffect('particles', false);
    w.store.getState().setEffect('ticker', false);
    w.store.getState().setChannelVolume('music', 0);
    w.store.getState().setChannelVolume('sfx', 0.35);
    // Переключатель, не доехавший до localStorage, откатился бы с закрытой вкладкой.
    expect(w.saved()?.settings).toMatchObject({
      particles: false,
      floaters: true,
      shake: true,
      ticker: false,
      musicVolume: 0,
      sfxVolume: 0.35,
    });
  });

  it('writes an effect switch to the save on the same touch, not on a later save', async () => {
    const w = await windowed();
    w.store.getState().setEffect('shake', false);
    expect(w.saved()?.settings).toMatchObject({ shake: false });
  });

  it('has the imported run in the save, so a reload cannot undo the import', async () => {
    const w = await windowed();
    const other: GameState = { ...newGame(T0), generation: 1, maxGeneration: 1, totalTokens: 5e9 };
    expect(w.store.getState().importSaveData(exportSave(other))).toBe(true);
    expect(w.saved()?.generation).toBe(1);
  });

  it('writes the tick at most once a second, and writes the newest state, not the first', async () => {
    vi.useFakeTimers();
    const w = await windowed();
    const tick = w.store.getState().tick;
    // Первая запись идёт сразу: счётчик записи на нуле, и свежий сейв обязан появиться без
    // секунды ожидания — иначе первый же перезапуск потерял бы всё, что натикано до него.
    tick(0.05);
    expect(w.writes).toHaveLength(1);

    // Двадцать тиков за секунду — это одна запись, а не двадцать.
    for (let i = 0; i < 19; i++) tick(0.05);
    expect(w.writes).toHaveLength(1);

    vi.advanceTimersByTime(SAVE_INTERVAL_MS + 10);
    const before = w.store.getState().state.lastTick;
    tick(0.05);
    expect(w.writes).toHaveLength(2);
    // Отложенная запись обязана нести последнее состояние, а не то, с которого ждала: без этого
    // дроссель тихо откатывал бы игру на секунду назад при каждой записи.
    expect(w.saved()?.lastTick).toBe(w.store.getState().state.lastTick);
    expect(w.store.getState().state.lastTick).toBeGreaterThan(before);
  });

  it('writes what the tick deferred when the tab is hidden, and when it closes', async () => {
    vi.useFakeTimers();
    const w = await windowed();
    const tick = w.store.getState().tick;
    tick(0.05);
    for (let i = 0; i < 10; i++) tick(0.05);
    // Всё это время записи не было: секунда ещё не вышла.
    expect(w.writes).toHaveLength(1);

    w.leave('hidden');
    expect(w.writes).toHaveLength(2);
    expect(w.saved()?.tokens).toBe(w.store.getState().state.tokens);

    // И второй уход — уже без отложенного: лишней записи быть не должно.
    w.leave('close');
    expect(w.writes).toHaveLength(2);
  });

  it('keeps a purchase that the deferred write from before it could have rolled back', async () => {
    vi.useFakeTimers();
    const w = await windowed();
    const tick = w.store.getState().tick;
    tick(0.05);
    // Отложенная запись уже ждёт своего интервала, а игрок в это время покупает.
    tick(0.05);
    funded(w, 1e9);
    w.store.getState().buyAgents(first.id);
    const afterBuy = w.writes.length;
    vi.advanceTimersByTime(SAVE_INTERVAL_MS + 10);
    tick(0.05);
    expect(w.writes.length).toBeGreaterThan(afterBuy);
    // Запись, пришедшая после покупки, обязана её увидеть: иначе дроссель откатил бы сейв.
    expect(w.saved()?.agents[first.id]).toBe(1);
  });

  it('cannot resurrect the deleted run, even with a deferred write still waiting', async () => {
    vi.useFakeTimers();
    const w = await windowed();
    const tick = w.store.getState().tick;
    tick(0.05);
    // Сброс при отложенной записи наготове: это единственный момент, где запись могла бы вернуть
    // прошлый забег, если бы она несла свой снимок вместо текущего состояния магазина.
    tick(0.05);
    w.store.getState().resetGame();
    expect(w.saved()).toBeNull();

    // Ключ удалён, и всё, что допишется после, — это уже новый забег, в котором ничего нет.
    vi.advanceTimersByTime(SAVE_INTERVAL_MS + 10);
    tick(0.05);
    w.leave('hidden');
    expect(w.saved()?.prestiges).toBe(0);
    expect(w.saved()?.agents).toEqual({});
    expect(w.saved()?.tokens).toBe(w.store.getState().state.tokens);
  });

  it('keeps the game alive when the storage refuses to write', async () => {
    // Приватный режим и переполненное хранилище — обычная судьба, а не повод останавливать игру.
    const w = await windowed({
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    expect(() => w.store.getState().tick(0.05)).not.toThrow();
    funded(w);
    expect(() => w.store.getState().buyAgents(first.id)).not.toThrow();
    // Состояние продолжает жить, даже когда запись не проходит: игра не обязана уметь сохраняться.
    expect(w.store.getState().state.agents[first.id]).toBe(1);
  });
});

/**
 * Фоновая вкладка: число Токенов в заголовке и тишина, пока страница скрыта.
 *
 * Модуль магазина перезагружается тем же приёмом, что и в «the save»: подписка на видимость
 * ставится при загрузке, поэтому документ-подделка обязана существовать до импорта.
 */
describe('the background tab', () => {
  const BASE_TITLE = 'Token Clicker';

  interface Tab {
    store: typeof useGameStore;
    /** Что сейчас в заголовке вкладки. */
    title: () => string;
    /** Игрок ушёл с вкладки или вернулся на неё. */
    show: (visible: boolean) => void;
    /** Вызовы, которыми магазин просил звук замолчать или вернуться. */
    silence: () => ReturnType<typeof vi.fn>;
  }

  /** Каждое присваивание заголовка, в том числе повторное тем же текстом. */
  const assigned: string[] = [];

  const openTab = async (visibility: 'visible' | 'hidden' = 'visible'): Promise<Tab> => {
    const listeners: (() => void)[] = [];
    let title = BASE_TITLE;
    const doc = {
      get title() {
        return title;
      },
      set title(next: string) {
        assigned.push(next);
        title = next;
      },
      visibilityState: visibility as DocumentVisibilityState,
      addEventListener: (type: string, fn: () => void) => {
        if (type === 'visibilitychange') listeners.push(fn);
      },
      removeEventListener: () => {},
    };
    vi.stubGlobal('window', { innerWidth: 800, innerHeight: 600, addEventListener: () => {}, removeEventListener: () => {} });
    vi.stubGlobal('document', doc);
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    vi.resetModules();
    // Звуковой модуль берётся из того же реестра, что и магазин: после resetModules у них общая
    // подделка, а не та, что импортирована в начале файла.
    const sound = await import('../audio/sound');
    const mod = await import('./useGameStore');
    return {
      store: mod.useGameStore,
      silence: () => vi.mocked(sound.setAudioHidden),
      title: () => doc.title,
      show: (visible) => {
        doc.visibilityState = visible ? 'visible' : 'hidden';
        for (const fn of listeners) fn();
      },
    };
  };

  /** Кошелёк под рукой: Доход без Агентов нулевой, и тик Токены не двигает. */
  const holding = (tab: Tab, tokens: number): void => {
    tab.store.setState({ state: { ...tab.store.getState().state, tokens, temp: 0, heat: 0 } });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    assigned.length = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shows the Tokens in the tab title in the notation the player chose', async () => {
    const tab = await openTab();
    holding(tab, 1.5e6);
    tab.store.getState().tick(0.05);
    expect(tab.title()).toBe('1,50 M · Token Clicker');

    tab.store.getState().setNotation('sci');
    vi.advanceTimersByTime(1000);
    tab.store.getState().tick(0.05);
    expect(tab.title()).toBe('1.50e6 · Token Clicker');
  });

  it('rewrites the title at most once a second, however often the tick runs', async () => {
    const tab = await openTab();
    const writes: string[] = [];
    const seen = (): void => {
      if (writes.at(-1) !== tab.title()) writes.push(tab.title());
    };
    holding(tab, 1000);
    tab.store.getState().tick(0.05);
    seen();

    // Двадцать тиков за секунду, и Токены растут на каждом: заголовок не должен поспевать за ними.
    for (let i = 1; i < 20; i += 1) {
      vi.advanceTimersByTime(50);
      holding(tab, 1000 * (i + 1));
      tab.store.getState().tick(0.05);
      seen();
    }
    expect(writes).toEqual(['1,00 K · Token Clicker']);

    vi.advanceTimersByTime(50);
    tab.store.getState().tick(0.05);
    seen();
    expect(writes).toEqual(['1,00 K · Token Clicker', '20,00 K · Token Clicker']);
  });

  it('does not touch the title when the number reads the same, so the tab strip stays still', async () => {
    const tab = await openTab();
    holding(tab, 1.5e6);
    tab.store.getState().tick(0.05);
    for (let i = 0; i < 5; i += 1) {
      vi.advanceTimersByTime(1000);
      tab.store.getState().tick(0.05);
    }
    // Токены не двигались, а пять секунд прошло: заголовок остался тем же и писался один раз.
    expect(assigned).toEqual(['1,50 M · Token Clicker']);
  });

  it('silences the sound while the page is hidden and gives it back with the settings it had', async () => {
    const tab = await openTab();
    tab.store.getState().setVolume(0.4);
    const settings = tab.store.getState().state.settings;
    expect(tab.silence()).not.toHaveBeenCalledWith(true, expect.anything());

    tab.show(false);
    expect(tab.silence()).toHaveBeenLastCalledWith(true, settings);
    // Тишина — не настройка: ползунок и мьют игрока остаются там, где он их оставил, поэтому
    // возвращение не может прозвучать иначе, чем он выбрал.
    expect(tab.store.getState().state.settings).toEqual(settings);

    tab.show(true);
    expect(tab.silence()).toHaveBeenLastCalledWith(false, settings);
    expect(tab.store.getState().state.settings).toEqual(settings);
    expect(tab.store.getState().state.settings.volume).toBe(0.4);
  });

  it('hands over the settings the player has at the moment he leaves, not the ones from load', async () => {
    const tab = await openTab();
    tab.store.getState().toggleMute();
    tab.show(false);
    // Мьют, поставленный до ухода, должен пережить возвращение: тишина не снимает его за игрока.
    expect(tab.silence()).toHaveBeenLastCalledWith(true, expect.objectContaining({ muted: true }));
    tab.show(true);
    expect(tab.silence()).toHaveBeenLastCalledWith(false, expect.objectContaining({ muted: true }));
  });

  it('starts silent when the page is opened in the background', async () => {
    const tab = await openTab('hidden');
    expect(tab.silence()).toHaveBeenCalledWith(true, tab.store.getState().state.settings);
  });

  it('does not ask the sound twice for a visibility that has not changed', async () => {
    const tab = await openTab();
    tab.show(true);
    expect(tab.silence()).not.toHaveBeenCalled();
    tab.show(false);
    tab.show(false);
    expect(tab.silence()).toHaveBeenCalledTimes(1);
  });
});

/**
 * Битое сохранение при загрузке.
 *
 * Перезагрузка модуля — тем же приёмом, что и выше: загрузка читается один раз при создании
 * магазина, поэтому подмена хранилища обязана случиться до импорта. Хранилище здесь словарь
 * в памяти теста: настоящий сейв игрока тест не трогает и стереть не может.
 */
describe('corrupt save on load', () => {
  const truncated = '{"version":8,"tokens":12345,"agents":{"m:gpt-4';

  const reloadWithCell = async (initial: Record<string, string>) => {
    const cell = new Map<string, string>(Object.entries(initial));
    const listeners = new Map<string, (() => void)[]>();
    const add = (type: string, fn: () => void) => {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    };
    const listen = { addEventListener: add, removeEventListener: () => {} };
    vi.stubGlobal('window', { innerWidth: 800, innerHeight: 600, ...listen });
    vi.stubGlobal('document', { visibilityState: 'visible', ...listen });
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => cell.get(k) ?? null,
      setItem: (k: string, v: string) => void cell.set(k, v),
      removeItem: (k: string) => void cell.delete(k),
    });
    vi.resetModules();
    const mod = await import('./useGameStore');
    const snapshot = mod.useGameStore.getState();
    vi.unstubAllGlobals();
    return { store: mod.useGameStore, snapshot, cell };
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('quarantines truncated bytes, starts fresh and says so instead of starting quietly', async () => {
    const { snapshot, cell } = await reloadWithCell({ [SAVE_KEY]: truncated });
    // Исходные байты целы под отдельным ключом, а основной ключ свежей игрой не затёрт:
    // загрузка ничего не пишет, она только увозит мусор в карантин.
    expect(cell.get(CORRUPT_SAVE_KEY)).toBe(truncated);
    expect(cell.get(SAVE_KEY)).toBeUndefined();
    // Новая игра, а не обломки старой.
    expect(snapshot.state.totalTokens).toBe(0);
    // Понятное сообщение вместо тихого старта с нуля.
    expect(snapshot.toasts.map((t) => t.title)).toContain('Сохранение повреждено');
  });

  it('starts quietly when the storage is empty', async () => {
    const { snapshot, cell } = await reloadWithCell({});
    expect(snapshot.toasts).toEqual([]);
    expect(cell.get(CORRUPT_SAVE_KEY)).toBeUndefined();
  });

  it('does not quarantine a readable save', async () => {
    const now = Date.now();
    const { snapshot, cell } = await reloadWithCell({
      [SAVE_KEY]: serialize({ ...newGame(now), totalTokens: 5 }),
    });
    expect(cell.get(CORRUPT_SAVE_KEY)).toBeUndefined();
    expect(snapshot.toasts).toEqual([]);
    expect(snapshot.state.totalTokens).toBe(5);
  });
});

describe('the Серия and holding a key down', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** Свежая игра без чисел и искр в воздухе и без Кликов в окне Серии. */
  const freshRun = (): void => {
    // Система движение разрешает; запрос о нём нужен стору при каждом решении об искрах.
    vi.stubGlobal('window', { matchMedia: (media: string) => ({ matches: false, media }) });
    freshStore();
    useGameStore.setState({ floaters: [], clickSparks: [] });
  };

  it('pays the same Токены for every Клик at any level of the Серия', () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    freshRun();
    const price = clickValue(state());
    const paid: number[] = [];
    const levels: number[] = [];
    for (let i = 0; i < 25; i += 1) {
      const before = state().tokens;
      store().clickPrompt(10, 10);
      paid.push(state().tokens - before);
      levels.push(store().floaters[store().floaters.length - 1].level);
      vi.advanceTimersByTime(80);
    }
    // Тест охватывает и покой, и высший уровень Серии, иначе равенство ничего не доказывало бы.
    expect(levels[0]).toBe(0);
    expect(levels[levels.length - 1]).toBeGreaterThan(2);
    for (const p of paid) expect(p).toBe(price);
  });

  it('plays the Клик sound one level higher as the Серия grows, and back down after a pause', () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    freshRun();
    vi.mocked(playClickSound).mockClear();
    for (let i = 0; i < 15; i += 1) {
      store().clickPrompt(10, 10);
      vi.advanceTimersByTime(80);
    }
    const levels = vi.mocked(playClickSound).mock.calls.map((c) => c[1]);
    expect(levels[0]).toBe(0);
    expect(levels[levels.length - 1]).toBeGreaterThan(levels[0] ?? 0);
    vi.advanceTimersByTime(5000);
    store().clickPrompt(10, 10);
    expect(vi.mocked(playClickSound).mock.calls.at(-1)?.[1]).toBe(0);
  });

  it('shows more sparks and a bigger +N at a higher level, none of them with the switches off', () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    freshRun();
    for (let i = 0; i < 15; i += 1) {
      store().clickPrompt(10, 10);
      vi.advanceTimersByTime(80);
    }
    const sparks = store().clickSparks;
    expect(sparks.length).toBeGreaterThan(0);
    expect(sparks[sparks.length - 1].level).toBeGreaterThan(sparks[0]?.level ?? 0);
    expect(store().floaters[store().floaters.length - 1].level).toBeGreaterThan(2);

    store().setEffect('particles', false);
    expect(store().clickSparks).toEqual([]);
    store().clickPrompt(10, 10);
    expect(store().clickSparks).toEqual([]);
    expect(store().floaters.length).toBeGreaterThan(0);

    store().setEffect('floaters', false);
    store().clickPrompt(10, 10);
    expect(store().floaters).toEqual([]);
  });

  it('makes no sparks under less animation, and the Клик still counts', () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    freshRun();
    vi.stubGlobal('window', { matchMedia: (media: string) => ({ matches: true, media }) });
    for (let i = 0; i < 10; i += 1) store().clickPrompt(10, 10);
    expect(store().clickSparks).toEqual([]);
    expect(state().clicks).toBe(10);
  });

  it('clears the sparks from the air once they have flown', () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    freshRun();
    for (let i = 0; i < 10; i += 1) {
      store().clickPrompt(10, 10);
      vi.advanceTimersByTime(60);
    }
    vi.advanceTimersByTime(2000);
    expect(store().clickSparks).toEqual([]);
  });

  it('holding a key gives no more Кликов per second than the ceiling, however often the key repeats', () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    freshRun();
    const accepted: number[] = [];
    // Автоповтор клавиши шлёт десятки нажатий в секунду; повторяем его шагом в 8 мс на три секунды.
    for (let t = 0; t < 3000; t += 8) {
      vi.setSystemTime(T0 + t);
      if (store().holdClick(10, 10)) accepted.push(t);
    }
    expect(state().clicks).toBe(accepted.length);
    expect(accepted.length).toBeGreaterThan(20);
    for (const at of accepted) {
      const inSecond = accepted.filter((other) => other > at - 1000 && other <= at).length;
      // Потолок — литерал из спеки, а не константа модуля: сравнение с ней прошло бы при любом её значении.
      expect(inSecond).toBeLessThanOrEqual(10);
    }
  });

  it('a held key pays the ordinary price of a Клик', () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    freshRun();
    const price = clickValue(state());
    const before = state().tokens;
    expect(store().holdClick(10, 10)).toBe(true);
    expect(state().tokens - before).toBe(price);
  });
});

describe('горячие клавиши в сторе', () => {
  beforeEach(() => {
    freshStore();
    useGameStore.setState({ shopTab: 'models', helpOpen: false, activeTab: 'click' });
  });

  it('1, 2 and 3 open the Models, Upgrades and Prestige tabs of the shop', () => {
    store().runHotkey({ kind: 'shopTab', tab: 'upgrades' });
    expect(store().shopTab).toBe('upgrades');
    store().runHotkey({ kind: 'shopTab', tab: 'prestige' });
    expect(store().shopTab).toBe('prestige');
    store().runHotkey({ kind: 'shopTab', tab: 'models' });
    expect(store().shopTab).toBe('models');
  });

  it('a tab key also brings the shop to the screen on a phone, where one column shows at a time', () => {
    useGameStore.setState({ activeTab: 'click' });
    store().runHotkey({ kind: 'shopTab', tab: 'upgrades' });
    expect(store().activeTab).toBe('shop');
  });

  it('? opens the key card and a second ? closes it', () => {
    store().runHotkey({ kind: 'help' });
    expect(store().helpOpen).toBe(true);
    store().runHotkey({ kind: 'help' });
    expect(store().helpOpen).toBe(false);
  });

  it('a hotkey never touches the run: no Токены, no Агенты, nothing to save', () => {
    const before = state();
    store().runHotkey({ kind: 'shopTab', tab: 'prestige' });
    store().runHotkey({ kind: 'help' });
    expect(state()).toBe(before);
  });
});

describe('покупка с модификатором', () => {
  beforeEach(() => {
    freshStore();
    withTokens(1e30);
  });

  it('buys exactly the requested amount and leaves the chosen ×N alone', () => {
    store().buyAgents(first.id, 10);
    expect(state().agents[first.id]).toBe(10);
    expect(store().buyAmount).toBe(1);
  });

  it('with no amount it buys what the buttons chose, as before', () => {
    useGameStore.setState({ buyAmount: 10 });
    store().buyAgents(first.id);
    expect(state().agents[first.id]).toBe(10);
  });

  it('Max spends what Max spends: the same purchase as choosing Max by button', () => {
    const viaButton = engineBuyAgents(state(), first.id, 'max');
    store().buyAgents(first.id, 'max');
    expect(state().agents[first.id]).toBe(viaButton.agents[first.id]);
    expect(state().tokens).toBe(viaButton.tokens);
  });

  it('a modifier on a sale sells that amount, capped at what is owned', () => {
    store().buyAgents(first.id, 100);
    store().sellAgents(first.id, 10);
    expect(state().agents[first.id]).toBe(90);
    store().sellAgents(first.id, 'max');
    expect(state().agents[first.id] ?? 0).toBe(0);
  });
});
