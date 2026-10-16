/**
 * Симулятор темпа: гоняет настоящий движок без рендера и печатает время вех и Поколений.
 *
 * Нужен, чтобы ритм прогрессии выбирался числами, а не ощущением. Правки баланса без него
 * означали бы вслепую: единственный способ узнать, что лестница Ранга перевёрнута или что
 * Compute дают слишком щедро, — это посмотреть на кривую.
 *
 * Запуск (tsx не объявлен зависимостью, `npx` подтянет его сам):
 *   npx tsx tools/sim.ts --campaign            вся кампания до Финала контента против кривой
 *   npx tsx tools/sim.ts                       первый забег, 40 минут
 *   npx tsx tools/sim.ts --prestige            с Престижами, 40 минут
 *   npx tsx tools/sim.ts --gen 90 --prestige   два забега подряд
 *
 * Главный режим — `--campaign`: Престиж по политике до тех пор, пока не куплен Флагман
 * последнего Поколения, и таблица «Поколение, сколько заняло, сколько по кривой, отклонение».
 * Кривая — данные в `src/data/paceCurve.ts`, а не числа здесь; её же читает проверка в `npm test`.
 * Код возврата 0 всегда: симулятор меряет, а не проверяет.
 *
 * Флаги (число — следующим аргументом):
 *   --campaign       Престижи до Финала контента, печатает таблицу против кривой
 *   --prestige       Престижи в обычном режиме (в `--campaign` включены сами)
 *   --gen N          сколько минут играть в обычном режиме (по умолчанию 40)
 *   --max N          потолок минут для `--campaign` (по умолчанию 1500); не дошёл — таблица
 *                    всё равно печатается, а Финал помечен недостигнутым
 *   --cps N          Кликов в секунду (по умолчанию 5)
 *   --farm N         секунд дофарма после взятого Флагмана перед Престижем (по умолчанию 0:
 *                    Престиж сразу; ручка из docs/research/07, §3.2)
 *   --reserve N      сколько свободного Compute политика не тратит на Перки (по умолчанию 25)
 *   --min-gain N     Престиж только если он даст не меньше N Compute (по умолчанию 1)
 *   --seed N         зерно генератора Событий (по умолчанию 1); тот же seed — тот же прогон
 *   --verbose        строка на каждую минуту
 *
 * Политика игрока жадная и осознанно простая: покупает всё доступное по порядку цены,
 * престижит, когда взят Флагман (и прошёл дофарм). Настоящий игрок отличается тем, что
 * крутит Температуру, — но симулятор этого не делает намеренно: он должен задавать
 * МИНИМАЛЬНЫЙ темп, а шкала может только его ускорить.
 *
 * Политика не застревает на Compute: Престиж не требует свободного Compute (он его начисляет),
 * а на Перки идёт только то, что сверх `--reserve`. Раньше политика ждала свободных 25 Compute
 * «на следующий круг», потратив всё на Перки, и зависала на втором Поколении. Запас сейчас
 * не влияет на момент Престижа; он нужен, когда бонус Compute станет считаться от свободного
 * Compute (ADR-0010) и трата на Перки начнёт стоить Дохода.
 */
import { CATALOG } from '../src/economy/catalog';
import type { GameState } from '../src/economy/state';
import {
  advanceTime,
  buyAgents,
  buyPerk,
  buyUpgrade,
  canPrestige,
  click,
  isContentFinale,
  prestige,
  prestigeGain,
  totalIncome,
  clickValue,
} from '../src/economy/engine';
import { availableUpgrades } from '../src/economy/upgrades';
import { PERKS } from '../src/economy/perks';
import { migrate } from '../src/economy/save';
import { FIRST_PRESTIGE_WINDOW_MIN, PACE_CURVE, paceTotalMinutes } from '../src/data/paceCurve';

const arg = (k: string, d: number) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? Number(process.argv[i + 1]) : d;
};
const has = (k: string) => process.argv.includes(`--${k}`);

const T0 = 1_700_000_000_000;
const DT = 1 / 20;
const CPS = arg('cps', 5);
/** Свободный Compute, который политика держит нетронутым: Перки покупаются только сверх него. */
const RESERVE = arg('reserve', 25);
/** Престиж не стоит нажимать ради меньшего прироста Compute. */
const MIN_GAIN = arg('min-gain', 1);
/** Секунд дофарма после взятого Флагмана: цена Престижа «сразу» против «чуть позже». */
const FARM_SEC = arg('farm', 0);
const CAMPAIGN = has('campaign');
const VERBOSE = has('verbose');
const MAX_MIN = arg('max', 1500);

/** Mulberry32: одно зерно — один и тот же розыгрыш Событий, чтобы прогоны сравнивались. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = seeded(arg('seed', 1));

const fmt = (n: number) => {
  if (!Number.isFinite(n)) return '∞';
  const units: [number, string][] = [
    [1e300, 'e300'], [1e36, 'e36'], [1e24, 'e24'], [1e18, 'e18'], [1e12, 'e12'],
    [1e9, 'e9'], [1e6, 'e6'], [1e3, 'K'],
  ];
  for (const [v, s] of units) if (n >= v) return (n / v).toFixed(2) + s;
  return n.toFixed(1);
};

/** Покупает Перк, если хватает Compute сверх запаса. Дороже — раньше: дешёвые кончаются первыми. */
function buyAffordablePerk(s: GameState): GameState {
  const free = s.compute - s.computeSpent - RESERVE;
  const sorted = [...PERKS].sort((a, b) => b.cost - a.cost);
  for (const p of sorted) {
    if (p.cost <= free && !s.perks.includes(p.id)) return buyPerk(s, p.id);
  }
  return s;
}

/**
 * Один проход покупок: Перк, все доступные Апгрейды, затем Агенты по кругу.
 *
 * Несколько проходов, потому что покупка Агента может открыть Синергию, а та — новый
 * Апгрейд: один проход оставил бы на экране покупки, до которых игрок уже дорос.
 */
function spend(s: GameState): GameState {
  let next = buyAffordablePerk(s);
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const u of availableUpgrades(next)) {
      if (u.cost <= next.tokens) {
        const after = buyUpgrade(next, u.id);
        if (after !== next) { next = after; changed = true; }
      }
    }
    // Агенты — по кругу, а не «все у лучшей Модели»: так растёт число Лабораторий в офисе,
    // а с ним и Синергия, и состав Сцены. Модели без Агентов пропускать нельзя, иначе
    // политика никогда не поднимется выше первой ступени.
    const models = CATALOG[next.generation].models
      .map((m) => ({ m, owned: next.agents[m.id] ?? 0 }))
      .sort((a, b) => (b.m.baseIncome / (b.m.baseCost * Math.pow(1.15, b.owned))) -
                     (a.m.baseIncome / (a.m.baseCost * Math.pow(1.15, a.owned))));
    for (const { m, owned } of models) {
      let after = buyAgents(next, m.id, 'max');
      while (after !== next) { next = after; after = buyAgents(next, m.id, 'max'); }
      if ((next.agents[m.id] ?? 0) !== owned) changed = true;
    }
    if (!changed) break;
  }
  return next;
}

const MIN = (v: number) => (v < 60 ? `${v.toFixed(1)} с` : `${(v / 60).toFixed(1)} мин`);

/** Сколько минут заняло Поколение; null — не закончено в отведённое время. */
interface GenResult {
  generation: number;
  minutes: number | null;
}

/** Таблица «Поколение, факт, кривая, отклонение»; недостигнутое помечено, а не выдумано. */
function printPace(results: GenResult[], finaleReached: boolean): void {
  console.log('\n=== темп против целевой кривой (src/data/paceCurve.ts) ===');
  console.log('Поколение'.padEnd(26) + 'факт, мин'.padStart(11) + 'кривая, мин'.padStart(13) + 'отклонение'.padStart(20));
  let actualSum = 0;
  let targetSum = 0;
  for (const target of PACE_CURVE) {
    const r = results.find((x) => x.generation === target.generation);
    const name = `${target.generation + 1}. ${CATALOG[target.generation].name}`.padEnd(26);
    if (!r || r.minutes === null) {
      console.log(`${name}${'—'.padStart(11)}${target.minutes.toFixed(0).padStart(13)}${'не дошёл'.padStart(20)}`);
      continue;
    }
    actualSum += r.minutes;
    targetSum += target.minutes;
    const diff = r.minutes - target.minutes;
    const pct = (diff / target.minutes) * 100;
    const dev = `${diff >= 0 ? '+' : ''}${diff.toFixed(1)} (${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%)`;
    console.log(`${name}${r.minutes.toFixed(1).padStart(11)}${target.minutes.toFixed(0).padStart(13)}${dev.padStart(20)}`);
  }
  const first = results.find((x) => x.generation === 0)?.minutes ?? null;
  if (first !== null) {
    const { from, to } = FIRST_PRESTIGE_WINDOW_MIN;
    const verdict = first < from ? 'раньше окна' : first > to ? 'позже окна' : 'в окне';
    console.log(`\nпервый Престиж: ${first.toFixed(1)} мин, окно ${from}–${to} мин — ${verdict}`);
  }
  if (finaleReached) {
    console.log(
      `Финал контента: ${actualSum.toFixed(1)} мин (${(actualSum / 60).toFixed(1)} ч), ` +
      `кривая ${paceTotalMinutes()} мин (${(paceTotalMinutes() / 60).toFixed(1)} ч), ` +
      `отклонение ${((actualSum / targetSum - 1) * 100).toFixed(0)}%`,
    );
  } else {
    console.log(`Финал контента НЕ достигнут за ${MAX_MIN} мин: поднимите --max или проверьте политику.`);
  }
}

function run(minutes: number, doPrestige: boolean): void {
  let s = migrate(null, T0);
  let t = 0;
  let clickCarry = 0;
  const marks = new Map<string, number>();
  const mark = (k: string) => { if (!marks.has(k)) marks.set(k, t); };
  const owned = (x: GameState) => Object.values(x.agents).reduce((a, b) => a + b, 0);
  let lastLog = -1;
  const results: GenResult[] = [];
  let genStart = 0;
  /** Когда в текущем Поколении взят Флагман: от него отсчитывается дофарм. */
  let flagshipAt: number | null = null;
  let finale = false;

  const steps = Math.round((minutes * 60) / DT);
  for (let i = 0; i < steps; i++) {
    clickCarry += CPS * DT;
    while (clickCarry >= 1) { clickCarry -= 1; s = click(s); }
    s = advanceTime(s, DT, rnd);
    s = spend(s);

    const n = owned(s);
    if (n >= 1) mark('первый Агент');
    if (n >= 10) mark('10 Агентов');
    if (n >= 25) mark('25 Агентов');
    if (n >= 50) mark('50 Агентов');
    if (n >= 100) mark('100 Агентов');
    if (s.upgrades.length >= 1) mark('первый Апгрейд');
    if (s.upgrades.length >= 5) mark('5 Апгрейдов');
    if (s.clicks >= 100) mark('100 кликов');
    if (canPrestige(s)) mark('можно Престижить');
    if (canPrestige(s) && flagshipAt === null) flagshipAt = t;
    for (const g of CATALOG[s.generation].models) {
      if ((s.agents[g.id] ?? 0) > 0) mark(`Агент: ${g.name}`);
    }

    // Финал контента: Флагман последнего Поколения взят, дальше Престижа нет. Конец прогона.
    if (CAMPAIGN && isContentFinale(s)) {
      results.push({ generation: s.generation, minutes: (t - genStart) / 60 });
      finale = true;
      break;
    }

    // Престиж по политике: Флагман взят, дофарм прошёл и прирост стоит нажатия. Свободный
    // Compute не условие: Престиж его начисляет, а не тратит.
    if (doPrestige && canPrestige(s) && !isContentFinale(s) && flagshipAt !== null &&
        t - flagshipAt >= FARM_SEC && prestigeGain(s) >= MIN_GAIN) {
      const before = s.generation;
      mark(`ПРЕСТИЖ #${s.prestiges + 1} → ${CATALOG[s.generation + 1].name}`);
      s = prestige(s, T0 + t * 1000);
      results.push({ generation: before, minutes: (t - genStart) / 60 });
      genStart = t;
      flagshipAt = null;
      console.log(
        `>>> ПРЕСТИЖ #${s.prestiges} на ${(t / 60).toFixed(1)} мин → ` +
        `${CATALOG[s.generation].name}, Compute ${s.compute}, Перков ${s.perks.length}`,
      );
      mark('первый Compute');
      mark(`престиж #${s.prestiges}`);
      lastLog = -1;
    }

    const minute = Math.floor(t / 60);
    if (VERBOSE && minute !== lastLog) {
      lastLog = minute;
      console.log(
        `t=${String(minute).padStart(2)}м доход=${fmt(totalIncome(s)).padStart(8)}/с ` +
        `кошелёк=${fmt(s.tokens).padStart(9)} агенты=${String(n).padStart(4)} ` +
        `апгрейды=${String(s.upgrades.length).padStart(2)} клик=${fmt(clickValue(s)).padStart(8)} ` +
        `поколение=${s.generation} compute=${s.compute}`,
      );
    }
    t += DT;
  }

  if (!CAMPAIGN) {
    console.log('\n=== вехи ===');
    for (const [k, v] of marks) console.log(`${k.padEnd(30)} ${MIN(v)}`);
  }
  console.log(
    `итог: доход ${fmt(totalIncome(s))}/с, поколение ${s.generation}, ` +
    `забег ${fmt(s.runTokens)}, престижей ${s.prestiges}, перков ${s.perks.length}`,
  );
  if (CAMPAIGN) printPace(results, finale);
}

if (CAMPAIGN) run(MAX_MIN, true);
else run(arg('gen', 40), has('prestige'));
