import { COURSES } from '../data/courses';
import { CHALLENGES, runPerks } from './challenges';
import { perkEffects } from './perks';
import type { GameState, ResearchJob, ResearchKind, ResearchTermId } from './state';

const MIN_MS = 60_000;

/**
 * Слотов Исследований два; третий открывает Перк «Третий слот Исследований» (ТЗ #118). Число живёт здесь, а не
 * в интерфейсе: интерфейс и сохранение читают одни и те же константы.
 */
export const RESEARCH_SLOTS = 2;
/** Предел слотов с Перком: по нему сохранение обрезает закладки. Перк снят, а закладка в третьем слоте осталась. */
export const RESEARCH_MAX_SLOTS = 3;

/**
 * Слотов в этом Забеге. Третий открывает Перк, пока он держится в Забеге: сброс дерева и «Забег без Перков»
 * закрывают его, а заложенное в третьем слоте остаётся в `research` до сбора (ТЗ #118).
 */
export function researchSlots(state: Pick<GameState, 'perks' | 'activeChallenges'>): number {
  return perkEffects(runPerks(state)).some((e) => e.kind === 'researchSlot') ? RESEARCH_MAX_SLOTS : RESEARCH_SLOTS;
}

export const RESEARCH_KINDS: readonly ResearchKind[] = ['boost', 'finetune', 'unlock'];
export const RESEARCH_TERM_IDS: readonly ResearchTermId[] = ['30m', '2h', '8h'];

/**
 * Постоянные открытия Исследований (ТЗ #118): Курсы и Испытания с `gated`, сначала Курсы, потом Испытания,
 * в порядке таблиц. Игрок не выбирает между ними: закладка берёт следующее по порядку (решение при реализации,
 * ADR-0013). Список короче таблиц, если открытие удалят, — тогда сохранение его тоже отбросит.
 */
export const RESEARCH_OPENING_IDS: readonly string[] = [
  ...COURSES.filter((c) => c.gated).map((c) => c.id),
  ...CHALLENGES.filter((c) => c.gated).map((c) => c.id),
];

/**
 * Следующее открытие для закладки: первое по таблице, которого нет среди открытых и которое не лежит в слоте.
 * `null`, когда открыто всё или всё лежит в слотах.
 */
export function nextOpening(state: Pick<GameState, 'researchUnlocks' | 'research'>): string | null {
  const taken = new Set<string>([
    ...state.researchUnlocks,
    ...state.research.flatMap((j) => (j.kind === 'unlock' ? [j.unlock] : [])),
  ]);
  return RESEARCH_OPENING_IDS.find((id) => !taken.has(id)) ?? null;
}

/**
 * Сколько Заготовок Файнтюна выдаёт один сбор Исследования по сроку (ТЗ #116). Длиннее — больше, но не
 * в разы: в минуту срока отдача падает, как у временного усиления. Длинный срок ценнее тем, что созревает
 * без игрока: вернувшись из простоя, он отдаёт сразу несколько Заготовок.
 */
export const RESEARCH_FINETUNE_YIELD: Record<ResearchTermId, number> = {
  '30m': 1,
  '2h': 2,
  '8h': 4,
};

/** Срок созревания по стенным часам: 30 минут, 2 часа, 8 часов (ТЗ #115 фиксирует их).
 *  Созревание считается по часам состояния, без таймера: готовое ждёт сбора, слот занят до него. */
export const RESEARCH_DURATION_MS: Record<ResearchTermId, number> = {
  '30m': 30 * MIN_MS,
  '2h': 120 * MIN_MS,
  '8h': 480 * MIN_MS,
};

/**
 * Множитель Дохода живого тика во время временного усиления. Замер `tools/sim.ts --research 30m` (внимательный
 * игрок, оба слота заняты всегда; Финал контента без Исследований — 494 минуты): при окнах 10/30/90 минут
 * ×2 даёт 358 минут, ×1,5 — 396; при окнах 6/20/60 (текущих) ×1,5 даёт 423.
 */
export const RESEARCH_BOOST_MULT = 1.5;

/**
 * Длина окна временного усиления по сроку: 6, 20 и 60 минут при сроках 30 минут, 2 и 8 часов. Отдача в минуту
 * срока падает (0,20 → 0,17 → 0,13), поэтому длинное Исследование ценнее, но не в разы, на которые его срок длиннее.
 * Тот же игрок с 2 часами даёт Финал 457 минут (−7,5%), с 8 часами — 493 минуты: их первое окно приходится
 * на конец кампании, где Престиж его и сбрасывает.
 * Их роль — возврат в игру после долгого отсутствия, а не ускорение кампании.
 */
export const RESEARCH_BOOST_WINDOW_MS: Record<ResearchTermId, number> = {
  '30m': 6 * MIN_MS,
  '2h': 20 * MIN_MS,
  '8h': 60 * MIN_MS,
};

/** Созрело ли Исследование к `now`: срок включительно, потому что закладка и срок — точные мс. */
export function isResearchReady(job: ResearchJob, now: number): boolean {
  return now - job.startedAt >= RESEARCH_DURATION_MS[job.term];
}

/**
 * Доля полного срока, которую сокращает один Compute-кристалл, потраченный на ускорение (ТЗ #117):
 * четверть, то есть 7,5 минуты у срока 30 минут и два часа у срока 8 часов. Число — черновик слоя 6,
 * его утверждает разработчик по замеру; живёт здесь, а не в интерфейсе, как и сроки.
 */
export const RESEARCH_HASTE_SHARE = 0.25;

/**
 * На сколько сдвинет готовность один кристалл: четверть полного срока, но не больше остатка. Последний
 * кристалл не уводит отметку готовности в прошлое дальше «сейчас», поэтому остаток обрезается. Ноль,
 * если Исследование уже созрело: ускорять нечего.
 */
export function researchHasteMs(job: ResearchJob, now: number): number {
  const duration = RESEARCH_DURATION_MS[job.term];
  const left = duration - Math.max(0, now - job.startedAt);
  return Math.max(0, Math.min(duration * RESEARCH_HASTE_SHARE, left));
}

/**
 * Ускорение созревающего Исследования одним целым Compute-кристаллом из запаса (ТЗ #117).
 *
 * Кристалл уходит из запаса вместе со своим процентом к Доходу: эту цену интерфейс показывает до траты.
 * Готовность сдвигается сдвигом старта назад, а не новым полем: срок, окно усиления и сохранение не меняются,
 * и старое сохранение читается без миграции. Пустой слот, уже созревшее Исследование или нет целого
 * кристалла — тот же объект, как у остальных переходов.
 */
export function hasteResearch(state: GameState, index: number, now: number): GameState {
  const job = state.research[index];
  if (!job || isResearchReady(job, now) || Math.floor(state.crystals) < 1) return state;
  const shift = researchHasteMs(job, now);
  const research = state.research.map((j, i) => (i === index ? { ...j, startedAt: j.startedAt - shift } : j));
  return { ...state, crystals: state.crystals - 1, research };
}

/**
 * Закладка в свободный слот. Без свободного слота, неизвестного вида или срока возвращает тот же
 * объект: переход не изменил ничего, и стор не должен трогать сейв.
 */
export function plantResearch(state: GameState, kind: ResearchKind, term: ResearchTermId, now: number): GameState {
  if (state.research.length >= researchSlots(state)) return state;
  if (!RESEARCH_KINDS.includes(kind) || !RESEARCH_TERM_IDS.includes(term)) return state;
  if (kind === 'unlock') {
    // Открытие назначается при закладке: результат известен заранее. Открытий не осталось — ничего не меняем.
    const unlock = nextOpening(state);
    if (unlock === null) return state;
    return { ...state, research: [...state.research, { kind, term, startedAt: now, unlock }] };
  }
  return { ...state, research: [...state.research, { kind, term, startedAt: now }] };
}

/**
 * Сбор готового Исследования по индексу слота: результат выплачивается, слот освобождается.
 * Не готово или индекса нет — тот же объект.
 *
 * Усиления не складываются по множителю, а продлевают окно (как второе «Лобби»): второе
 * Исследование, собранное внутри окна, добавляет свои минуты к его концу.
 */
export function collectResearch(state: GameState, index: number, now: number): GameState {
  const job = state.research[index];
  if (!job || !isResearchReady(job, now)) return state;
  const research = state.research.filter((_, i) => i !== index);
  return payOut({ ...state, research }, job, now);
}

/** Выплата результата по виду: усиление продлевает окно, Заготовка копится, открытие пишется навсегда. */
function payOut(state: GameState, job: ResearchJob, now: number): GameState {
  switch (job.kind) {
    case 'boost':
      return {
        ...state,
        researchBoostUntil: Math.max(state.researchBoostUntil, now) + RESEARCH_BOOST_WINDOW_MS[job.term],
      };
    case 'finetune':
      return { ...state, finetuneStock: state.finetuneStock + RESEARCH_FINETUNE_YIELD[job.term] };
    case 'unlock':
      // Открытие, которое уже открыто, ничего не добавляет: второй сбор не удваивает пул.
      if (state.researchUnlocks.includes(job.unlock)) return state;
      return { ...state, researchUnlocks: [...state.researchUnlocks, job.unlock] };
  }
}

/** Идёт ли временное усиление к `now`: окно открыто до своей границы, не включая её. */
export function researchBoostActive(state: GameState, now: number): boolean {
  return now < state.researchBoostUntil;
}

/** Множитель живого Дохода от временного усиления: 1 вне окна. Постоянным не бывает, поэтому в оффлайн не входит. */
export function researchBoostMult(state: GameState, now: number): number {
  return researchBoostActive(state, now) ? RESEARCH_BOOST_MULT : 1;
}
