import type { GameState, ResearchJob, ResearchKind, ResearchTermId } from './state';

const MIN_MS = 60_000;

/**
 * Слотов Исследований два. Третий даёт Перк (тикет #118), поэтому число живёт здесь, а не в интерфейсе:
 * интерфейс и сохранение читают одну константу.
 */
export const RESEARCH_SLOTS = 2;

export const RESEARCH_KINDS: readonly ResearchKind[] = ['boost', 'finetune'];
export const RESEARCH_TERM_IDS: readonly ResearchTermId[] = ['30m', '2h', '8h'];

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
  if (state.research.length >= RESEARCH_SLOTS) return state;
  if (!RESEARCH_KINDS.includes(kind) || !RESEARCH_TERM_IDS.includes(term)) return state;
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

/** Выплата результата по виду. Переключатель по виду — место, куда встанет #118 (постоянное открытие). */
function payOut(state: GameState, job: ResearchJob, now: number): GameState {
  switch (job.kind) {
    case 'boost':
      return {
        ...state,
        researchBoostUntil: Math.max(state.researchBoostUntil, now) + RESEARCH_BOOST_WINDOW_MS[job.term],
      };
    case 'finetune':
      return { ...state, finetuneStock: state.finetuneStock + RESEARCH_FINETUNE_YIELD[job.term] };
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
