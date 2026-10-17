/**
 * Звук Температуры.
 *
 * Отдельный модуль от `sound.ts`, потому что здесь не один вызов, а непрерывный голос:
 * короткие сигналы живут в том файле, а «тёплый воздух» обязан тянуться, меняться по
 * жару и сниматься остужанием.
 *
 * Голос — фон, под который играют часами, поэтому он греет, а не тревожит. Прежний голос
 * (расстроенная пила, полосовой шум и гул на 55 Гц, звучащий и в холоде) читался как сирена
 * и мешал играть. Теперь слоя два, и оба мягкие:
 *   - шум сквозь фильтр нижних частот — «тёплый воздух»: в холоде его почти нет, с жаром он
 *     становится громче и чуть светлее, но без резонанса и без свиста;
 *   - тихий синус на 110 Гц — «тёплый гул»: проступает только в верхней половине шкалы и с
 *     перегревом, чтобы горячий офис отличался от тёплого. Не 55 Гц: такой низ на телефоне и в
 *     наушниках слышен не тоном, а давлением.
 *
 * Высота не растёт ни у одного слоя: растущий тон — язык тревоги, а жар здесь — рычаг игрока.
 * Параметры меняются с постоянной времени в полсекунды, поэтому рывок шкалы звучит как
 * медленный вдох, а не как скачок. Всё идёт через канал эффектов `sound.ts`: громкость и мьют
 * игрока применяются там.
 */
import { audioBus, isAudioHidden, noiseBuffer, runningBus, type SoundSettings } from './sound';

/** Фильтр «воздуха»: срез в холоде и на краю шкалы. Ниже 450 Гц шум превращается в гул, выше 1.1 кГц — в шипение. */
const AIR_CUTOFF_COLD_HZ = 450;
const AIR_CUTOFF_HOT_HZ = 1100;
/** Громкость «воздуха» в холоде и на краю шкалы: в холоде его едва слышно, на краю — фон, не сигнал. */
const AIR_LEVEL_COLD = 0.003;
const AIR_LEVEL_HOT = 0.015;
/** Перегрев добавляет «воздуху» немного сверх шкалы: игрок слышит, что пора остужать. */
const AIR_HEAT_BONUS = 0.005;
/** Гул: частота, потолок громкости и доля шкалы, с которой он начинает проступать. */
const HUM_HZ = 110;
const HUM_LEVEL = 0.006;
const HUM_FROM = 0.45;
/** Постоянная времени: полсекунды, медленный вдох вместо рывка вслед за ручкой шкалы. */
const SMOOTH_SEC = 0.5;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export interface ThermalAudioParams {
  /** Температура, [0, 1] шкалы. */
  temp: number;
  /** Перегрев, [0, 1]. */
  heat: number;
}

/** Уровни и срез голоса по Температуре и перегреву — решение без AudioContext. */
export interface ThermalMix {
  airCutoff: number;
  airLevel: number;
  humLevel: number;
}

export function calcThermalMix({ temp, heat }: ThermalAudioParams): ThermalMix {
  const warm = clamp01(temp);
  const overheat = clamp01(heat);
  return {
    airCutoff: AIR_CUTOFF_COLD_HZ + (AIR_CUTOFF_HOT_HZ - AIR_CUTOFF_COLD_HZ) * warm,
    airLevel: AIR_LEVEL_COLD + (AIR_LEVEL_HOT - AIR_LEVEL_COLD) * warm + AIR_HEAT_BONUS * overheat,
    humLevel: HUM_LEVEL * smoothstep(HUM_FROM, 1, Math.max(warm, overheat)),
  };
}

/**
 * Живой голос. Держится между вызовами, поэтому `updateThermalAudio` на каждом тике ничего
 * не пересоздаёт: источники запускаются один раз, а меняются только параметры.
 *
 * Контекст входит в состояние: после `close()` старые узлы уже мёртвые, и новый контекст без
 * пересоздания голоса играл бы в никуда.
 */
let voice: {
  ctx: AudioContext;
  airFilter: BiquadFilterNode;
  airGain: GainNode;
  humGain: GainNode;
} | null = null;

/**
 * Поднимает голос Температуры и держит его на нужном уровне.
 *
 * Один вызов на тик, а не событие: параметры ползучие, и пересоздавать источники каждые
 * 50 мс было бы и слышно, и дорого. `start()` вызывается ровно один раз за жизнь голоса,
 * а всё остальное — `setTargetAtTime`, который по определению плавный и не щёлкает.
 * Пока звук выключен или страница скрыта, голос не создаётся вовсе; уже созданный глушит мастер.
 */
export function updateThermalAudio(settings: SoundSettings, params: ThermalAudioParams): void {
  if ((settings.muted || isAudioHidden()) && !voice) return;
  const bus = audioBus(settings);
  if (!bus) return;
  const { ctx, sfx } = bus;
  if (!voice || voice.ctx !== ctx) {
    const air = ctx.createBufferSource();
    air.buffer = noiseBuffer(ctx);
    air.loop = true;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = 'lowpass';
    // Q ниже баттервортовых 0.707: у среза нет горба, и шум не «поёт» на его частоте.
    airFilter.Q.value = 0.5;
    airFilter.frequency.value = AIR_CUTOFF_COLD_HZ;
    const airGain = ctx.createGain();
    airGain.gain.value = 0;
    air.connect(airFilter).connect(airGain).connect(sfx);

    const hum = ctx.createOscillator();
    hum.type = 'sine';
    hum.frequency.value = HUM_HZ;
    const humGain = ctx.createGain();
    humGain.gain.value = 0;
    hum.connect(humGain).connect(sfx);

    air.start();
    hum.start();

    voice = { ctx, airFilter, airGain, humGain };
  }

  const v = voice;
  const now = ctx.currentTime;
  const mix = calcThermalMix(params);
  v.airFilter.frequency.setTargetAtTime(mix.airCutoff, now, SMOOTH_SEC);
  v.airGain.gain.setTargetAtTime(mix.airLevel, now, SMOOTH_SEC);
  v.humGain.gain.setTargetAtTime(mix.humLevel, now, SMOOTH_SEC);
}

/**
 * Охлаждение: единственный звук, который не про жар, а про его конец.
 *
 * Отдельный вызов, а не состояние голоса: перегрев — событие. Это мягкий выдох — шум уходит
 * вниз по частоте, как остывает металл, но начинается с 1.6 кГц, а не с прежних 3.8: свист
 * сверху пугал сильнее, чем сам перегрев. Оба сигнала Температуры приходят из тика, поэтому
 * звучат только на уже проснувшемся контексте.
 */
export function playCoolingSound(settings: SoundSettings): void {
  const bus = runningBus(settings);
  if (!bus) return;
  const { ctx, sfx } = bus;

  const now = ctx.currentTime;
  const dur = 1.2;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.7;
  filter.frequency.setValueAtTime(1600, now);
  filter.frequency.exponentialRampToValueAtTime(200, now + dur);
  const gain = ctx.createGain();
  // Вход за 60 мс: выдох, а не удар.
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.05, now + 0.06);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  src.connect(filter).connect(gain).connect(sfx);
  src.start(now);
  src.stop(now + dur + 0.02);
}

/**
 * Галлюцинация: короткий сдвиг тона вниз.
 *
 * Не тревожный сигнал, а именно «сбой»: игра не ругает игрока за жар, она показывает, что
 * горячо. Поэтому это нисходящая кварта на синусоиде в середине регистра (D5 → A4), тихая и с
 * мягким входом, а не писк сверху.
 */
export function playHallucinationSound(settings: SoundSettings): void {
  const bus = runningBus(settings);
  if (!bus) return;
  const { ctx, sfx } = bus;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(587.33, now);
  osc.frequency.exponentialRampToValueAtTime(440, now + 0.28);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.045, now + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.00005, now + 0.38);

  osc.connect(gain).connect(sfx);
  osc.start(now);
  osc.stop(now + 0.4);
}
