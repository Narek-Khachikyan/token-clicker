import type { GameState } from './state';

/**
 * Испытание Забега: добровольное ограничение на весь Забег (ADR-0013). Испытания берутся только на
 * свежем Забеге (см. canStartChallenge), и брать можно несколько сразу. У каждого есть тяжесть;
 * сумма тяжести взятых — Класс риска. Престиж закрывает все взятые и платит за них Compute:
 * прирост за этот Престиж умножается на множитель Класса риска, с потолком. Награда не копится в
 * постоянный Доход — это та же петля, что закрывает ADR-0010. Термин зафиксирован: «Испытание
 * Забега», не «челлендж»; «Класс риска» называет сумму тяжести, а не ступень силы — запрещённые
 * синонимы Ранга рядом с ним не появляются.
 */
export interface ChallengeDef {
  id: 'no-synergy' | 'no-click' | 'no-dataset' | 'cold' | 'no-perks';
  name: string;
  desc: string;
  /** Тяжесть: целое, чем больше, тем дороже Испытание в Классе риска. Подбирается замером `tools/sim.ts`. */
  weight: number;
}

/**
 * Порядок таблицы — порядок списка взятых Испытаний и порядок карточек: от лёгких к тяжёлым.
 * Тяжесть выбрана самой консервативной из согласующихся с ADR-0013 (шаг +15% за единицу Класса,
 * потолок ×2): лёгкие ограничения, которые едва заметны по отдельности, весят 1, ограничения,
 * меняющие ход Забега — 2 и 3. Никто не утверждал список при старте тикета, поэтому выбор
 * консервативный и о нём сказано в отчёте.
 */
export const CHALLENGES: readonly ChallengeDef[] = [
  {
    id: 'no-click',
    name: 'Забег без Кликов',
    desc: 'Клики не приносят Токены весь Забег, но их счётчик растёт — реплики Моделей и Переписка продолжают работать.',
    weight: 1,
  },
  {
    id: 'no-dataset',
    name: 'Стена данных',
    desc: 'Датасет не действует весь Забег: Достижения при тебе, но Доход от них молчит.',
    weight: 1,
  },
  {
    id: 'cold',
    name: 'Забег без Температуры',
    desc: 'Температура застыла на нуле: без прибавки к Доходу от жара, но и без перегрева и Галлюцинаций. Шкалу двигать бессмысленно.',
    weight: 1,
  },
  {
    id: 'no-synergy',
    name: 'Забег без Синергий',
    desc: 'Синергии Лабораторий не действуют весь Забег — ни лабораторные, ни парные.',
    weight: 2,
  },
  {
    id: 'no-perks',
    name: 'Забег без Перков',
    desc: 'Купленные Перки не действуют весь Забег, а новые купить нельзя. Сброс дерева и Оффлайн-доход остаются.',
    weight: 3,
  },
];

const CHALLENGE_BY_ID: Record<string, ChallengeDef> = Object.fromEntries(CHALLENGES.map((c) => [c.id, c]));

/** Известно ли такое Испытание таблице (проверка для разбора сохранения и стора). */
export const isChallengeId = (id: unknown): id is ChallengeDef['id'] =>
  typeof id === 'string' && Object.prototype.hasOwnProperty.call(CHALLENGE_BY_ID, id);

/** Взято ли Испытание на текущий Забег. */
export const hasChallenge = (state: Pick<GameState, 'activeChallenges'>, id: ChallengeDef['id']): boolean =>
  state.activeChallenges.includes(id);

/**
 * Перки, которые действуют в этом Забеге: те же, что куплены, а в «Забеге без Перков» — никаких.
 * Ссылка на пустой список одна и та же, потому что разбор Перков и Температуры кэширует по ссылке.
 */
const NO_PERKS: string[] = [];
export function runPerks(state: Pick<GameState, 'perks' | 'activeChallenges'>): string[] {
  return state.activeChallenges.includes('no-perks') ? NO_PERKS : state.perks;
}

/** Класс риска: сумма тяжести взятых Испытаний. Неизвестный id (из чужого сейва) веса не имеет. */
export function riskClass(state: Pick<GameState, 'activeChallenges'>): number {
  let sum = 0;
  for (const id of state.activeChallenges) sum += CHALLENGE_BY_ID[id]?.weight ?? 0;
  return sum;
}

/** Сколько множитель Compute прибавляет за единицу Класса риска (0,15 = +15%). */
export const RISK_MULT_STEP = 0.15;
/**
 * Потолок множителя Compute за Престиж. Без него полный набор Испытаний был бы единственной
 * разумной игрой; с ним лишняя тяжесть сверх потолка платит только теневыми Достижениями.
 */
export const RISK_MULT_MAX = 2;

/** Множитель Compute за Престиж для Класса риска `risk`: растёт по прямой и упирается в потолок. */
export function riskMult(risk: number): number {
  return Math.min(RISK_MULT_MAX, 1 + RISK_MULT_STEP * Math.max(0, risk));
}

/** Множитель Compute, который получит Престиж этого Забега. */
export const challengeComputeMult = (state: Pick<GameState, 'activeChallenges'>): number => riskMult(riskClass(state));

/**
 * Испытание стартует только на свежем забеге: ни Агентов, ни Апгрейдов, ни Кликов.
 * Правило держит испытание честным — его нельзя включить задним числом на середине забега,
 * когда ограничение уже ничего не стоит, и нельзя снять штраф, не сбросив забег.
 */
export function canStartChallenge(state: GameState): boolean {
  return (
    Object.values(state.agents).every((n) => n <= 0) &&
    state.upgrades.length === 0 &&
    state.runClicks === 0
  );
}

/**
 * Берёт Испытание на Забег или кладёт обратно. Работает только на свежем забеге: иначе возвращается
 * тот же объект, и стор по identity-контракту пропускает звуки и тосты. Список держит порядок
 * таблицы, а не порядок нажатий, чтобы один и тот же набор был одним и тем же значением.
 *
 * «Забег без Температуры» при взятии гасит шкалу сразу: остальное она читает холодной сама
 * (`thermalRead`), но сохранённое тепло не должно переживать Испытание.
 */
export function toggleChallenge(state: GameState, id: ChallengeDef['id']): GameState {
  if (!isChallengeId(id) || !canStartChallenge(state)) return state;
  const taken = state.activeChallenges.includes(id);
  const activeChallenges = CHALLENGES.map((c) => c.id).filter((x) =>
    x === id ? !taken : state.activeChallenges.includes(x),
  );
  const next = { ...state, activeChallenges };
  return !taken && id === 'cold' ? { ...next, temp: 0, heat: 0 } : next;
}

/** Доля Дохода за каждое Испытание, закрытое до Compute-награды: +10% навсегда, как и было обещано. */
export const INHERITED_REWARD_PCT = 10;

/**
 * Множитель Дохода за Испытания, закрытые до Compute-награды: +10% за каждое, дедуп по id.
 *
 * Считаются все записи без сверки с таблицей — как Достижения, а не как Перки: id переживает
 * правку таблицы, и заработанное не должно дешеветь от того, что строку переименовали.
 */
export function challengeIncomeMult(state: Pick<GameState, 'challengesInherited'>): number {
  return 1 + (INHERITED_REWARD_PCT / 100) * new Set(state.challengesInherited).size;
}
