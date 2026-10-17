import { CHARACTER_QUIPS, type CharacterQuip, type CharacterQuipTrigger } from '../data/characterQuips';
import { CHARACTERS } from '../data/characters';
import { LAB_IDS, type LabId } from '../data/labs';
import { CATALOG } from './catalog';
import type { GameState } from './state';

/**
 * ХАРАКТЕР ЛАБОРАТОРИИ (ADR-0011): состав офиса меняет Температуру.
 *
 * Характер выводится из купленных Агентов текущего Поколения — нового поля сейва нет, а смена
 * состава (покупка, продажа, Престиж) меняет его сама. Живёт только в Температуре: модуль
 * отдаёт поправки к скорости перегрева и силе жара, которые `thermal.ts` складывает с поправками
 * Перков Оверклокера. Базовые цену и Доход Модели он не видит вовсе (`economy.test.ts` держит
 * монотонность по Рангу с любым набором Лабораторий в офисе).
 *
 * Сила Характера Лаборатории — её доля в офисе со сглаживанием:
 *
 *   сила(L) = Агентов(L) / (Агентов всего + CHARACTER_SMOOTHING)
 *
 * Сглаживание нужно, чтобы первый же Агент не был «стопроцентным офисом»: один Агент xAI в
 * пустой комнате дал бы полную Горячую голову. С десятью в знаменателе один Агент даёт 1/11, а
 * сто — 91%. Чистый офис одной Лаборатории приближается к полной силе, смешанный делит её по
 * долям, поэтому безопасная Температура (`safeTemp`) — не одно число, а ответ на вопрос «кто в офисе».
 */
export const CHARACTER_SMOOTHING = 10;

/** Агенты текущего Поколения по Лабораториям и их сумма. */
function officeRoster(state: Pick<GameState, 'generation' | 'agents'>): { byLab: Map<LabId, number>; total: number } {
  const byLab = new Map<LabId, number>();
  let total = 0;
  for (const m of CATALOG[state.generation].models) {
    const n = state.agents[m.id] ?? 0;
    if (n <= 0) continue;
    byLab.set(m.lab, (byLab.get(m.lab) ?? 0) + n);
    total += n;
  }
  return { byLab, total };
}

/** Сила Характера Лаборатории в офисе, [0, 1): 0 без её Агентов. */
export function characterStrength(state: Pick<GameState, 'generation' | 'agents'>, lab: LabId): number {
  const { byLab, total } = officeRoster(state);
  return (byLab.get(lab) ?? 0) / (total + CHARACTER_SMOOTHING);
}

/** Поправки Характеров к Температуре: множитель скорости перегрева и прибавка к силе жара. */
export interface CharacterMods {
  heat: number;
  yield: number;
}

export const NO_CHARACTER_MODS: CharacterMods = { heat: 1, yield: 0 };

let cache: { agents: GameState['agents']; generation: number; mods: CharacterMods } | null = null;

/**
 * Поправки всех Характеров офиса. Кэш по ссылке на `agents` и Поколению, как у `thermalMods`:
 * тик зовёт функцию несколько раз за 50 мс, а `agents` меняется заменой целиком при покупке.
 */
export function characterMods(state: Pick<GameState, 'generation' | 'agents'>): CharacterMods {
  if (cache && cache.agents === state.agents && cache.generation === state.generation) return cache.mods;
  const { byLab, total } = officeRoster(state);
  let mods = NO_CHARACTER_MODS;
  if (total > 0) {
    let heat = 1;
    let yieldAdd = 0;
    for (const lab of LAB_IDS) {
      const character = CHARACTERS[lab];
      const n = byLab.get(lab) ?? 0;
      if (!character || n === 0) continue;
      const strength = n / (total + CHARACTER_SMOOTHING);
      for (const e of character.effects) {
        if (e.kind === 'heat') heat *= 1 + e.perStrength * strength;
        else yieldAdd += e.perStrength * strength;
      }
    }
    mods = { heat, yield: yieldAdd };
  }
  cache = { agents: state.agents, generation: state.generation, mods };
  return mods;
}

/** Лаборатория с Характером, чей голос в офисе громче всех; `null`, если таких Агентов нет. */
export function loudestCharacterLab(state: Pick<GameState, 'generation' | 'agents'>): LabId | null {
  const { byLab } = officeRoster(state);
  let best: LabId | null = null;
  let bestN = 0;
  for (const lab of LAB_IDS) {
    const n = byLab.get(lab) ?? 0;
    if (CHARACTERS[lab] && n > bestN) {
      best = lab;
      bestN = n;
    }
  }
  return best;
}

/** Нанят ли первый Агент Лаборатории с Характером: до покупки их в офисе не было, после — есть. */
export function isFirstHireOfCharacterLab(
  before: Pick<GameState, 'generation' | 'agents'>,
  after: Pick<GameState, 'generation' | 'agents'>,
  lab: LabId,
): boolean {
  if (!CHARACTERS[lab]) return false;
  return (officeRoster(before).byLab.get(lab) ?? 0) === 0 && (officeRoster(after).byLab.get(lab) ?? 0) > 0;
}

/**
 * Реплика Маскота о Характере по поводу; `null`, если у Лаборатории нет строки на этот повод.
 * Выбор — по `salt` (отметка времени события), а не `Math.random`: тот же повод в тот же миг даёт
 * ту же строку, и тест не зависит от случая. Экономики у строки нет.
 */
export function pickCharacterQuip(lab: LabId, on: CharacterQuipTrigger, salt: number): CharacterQuip | null {
  const rows = CHARACTER_QUIPS.filter((q) => q.lab === lab && q.on === on);
  if (rows.length === 0) return null;
  return rows[Math.abs(Math.floor(salt)) % rows.length];
}
