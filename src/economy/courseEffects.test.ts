import { describe, expect, it } from 'vitest';
import { CATALOG } from './catalog';
import { advanceTime, applyOffline, bulkCost, buyAgents, clickValue, discountMult, modelIncome, offlineIncome, prestige } from './engine';
import {
  chooseCourse,
  courseClickMult,
  courseEventWindowMult,
  courseIncomeMult,
  coursePriceMult,
  courseThermalMods,
} from './course';
import { queueAgent, queueCapacity } from './purchaseQueue';
import { activeRules, holdThought, rulePriceMult, thoughtOutlook } from './rules';
import { newGame, type GameState } from './state';
import { COURSES } from '../data/courses';
import { GENERATION_RULES } from '../data/generationRules';
import { safeTemp, thermalModsFor, thermalRead } from './thermal';

const T0 = 1_700_000_000_000;

/** Забег Поколения `generation` с действующим Курсом `course`, без Температуры, часами в `minutes` минут от начала. */
const under = (generation: number, course: string | null, minutes = 0): GameState => ({
  ...newGame(T0),
  generation,
  maxGeneration: generation,
  course,
  temp: 0,
  heat: 0,
  runStartedAt: T0,
  lastTick: T0 + minutes * 60_000,
});

const office = (s: GameState, n = 5): GameState => ({
  ...s,
  agents: Object.fromEntries(CATALOG[s.generation].models.map((m) => [m.id, n])),
});

describe('собственные Курсы: что делают', () => {
  it('«Бережливость» удешевляет каждую покупку на двадцать процентов и ничего больше', () => {
    const plain = office(under(3, null), 2);
    const frugal = office(under(3, 'frugal'), 2);
    for (const m of CATALOG[3].models) {
      expect(bulkCost(m, 2, 5, discountMult(frugal)) / bulkCost(m, 2, 5, discountMult(plain))).toBeCloseTo(0.8, 9);
      expect(modelIncome(frugal, m)).toBe(modelIncome(plain, m));
    }
  });

  it('«Масштабирование» поднимает Доход каждой Модели на десять процентов и не трогает цену', () => {
    const plain = office(under(3, null));
    const scale = office(under(3, 'scale'));
    for (const m of CATALOG[3].models) {
      expect(modelIncome(scale, m) / modelIncome(plain, m)).toBeCloseTo(1.1, 9);
    }
    expect(discountMult(scale)).toBe(discountMult(plain));
  });

  it('«Масштабирование» достаётся и Оффлайн-доходу, но потолок простоя остаётся прежним', () => {
    const plain = office(under(3, null));
    const scale = office(under(3, 'scale'));
    expect(offlineIncome(scale) / offlineIncome(plain)).toBeCloseTo(1.1, 9);
    const away = applyOffline(scale, scale.lastTick + 1000 * 3600_000);
    expect(away.seconds).toBe(8 * 3600);
    expect(away.earned / (offlineIncome(scale) * 8 * 3600)).toBeCloseTo(1, 9);
  });

  it('«Ручная работа» удваивает Клик', () => {
    const plain = office(under(2, null));
    const manual = office(under(2, 'manual'));
    expect(clickValue(manual) / clickValue(plain)).toBeCloseTo(2, 9);
  });

  it('«Холодная голова» вдвое замедляет перегрев, поднимает безопасную Температуру и вдвое режет Галлюцинации', () => {
    const plain = under(2, null);
    const cool = under(2, 'cool');
    expect(thermalModsFor(cool).heat).toBeCloseTo(thermalModsFor(plain).heat * 0.5, 9);
    expect(thermalModsFor(cool).hallu).toBeCloseTo(thermalModsFor(plain).hallu * 0.5, 9);
    expect(safeTemp(cool)).toBeCloseTo(safeTemp(plain) * 2, 9);
    const hot = { ...cool, temp: 1 };
    expect(thermalRead(hot).halluRate).toBeCloseTo(thermalRead({ ...plain, temp: 1 }).halluRate * 0.5, 9);
  });

  it('«Охота за сигналом» сжимает обычную паузу между Событиями', () => {
    const roll = () => 0.5;
    const gap = (course: string | null): number => {
      const s = { ...under(2, course), nextEventAt: T0 + 1, event: null };
      const next = advanceTime(s, 1, roll);
      return next.nextEventAt - next.lastTick;
    };
    expect(gap('signal')).toBeCloseTo(gap(null) * 0.8, -1);
    expect(gap('signal')).toBeLessThan(gap(null));
  });

  it('Курс не накладывает ничего на Забег без него и на чужие оси', () => {
    const plain = office(under(3, null));
    expect(coursePriceMult(plain)).toBe(1);
    expect(courseIncomeMult(plain)).toBe(1);
    expect(courseClickMult(plain)).toBe(1);
    expect(courseEventWindowMult(plain)).toBe(1);
    expect(courseThermalMods(plain)).toEqual({ heat: 1, hallu: 1 });
    expect(courseIncomeMult(under(3, 'frugal'))).toBe(1);
    expect(coursePriceMult(under(3, 'scale'))).toBe(1);
  });

  it('неизвестный Курс не действует', () => {
    const odd = office(under(3, 'выдуманный'));
    expect(modelIncome(odd, CATALOG[3].models[0])).toBe(modelIncome(office(under(3, null)), CATALOG[3].models[0]));
  });
});

describe('Курс-Правило: пройденное Правило действует в чужом Поколении', () => {
  it('«Дефицит GPU» в Курсе дорожает за ряд покупок в Поколении без своего Правила', () => {
    const base = { ...under(2, 'rule:scarcity'), tokens: 1e300 };
    const first = buyAgents(base, CATALOG[2].models[0].id, 10);
    expect(rulePriceMult(first)).toBeCloseTo(1.1, 9);
    expect(rulePriceMult(under(2, null))).toBe(1);
  });

  it('«Ценовая война» в Курсе удешевляет со временем Забега', () => {
    expect(rulePriceMult(under(5, 'rule:price-war', 15))).toBeCloseTo(0.75, 9);
  });

  it('«Разнообразие» в Курсе растит Доход от числа Лабораторий', () => {
    const plain = office(under(5, null), 5);
    const variety = office(under(5, 'rule:variety'), 5);
    const m = CATALOG[5].models[0];
    expect(modelIncome(variety, m)).toBeGreaterThan(modelIncome(plain, m));
  });

  it('«Подумай ещё» в Курсе копит размышление удержанием Клика', () => {
    const s = under(5, 'rule:think');
    const held = holdThought(holdThought({ ...s, thoughtAt: s.lastTick - 100 }));
    expect(thoughtOutlook(s)).not.toBeNull();
    expect(held.thought).toBeGreaterThan(0);
    expect(thoughtOutlook(under(5, null))).toBeNull();
  });

  it('«Агенты сами» в Курсе открывает Очередь закупок', () => {
    expect(queueCapacity(under(2, 'rule:agents'))).toBe(6);
    expect(queueCapacity(under(2, null))).toBe(0);
    const id = CATALOG[2].models[0].id;
    expect(queueAgent(under(2, 'rule:agents'), id).purchaseQueue).toEqual([id]);
  });

  it('действует вместе со Правилом своего Поколения, а не вместо него', () => {
    // Поколение 3 живёт по «Ценовой войне»; Курс добавляет «Дефицит GPU», и обе надбавки цены множатся.
    const s = { ...under(3, 'rule:scarcity', 15), tokens: 1e300 };
    const hired = buyAgents(s, CATALOG[3].models[0].id, 10);
    expect(rulePriceMult(hired)).toBeCloseTo(0.75 * 1.1, 9);
    expect(activeRules(hired).map((r) => r.id)).toEqual(['price-war', 'scarcity']);
  });

  it('Престиж с выбранным Курсом-Правилом ведёт в Поколение, где работают и его Правило, и Курс', () => {
    const flagship = CATALOG[2].flagship.id;
    const at = { ...under(2, null), tokens: 1e300, agents: { [flagship]: 1 }, courseOffer: ['rule:scarcity', 'scale', 'cool'] };
    const next = prestige(chooseCourse(at, 'rule:scarcity'), T0 + 10_000);
    expect(next.course).toBe('rule:scarcity');
    expect(activeRules(next).map((r) => r.id)).toEqual(['price-war', 'scarcity']);
  });
});

describe('Правило-Курс и Правило того же Поколения не задваиваются', () => {
  // Предложение не отдаёт Правило Поколения, куда ведёт Престиж, но обратный Престиж с Финала
  // (слой 5, ADR-0013) вернёт игрока в Поколение, чьё Правило он уже взял Курсом: тогда Правило
  // действует и само, и по Курсу. Читанное через `ruleEffect` множится единожды, а ряд правил
  // (`activeRules`) обязан его показывать один раз: «дважды» — это ровно удвоение, которого
  // критерий не допускает ни в списке, ни в числах.
  const cases = GENERATION_RULES.map((rule) => ({
    rule,
    // Пятнадцатая минута: «Ценовая война» уже подешевела, и задвоение было бы видно в цене —
    // 0,75 в квадрате против 0,75.
    doubled: under(rule.generation, `rule:${rule.id}`, 15),
    plain: under(rule.generation, null, 15),
  }));

  it('ряд действующих Правил называет одинаковое Правило один раз и один его эффект', () => {
    for (const { rule, doubled } of cases) {
      const acting = activeRules(doubled);
      expect(acting.map((r) => r.id), rule.id).toEqual([rule.id]);
      expect(acting[0]?.effect, rule.id).toEqual(rule.effect);
    }
  });

  it('цена и Доход такие же, как у Забега без Курса: множитель один, а не квадрат', () => {
    for (const { doubled, plain } of cases) {
      expect(rulePriceMult(doubled), `Поколение ${doubled.generation}`).toBeCloseTo(rulePriceMult(plain), 9);
      const officeWith = office(doubled);
      const officeWithout = office(plain);
      for (const m of CATALOG[doubled.generation].models) {
        expect(modelIncome(officeWith, m), `${m.name}, Поколение ${doubled.generation}`).toBe(
          modelIncome(officeWithout, m),
        );
      }
    }
  });
});

describe('Оффлайн-доход под любым Курсом', () => {
  // Idle time is paid once, and capped: Курс не создаёт Токены сверх потолка простоя и не заставляет
  // Правило, которое живёт только в игре (очередь, размышление), работать без игрока.
  const flagshipId = CATALOG[3].models[0].id;
  for (const course of COURSES) {
    it(`«${course.name}»: простой платит Доход офиса за потолок и не трогает очередь и размышление`, () => {
      const base = office({ ...under(3, course.id, 30), purchaseQueue: [flagshipId], thought: 2, thoughtAt: T0 + 30 * 60_000 });
      const away = applyOffline(base, base.lastTick + 1000 * 3600_000);
      expect(away.seconds).toBe(8 * 3600);
      expect(away.earned / (offlineIncome(base) * 8 * 3600)).toBeCloseTo(1, 9);
      expect(away.state.tokens - base.tokens).toBe(away.earned);
      expect(away.state.purchaseQueue).toEqual(base.purchaseQueue);
      expect(away.state.thought).toBe(base.thought);
      expect(away.state.agents).toEqual(base.agents);
    });
  }
});
