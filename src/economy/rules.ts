import { CATALOG } from './catalog';
import type { GameState } from './state';
import { GENERATION_RULES, type GenerationRule } from '../data/generationRules';

/** Правило Поколения с индексом `generation`; `null` у «Рассвета» и у Поколений, чьё Правило ещё не написано. */
export function generationRule(generation: number): GenerationRule | null {
  return GENERATION_RULES.find((r) => r.generation === generation) ?? null;
}

/** Правило, действующее в Забеге сейчас: только своего Поколения (ADR-0013), других источников пока нет. */
export function activeRule(state: GameState): GenerationRule | null {
  return generationRule(state.generation);
}

/**
 * Во сколько раз Правило меняет цену Моделей. Единица вне «Ценовой войны».
 *
 * Время Забега берётся из часов самого состояния — `lastTick − runStartedAt`, — тех же, по которым
 * идёт тик. Отдельного счётчика в сохранении нет: Правило выводится из полей, которые уже
 * переживают перезагрузку, и миграции не просит. Минуты целые: цена не дрожит между тиками, а
 * карточки магазина перерисовываются раз в минуту. Дно держит цену выше нуля при любом простое:
 * скидка не бесконечна, и долгое отсутствие даёт её один раз, а не растущую.
 */
export function rulePriceMult(state: GameState): number {
  const effect = activeRule(state)?.effect;
  if (effect?.kind !== 'priceDecay') return 1;
  const minutes = Math.floor(Math.max(0, state.lastTick - state.runStartedAt) / 60_000);
  return effect.floor + (1 - effect.floor) * Math.pow(0.5, minutes / effect.halfLifeMin);
}

/** Сколько разных Лабораторий нанято: ключ кэша — ссылка на `agents`, которая меняется покупкой, а не тиком. */
let rosterCache: { agents: GameState['agents']; generation: number; labs: number } | null = null;

function labsInOffice(state: GameState): number {
  if (rosterCache?.agents === state.agents && rosterCache.generation === state.generation) return rosterCache.labs;
  const labs = new Set<string>();
  for (const m of CATALOG[state.generation].models) if ((state.agents[m.id] ?? 0) > 0) labs.add(m.lab);
  rosterCache = { agents: state.agents, generation: state.generation, labs: labs.size };
  return labs.size;
}

/**
 * Во сколько раз Правило меняет Доход каждой Модели. Единица вне «Разнообразия».
 *
 * Зависит от состава офиса, а не от времени, поэтому, как Синергия, достаётся и Оффлайн-доходу:
 * офис за время отсутствия не меняется. Минутные эффекты Правил в оффлайн не попадают.
 */
export function ruleIncomeMult(state: GameState): number {
  const effect = activeRule(state)?.effect;
  if (effect?.kind !== 'labVariety') return 1;
  return 1 + effect.perLab * Math.max(0, labsInOffice(state) - 1);
}
