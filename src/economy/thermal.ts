import { characterMods } from './character';
import { courseThermalMods } from './course';
import { hasChallenge, runPerks } from './challenges';
import { perkEffects } from './perks';
import { finetuneHeatMult } from './finetune';
import type { GameState } from './state';

/**
 * ТЕМПЕРАТУРА — сигнатурная механика игры.
 *
 * Игрок управляет нагревом непрерывно, а не покупает его: значение живёт в состоянии и
 * меняется каждый тик. Жар поднимает Доход, но копит перегрев; перегрев сбрасывает жар
 * в ноль и какое-то время душит Доход. Получается тактика «греть рывками» вместо ещё
 * одного множителя, который достаточно поставить один раз.
 *
 * Диапазон температуры. `0` — холод: только базовый Доход. `1` — рабочий жар: максимум
 * выгоды при умеренном накоплении перегрева. Выше `1` («перегруз») доход растёт дальше,
 * но перегрев копится в разы быстрее — это осознанный риск, а не забытый потолок.
 */
export const TEMP_MIN = 0;
export const TEMP_MAX = 1.6;
/** Стартовое значение: не ноль, потому что в холоде Доход = базовый и шкала выглядит мёртвой. */
export const TEMP_START = 0.45;

/**
 * Насколько Температура поднимает Доход: линейная доля от единицы жара.
 *
 * Считается от `1 + TEMP_YIELD_MAX × temp`, а не степенью: степень дала бы разгон в конце
 * шкалы, где перегрев уже отнимает больше, чем прибавляет, и игрок получил бы два
 * противоположных сигнала на одном и том же движении. Линейная шкала читается с первого взгляда.
 */
export const TEMP_YIELD_MAX = 1.2;

/**
 * Сколько перегрева копится за секунду при Температуре 1.
 *
 * Линейно по temp, а не по temp²: с квадратом игрок, державший жар на 0.8, копил бы
 * перегрев быстрее, чем игрок на 1.0, и «горячее» перестало бы значить «опаснее».
 */
export const HEAT_RATE = 1 / 26;

/** Насколько перегрев режет Доход, когда он полный. Ниже единицы намеренно: перегрев должен
 *  быть отложенной платой за жар, а не мгновенным обнулением, из-за которого игрок закрыл бы вкладку. */
export const HEAT_PENALTY = 0.55;

/**
 * Секунд на ПОЛНЫЙ сброс перегрева в холод.
 *
 * Ставка стягивания постоянная, а не пропорциональная перегреву. Это единственная форма,
 * при которой механика вообще работает: при пропорциональном стягивании у шкалы есть
 * равновесие `heat = temp × HEAT_RATE × COOL`, и перегрев достижим только при
 * `temp > COOL / HEAT_RATE` — то есть при текущих константах выше 3.7, а максимум шкалы
 * равен 1.6. Стягивание бы заглохло наглухо, и перегрев перестал бы случаться вообще.
 *
 * При постоянной ставке равновесия нет: жар любой силы в итоге даёт перегрев, и от жара
 * зависит только СКОРОСТЬ, за которую он наступит. Это и делает шкалу тактикой, а не
 * переключателем — держать жар можно сколько угодно, но чем он выше, тем меньше окно.
 *
 * Ставка подобрана так, чтобы окно игрока росло с жаром и оставалось в разумных рамках:
 * от стартовых 0.45 перегрев наступает через две минуты, от 1.0 — через 33 секунды,
 * от предела 1.6 — через 19. Окно в полминуты достаточно, чтобы успеть купить Агента на
 * жаре, и достаточно коротко, чтобы перегрев был событием, а не фоном.
 */
export const HEAT_COOL_SEC = 120;

/** Ставка стягивания в единицу секунды: производная от `HEAT_COOL_SEC`, а не отдельное
 *  число, потому что это ровно обратная величина и две копии разошлись бы при правке. */
export const HEAT_COOL_RATE = 1 / HEAT_COOL_SEC;

/** Сколько секунд Доход душен после перегрева, даже когда сам перегрев уже спал. */
export const OVERHEAT_STUN_SEC = 3.5;

/** Порог, за которым перегрев срабатывает. Единица, а не «полный круг»: шкала 0..1 читается
 *  как «сколько осталось до сброса», и игрок держит её в уме, не считая секунды. */
export const HEAT_LIMIT = 1;

/**
 * Сколько перегрева добавляет одна Галлюцинация.
 *
 * Существенно меньше единицы: галлюцинация обязана быть ощутимой, но не обязана
 * сбрасывать шкалу. Иначе одно событие решало бы за игрока, что делать с жаром,
 * и тактика «греть рывками» превратилась бы в лотерей.
 */
export const HALLUC_HEAT = 0.3;

/**
 * Где на шкале начинается зона перегруза.
 *
 * Живёт здесь, потому что это единственная граница, которую читают три потребителя: шкала
 * рисует её пунктиром, тексты зоны её называют, а игрок судит по ней, «перегрузил» он или
 * ещё нет. Три литерала в трёх файлах разошлись бы при первой правке шкалы, и зона
 * переехала бы на пиксель вбок, не заметив этого.
 */
export const OVERLOAD_FROM = 1;

/** Доля шкалы, на которой стоит граница перегруза: для CSS и для подписи. */
export const overloadShare = (): number => (OVERLOAD_FROM - TEMP_MIN) / (TEMP_MAX - TEMP_MIN);

/** Температура в перегрузе? */
export const isOverloaded = (temp: number): boolean => clampTemp(temp) >= OVERLOAD_FROM;

/**
 * Сколько Токенов отнимает одна Галлюцинация.
 *
 * Доля от текущего кошелька, а не от Дохода: потеря должна быть видна в том же числе,
 * которое игрок смотрит, и не обнулять его. `HALLUC_LOSS` = 1/24 — около четырёх процентов
 * кошелька за срабатывание; на 1.0 Температуры событие приходит примерно раз в 30 секунд,
 * что игрок успевает заметить и связать с жаром.
 */
export const HALLUC_LOSS = 1 / 24;

/** Шанс Галлюцинации в секунду при Температуре 1. */
export const HALLUC_RATE = 1 / 30;

/**
 * Ключевые числа Температуры в одном месте для симулятора и подписей.
 * Сделано функциями, а не объектом, чтобы вызывающая сторона решала, какие читать.
 */
/**
 * Поправки Температуры от Перков Оверклокера (ADR-0012): множители к скорости перегрева, длине
 * оглушения и частоте Галлюцинаций и прибавка к силе жара. Единица (и ноль для прибавки) — Перков
 * нет. Характеры Лабораторий (`character.ts`) стоят поверх: «Горячая голова» xAI перегрев ускоряет,
 * поэтому стор сверяет скачок Галлюцинации с `heatRate(TEMP_MAX, thermalModsFor(state))`, а не с голым.
 */
export interface ThermalMods {
  heat: number;
  stun: number;
  hallu: number;
  /** Прибавка к `TEMP_YIELD_MAX` в долях: 0,15 — жар поднимает Доход на 15% сильнее. */
  yield: number;
}

export const NO_THERMAL_MODS: ThermalMods = { heat: 1, stun: 1, hallu: 1, yield: 0 };

let modsCache: { perks: readonly string[]; mods: ThermalMods } | null = null;

/**
 * Поправки по купленным Перкам. Кэш по ссылке на список — по тем же причинам, что у `perkEffects`:
 * список меняется только заменой целиком, а тик зовёт функцию несколько раз за каждые 50 мс.
 */
export function thermalMods(perks: string[]): ThermalMods {
  if (modsCache?.perks === perks) return modsCache.mods;
  let mods = NO_THERMAL_MODS;
  for (const e of perkEffects(perks)) {
    if (e.kind === 'heatSlow') mods = { ...mods, heat: mods.heat * e.mult };
    else if (e.kind === 'stunShort') mods = { ...mods, stun: mods.stun * e.mult };
    else if (e.kind === 'yieldBoost') mods = { ...mods, yield: mods.yield + e.pct };
    else if (e.kind === 'overclock') mods = { ...mods, yield: mods.yield + e.yieldPct, hallu: mods.hallu * e.halluMult };
  }
  modsCache = { perks, mods };
  return mods;
}

/**
 * Поправки Температуры состояния целиком: Перки Оверклокера и Характеры Лабораторий офиса.
 *
 * Скорость перегрева перемножается, сила жара складывается: Характер стоит ПОВЕРХ Перка, а не
 * вместо него (Осторожность и «Жидкостное охлаждение» копятся). Множитель силы жара `1 + yield`
 * не уходит ниже нуля, поэтому самый осторожный офис не сделает жар вредным: Доход от
 * Температуры остаётся не меньше единицы.
 * Тот же результат читают тик, шкала, магазин и справка, поэтому у них одна правда.
 */
export function thermalModsFor(
  state: Pick<GameState, 'perks' | 'generation' | 'agents' | 'course' | 'activeChallenges' | 'finetunes'>,
): ThermalMods {
  const perks = thermalMods(runPerks(state));
  const office = characterMods(state);
  const course = courseThermalMods(state);
  // Файнтюны офиса («Thinking» греет, «Turbo» охлаждает) стоят поверх Перков и Характеров (ТЗ #116).
  const finetune = finetuneHeatMult(state);
  if (office.heat === 1 && office.yield === 0 && office.hallu === 1 && course.heat === 1 && course.hallu === 1 && finetune === 1) {
    return perks;
  }
  return {
    ...perks,
    // Курс «Холодная голова» стоит поверх Перков и Характеров: все три копятся, как Осторожность с охлаждением.
    heat: perks.heat * office.heat * course.heat * finetune,
    hallu: perks.hallu * office.hallu * course.hallu,
    yield: Math.max(-1, perks.yield + office.yield),
  };
}

/**
 * Безопасная Температура: на ней перегрев копится ровно с той скоростью, с какой стягивается,
 * то есть шкалу можно «поставить и забыть». Без поправок это `HEAT_COOL_RATE / HEAT_RATE` ≈ 0,217;
 * Перки и Характеры состава двигают её, поэтому это число офиса, а не константа.
 */
const safeTempOf = (mods: ThermalMods): number => Math.min(TEMP_MAX, HEAT_COOL_RATE / (HEAT_RATE * mods.heat));

export const safeTemp = (state: Pick<GameState, 'perks' | 'generation' | 'agents' | 'course' | 'activeChallenges' | 'finetunes'>): number =>
  safeTempOf(thermalModsFor(state));

export const heatRate = (temp: number, mods: ThermalMods = NO_THERMAL_MODS): number => HEAT_RATE * temp * mods.heat;
export const halluRate = (temp: number, mods: ThermalMods = NO_THERMAL_MODS): number => HALLUC_RATE * temp * temp * mods.hallu;

/** Доход от Температуры: базовый множитель по жару. */
export const tempYieldMult = (temp: number, mods: ThermalMods = NO_THERMAL_MODS): number =>
  1 + TEMP_YIELD_MAX * (1 + mods.yield) * clampTemp(temp);

/** Множитель от перегрева: 1 в холоде, `1 - HEAT_PENALTY` на полном перегреве. */
export const heatMult = (heat: number): number => 1 - HEAT_PENALTY * Math.min(1, Math.max(0, heat));

/**
 * Множитель оглушения после перегрева. Не ноль: полное обнуление Дохода выглядело бы
 * как поломка, а не как последствие, и игрок вместо «надо остужать» решал бы «игра сломалась».
 */
export const overheatStunMult = (state: GameState, now: number): number => {
  const left = now - state.overheatedAt;
  if (state.overheatedAt <= 0 || left < 0) return 1;
  const window = OVERHEAT_STUN_SEC * thermalModsFor(state).stun * 1000;
  if (left > window) return 1;
  // Линейное затухание: к концу окна штраф доходит до нуля ровно в момент, когда он снимается.
  const t = 1 - left / window;
  return 1 - HEAT_PENALTY * t;
};

/**
 * Температура, которую читают Доход и тик: на шкале, а в Испытании «temperature = 0» — всегда ноль, что бы
 * ни лежало в состоянии (импорт, старый сейв): ограничение держится на чтении, а не на том, что никто
 * не тронул ползунок.
 */
export const effectiveTemp = (state: Pick<GameState, 'temp' | 'activeChallenges'>): number =>
  hasChallenge(state, 'cold') ? TEMP_MIN : clampTemp(state.temp);

export function clampTemp(temp: number): number {
  return Math.min(TEMP_MAX, Math.max(TEMP_MIN, Number.isFinite(temp) ? temp : TEMP_START));
}

/**
 * Температура и её побочные эффекты на текущий момент: Доход, доля перегрева, риск.
 *
 * Один срез вместо трёх отдельных вопросов по трём функциям: интерфейс показывает жар,
 * полосу перегрева и подсказку об опасности в один кадр, и три независимых чтения разошлись
 * бы между собой на границах (например оглушение ещё идёт, а перегрев уже сошёл).
 */
export interface ThermalRead {
  temp: number;
  heat: number;
  /** Доход, который жар и перегрев давят на итоговый множитель. */
  mult: number;
  /** Риск Галлюцинации в секунду, для подсказки. */
  halluRate: number;
  /** Идёт ли оглушение прямо сейчас. */
  stunned: boolean;
  /** Безопасная Температура офиса: перегрев на ней не копится (`safeTemp`). */
  safeTemp: number;
}

export function thermalRead(state: GameState, now: number = state.lastTick): ThermalRead {
  const temp = effectiveTemp(state);
  const stun = overheatStunMult(state, now);
  const mods = thermalModsFor(state);
  return {
    temp,
    heat: Math.min(1, Math.max(0, state.heat)),
    // Оглушение и перегрев складываются, а не выбирают: перегрев — это про тепло,
    // оглушение — про его последствие, и игрок теряет обе вещи сразу.
    mult: tempYieldMult(temp, mods) * heatMult(state.heat) * stun,
    halluRate: halluRate(temp, mods),
    stunned: stun < 1,
    safeTemp: safeTempOf(mods),
  };
}

/**
 * Перегрев: сбросить жар в ноль, отметить момент и снять накопленное.
 *
 * Возвращает тот же объект, если перегрева не было: переход, который ничего не сделал,
 * обязан вернуть то же самое состояние — на этом стоит определение «изменилось» в сторе.
 */
export function applyOverheat(state: GameState, now: number): GameState {
  if (state.heat < HEAT_LIMIT) return state;
  return { ...state, temp: TEMP_MIN, heat: 0, overheatedAt: now };
}