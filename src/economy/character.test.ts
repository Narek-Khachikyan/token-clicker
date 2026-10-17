import { describe, expect, it } from 'vitest';
import { CATALOG } from './catalog';
import { advanceTime } from './engine';
import { newGame, type GameState } from './state';
import { HEAT_COOL_RATE, HEAT_RATE, TEMP_MAX, heatRate, safeTemp, thermalModsFor, thermalRead } from './thermal';
import { characterStrength } from './character';
import type { LabId } from '../data/labs';

const T0 = 1_000_000;
/** Мультимодальная: в ней есть Модели и Anthropic, и xAI, и Mistral, и Лабораторий без Характера. */
const GEN = 2;

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
