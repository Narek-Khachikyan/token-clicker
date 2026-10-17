/**
 * Замер Восстания моделей, Глюков и цены «Лобби» на длинных Забегах (план `docs/plans/deepening.md`,
 * «Не проверено»; отчёт — `docs/plans/110-pace-report.md`). Только меряет, механик не трогает.
 *
 * Запуск (tsx не объявлен зависимостью, `npx` подтянет его сам):
 *   npx tsx tools/measureMeta.ts --uprising --glitches live --seeds 1,2,3 --prices
 *
 * Одна и та же жадная политика (`tools/greedyPolicy.ts`) на целую кампанию, меняются два её рычага:
 *   --uprising       политика поднимает стадию Восстания, как стор (`raiseUprising`): игра, какой её видит
 *                    игрок. Без флага красных События нет — так считает и `tools/sim.ts`, он стора не гоняет
 *   --glitches MODE  live (по умолчанию: Глюки копятся, политика их не трогает) | pop (лопает каждого в
 *                    тот же тик: внимательный игрок) | none (Глюков нет)
 * Разница двух запусков, отличающихся одним рычагом, и есть цена этого рычага.
 *
 * Печатает по Поколениям средние по зёрнам: минуты, События (всего / красных), живых Глюков в среднем
 * и в пике, а при `--prices` — цену «Лобби» против Флагмана, Дохода и кошелька на трёх четвертях Забега.
 */
import { CATALOG } from '../src/economy/catalog';
import { isContentFinale, totalIncome } from '../src/economy/engine';
import { PLEDGE_GROWTH, PLEDGE_MAX, PLEDGE_MS, PLEDGE_UNITS } from '../src/economy/glitches';
import { doPrestige, newSession, prestigeDue, tick, DT } from './greedyPolicy';

const argOf = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const UPRISING = process.argv.includes('--uprising');
const GLITCHES = argOf('glitches', 'live') as 'live' | 'none' | 'pop';
const SEEDS = argOf('seeds', '1,2,3').split(',').map(Number);
const PRICES = process.argv.includes('--prices');

interface GenStats {
  minutes: number;
  events: number;
  red: number;
  /** Среднее живых Глюков по времени Забега. */
  glitchMean: number;
  glitchPeak: number;
  /** Минутные снимки: доход и кошелёк, чтобы мерить цену «Лобби» в секундах Дохода. */
  incomeAt: number[];
  tokensAt: number[];
  runTokens: number;
}

const redKinds: Record<string, number> = {};

function campaign(seed: number): GenStats[] {
  const w = newSession({ seed, uprising: UPRISING, glitches: GLITCHES });
  const out: GenStats[] = [];
  let cur = { events: 0, red: 0, glitchSum: 0, glitchPeak: 0, ticks: 0, incomeAt: [] as number[], tokensAt: [] as number[] };
  let lastEvent = -1;
  let lastMinute = -1;
  const reset = () => {
    cur = { events: 0, red: 0, glitchSum: 0, glitchPeak: 0, ticks: 0, incomeAt: [], tokensAt: [] };
    lastMinute = -1;
  };
  const close = (minutes: number) =>
    out.push({
      minutes,
      events: cur.events,
      red: cur.red,
      glitchMean: cur.ticks ? cur.glitchSum / cur.ticks : 0,
      glitchPeak: cur.glitchPeak,
      incomeAt: cur.incomeAt,
      tokensAt: cur.tokensAt,
      runTokens: w.s.runTokens,
    });

  const steps = Math.round((1500 * 60) / DT);
  for (let i = 0; i < steps; i++) {
    tick(w);

    const ev = w.s.event;
    if (ev && ev.startedAt !== lastEvent) {
      lastEvent = ev.startedAt;
      cur.events++;
      if (ev.red) {
        cur.red++;
        redKinds[ev.kind] = (redKinds[ev.kind] ?? 0) + 1;
      }
    }
    cur.glitchSum += w.s.glitches.length;
    cur.glitchPeak = Math.max(cur.glitchPeak, w.s.glitches.length);
    cur.ticks++;
    const minute = Math.floor((w.t - w.genStart) / 60);
    if (minute !== lastMinute) {
      lastMinute = minute;
      cur.incomeAt.push(totalIncome(w.s));
      cur.tokensAt.push(w.s.tokens);
    }

    if (isContentFinale(w.s)) {
      close((w.t - w.genStart) / 60);
      break;
    }
    if (prestigeDue(w)) {
      close((w.t - w.genStart) / 60);
      doPrestige(w);
      reset();
    }
  }
  return out;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const runs = SEEDS.map(campaign);

console.log(`Восстание ${UPRISING ? 'вкл' : 'выкл'}, Глюки ${GLITCHES}, зёрна ${SEEDS.join(',')}; средние по зёрнам`);
console.log('Поколение'.padEnd(20) + 'мин'.padStart(8) + 'События'.padStart(9) + 'красных'.padStart(9) + 'Глюков ср.'.padStart(12) + 'пик'.padStart(5));
let total = 0;
for (let g = 0; g < CATALOG.length; g++) {
  const rows = runs.map((r) => r[g]).filter(Boolean);
  if (rows.length === 0) continue;
  const minutes = mean(rows.map((r) => r.minutes));
  total += minutes;
  console.log(
    `${g + 1}. ${CATALOG[g].name}`.padEnd(20) +
      minutes.toFixed(1).padStart(8) +
      mean(rows.map((r) => r.events)).toFixed(1).padStart(9) +
      mean(rows.map((r) => r.red)).toFixed(1).padStart(9) +
      mean(rows.map((r) => r.glitchMean)).toFixed(1).padStart(12) +
      String(Math.max(...rows.map((r) => r.glitchPeak))).padStart(5),
  );
}
console.log(`всего ${total.toFixed(1)} мин`);
if (UPRISING) console.log(`красные События по видам (сумма по зёрнам): ${JSON.stringify(redKinds)}`);

if (PRICES) {
  console.log('\n«Лобби»: цена первой покупки (PLEDGE_UNITS × масштаб) против Флагмана, Дохода и кошелька на трёх четвертях Забега');
  console.log(
    'Поколение'.padEnd(20) + '/ Флагман'.padStart(11) + 'мс Дохода'.padStart(11) + '/ кошелёк'.padStart(11) +
      'покупок на Забег'.padStart(18) + 'их цена / заработок'.padStart(21) + 'пятая / Флагман'.padStart(17),
  );
  for (let g = 0; g < CATALOG.length; g++) {
    const rows = runs.map((r) => r[g]).filter(Boolean);
    if (rows.length === 0) continue;
    const price = PLEDGE_UNITS * CATALOG[g].scale;
    const flagship = CATALOG[g].flagship.baseCost;
    const late = (xs: number[]) => xs[Math.floor(xs.length * 0.75)];
    const wallet = mean(rows.map((r) => late(r.tokensAt)));
    const income = mean(rows.map((r) => late(r.incomeAt)));
    const minutes = mean(rows.map((r) => r.minutes));
    // Чтобы красные События молчали весь Забег, покупок нужно по одной на PLEDGE_MS, не больше PLEDGE_MAX.
    const need = Math.min(PLEDGE_MAX, Math.ceil((minutes * 60_000) / PLEDGE_MS));
    let cover = 0;
    for (let k = 0; k < need; k++) cover += price * Math.pow(PLEDGE_GROWTH, k);
    const earned = mean(rows.map((r) => r.runTokens));
    const fifth = price * Math.pow(PLEDGE_GROWTH, PLEDGE_MAX - 1);
    const pct = (x: number) => (x < 1e-4 ? `${(x * 100).toExponential(1)}%` : `${(x * 100).toFixed(x < 0.001 ? 4 : 2)}%`);
    console.log(
      `${g + 1}. ${CATALOG[g].name}`.padEnd(20) +
        pct(price / flagship).padStart(11) +
        (price / income * 1000).toFixed(1).padStart(11) +
        pct(price / wallet).padStart(11) +
        String(need).padStart(18) +
        pct(cover / earned).padStart(21) +
        (fifth / flagship).toFixed(2).padStart(17),
    );
  }
  console.log(`(за Забег «Лобби» можно купить не больше ${PLEDGE_MAX} раз)`);
}
