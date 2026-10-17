import { describe, expect, it } from 'vitest';
import { CATALOG } from './catalog';
import { advanceTime, applyOffline, clickValue, incomeGain, modelIncome, offlineCapHours, offlineIncome, totalIncome } from './engine';
import { newGame, type GameState } from './state';
import { synergyUpgradeId } from './upgrades';
import { HEAT_COOL_RATE, HEAT_RATE, TEMP_MAX, heatRate, safeTemp, thermalModsFor, thermalRead } from './thermal';
import { characterIncomeMult, characterReadout, characterStrength } from './character';
import { LAB_IDS, type LabId } from '../data/labs';

const T0 = 1_000_000;
/**
 * Omni: в нём есть Модели всех восьми Лабораторий, а Правило («Ценовая война») не зависит от
 * состава офиса — в «Мультимодальной» «Разнообразие» двигало бы Доход вместе с числом Лабораторий
 * и подмешивалось бы к тому, что тест хочет измерить.
 */
const GEN = 3;

/** Офис из `n` Агентов каждой из перечисленных Лабораторий (по первой Модели Лаборатории). */
function office(labs: Partial<Record<LabId, number>>, perks: string[] = []): GameState {
  const agents: Record<string, number> = {};
  for (const [lab, n] of Object.entries(labs) as [LabId, number][]) {
    const model = CATALOG[GEN].models.find((m) => m.lab === lab);
    if (!model) throw new Error(`в Поколении ${GEN} нет Модели ${lab}`);
    agents[model.id] = n;
  }
  return { ...newGame(T0), generation: GEN, maxGeneration: GEN, agents, perks, temp: 0, heat: 0 };
}

/** Секунд до перегрева на Температуре `temp`: тик по 0,5 с без Галлюцинаций. */
function secondsToOverheat(s: GameState, temp: number): number {
  let cur: GameState = { ...s, temp };
  for (let t = 0; t < 600; t += 0.5) {
    cur = advanceTime(cur, 0.5, () => 1);
    if (cur.overheatedAt > 0) return t + 0.5;
  }
  return Infinity;
}

const BASE_SAFE = HEAT_COOL_RATE / HEAT_RATE;

describe('Характер Лаборатории: сила зависит от состава офиса', () => {
  it('равна нулю без Агентов и растёт с долей Лаборатории в офисе', () => {
    expect(characterStrength(office({}), 'anthropic')).toBe(0);
    const solo = characterStrength(office({ anthropic: 20 }), 'anthropic');
    const diluted = characterStrength(office({ anthropic: 20, meta: 20 }), 'anthropic');
    expect(solo).toBeGreaterThan(diluted);
    expect(diluted).toBeGreaterThan(0);
    // Сила — доля, а не горсть Агентов: она не выходит за единицу ни в каком офисе.
    expect(solo).toBeLessThan(1);
  });

  it('не даёт Характера Лаборатории без Характера', () => {
    expect(thermalModsFor(office({ meta: 50 }))).toEqual(thermalModsFor(office({})));
    expect(safeTemp(office({ meta: 50 }))).toBeCloseTo(BASE_SAFE, 9);
  });

  it('сдвигает безопасную Температуру вместе с составом офиса', () => {
    const calm = safeTemp(office({ anthropic: 30 }));
    const hot = safeTemp(office({ xai: 30 }));
    const compact = safeTemp(office({ mistral: 30 }));
    // Осторожность и Компактность поднимают порог, Горячая голова опускает.
    expect(calm).toBeGreaterThan(compact);
    expect(compact).toBeGreaterThan(BASE_SAFE);
    expect(hot).toBeLessThan(BASE_SAFE);
    // Смешанный офис лежит между чистыми и зависит от пропорции, а не от наличия Лаборатории.
    const mixed = safeTemp(office({ anthropic: 15, xai: 15 }));
    expect(mixed).toBeLessThan(calm);
    expect(mixed).toBeGreaterThan(hot);
    expect(safeTemp(office({ anthropic: 25, xai: 5 }))).toBeGreaterThan(safeTemp(office({ anthropic: 5, xai: 25 })));
  });

  it('безопасная Температура — та, на которой перегрев не копится', () => {
    for (const labs of [{ anthropic: 30 }, { xai: 30 }, { mistral: 30 }, { anthropic: 10, xai: 20, meta: 10 }]) {
      const s = office(labs);
      expect(heatRate(safeTemp(s), thermalModsFor(s))).toBeCloseTo(HEAT_COOL_RATE, 9);
    }
  });

  it('меняет скорость перегрева: xAI греет быстрее, Anthropic и Mistral медленнее', () => {
    const base = secondsToOverheat(office({ meta: 30 }), 1);
    const xai = secondsToOverheat(office({ xai: 30 }), 1);
    const anthropic = secondsToOverheat(office({ anthropic: 30 }), 1);
    const mistral = secondsToOverheat(office({ mistral: 30 }), 1);
    expect(xai).toBeLessThan(base);
    expect(anthropic).toBeGreaterThan(base);
    expect(mistral).toBeGreaterThan(base);
    expect(anthropic).toBeGreaterThan(mistral);
  });

  it('меняет, сколько Дохода даёт жар: xAI больше, Anthropic меньше', () => {
    const at = (labs: Partial<Record<LabId, number>>) => thermalRead({ ...office(labs), temp: 1 }).mult;
    expect(at({ xai: 30 })).toBeGreaterThan(at({ meta: 30 }));
    expect(at({ anthropic: 30 })).toBeLessThan(at({ meta: 30 }));
    // Холод ничего не платит ни при каком Характере.
    expect(thermalRead(office({ xai: 30 })).mult).toBe(1);
    expect(thermalRead(office({ anthropic: 30 })).mult).toBe(1);
  });

  it('складывается с Перками Оверклокера: перегрев перемножается, жар складывается', () => {
    const plain = office({ anthropic: 30 });
    const cooled = office({ anthropic: 30 }, ['oc_cooling']);
    // Жидкостное охлаждение (×0,85) стоит поверх Осторожности, а не вместо неё.
    expect(safeTemp(cooled)).toBeCloseTo(safeTemp(plain) / 0.85, 9);
    // На предельной шкале, где перегрев копится заведомо: на единице осторожный офис с охлаждением
    // не перегревается вовсе.
    expect(secondsToOverheat(plain, TEMP_MAX)).toBeLessThan(Infinity);
    expect(secondsToOverheat(cooled, TEMP_MAX)).toBeGreaterThan(secondsToOverheat(plain, TEMP_MAX));
    const tuned = office({ xai: 30 }, ['oc_tuning']);
    expect(thermalRead({ ...tuned, temp: 1 }).mult).toBeGreaterThan(thermalRead({ ...office({ xai: 30 }), temp: 1 }).mult);
    expect(thermalRead({ ...tuned, temp: 1 }).mult).toBeGreaterThan(
      thermalRead({ ...office({ meta: 30 }, ['oc_tuning']), temp: 1 }).mult,
    );
  });

  it('не уводит Доход ниже холода даже у самой осторожной Лаборатории на полной шкале', () => {
    expect(thermalRead({ ...office({ anthropic: 500 }), temp: 1.6 }).mult).toBeGreaterThan(1);
  });
});

/** Модель Лаборатории в Поколении теста: та, которую `office` нанимает. */
const modelOf = (lab: LabId) => {
  const m = CATALOG[GEN].models.find((x) => x.lab === lab);
  if (!m) throw new Error(`в Поколении ${GEN} нет Модели ${lab}`);
  return m;
};

describe('Экосистема Google: Синергия растёт от числа других Лабораторий в офисе', () => {
  const withSynergy = (labs: Partial<Record<LabId, number>>): GameState => ({
    ...office(labs),
    upgrades: [synergyUpgradeId(GEN, 'google')],
  });
  const google = modelOf('google');

  it('поднимает Доход Google в разнообразном офисе против чистого', () => {
    const solo = modelIncome(withSynergy({ google: 30 }), google);
    const three = modelIncome(withSynergy({ google: 30, anthropic: 30, deepseek: 30, mistral: 30 }), google);
    const five = modelIncome(withSynergy({ google: 30, anthropic: 30, deepseek: 30, mistral: 30, xai: 30, openai: 30 }), google);
    expect(three).toBeGreaterThan(solo);
    expect(five).toBeGreaterThan(three);
    // Синергия 30 Агентов Google: 1 + 0,3; с тремя другими Лабораториями её прибавка растёт в 1,45 раза.
    expect(three / solo).toBeCloseTo((1 + 0.3 * 1.45) / 1.3, 9);
  });

  it('не считает Лабораторию, у которой в офисе горстка Агентов', () => {
    const lone = modelIncome(withSynergy({ google: 30, anthropic: 1, deepseek: 1 }), google);
    expect(lone).toBe(modelIncome(withSynergy({ google: 30 }), google));
  });

  it('не трогает чужие Модели и молчит без Агентов Google', () => {
    const anthropic = modelOf('anthropic');
    const alone = modelIncome(withSynergy({ anthropic: 30, deepseek: 30 }), anthropic);
    expect(modelIncome(withSynergy({ anthropic: 30, deepseek: 30, google: 30 }), anthropic)).toBe(alone);
    // Без Агентов Google в офисе нет ни их Дохода, ни прибавки к чьему-либо.
    expect(modelIncome(withSynergy({ anthropic: 30, deepseek: 30 }), google)).toBe(0);
  });

  it('ничего не меняет, пока Синергия Google не куплена', () => {
    const bare = (labs: Partial<Record<LabId, number>>) => modelIncome(office(labs), google);
    expect(bare({ google: 30, anthropic: 30, deepseek: 30, mistral: 30 })).toBe(bare({ google: 30 }));
  });
});

describe('Эффективность DeepSeek: Клик сильнее, Галлюцинаций больше', () => {
  const hallu = (labs: Partial<Record<LabId, number>>) => thermalRead({ ...office(labs), temp: 1 }).halluRate;

  it('усиливает Клик офиса с Агентами DeepSeek и не трогает остальные', () => {
    const base = clickValue(office({ anthropic: 30 }));
    expect(clickValue(office({ deepseek: 30 }))).toBeGreaterThan(base);
    // Сила 30 / (30 + 10) = 0,75; Клик растёт на 1,5 за единицу силы.
    expect(clickValue(office({ deepseek: 30 })) / base).toBeCloseTo(1 + 1.5 * 0.75, 9);
    // Без Агентов DeepSeek Клик такой же, как в пустом офисе.
    expect(clickValue(office({ meta: 30, xai: 30, google: 30 }))).toBe(clickValue(office({})));
  });

  it('делит усиление Клика с остальными Лабораториями офиса', () => {
    expect(clickValue(office({ deepseek: 30 }))).toBeGreaterThan(clickValue(office({ deepseek: 30, anthropic: 30 })));
    expect(clickValue(office({ deepseek: 30, anthropic: 30 }))).toBeGreaterThan(clickValue(office({ anthropic: 30 })));
  });

  it('учащает Галлюцинации ценой того же Характера', () => {
    const base = hallu({ anthropic: 30 });
    expect(hallu({ deepseek: 30 })).toBeGreaterThan(base);
    expect(hallu({ deepseek: 30 }) / base).toBeCloseTo(1 + 1.0 * 0.75, 9);
    expect(hallu({ meta: 30, google: 30 })).toBe(base);
  });

  it('не двигает безопасную Температуру: она про перегрев, а не про Галлюцинации', () => {
    expect(safeTemp(office({ deepseek: 30 }))).toBeCloseTo(BASE_SAFE, 9);
  });
});

describe('Хайп OpenAI: Волны хайпа приходят чаще', () => {
  /** Доля Волн хайпа среди Событий, выпавших при `rnd`, равномерно обходящем отрезок [0, 1). */
  function hypeShare(labs: Partial<Record<LabId, number>>): number {
    const steps = 400;
    let hype = 0;
    for (let k = 0; k < steps; k++) {
      const r = (k + 0.5) / steps;
      const due: GameState = { ...office(labs), nextEventAt: T0 + 1, event: null };
      if (advanceTime(due, 0.05, () => r).event?.kind === 'hype') hype++;
    }
    return hype / steps;
  }

  it('поднимает долю Волн хайпа среди Событий офиса с Агентами OpenAI', () => {
    // Четыре вида, веса равны: без OpenAI Волна хайпа — каждое четвёртое Событие.
    expect(hypeShare({ anthropic: 30 })).toBeCloseTo(0.25, 2);
    // Сила 30 / 40 = 0,75; вес Волны хайпа 1 + 2 × 0,75 = 2,5 против трёх по единице.
    expect(hypeShare({ openai: 30 })).toBeCloseTo(2.5 / 5.5, 2);
  });

  it('делит усиление с остальными Лабораториями и молчит без Агентов OpenAI', () => {
    expect(hypeShare({ openai: 30, anthropic: 30 })).toBeLessThan(hypeShare({ openai: 30 }));
    expect(hypeShare({ openai: 30, anthropic: 30 })).toBeGreaterThan(hypeShare({ anthropic: 30 }));
    expect(hypeShare({ meta: 30, google: 30, deepseek: 30 })).toBeCloseTo(0.25, 2);
  });

  it('не меняет силу самой Волны: эффект по-прежнему платит только пойманный Золотой Токен', () => {
    const hyped: GameState = {
      ...office({ openai: 30 }),
      event: { kind: 'hype', startedAt: T0, red: false },
      eventCaughtAt: 0,
    };
    const caught: GameState = { ...hyped, eventCaughtAt: T0 };
    expect(totalIncome(hyped, T0 + 1000)).toBeCloseTo(totalIncome({ ...hyped, event: null }, T0 + 1000), 6);
    expect(totalIncome(caught, T0 + 1000) / totalIncome(hyped, T0 + 1000)).toBeCloseTo(7, 6);
  });
});

describe('Открытые веса Meta: Агенты Meta слегка усиливают чужие Модели', () => {
  it('поднимает Доход чужих Моделей и не трогает собственные Модели Meta', () => {
    const anthropic = modelOf('anthropic');
    const meta = modelOf('meta');
    const alone = modelIncome(office({ anthropic: 30 }), anthropic);
    const withMeta = modelIncome(office({ anthropic: 30, meta: 40 }), anthropic);
    // Сорок Агентов Meta — половина от полки в 40: чужие Модели растут на половину от 0,1.
    expect(withMeta / alone).toBeCloseTo(1 + 0.1 * 0.5, 9);
    expect(modelIncome(office({ anthropic: 30, meta: 40 }), meta)).toBe(modelIncome(office({ meta: 40 }), meta));
  });

  it('растёт с числом Агентов Meta, упирается в потолок и исчезает без них', () => {
    const anthropic = modelOf('anthropic');
    const income = (labs: Partial<Record<LabId, number>>) => modelIncome(office(labs), anthropic);
    expect(income({ anthropic: 30, meta: 60 })).toBeGreaterThan(income({ anthropic: 30, meta: 30 }));
    expect(income({ anthropic: 30, meta: 30 })).toBeGreaterThan(income({ anthropic: 30 }));
    expect(income({ anthropic: 30, meta: 100_000 }) / income({ anthropic: 30 })).toBeLessThan(1.1);
    expect(income({ anthropic: 30, mistral: 30, google: 30 })).toBe(income({ anthropic: 30 }));
  });

  it('не уменьшается от найма чужого Агента: доля Meta в офисе тут ни при чём', () => {
    const anthropic = modelOf('anthropic');
    const before = modelIncome(office({ anthropic: 30, meta: 40 }), anthropic);
    expect(modelIncome(office({ anthropic: 30, meta: 40, mistral: 500 }), anthropic)).toBe(before);
  });
});

describe('Конвейер Alibaba: растёт от числа разных Моделей в офисе', () => {
  const alibaba = modelOf('alibaba');

  it('поднимает Доход Alibaba с каждой другой Моделью офиса', () => {
    const solo = modelIncome(office({ alibaba: 30 }), alibaba);
    const three = modelIncome(office({ alibaba: 30, anthropic: 30, xai: 30 }), alibaba);
    const five = modelIncome(office({ alibaba: 30, anthropic: 30, xai: 30, mistral: 30, google: 30 }), alibaba);
    // Каждая другая Модель даёт Alibaba +0,02 к множителю: сильнее нельзя, иначе вместе с кривой
    // порогов Апгрейдов Модели лестница Ранга и полоса 3× не держатся (tierCurve.test.ts).
    expect(three / solo).toBeCloseTo(1.04, 9);
    expect(five / solo).toBeCloseTo(1.08, 9);
  });

  it('считает разные Модели, а не Агентов: тридцать Агентов одной Модели прибавляют столько же, сколько триста', () => {
    expect(modelIncome(office({ alibaba: 30, anthropic: 300 }), alibaba)).toBe(
      modelIncome(office({ alibaba: 30, anthropic: 30 }), alibaba),
    );
  });

  it('считает только Модели с настоящим присутствием и не трогает чужие', () => {
    const base = modelIncome(office({ alibaba: 30 }), alibaba);
    expect(modelIncome(office({ alibaba: 30, anthropic: 1, xai: 2 }), alibaba)).toBe(base);
    const anthropic = modelOf('anthropic');
    expect(modelIncome(office({ anthropic: 30, alibaba: 30, xai: 30 }), anthropic)).toBe(
      modelIncome(office({ anthropic: 30, xai: 30 }), anthropic),
    );
  });
});

describe('Характеры всех Лабораторий вместе', () => {
  it('никогда не отнимают Доход у найма: прирост от Агента положителен в каждом составе', () => {
    for (const g of CATALOG) {
      for (const n of [3, 30, 300]) {
        const agents: Record<string, number> = {};
        for (const m of g.models) agents[m.id] = n;
        const upgrades = [...new Set(g.models.map((m) => m.lab))].map((lab) => synergyUpgradeId(g.index, lab));
        const full: GameState = { ...newGame(T0), generation: g.index, maxGeneration: g.index, agents, upgrades, temp: 0, heat: 0 };
        for (const m of g.models) expect(incomeGain(full, m.id, 1)).toBeGreaterThan(0);
      }
    }
  });
});

describe('Подсказка о Характере в карточке Модели', () => {
  it('называет меру, по которой Характер читает офис', () => {
    const rowsOf = (lab: LabId, labs: Partial<Record<LabId, number>>) =>
      Object.fromEntries(characterReadout(office(labs), modelOf(lab)).map((r) => [r.label, r.value]));
    expect(rowsOf('anthropic', { anthropic: 30 })).toEqual({ 'Сила в вашем офисе': '75%' });
    expect(rowsOf('google', { google: 30, anthropic: 30, xai: 30 })).toEqual({ 'Других Лабораторий в офисе': '2' });
    expect(rowsOf('alibaba', { alibaba: 30, anthropic: 30 })).toEqual({ 'Других Моделей в офисе': '1' });
    expect(rowsOf('meta', { meta: 40 })).toEqual({ 'Чужие Модели сильнее на': '5%' });
    expect(rowsOf('deepseek', {})).toEqual({ 'Сила в вашем офисе': '0%' });
  });
});

describe('Характеры и Оффлайн-доход', () => {
  const DAY = 86_400_000;
  /** Офис, где одна из Лабораторий в сорок Агентов, а остальные по двадцать: Характер каждой на виду. */
  const officeLoud = (loud: LabId): GameState => {
    const labs: Partial<Record<LabId, number>> = {};
    for (const lab of LAB_IDS) labs[lab] = lab === loud ? 40 : 20;
    return { ...office(labs), temp: TEMP_MAX, tokens: 0, lastTick: T0 };
  };

  it('платит за простой по постоянному Доходу и ничего не сжигает: Галлюцинации и жар спят', () => {
    for (const lab of LAB_IDS) {
      const s = officeLoud(lab);
      const perSec = offlineIncome(s);
      expect(perSec).toBeGreaterThan(0);
      const hour = applyOffline(s, T0 + 3600_000);
      expect(hour.earned).toBeCloseTo(perSec * 3600, 0);
      // Простой в два раза дольше платит ровно вдвое больше: Характер не съедает время.
      expect(applyOffline(s, T0 + 7200_000).earned).toBeCloseTo(hour.earned * 2, 0);
      // Кошелёк вырос ровно на выплату: ни Галлюцинация DeepSeek, ни перегрев xAI Токенов не отняли.
      expect(hour.state.tokens).toBeCloseTo(hour.earned, 0);
      expect(hour.state.temp).toBe(TEMP_MAX);
    }
  });

  it('упирается в потолок оффлайна, а лишнее время не создаёт Токенов и не откладывается', () => {
    for (const lab of LAB_IDS) {
      const s = officeLoud(lab);
      const capSec = offlineCapHours(s) * 3600;
      const capped = offlineIncome(s) * capSec;
      for (const days of [2, 30, 3650]) {
        const away = applyOffline(s, T0 + days * DAY);
        expect(away.seconds).toBe(capSec);
        expect(away.earned).toBeCloseTo(capped, -3);
        // lastTick уехал на «сейчас»: повторный вход ничего не доначислит.
        expect(away.state.lastTick).toBe(T0 + days * DAY);
        expect(applyOffline(away.state, away.state.lastTick).earned).toBe(0);
      }
      // Длинный тик идёт тем же путём, что и загрузка: потолок не обойти одним большим dt.
      const viaTick = advanceTime(s, 30 * 86_400, () => 1);
      expect(viaTick.tokens).toBeCloseTo(capped, -3);
    }
  });

  it('берёт Характеры в общий постоянный Доход: он равен сумме Дохода Моделей без Температуры', () => {
    for (const lab of LAB_IDS) {
      const s = officeLoud(lab);
      const sum = CATALOG[GEN].models.reduce((acc, m) => acc + modelIncome(s, m), 0);
      expect(offlineIncome(s)).toBeCloseTo(sum, -2);
    }
  });
});

describe('Характеры по всему каталогу', () => {
  it('множитель Дохода от Характеров не перекраивает лестницу Ранга: меньше шага соседних Рангов', () => {
    for (const g of CATALOG) {
      const agents: Record<string, number> = {};
      for (const m of g.models) agents[m.id] = 500;
      const full: GameState = { ...newGame(T0), generation: g.index, maxGeneration: g.index, agents };
      for (const m of g.models) expect(characterIncomeMult(full, m)).toBeLessThan(2);
    }
  });
});
