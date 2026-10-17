import { describe, expect, it } from 'vitest';
import { advance, buyAgents, buyPerk, resetPerkTree, totalIncome, clickValue, prestige } from './engine';
import { HALLUC_RATE, HEAT_RATE, OVERHEAT_STUN_SEC, TEMP_YIELD_MAX, halluRate, heatRate, overheatStunMult, tempYieldMult, thermalMods, thermalRead } from './thermal';
import { CATALOG } from './catalog';
import { BRANCHES, PERK_BY_ID, PERKS, perkLock, treeCost } from './perks';
import { newGame, type GameState } from './state';
import { collectResearch, plantResearch } from './research';

const T0 = 1_000_000;

/** Состояние с Compute в избытке и холодной Температурой: цифры здесь не про жар. */
const funded = (compute = 1000): GameState => ({ ...newGame(T0), temp: 0, heat: 0, compute });
/** Покупает цепочку Перков подряд; тест ломается, если какая-то покупка отказала. */
const buyAll = (s: GameState, ids: string[]): GameState =>
  ids.reduce((acc, id) => {
    const next = buyPerk(acc, id);
    expect(next, `покупка ${id} должна пройти`).not.toBe(acc);
    return next;
  }, s);

const tops = PERKS.filter((p) => p.top);

describe('дерево Перков', () => {
  it('состоит из ствола и трёх Ветвей, у каждой Ветви один верхний Перк', () => {
    expect(BRANCHES.map((b) => b.name)).toEqual(['Промпт-инженер', 'Оркестратор', 'Оверклокер']);
    for (const b of BRANCHES) {
      expect(PERKS.filter((p) => p.branch === b.id && p.top)).toHaveLength(1);
    }
    expect(PERKS.filter((p) => p.branch === 'trunk' && p.top)).toHaveLength(0);
  });

  it('ссылается только на существующих предшественников и не замыкается в цикл', () => {
    for (const p of PERKS) {
      for (const r of p.requires) expect(PERK_BY_ID[r], `${p.id} требует ${r}`).toBeDefined();
    }
    // Предшественник стоит в списке раньше: по порядку PERKS дерево собирается сверху вниз.
    PERKS.forEach((p, i) => {
      for (const r of p.requires) expect(PERKS.findIndex((x) => x.id === r)).toBeLessThan(i);
    });
  });

  it('не продаёт Перк, пока не куплены все его предшественники', () => {
    const s = funded();
    const second = PERKS.find((p) => p.requires.length > 0 && !p.top)!;
    expect(buyPerk(s, second.id)).toBe(s);
    expect(perkLock(s.perks, second.id)).toEqual({ kind: 'needs', ids: second.requires });
    // Купили предшественников — покупка проходит.
    const ready = buyAll(s, [...second.requires]);
    expect(buyPerk(ready, second.id)).not.toBe(ready);
  });

  it('верхний Перк требует всех предшественников своей Ветви', () => {
    for (const top of tops) {
      expect(top.requires.length).toBeGreaterThanOrEqual(2);
      const s = funded();
      expect(buyPerk(s, top.id)).toBe(s);
    }
  });

  it('взаимоисключает только верхние Перки разных Ветвей', () => {
    const [a, b] = tops;
    // Берём ровно предшественников, не лишнего: исключение должно быть единственной причиной отказа.
    const closure = (id: string): string[] => {
      const out: string[] = [];
      const walk = (x: string) => {
        for (const r of PERK_BY_ID[x].requires) walk(r);
        if (!out.includes(x)) out.push(x);
      };
      walk(id);
      return out;
    };
    const bothTrees = [...new Set([...closure(a.id).slice(0, -1), ...closure(b.id).slice(0, -1)])];
    let s = buyAll(funded(), bothTrees);
    // Нижние Перки двух Ветвей живут вместе: гибрид не наказан.
    expect(s.perks).toEqual(expect.arrayContaining([...closure(a.id).slice(0, -1), ...closure(b.id).slice(0, -1)]));
    s = buyPerk(s, a.id);
    expect(s.perks).toContain(a.id);
    const rival = buyPerk(s, b.id);
    expect(rival).toBe(s);
    expect(perkLock(s.perks, b.id)).toEqual({ kind: 'rival', id: a.id });
  });

  it('не берёт Compute за отказ', () => {
    const s = funded(1);
    const pricey = PERKS.find((p) => p.cost > 1 && p.requires.length === 0)!;
    expect(buyPerk(s, pricey.id)).toBe(s);
    expect(s.computeSpent).toBe(0);
  });

  it('сумма цен дерева больше Compute, который даёт кампания, так что выбор настоящий', () => {
    // Кампания из восьми Поколений приносит порядка 300 Compute (tools/sim.ts --campaign).
    expect(treeCost()).toBeGreaterThan(300);
  });
});

describe('сброс дерева', () => {
  const built = (): GameState => buyAll(funded(100), ['click_x2', 'start_tokens']);

  it('снимает все Перки и возвращает потраченный Compute', () => {
    const s = built();
    expect(s.computeSpent).toBe(PERK_BY_ID.click_x2.cost + PERK_BY_ID.start_tokens.cost);
    const after = resetPerkTree(s);
    expect(after.perks).toEqual([]);
    expect(after.computeSpent).toBe(0);
    expect(after.compute).toBe(s.compute);
    expect(after.perkResetUsed).toBe(true);
  });

  it('доступен раз за Престиж: второй сброс до Престижа ничего не делает', () => {
    const once = resetPerkTree(built());
    const rebuilt = buyAll(once, ['click_x2']);
    expect(resetPerkTree(rebuilt)).toBe(rebuilt);
    expect(rebuilt.perks).toEqual(['click_x2']);
  });

  it('Престиж снова открывает сброс', () => {
    const flagshipId = CATALOG[0].flagship.id;
    const run = { ...buyAgents({ ...built(), tokens: 1e15, runTokens: 1e15 }, flagshipId, 1) };
    const used = resetPerkTree(run);
    expect(used.perkResetUsed).toBe(true);
    const next = prestige(buyAll(used, ['click_x2']), T0 + 1);
    expect(next.generation).toBe(1);
    expect(next.perkResetUsed).toBe(false);
    expect(resetPerkTree(next)).not.toBe(next);
  });

  it('без купленных Перков не тратит единственный сброс', () => {
    const s = funded();
    expect(resetPerkTree(s)).toBe(s);
  });

  it('не проходит, пока третий слот Исследований занят: Compute вернулся бы, а работа в слоте осталась', () => {
    let s = buyAll(funded(100), ['research_slot']);
    s = plantResearch(s, 'boost', '30m', T0);
    s = plantResearch(s, 'boost', '2h', T0);
    s = plantResearch(s, 'boost', '8h', T0);
    expect(s.research).toHaveLength(3);
    expect(resetPerkTree(s)).toBe(s);
    // Два занятых слота сбросу не мешают: его слот ещё не используется.
    const twoBusy = { ...s, research: s.research.slice(0, 2) };
    expect(resetPerkTree(twoBusy).perks).toEqual([]);
    // Сбор третьего освобождает слот, и сброс проходит.
    const collected = collectResearch(s, 2, T0 + 480 * 60_000);
    expect(resetPerkTree(collected).perks).toEqual([]);
  });

  it('возвращённый Compute снова даёт бонус к Доходу, а покупка его снова отнимает', () => {
    const base = buyAgents({ ...funded(100), tokens: 1e6 }, CATALOG[0].models[0].id, 3);
    const bought = buyAll(base, ['start_tokens']);
    expect(totalIncome(bought)).toBeLessThan(totalIncome(base));
    expect(totalIncome(resetPerkTree(bought))).toBeCloseTo(totalIncome(base));
  });
});

describe('эффекты ствола и Ветвей', () => {
  it('«Наследие поколений» усиливает Доход текущего Забега за каждое пройденное Поколение', () => {
    const model = CATALOG[0].models[0];
    const at = (maxGeneration: number, perks: string[]): GameState => ({
      ...funded(0),
      generation: 0,
      maxGeneration,
      perks,
      agents: { [model.id]: 10 },
    });
    const bare = totalIncome(at(0, []));
    // На первом Поколении пройденных нет — Перк ничего не добавляет.
    expect(totalIncome(at(0, ['start_tokens', 'legacy']))).toBeCloseTo(bare);
    const pct = (PERK_BY_ID.legacy.effect as { pctPerGeneration: number }).pctPerGeneration;
    expect(totalIncome({ ...at(3, ['legacy']) , generation: 0 })).toBeCloseTo(bare * (1 + 3 * pct));
  });

  it('Промпт-инженер множит Клик, верхний Перк Ветви — сильнее всех', () => {
    const base = funded(0);
    const withPerks = (ids: string[]): GameState => ({ ...base, perks: ids });
    expect(clickValue(withPerks(['click_x2']))).toBeCloseTo(clickValue(base) * 2);
    expect(clickValue(withPerks(['click_x2', 'click_chain']))).toBeCloseTo(clickValue(base) * 4);
  });
});

describe('Оркестратор', () => {
  it('верхний Перк Ветви поднимает Доход всех Моделей', () => {
    const model = CATALOG[0].models[0];
    const s: GameState = { ...funded(0), agents: { [model.id]: 10 } };
    expect(totalIncome({ ...s, perks: ['orch_swarm'] })).toBeCloseTo(totalIncome(s) * 1.25);
  });
});

describe('Оверклокер', () => {
  const withPerks = (ids: string[]): GameState => ({ ...funded(0), temp: 1, perks: ids });

  it('без Перков Температура считается по прежним числам', () => {
    const s = withPerks([]);
    expect(heatRate(1, thermalMods(s.perks))).toBeCloseTo(HEAT_RATE);
    expect(halluRate(1, thermalMods(s.perks))).toBeCloseTo(HALLUC_RATE);
    expect(tempYieldMult(1, thermalMods(s.perks))).toBeCloseTo(1 + TEMP_YIELD_MAX);
  });

  // rnd = 1: Галлюцинация (она тоже греет) не выпадает, и меняется только накопление жара.
  const noHallucination = () => 1;

  it('охлаждение замедляет перегрев на 15%', () => {
    const fast = advance({ ...withPerks([]), heat: 0.5 }, 10, noHallucination);
    const slow = advance({ ...withPerks(['oc_cooling']), heat: 0.5 }, 10, noHallucination);
    const gain = (s: GameState) => s.heat - 0.5;
    // Остывание одинаково, меняется только накопление: сравниваем накопление до остывания.
    const cool = 10 / 120;
    expect(gain(slow) + cool).toBeCloseTo((gain(fast) + cool) * 0.85, 5);
  });

  it('мягкий сброс укорачивает оглушение вдвое', () => {
    const justOverheated = (ids: string[]): GameState => ({ ...withPerks(ids), overheatedAt: T0 });
    const mid = T0 + (OVERHEAT_STUN_SEC * 1000) / 2;
    // Через половину обычного окна оглушение обычного состояния ещё держит, а укороченного уже нет.
    expect(overheatStunMult(justOverheated([]), mid)).toBeLessThan(1);
    expect(overheatStunMult(justOverheated(['oc_cooling', 'oc_stun']), mid)).toBe(1);
  });

  it('настройка частот и разгон складывают прибавку к силе жара', () => {
    const read = (ids: string[]) => thermalRead(withPerks(ids)).mult;
    const base = 1 + TEMP_YIELD_MAX;
    expect(read(['oc_tuning'])).toBeCloseTo(1 + TEMP_YIELD_MAX * 1.15);
    expect(read(['oc_tuning', 'oc_overclock'])).toBeCloseTo(1 + TEMP_YIELD_MAX * 1.5);
    expect(read([])).toBeCloseTo(base);
  });

  it('разгон делает Галлюцинации чаще в полтора раза', () => {
    expect(thermalRead(withPerks(['oc_overclock'])).halluRate).toBeCloseTo(HALLUC_RATE * 1.5);
  });
});
