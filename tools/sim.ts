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
 *   --min-gain N     Престиж только если он даст не меньше N Compute (по умолчанию 40)
 *   --seed N         зерно генератора Событий (по умолчанию 1); тот же seed — тот же прогон
 *   --thermal MODE   как политика крутит Температуру: off (по умолчанию) | safe | ride | max;
 *                    safe держит безопасную Температуру офиса, ride — 1,0, max — предел шкалы
 *   --course ID      какой Курс (ADR-0013) политика берёт на каждом Престиже: none (по умолчанию) |
 *                    first (первый из трёх предложенных) | id Курса из `src/data/courses.ts`
 *                    (`scale`, `rule:scarcity`…), когда пул Престижа его содержит
 *   --challenge MODE Испытания Забега (ADR-0013, слой 5): none (по умолчанию) | all — все Испытания
 *                    таблицы на каждом Забеге, то есть кампания на максимальном Классе риска
 *   --catch          политика ловит каждое обычное Событие сразу (верхняя граница внимательного
 *                    игрока); по умолчанию не ловит, и Золотые Токены ничего не платят
 *   --uprising       политика поднимает стадию Восстания, как стор: красные События выпадают (по умолчанию
 *                    их в прогоне нет — симулятор стора не гоняет); разбор — docs/plans/110-pace-report.md
 *   --glitches MODE  Глюки: live (по умолчанию: растут, политика их не трогает) | pop (лопает сразу) | none
 *   --research TERM  Исследование (ТЗ #115): none (по умолчанию) | 30m | 2h | 8h — закладывает этот срок в
 *                    свободный слот и собирает созревшее сразу (верхняя граница внимательного игрока)
 *   --no-characters  выключить Характеры Лабораторий (ADR-0011): база для сравнения «с / без»;
 *                    таблица в памяти очищается, файлы не трогаются
 *   --policy P       игрок: greedy (по умолчанию, `tools/greedyPolicy.ts`, нижняя граница темпа) |
 *                    attentive (`tools/attentivePolicy.ts`, внимательный игрок тикета #125: ловит
 *                    Золотые Токены и лопает Глюки с задержкой реакции, закладывает Исследования,
 *                    берёт Курсы, Престиж — по падению скорости Compute). У attentive свои числа:
 *                    `--cps` по умолчанию 4, `--course-priority a,b` и `--challenge-set a,b` (id Курсов и
 *                    Испытаний, `none` — пусто) переопределяют его списки, а `--catch`, `--glitches`,
 *                    `--research`, `--course`, `--challenge`, `--farm`, `--min-gain` на него не действуют —
 *                    его поведение задано в `tools/attentivePolicy.ts`
 *   --verbose        строка на каждую минуту
 *
 * Политика — `tools/greedyPolicy.ts`, общая с проверкой в `npm test`: жадная и осознанно простая,
 * Температуру не крутит, поэтому задаёт МИНИМАЛЬНЫЙ темп, а шкала может только его ускорить.
 * Престижит, когда взят Флагман, прошёл дофарм и Престиж даёт не меньше `--min-gain` Compute
 * (по умолчанию 40, ориентир первого Престижа): без этого условия Престиж ложится на первый
 * Флагман (~15-я минута), а его время ручки баланса не двигают.
 *
 * Политика не застревает на Compute: Престиж не требует свободного Compute (он его начисляет),
 * а на Перки идёт только то, что сверх `--reserve`. Бонус Compute считается от свободного Compute
 * (ADR-0010), и трата на Перки стоит Дохода, поэтому запас держит часть бонуса нетронутой.
 */
import { CATALOG } from '../src/economy/catalog';
import type { GameState } from '../src/economy/state';
import { canPrestige, isContentFinale, prestigeGain, totalIncome, clickValue } from '../src/economy/engine';
import { FIRST_PRESTIGE_WINDOW_MIN, PACE_CURVE, PACE_TOLERANCE, paceTotalMinutes } from '../src/data/paceCurve';
import { CHARACTERS } from '../src/data/characters';
import { LAB_IDS } from '../src/data/labs';
import { characterStrength } from '../src/economy/character';
import { safeTemp } from '../src/economy/thermal';
import { DEFAULT_POLICY, DT, doPrestige, newSession, prestigeDue, tick, type PolicyOptions, type Session, type ThermalPolicy } from './greedyPolicy';
import { ATTENTIVE_DEFAULTS, attentivePlayer, type PlayerPolicy } from './attentivePolicy';

const arg = (k: string, d: number) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? Number(process.argv[i + 1]) : d;
};
const has = (k: string) => process.argv.includes(`--${k}`);
const strArg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};

const modeArg = (): ThermalPolicy => {
  const i = process.argv.indexOf('--thermal');
  const v = i >= 0 ? process.argv[i + 1] : 'off';
  if (v !== 'off' && v !== 'safe' && v !== 'ride' && v !== 'max') throw new Error(`--thermal: off|safe|ride|max, получено ${v}`);
  return v;
};
const challengeArg = (): 'none' | 'all' => {
  const i = process.argv.indexOf('--challenge');
  const v = i >= 0 ? process.argv[i + 1] : 'none';
  if (v !== 'none' && v !== 'all') throw new Error(`--challenge: none|all, получено ${v}`);
  return v;
};
const glitchesArg = (): 'live' | 'pop' | 'none' => {
  const v = strArg('glitches', 'live');
  if (v !== 'live' && v !== 'pop' && v !== 'none') throw new Error(`--glitches: live|pop|none, получено ${v}`);
  return v;
};
const researchArg = (): PolicyOptions['research'] => {
  const v = strArg('research', 'none');
  if (v !== 'none' && v !== '30m' && v !== '2h' && v !== '8h') throw new Error(`--research: none|30m|2h|8h, получено ${v}`);
  return v;
};
if (has('no-characters')) for (const lab of LAB_IDS) delete CHARACTERS[lab];

const POLICY_NAME = strArg('policy', 'greedy');
if (POLICY_NAME !== 'greedy' && POLICY_NAME !== 'attentive') throw new Error(`--policy: greedy|attentive, получено ${POLICY_NAME}`);
const ATTENTIVE = POLICY_NAME === 'attentive';
if (ATTENTIVE && (has('catch') || has('glitches') || has('research') || has('course') || has('challenge') || has('farm') || has('min-gain') || has('thermal') || has('uprising'))) {
  console.log('Внимание: --policy attentive задаёт поведение сам (см. tools/attentivePolicy.ts); флаги --catch, --glitches, --research, --course, --challenge, --farm, --min-gain, --thermal, --uprising на него не действуют.');
}

const POLICY = {
  thermal: modeArg(),
  cps: arg('cps', DEFAULT_POLICY.cps),
  reserve: arg('reserve', DEFAULT_POLICY.reserve),
  minGain: arg('min-gain', DEFAULT_POLICY.minGain),
  farmSec: arg('farm', DEFAULT_POLICY.farmSec),
  seed: arg('seed', DEFAULT_POLICY.seed),
  course: strArg('course', DEFAULT_POLICY.course),
  catchEvents: has('catch'),
  challenges: challengeArg(),
  uprising: has('uprising'),
  glitches: glitchesArg(),
  research: researchArg(),
};
/** Игрок: жадный или внимательный; у каждого свой Престиж и свои покупки, `sim` меряет их одинаково. */
const listArg = (k: string, d: readonly string[]): readonly string[] => {
  const v = strArg(k, '');
  if (v === '') return d;
  return v === 'none' ? [] : v.split(',');
};
const PLAYER: PlayerPolicy = ATTENTIVE
  ? attentivePlayer({
      cps: arg('cps', 4),
      reserve: arg('reserve', DEFAULT_POLICY.reserve),
      seed: arg('seed', DEFAULT_POLICY.seed),
      coursePriority: listArg('course-priority', ATTENTIVE_DEFAULTS.coursePriority),
      challengeSet: listArg('challenge-set', ATTENTIVE_DEFAULTS.challengeSet),
    })
  : {
      newSession: () => newSession(POLICY),
      tick,
      prestigeDue,
      doPrestige,
    };
const CAMPAIGN = has('campaign');
const VERBOSE = has('verbose');
const MAX_MIN = arg('max', 1500);

const fmt = (n: number) => {
  if (!Number.isFinite(n)) return '∞';
  const units: [number, string][] = [
    [1e300, 'e300'], [1e36, 'e36'], [1e24, 'e24'], [1e18, 'e18'], [1e12, 'e12'],
    [1e9, 'e9'], [1e6, 'e6'], [1e3, 'K'],
  ];
  for (const [v, s] of units) if (n >= v) return (n / v).toFixed(2) + s;
  return n.toFixed(1);
};

const MIN = (v: number) => (v < 60 ? `${v.toFixed(1)} с` : `${(v / 60).toFixed(1)} мин`);

/** Сколько минут заняло Поколение; null — не закончено в отведённое время. */
interface GenResult {
  generation: number;
  minutes: number | null;
}

/** Таблица «Поколение, факт, кривая, отклонение»; недостигнутое помечено, а не выдумано. */
function printPace(results: GenResult[], finaleReached: boolean): void {
  console.log('\n=== темп против целевой кривой (src/data/paceCurve.ts) ===');
  console.log('Поколение'.padEnd(26) + 'факт, мин'.padStart(11) + 'кривая, мин'.padStart(13) + `отклонение (допуск ±${PACE_TOLERANCE * 100}%)`.padStart(40));
  let actualSum = 0;
  let targetSum = 0;
  for (const target of PACE_CURVE) {
    const r = results.find((x) => x.generation === target.generation);
    const name = `${target.generation + 1}. ${CATALOG[target.generation].name}`.padEnd(26);
    if (!r || r.minutes === null) {
      console.log(`${name}${'—'.padStart(11)}${target.minutes.toFixed(0).padStart(13)}${'не дошёл'.padStart(40)}`);
      continue;
    }
    actualSum += r.minutes;
    targetSum += target.minutes;
    const diff = r.minutes - target.minutes;
    const pct = (diff / target.minutes) * 100;
    const within = Math.abs(diff) <= target.minutes * PACE_TOLERANCE;
    const dev = `${diff >= 0 ? '+' : ''}${diff.toFixed(1)} (${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%) ${within ? 'ок' : 'вне допуска'}`;
    console.log(`${name}${r.minutes.toFixed(1).padStart(11)}${target.minutes.toFixed(0).padStart(13)}${dev.padStart(40)}`);
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

function run(minutes: number, withPrestige: boolean): void {
  const w: Session = PLAYER.newSession();
  const marks = new Map<string, number>();
  const mark = (k: string) => { if (!marks.has(k)) marks.set(k, w.t); };
  const owned = (x: GameState) => Object.values(x.agents).reduce((a, b) => a + b, 0);
  let lastLog = -1;
  const results: GenResult[] = [];
  let finale = false;

  const steps = Math.round((minutes * 60) / DT);
  for (let i = 0; i < steps; i++) {
    PLAYER.tick(w);
    const s = w.s;

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
    for (const g of CATALOG[s.generation].models) {
      if ((s.agents[g.id] ?? 0) > 0) mark(`Агент: ${g.name}`);
    }

    // Финал контента: Флагман последнего Поколения взят, дальше Престижа нет. Конец прогона.
    if (CAMPAIGN && isContentFinale(s)) {
      results.push({ generation: s.generation, minutes: (w.t - w.genStart) / 60 });
      finale = true;
      break;
    }

    if ((withPrestige || CAMPAIGN) && PLAYER.prestigeDue(w)) {
      const gain = prestigeGain(s);
      mark(`ПРЕСТИЖ #${s.prestiges + 1} → ${CATALOG[s.generation + 1].name}`);
      const done = PLAYER.doPrestige(w);
      results.push(done);
      console.log(
        `>>> ПРЕСТИЖ #${w.s.prestiges} на ${(w.t / 60).toFixed(1)} мин → ` +
        `${CATALOG[w.s.generation].name}, прирост ${gain}, Compute ${w.s.compute}, Перков ${w.s.perks.length}, Курс ${w.s.course ?? '—'}`,
      );
      const strengths = LAB_IDS.filter((l) => CHARACTERS[l]).map((l) => `${l} ${characterStrength(s, l).toFixed(2)}`).join(', ');
      console.log(`    Характеры в офисе перед Престижем: ${strengths || 'выключены'}; безопасная Температура ${safeTemp(s).toFixed(3)}`);
      mark('первый Compute');
      mark(`престиж #${w.s.prestiges}`);
      lastLog = -1;
    }

    const minute = Math.floor(w.t / 60);
    if (VERBOSE && minute !== lastLog) {
      lastLog = minute;
      const x = w.s;
      console.log(
        `t=${String(minute).padStart(2)}м доход=${fmt(totalIncome(x)).padStart(8)}/с ` +
        `кошелёк=${fmt(x.tokens).padStart(9)} агенты=${String(owned(x)).padStart(4)} ` +
        `апгрейды=${String(x.upgrades.length).padStart(2)} клик=${fmt(clickValue(x)).padStart(8)} ` +
        `поколение=${x.generation} compute=${x.compute}`,
      );
    }
  }

  if (!CAMPAIGN) {
    console.log('\n=== вехи ===');
    for (const [k, v] of marks) console.log(`${k.padEnd(30)} ${MIN(v)}`);
  }
  const x = w.s;
  console.log(
    `итог: доход ${fmt(totalIncome(x))}/с, поколение ${x.generation}, ` +
    `забег ${fmt(x.runTokens)}, престижей ${x.prestiges}, перков ${x.perks.length}`,
  );
  if (CAMPAIGN) {
    printPace(results, finale);
    console.log(`игрок: ${POLICY_NAME}; Compute всего ${x.compute}, потрачено ${x.computeSpent}, в запасе ${x.compute - x.computeSpent}`);
  }
}

if (CAMPAIGN) run(MAX_MIN, true);
else run(arg('gen', 40), has('prestige'));
