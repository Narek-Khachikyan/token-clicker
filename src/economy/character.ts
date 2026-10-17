import { CHARACTER_QUIPS, type CharacterQuip, type CharacterQuipTrigger } from '../data/characterQuips';
import { CHARACTERS } from '../data/characters';
import { LAB_IDS, type LabId } from '../data/labs';
import { CATALOG, type Model } from './catalog';
import type { GameState } from './state';

/**
 * ХАРАКТЕР ЛАБОРАТОРИИ (ADR-0011): состав офиса меняет Температуру.
 *
 * Характер выводится из купленных Агентов текущего Поколения — нового поля сейва нет, а смена
 * состава (покупка, продажа, Престиж) меняет его сама. Модуль отдаёт: поправки к скорости
 * перегрева и силе жара (их `thermal.ts` складывает с поправками Перков Оверклокера), частоте
 * Галлюцинаций, силе Клика и весу Волны хайпа в розыгрыше События (`CharacterMods`), множитель
 * Дохода Модели (`characterIncomeMult`: «Конвейер», «Открытые веса») и усиление лабораторной
 * Синергии (`ecosystemBoost`). Базовые цену и Доход Модели из каталога он не видит вовсе
 * (`economy.test.ts` держит монотонность по Рангу с любым набором Лабораторий в офисе), а
 * эффект Волны хайпа и Клик-рывка по-прежнему платит только пойманный Золотой Токен.
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

/**
 * Сколько Агентов Лаборатории или Модели делают её «присутствующей в офисе» для Характеров, что
 * считают разнообразие («Экосистема», «Конвейер»). Один купленный Агент каждой Лаборатории — самая
 * дешёвая покупка Поколения, и без порога разнообразие стоило бы горсти токенов вместо состава.
 */
export const CHARACTER_PRESENCE_AGENTS = 5;

/** Состав офиса текущего Поколения: Агенты по Лабораториям и Моделям и их сумма. */
interface Roster {
  byLab: Map<LabId, number>;
  byModel: Map<string, number>;
  total: number;
}

let rosterCache: { agents: GameState['agents']; generation: number; roster: Roster } | null = null;

/**
 * Кэш по ссылке на `agents` и Поколению, как у `thermalMods`: тик зовёт Характеры на каждую Модель
 * двадцать раз в секунду, а `agents` меняется заменой целиком при покупке, а не на тике.
 */
function officeRoster(state: Pick<GameState, 'generation' | 'agents'>): Roster {
  if (rosterCache && rosterCache.agents === state.agents && rosterCache.generation === state.generation) {
    return rosterCache.roster;
  }
  const byLab = new Map<LabId, number>();
  const byModel = new Map<string, number>();
  let total = 0;
  for (const m of CATALOG[state.generation].models) {
    const n = state.agents[m.id] ?? 0;
    if (n <= 0) continue;
    byLab.set(m.lab, (byLab.get(m.lab) ?? 0) + n);
    byModel.set(m.id, n);
    total += n;
  }
  const roster = { byLab, byModel, total };
  rosterCache = { agents: state.agents, generation: state.generation, roster };
  return roster;
}

/** Сила Характера Лаборатории в офисе, [0, 1): 0 без её Агентов. */
export function characterStrength(state: Pick<GameState, 'generation' | 'agents'>, lab: LabId): number {
  const { byLab, total } = officeRoster(state);
  return (byLab.get(lab) ?? 0) / (total + CHARACTER_SMOOTHING);
}

/** Сколько других Лабораторий присутствует в офисе (`CHARACTER_PRESENCE_AGENTS` и больше Агентов). */
export function otherLabsInOffice(state: Pick<GameState, 'generation' | 'agents'>, lab: LabId): number {
  let n = 0;
  for (const [other, agents] of officeRoster(state).byLab) if (other !== lab && agents >= CHARACTER_PRESENCE_AGENTS) n++;
  return n;
}

/**
 * Во сколько раз «Экосистема» усиливает прибавку лабораторной Синергии Лаборатории `lab`; 1 у
 * Лабораторий без этого Характера. Умножается именно прибавка (`SYNERGY_PER_AGENT × Агенты`), а не
 * весь множитель Синергии: единица в `1 + прибавка` — это «без Синергии», и её Характер не растит.
 */
export function ecosystemBoost(state: Pick<GameState, 'generation' | 'agents'>, lab: LabId): number {
  let boost = 1;
  for (const e of CHARACTERS[lab]?.effects ?? []) {
    if (e.kind === 'ecosystem') boost += e.perLab * otherLabsInOffice(state, lab);
  }
  return boost;
}

/** Сколько других Моделей присутствует в офисе (`CHARACTER_PRESENCE_AGENTS` и больше Агентов). */
export function otherModelsInOffice(state: Pick<GameState, 'generation' | 'agents'>, modelId: string): number {
  let n = 0;
  for (const [id, agents] of officeRoster(state).byModel) if (id !== modelId && agents >= CHARACTER_PRESENCE_AGENTS) n++;
  return n;
}

/**
 * Множитель Дохода Модели от Характеров состава: «Конвейер» её собственной Лаборатории и
 * «Открытые веса» чужих. Единица, пока таких Характеров в офисе нет.
 *
 * Это множитель, как Синергия, а не поправка базового Дохода: базу Модели в каталоге он не
 * видит, и лестница Рангов (`economy.test.ts`) читает только её. Оффлайн-доход берёт его из
 * того же `modelMultiplier`, поэтому потолок оффлайна на него распространяется сам.
 */
export function characterIncomeMult(state: Pick<GameState, 'generation' | 'agents'>, model: Model): number {
  let mult = 1;
  for (const e of CHARACTERS[model.lab]?.effects ?? []) {
    if (e.kind === 'pipeline') mult *= 1 + e.perModel * otherModelsInOffice(state, model.id);
  }
  for (const lab of LAB_IDS) {
    if (lab === model.lab) continue;
    for (const e of CHARACTERS[lab]?.effects ?? []) {
      if (e.kind === 'openWeights') {
        const n = officeRoster(state).byLab.get(lab) ?? 0;
        mult *= 1 + (e.max * n) / (n + e.halfAgents);
      }
    }
  }
  return mult;
}

/**
 * Поправки Характеров офиса, не зависящие от Модели: скорость перегрева (×), прибавка к силе жара,
 * частота Галлюцинаций (×), сила Клика (×) и вес Волны хайпа среди Событий (×). Нейтральные значения — единица и ноль.
 */
export interface CharacterMods {
  heat: number;
  yield: number;
  hallu: number;
  click: number;
  /** Вес Волны хайпа в розыгрыше вида События (×); у остальных видов вес не меняется. */
  hype: number;
}

export const NO_CHARACTER_MODS: CharacterMods = { heat: 1, yield: 0, hallu: 1, click: 1, hype: 1 };

let cache: { agents: GameState['agents']; generation: number; mods: CharacterMods } | null = null;

/** Поправки всех Характеров офиса; кэш по тем же ключам, что и у состава. */
export function characterMods(state: Pick<GameState, 'generation' | 'agents'>): CharacterMods {
  if (cache && cache.agents === state.agents && cache.generation === state.generation) return cache.mods;
  const { byLab, total } = officeRoster(state);
  let mods = NO_CHARACTER_MODS;
  if (total > 0) {
    let heat = 1;
    let yieldAdd = 0;
    let hallu = 1;
    let click = 1;
    let hype = 1;
    for (const lab of LAB_IDS) {
      const character = CHARACTERS[lab];
      const n = byLab.get(lab) ?? 0;
      if (!character || n === 0) continue;
      const strength = n / (total + CHARACTER_SMOOTHING);
      for (const e of character.effects) {
        if (e.kind === 'heat') heat *= 1 + e.perStrength * strength;
        else if (e.kind === 'yield') yieldAdd += e.perStrength * strength;
        else if (e.kind === 'hallu') hallu *= 1 + e.perStrength * strength;
        else if (e.kind === 'click') click *= 1 + e.perStrength * strength;
        else if (e.kind === 'hype') hype *= 1 + e.perStrength * strength;
      }
    }
    mods = { heat, yield: yieldAdd, hallu, click, hype };
  }
  cache = { agents: state.agents, generation: state.generation, mods };
  return mods;
}

/** Строка подсказки о Характере: что он сейчас делает в офисе игрока. */
export interface CharacterReadoutRow {
  label: string;
  value: string;
}

/**
 * Что Характер Лаборатории читает в офисе игрока, в строках для карточки Модели: у каждого вида
 * Характера своя мера. Сила в долях — у тех, что считают долю Агентов; число других Лабораторий
 * и Моделей — у разнообразия; рост чужих Моделей — у «Открытых весов». Безопасную Температуру
 * карточка добавляет сама: она живёт в `thermal.ts`, а тот импортирует этот модуль.
 */
export function characterReadout(state: Pick<GameState, 'generation' | 'agents'>, model: Model): CharacterReadoutRow[] {
  const character = CHARACTERS[model.lab];
  if (!character) return [];
  const rows: CharacterReadoutRow[] = [];
  const byShare = character.effects.some((e) => e.kind === 'heat' || e.kind === 'yield' || e.kind === 'click' || e.kind === 'hallu' || e.kind === 'hype');
  if (byShare) rows.push({ label: 'Сила в вашем офисе', value: `${Math.round(characterStrength(state, model.lab) * 100)}%` });
  for (const e of character.effects) {
    if (e.kind === 'ecosystem') rows.push({ label: 'Других Лабораторий в офисе', value: String(otherLabsInOffice(state, model.lab)) });
    else if (e.kind === 'pipeline') rows.push({ label: 'Других Моделей в офисе', value: String(otherModelsInOffice(state, model.id)) });
    else if (e.kind === 'openWeights') {
      const n = officeRoster(state).byLab.get(model.lab) ?? 0;
      rows.push({ label: 'Чужие Модели сильнее на', value: `${Math.round(((e.max * n) / (n + e.halfAgents)) * 100)}%` });
    }
  }
  return rows;
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
