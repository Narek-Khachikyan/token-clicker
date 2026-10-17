import { describe, expect, it, vi, afterEach } from 'vitest';
import { CORRUPT_SAVE_KEY, exportSave, importSave, MIGRATIONS, migrate, quarantineStoredSave, readStoredSave, SAVE_KEY } from './save';
import { CRYSTAL_CYCLE_MS, crystalCycleMs } from './crystal';
import { CATALOG } from './catalog';
import { DEFAULT_VOLUME, newGame, SAVE_VERSION } from './state';

const encodeRaw = (raw: unknown): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(raw));
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
};

const T0 = 1_700_000_000_000;

/** Сохранение версии 6: поля громкости в нём ещё не существует. */
const v6Save = (settings?: Record<string, unknown>) => ({
  version: 6,
  generation: 3,
  tokens: 1e6,
  totalTokens: 1e6,
  lastTick: T0,
  settings: settings ?? { notation: 'sci', muted: true, reducedMotion: true },
});

/** Сохранение текущей версии — то, что реально пишет игра, и форма чужого/битого файла. */
const currentSave = (settings?: Record<string, unknown>) => {
  const base = newGame(T0);
  return { ...base, settings: { ...base.settings, ...settings } };
};

describe('save volume', () => {
  it('gives a v6 save the default volume and keeps the other settings', () => {
    const s = migrate(v6Save(), T0);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.settings.volume).toBe(DEFAULT_VOLUME);
    expect(s.settings.notation).toBe('sci');
    expect(s.settings.muted).toBe(true);
    expect(s.settings.reducedMotion).toBe(true);
    expect(s.generation).toBe(3);
    expect(s.tokens).toBe(1e6);
  });

  it('gives the default volume to a save that predates settings entirely', () => {
    expect(migrate({ version: 1, generation: 2, tokens: 5 }, T0).settings.volume).toBe(DEFAULT_VOLUME);
    // Отсутствие settings целиком — обычное дело, а не мусор: разбор обязан достроить блок.
    expect(migrate({ version: 1, settings: null }, T0).settings.volume).toBe(DEFAULT_VOLUME);
  });

  it('clamps a volume from a corrupt or foreign save into 0..1', () => {
    expect(migrate(currentSave({ volume: 9999 }), T0).settings.volume).toBe(1);
    expect(migrate(currentSave({ volume: -5 }), T0).settings.volume).toBe(0);
    // Импорт идёт через base64 чужого файла — зажим обязан работать и на этом пути.
    expect(importSave(exportSave(currentSave({ volume: 9999 })), T0)!.settings.volume).toBe(1);
    expect(importSave(exportSave(currentSave({ volume: -5 })), T0)!.settings.volume).toBe(0);
  });

  it('falls back to the default when the volume is not a number', () => {
    expect(migrate(currentSave({ volume: 'x' }), T0).settings.volume).toBe(DEFAULT_VOLUME);
    expect(migrate(currentSave({ volume: null }), T0).settings.volume).toBe(DEFAULT_VOLUME);
    expect(migrate(currentSave({ volume: Infinity }), T0).settings.volume).toBe(DEFAULT_VOLUME);
    expect(migrate(currentSave({ volume: NaN }), T0).settings.volume).toBe(DEFAULT_VOLUME);
  });

  it('keeps a volume the player actually chose', () => {
    expect(migrate(currentSave({ volume: 0.25 }), T0).settings.volume).toBe(0.25);
    expect(migrate(currentSave({ volume: 0 }), T0).settings.volume).toBe(0);
    expect(migrate(currentSave({ volume: 1 }), T0).settings.volume).toBe(1);
    // Миграция дополняет, а не перезаписывает: даже поле, которого в настоящей
    // v7-записи быть не могло, сохраняется как есть, а не сбрасывается в дефолт.
    expect(migrate(v6Save({ volume: 0.25 }), T0).settings.volume).toBe(0.25);
  });

  it('round-trips through export/import, including a deliberate silence', () => {
    for (const volume of [0.35, 0]) {
      const s = { ...newGame(T0), settings: { ...newGame(T0).settings, volume } };
      expect(importSave(exportSave(s), T0)!.settings).toEqual(s.settings);
    }
  });
});

describe('save effect switches and channel volumes', () => {
  /** Настройки игрока, который успел выбрать всё, что было выбираемо до переключателей. */
  const CHOSEN = { notation: 'sci', muted: true, volume: 0.25, reducedMotion: true };
  const EFFECT_DEFAULTS = { particles: true, floaters: true, shake: true, ticker: true, musicVolume: 1, sfxVolume: 1 };

  it('brings a save of every earlier version to the current one with every effect on and full channels', () => {
    for (let v = 1; v < SAVE_VERSION; v++) {
      const s = migrate({ version: v, generation: 3, tokens: 1e6, settings: CHOSEN }, T0);
      expect(s.version, `v${v}`).toBe(SAVE_VERSION);
      // Каналы на единице, а не на DEFAULT_VOLUME: общий ползунок остаётся мастером, и игрок,
      // не трогавший новых настроек, слышит игру ровно такой, какой слышал вчера.
      expect(s.settings, `v${v}`).toEqual({ ...CHOSEN, ...EFFECT_DEFAULTS });
      expect(s.generation, `v${v}`).toBe(3);
      expect(s.tokens, `v${v}`).toBe(1e6);
    }
  });

  it('builds the whole settings block for a save that predates settings entirely', () => {
    expect(migrate({ version: 1, generation: 2 }, T0).settings).toEqual({
      notation: 'short',
      muted: false,
      volume: DEFAULT_VOLUME,
      reducedMotion: false,
      ...EFFECT_DEFAULTS,
    });
  });

  it('reads a missing reduced motion in a current save as off', () => {
    // Чужой или урезанный файл текущей версии идёт мимо миграций: дефолт обязан держать и разбор.
    const { reducedMotion: _dropped, ...rest } = newGame(T0).settings;
    expect(migrate({ ...newGame(T0), settings: rest }, T0).settings.reducedMotion).toBe(false);
  });

  it('starts a new game with every effect on and both channels full', () => {
    expect(newGame(T0).settings).toEqual({
      notation: 'short',
      muted: false,
      volume: DEFAULT_VOLUME,
      reducedMotion: false,
      ...EFFECT_DEFAULTS,
    });
  });

  it('keeps what the player switched off and the channel levels they chose', () => {
    const chosen = { particles: false, floaters: false, shake: false, ticker: false, musicVolume: 0.3, sfxVolume: 0 };
    expect(migrate(currentSave(chosen), T0).settings).toMatchObject(chosen);
    // Миграция дополняет, а не перезаписывает: поле, уже стоящее в записи, переживает подъём версии.
    expect(migrate({ version: SAVE_VERSION - 1, settings: { ...CHOSEN, ...chosen } }, T0).settings).toEqual({
      ...CHOSEN,
      ...chosen,
    });
  });

  it('falls back to on and full for values that are not a switch or a level', () => {
    const junk = migrate(
      currentSave({ particles: 'нет', floaters: null, shake: 0, ticker: [], musicVolume: 'x', sfxVolume: Infinity }),
      T0,
    );
    expect(junk.settings).toMatchObject(EFFECT_DEFAULTS);
    expect(migrate(currentSave({ musicVolume: NaN, sfxVolume: null }), T0).settings).toMatchObject({
      musicVolume: 1,
      sfxVolume: 1,
    });
  });

  it('clamps a channel level from a corrupt or foreign save into 0..1', () => {
    expect(migrate(currentSave({ musicVolume: 9999, sfxVolume: -5 }), T0).settings).toMatchObject({
      musicVolume: 1,
      sfxVolume: 0,
    });
    const imported = importSave(exportSave(currentSave({ musicVolume: -2, sfxVolume: 40 })), T0)!;
    expect(imported.settings).toMatchObject({ musicVolume: 0, sfxVolume: 1 });
  });

  it('round-trips through export/import, switches and silent channels included', () => {
    const base = newGame(T0);
    const s = {
      ...base,
      settings: { ...base.settings, particles: false, ticker: false, musicVolume: 0, sfxVolume: 0.4 },
    };
    expect(importSave(exportSave(s), T0)!.settings).toEqual(s.settings);
  });
});

describe('migration chain', () => {
  it('covers every version from 1 to SAVE_VERSION without gaps', () => {
    // Пропуск шага молча обрывал цепочку, а сохранение штамповалось текущей версией:
    // этот тест и есть запрет из AGENTS.md, и пропуск роняет его вместе со сборкой.
    for (let v = 1; v < SAVE_VERSION; v++) {
      expect(MIGRATIONS[v], `missing migration for v${v}`).toBeDefined();
    }
  });

  it('migrates a v7 save with crystals, milestones and quips without wiping them', () => {
    // Живая миграция с прошлой версии: всё, что игрок уже собрал, обязано пережить подъём версии.
    const raw = {
      ...newGame(T0),
      version: SAVE_VERSION - 1,
      crystals: 5,
      crystalUpgrades: ['cu:speed1'],
      milestones: ['ms_click'],
      quipsSeen: ['q1'],
      temp: 0.9,
      heat: 0.2,
    };
    const s = migrate(raw, T0);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.crystals).toBe(5);
    expect(s.crystalUpgrades).toEqual(['cu:speed1']);
    expect(s.milestones).toEqual(['ms_click']);
    expect(s.quipsSeen).toEqual(['q1']);
    expect(s.temp).toBe(0.9);
    expect(s.heat).toBe(0.2);
  });

  it('fills only what is missing and never overwrites a present field with a default', () => {
    // Миграции дополняют, а не перезаписывают: сохранение со штампом v1, но с уже
    // заполненными полями обязано сохранить их все до единого.
    const full = {
      ...newGame(T0),
      version: 1,
      crystals: 5,
      crystalUpgrades: ['cu:speed1'],
      milestones: ['ms_click', 'ms_hire'],
      quipsSeen: ['q1'],
      challengesDone: ['no-click'],
      temp: 0.9,
      heat: 0.2,
      settings: { notation: 'sci', muted: true, volume: 0.25, reducedMotion: true },
    };
    const s = migrate(full, T0);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.crystals).toBe(5);
    expect(s.crystalUpgrades).toEqual(['cu:speed1']);
    expect(s.milestones).toEqual(['ms_click', 'ms_hire']);
    expect(s.quipsSeen).toEqual(['q1']);
    expect(s.challengesDone).toEqual(['no-click']);
    expect(s.temp).toBe(0.9);
    expect(s.heat).toBe(0.2);
    expect(s.settings).toEqual({
      notation: 'sci',
      muted: true,
      volume: 0.25,
      reducedMotion: true,
      particles: true,
      floaters: true,
      shake: true,
      ticker: true,
      musicVolume: 1,
      sfxVolume: 1,
    });
  });
});

describe('migration of the perk tree', () => {
  /** Цена n особых Перков Поколения в прошлой версии: 10, 15, 20… за каждый следующий, вне зависимости от порядка. */
  const oldGenPerksPaid = (n: number) => 10 * n + (5 * n * (n - 1)) / 2;

  /** Сохранение v9 в форме, какой его писала игра: «Наследие» по Поколениям, плоский список Перков. */
  const v9Save = (over: Record<string, unknown>) => {
    const { perkResetUsed: _drop, ...base } = newGame(T0);
    return { ...base, version: 9, ...over };
  };

  it('gives the price of every perk that left the tree back as Compute', () => {
    const raw = v9Save({ compute: 200, computeSpent: 3 + 5 + oldGenPerksPaid(3), perks: ['click_x2', 'start_tokens', 'gen_0', 'gen_1', 'gen_5'] });
    const s = migrate(raw, T0);
    expect(s.version).toBe(SAVE_VERSION);
    // Остались только Перки, которые есть в дереве, и они же остались купленными.
    expect(s.perks).toEqual(['click_x2', 'start_tokens']);
    expect(s.computeSpent).toBe(3 + 5);
    expect(s.compute).toBe(200);
    expect(s.perkResetUsed).toBe(false);
  });

  it('keeps every perk whose id is still in the tree, with its paid price', () => {
    const kept = ['click_x2', 'offline_rate_1', 'start_tokens', 'offline_24h', 'discount', 'autoclick', 'event_alert', 'lab_openai'];
    const s = migrate(v9Save({ compute: 500, computeSpent: 3 + 4 + 5 + 10 + 20 + 25 + 30 + 15, perks: kept }), T0);
    expect(s.perks).toEqual(kept);
    expect(s.computeSpent).toBe(112);
  });

  it('never lets spent exceed earned, even when the old save was inconsistent', () => {
    // Все восемь особых куплены, но «потрачено» в сохранении меньше суммы возврата: возврат упирается в ноль.
    const raw = v9Save({ compute: 100, computeSpent: 40, perks: CATALOG.map((_, i) => `gen_${i}`) });
    const s = migrate(raw, T0);
    expect(s.perks).toEqual([]);
    expect(s.computeSpent).toBe(0);
    // «Потрачено» больше «начислено» в самом сохранении — тоже не доходит до игры.
    const over = migrate(v9Save({ compute: 10, computeSpent: 50, perks: ['click_x2'] }), T0);
    expect(over.computeSpent).toBeLessThanOrEqual(over.compute);
  });

  it('loads an export code of the previous version without loss', () => {
    const raw = v9Save({
      compute: 120,
      computeSpent: 5 + oldGenPerksPaid(2),
      perks: ['start_tokens', 'gen_2', 'gen_3'],
      crystals: 4,
      achievements: ['click_1'],
    });
    const s = importSave(encodeRaw(raw), T0)!;
    expect(s).not.toBeNull();
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.perks).toEqual(['start_tokens']);
    expect(s.computeSpent).toBe(5);
    expect(s.crystals).toBe(4);
    expect(s.achievements).toEqual(['click_1']);
  });

  it('refunds only once: a migrated save loads again as it is', () => {
    const once = migrate(v9Save({ compute: 200, computeSpent: 5 + oldGenPerksPaid(1), perks: ['start_tokens', 'gen_0'] }), T0);
    const twice = migrate(JSON.parse(JSON.stringify(once)), T0);
    expect(twice.computeSpent).toBe(once.computeSpent);
    expect(twice.perks).toEqual(once.perks);
  });
});

describe('migration of the purchase queue', () => {
  /** Сохранение v10 в форме, какой его писала игра: поля очереди закупок в нём ещё нет. */
  const v10Save = (over: Record<string, unknown>) => {
    const { purchaseQueue: _drop, ...base } = newGame(T0);
    return { ...base, version: 10, ...over };
  };

  const agentic = CATALOG[5].models;

  it('gives a save of the previous version an empty queue and keeps everything the player had', () => {
    const raw = v10Save({
      generation: 5,
      maxGeneration: 5,
      tokens: 4e20,
      agents: { [agentic[0].id]: 7 },
      compute: 90,
      computeSpent: 30,
      perks: ['start_tokens'],
      crystals: 3,
      achievements: ['click_1'],
    });
    const s = migrate(raw, T0);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.purchaseQueue).toEqual([]);
    expect(s.generation).toBe(5);
    expect(s.tokens).toBe(4e20);
    expect(s.agents).toEqual({ [agentic[0].id]: 7 });
    expect(s.compute).toBe(90);
    expect(s.computeSpent).toBe(30);
    expect(s.perks).toEqual(['start_tokens']);
    expect(s.crystals).toBe(3);
    expect(s.achievements).toEqual(['click_1']);
  });

  it('loads an export code of the previous version without loss', () => {
    const raw = v10Save({ generation: 6, maxGeneration: 6, tokens: 12345, crystals: 2, prestiges: 6 });
    const s = importSave(encodeRaw(raw), T0)!;
    expect(s).not.toBeNull();
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.purchaseQueue).toEqual([]);
    expect(s.tokens).toBe(12345);
    expect(s.crystals).toBe(2);
    expect(s.prestiges).toBe(6);
  });

  it('keeps the queue the player set through a save, an export and an import', () => {
    const queue = [agentic[0].id, agentic[3].id, agentic[0].id];
    const s = { ...newGame(T0), generation: 5, maxGeneration: 5, purchaseQueue: queue };
    expect(migrate(JSON.parse(JSON.stringify(s)), T0).purchaseQueue).toEqual(queue);
    expect(importSave(exportSave(s), T0)!.purchaseQueue).toEqual(queue);
  });

  it('drops queue entries that are not models of the current generation and any queue outside the rule', () => {
    const foreign = CATALOG[4].models[0].id;
    const mixed = migrate({ ...newGame(T0), generation: 5, purchaseQueue: [agentic[1].id, foreign, 'нет-такой', 7, agentic[2].id] }, T0);
    expect(mixed.purchaseQueue).toEqual([agentic[1].id, agentic[2].id]);
    const elsewhere = migrate({ ...newGame(T0), generation: 4, purchaseQueue: [CATALOG[4].models[0].id] }, T0);
    expect(elsewhere.purchaseQueue).toEqual([]);
  });

  it('caps a queue longer than the rule allows and reads a non-list as empty', () => {
    const long = Array.from({ length: 40 }, () => agentic[0].id);
    expect(migrate({ ...newGame(T0), generation: 5, purchaseQueue: long }, T0).purchaseQueue).toHaveLength(6);
    expect(migrate({ ...newGame(T0), generation: 5, purchaseQueue: 'oops' }, T0).purchaseQueue).toEqual([]);
    expect(migrate({ ...newGame(T0), generation: 5, purchaseQueue: { length: 3 } }, T0).purchaseQueue).toEqual([]);
  });
});

describe('migration of the generation-rule state of GPT-4 and Reasoning', () => {
  /** Сохранение v11 в форме, какой его писала игра: ни ряда покупок, ни размышления в нём ещё нет. */
  const v11Save = (over: Record<string, unknown>) => {
    const { buyStreak: _a, lastBuyAt: _b, thought: _c, thoughtAt: _d, ...base } = newGame(T0);
    return { ...base, version: 11, ...over };
  };

  const gpt4 = CATALOG[1].models;

  it('gives a save of the previous version an empty streak and no held thought, and keeps everything the player had', () => {
    const raw = v11Save({
      generation: 5,
      maxGeneration: 5,
      tokens: 4e20,
      agents: { [CATALOG[5].models[0].id]: 7 },
      purchaseQueue: [CATALOG[5].models[1].id],
      compute: 90,
      computeSpent: 30,
      perks: ['start_tokens'],
      crystals: 3,
      achievements: ['click_1'],
    });
    const s = migrate(raw, T0);
    expect(s.version).toBe(SAVE_VERSION);
    expect([s.buyStreak, s.lastBuyAt, s.thought, s.thoughtAt]).toEqual([0, 0, 0, 0]);
    expect(s.generation).toBe(5);
    expect(s.tokens).toBe(4e20);
    expect(s.agents).toEqual({ [CATALOG[5].models[0].id]: 7 });
    expect(s.purchaseQueue).toEqual([CATALOG[5].models[1].id]);
    expect(s.compute).toBe(90);
    expect(s.computeSpent).toBe(30);
    expect(s.perks).toEqual(['start_tokens']);
    expect(s.crystals).toBe(3);
    expect(s.achievements).toEqual(['click_1']);
  });

  it('loads an export code of the previous version without loss', () => {
    const raw = v11Save({ generation: 4, maxGeneration: 6, tokens: 12345, crystals: 2, prestiges: 4, purchaseQueue: [] });
    const s = importSave(encodeRaw(raw), T0)!;
    expect(s).not.toBeNull();
    expect(s.version).toBe(SAVE_VERSION);
    expect([s.buyStreak, s.thought]).toEqual([0, 0]);
    expect(s.generation).toBe(4);
    expect(s.maxGeneration).toBe(6);
    expect(s.tokens).toBe(12345);
    expect(s.crystals).toBe(2);
    expect(s.prestiges).toBe(4);
  });

  it('keeps the streak and the held thought through a save, an export and an import', () => {
    const streak = { ...newGame(T0), generation: 1, maxGeneration: 1, buyStreak: 12, lastBuyAt: T0 - 5_000, lastTick: T0 };
    const back = migrate(JSON.parse(JSON.stringify(streak)), T0);
    expect([back.buyStreak, back.lastBuyAt]).toEqual([12, T0 - 5_000]);
    const reloaded = importSave(exportSave(streak), T0)!;
    expect([reloaded.buyStreak, reloaded.lastBuyAt]).toEqual([12, T0 - 5_000]);

    const thinking = { ...newGame(T0), generation: 4, maxGeneration: 4, thought: 2.5, thoughtAt: T0 - 100 };
    const again = importSave(exportSave(thinking), T0)!;
    expect([again.thought, again.thoughtAt]).toEqual([2.5, T0 - 100]);
  });

  it('drops the state of a rule the save is not under', () => {
    const elsewhere = migrate({ ...newGame(T0), generation: 3, buyStreak: 9, lastBuyAt: T0, thought: 2, thoughtAt: T0 }, T0);
    expect([elsewhere.buyStreak, elsewhere.lastBuyAt, elsewhere.thought, elsewhere.thoughtAt]).toEqual([0, 0, 0, 0]);
  });

  it('clamps junk: a negative or non-number streak, a thought beyond the limit, a mark from the future', () => {
    const junk = migrate({ ...newGame(T0), generation: 1, buyStreak: -4, lastBuyAt: 'x' }, T0);
    expect([junk.buyStreak, junk.lastBuyAt]).toEqual([0, 0]);
    const huge = migrate({ ...newGame(T0), generation: 1, buyStreak: 1e9, lastBuyAt: T0 + 9e9 }, T0);
    expect(huge.buyStreak).toBeLessThanOrEqual(100);
    expect(huge.lastBuyAt).toBe(T0);
    const over = migrate({ ...newGame(T0), generation: 4, thought: 99, thoughtAt: T0 + 9e9 }, T0);
    expect(over.thought).toBeLessThanOrEqual(4);
    expect(over.thoughtAt).toBe(T0);
    const noStamp = migrate({ ...newGame(T0), generation: 4, thought: 3, thoughtAt: 0 }, T0);
    expect(noStamp.thought).toBe(0);
    const nan = migrate({ ...newGame(T0), generation: 4, thought: 'много', thoughtAt: T0 }, T0);
    expect(nan.thought).toBe(0);
  });

  it('keeps a GPT-4 save under its rule with the models it owns', () => {
    const s = migrate({ ...newGame(T0), generation: 1, agents: { [gpt4[0].id]: 4 }, buyStreak: 4, lastBuyAt: T0 }, T0);
    expect(s.agents).toEqual({ [gpt4[0].id]: 4 });
    expect(s.buyStreak).toBe(4);
  });
});

describe('import rejects non-saves', () => {
  it('rejects an empty object, an empty array and arbitrary JSON without progress fields', () => {
    expect(importSave(encodeRaw({}), T0)).toBeNull();
    expect(importSave(encodeRaw([]), T0)).toBeNull();
    expect(importSave(encodeRaw({ foo: 1, bar: [1, 2] }), T0)).toBeNull();
    expect(importSave(encodeRaw({ version: 8 }), T0)).toBeNull();
    expect(importSave(encodeRaw(42), T0)).toBeNull();
    expect(importSave(encodeRaw('hello'), T0)).toBeNull();
  });

  it('rejects a corrupt version instead of reading it as an old version', () => {
    const base = { ...newGame(T0), crystals: 5, milestones: ['ms_click'], quipsSeen: ['q1'] };
    expect(importSave(encodeRaw({ ...base, version: 'oops' }), T0)).toBeNull();
    expect(importSave(encodeRaw({ ...base, version: 2.5 }), T0)).toBeNull();
    expect(importSave(encodeRaw({ ...base, version: 0 }), T0)).toBeNull();
    expect(importSave(encodeRaw({ ...base, version: NaN }), T0)).toBeNull();
    const { version: _dropped, ...noVersion } = base;
    expect(importSave(encodeRaw(noVersion), T0)).toBeNull();
  });

  it('rejects truncated and non-base64 codes', () => {
    expect(importSave('', T0)).toBeNull();
    expect(importSave('!!!not-base64!!!', T0)).toBeNull();
    expect(importSave(encodeRaw(newGame(T0)).slice(0, 20), T0)).toBeNull();
    expect(importSave('{"tokens":', T0)).toBeNull();
  });

  it('still imports a valid save of the previous version with migrations', () => {
    const prev = { ...newGame(T0), version: SAVE_VERSION - 1, crystals: 3, totalTokens: 1e9 };
    const back = importSave(encodeRaw(prev), T0);
    expect(back).not.toBeNull();
    expect(back!.version).toBe(SAVE_VERSION);
    expect(back!.crystals).toBe(3);
    expect(back!.totalTokens).toBe(1e9);
  });
});

describe('foreign ids', () => {
  const PROTO_IDS = ['constructor', 'toString', 'hasOwnProperty', '__proto__'];
  const modelId = CATALOG[0].models[0].id;

  it('drops prototype keys from every id list', () => {
    const s = migrate(
      {
        ...newGame(T0),
        upgrades: [...PROTO_IDS, `m:${modelId}:0`],
        perks: [...PROTO_IDS, 'click_x2'],
        crystalUpgrades: [...PROTO_IDS, 'cu:speed1'],
        milestones: [...PROTO_IDS, 'ms_click'],
      },
      T0,
    );
    expect(s.upgrades).toEqual([`m:${modelId}:0`]);
    expect(s.perks).toEqual(['click_x2']);
    expect(s.crystalUpgrades).toEqual(['cu:speed1']);
    expect(s.milestones).toEqual(['ms_click']);
  });

  it('drops prototype keys from agents and from the event model', () => {
    const agents: Record<string, unknown> = { [modelId]: 3 };
    for (const id of PROTO_IDS) agents[id] = 5;
    const s = migrate(
      {
        ...newGame(T0),
        agents,
        event: { kind: 'grant', startedAt: T0, red: false, modelId: 'toString' },
      },
      T0,
    );
    expect(s.agents).toEqual({ [modelId]: 3 });
    expect(s.event?.modelId).toBeUndefined();
  });

  it('keeps the crystal cycle numeric after importing a foreign crystal id', () => {
    const back = importSave(encodeRaw({ ...newGame(T0), crystalUpgrades: ['toString', '__proto__'] }), T0)!;
    expect(back.crystalUpgrades).toEqual([]);
    // Чужой id без белого списка давал cycleMs undefined, и цикл уходил в NaN:
    // кристалл «дозревал» каждый тик, раздавая бесплатные кристаллы и Доход.
    expect(crystalCycleMs(back)).toBe(CRYSTAL_CYCLE_MS);
  });
});

describe('corrupt storage', () => {
  const mem = (initial: Record<string, string> = {}) => {
    const cell = new Map(Object.entries(initial));
    return {
      cell,
      storage: {
        getItem: (k: string) => cell.get(k) ?? null,
        setItem: (k: string, v: string) => void cell.set(k, v),
        removeItem: (k: string) => void cell.delete(k),
      },
    };
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads an empty storage as a quiet start', () => {
    const { storage } = mem();
    vi.stubGlobal('localStorage', storage);
    expect(readStoredSave()).toEqual({ status: 'empty' });
  });

  it('reads a valid save as ok', () => {
    const text = JSON.stringify({ ...newGame(T0), tokens: 4242 });
    const { storage } = mem({ [SAVE_KEY]: text });
    vi.stubGlobal('localStorage', storage);
    const read = readStoredSave();
    expect(read.status).toBe('ok');
    if (read.status !== 'ok') return;
    expect(read.text).toBe(text);
    expect((read.value as { tokens: number }).tokens).toBe(4242);
  });

  it('reads truncated JSON as corrupt and quarantines the bytes under a separate key', () => {
    const truncated = '{"version":8,"tokens":12345,"agents":{"m:gpt-4';
    const { cell, storage } = mem({ [SAVE_KEY]: truncated });
    vi.stubGlobal('localStorage', storage);
    const read = readStoredSave();
    expect(read.status).toBe('corrupt');
    if (read.status !== 'corrupt') return;
    expect(read.text).toBe(truncated);
    quarantineStoredSave(read.text);
    // Исходные байты целы под отдельным ключом, а основной ключ свободен под новую игру.
    expect(cell.get(CORRUPT_SAVE_KEY)).toBe(truncated);
    expect(cell.get(SAVE_KEY)).toBeUndefined();
  });
});
