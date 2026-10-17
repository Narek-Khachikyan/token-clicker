/**
 * Музыкальный луп: спокойный lo-fi под работу — пэд на аккордах, мягкий бас, редкие тёплые клавиши
 * и щёточные барабаны, собранные из осцилляторов.
 *
 * Ориентир — стрим Claude FM, «музыка, под которую думают»: медленно, тепло, без острой атаки и
 * без высоких частот. Поэтому темп постоянный и низкий, тембры — синус и треугольник за фильтром
 * нижних частот, а мелодия больше молчит, чем играет. Луп звучит часами, и всё, что в нём торопит
 * или режет ухо, через десять минут превращается в раздражитель.
 *
 * Гармония — четыре аккорда по два такта: Cmaj9 → Am9 → Fmaj9 → G6/9. В них нет ни
 * доминантового тритона, ни вводного тона, который тянул бы к разрешению: круг не «ждёт» финала и
 * может повторяться бесконечно. Мелодия берёт ноты из до-мажорной пентатоники, которая ложится на
 * все четыре аккорда без полутонового трения.
 *
 * Музыка читает три числа игры, и каждое отвечает за своё:
 *   - Доход — слои: клавиши и барабаны проступают по мере того, как игра «включается»;
 *   - Поколение — тональность: у каждого своя, но регистр не уползает, и бас остаётся басом;
 *   - Температура — яркость: жар чуть открывает фильтры, но не разгоняет темп — спешка в
 *     фоне делала бы жар тревожным, а он и так виден на шкале.
 *
 * Чтобы час игры не звучал как один и тот же отрывок, мелодия и мелкие удары выбираются по хешу
 * номера такта: каждый такт свой, но один и тот же такт звучит одинаково, и тест его видит. Каждые
 * 32 такта луп «выдыхает»: клавиши и барабаны редеют.
 *
 * Шедулер — lookahead: раз в 100 мс он планирует ноты на 0.2 с вперёд, а играет их AudioContext по
 * своему часу. У лупа нет иного способа попасть в такт, потому что его события повторяются
 * бесконечно, в отличие от одноразового звука и тика на 50 мс.
 *
 * Музыка не стартует сама: пока AudioContext suspended, планировать нечего, и первое озвученное
 * касание оживит контекст, после чего луп оживёт сам.
 */
import { audioBus, channelVolume, masterVolume, playNoise, playVoice, type AudioBus, type SoundSettings } from './sound';

/** Темп: медленная ходьба, ниже пульса в покое. Не зависит от игры — фон не торопит игрока. */
export const MUSIC_BPM = 72;
/** Восьмые: 8 шагов на такт. */
const STEPS_PER_BAR = 8;
/** Длительность шага-восьмой в секундах. */
export const MUSIC_STEP_SEC = 60 / MUSIC_BPM / 2;
/**
 * Свинг: слабая восьмая приходит на 56% доли, а не на 50%. Чуть «вразвалку» — то, что отличает
 * lo-fi от метронома; больше — и ритм начинает хромать.
 */
const SWING = 0.56;

/** Корень баса в до мажоре: C2 (65.4 Гц). */
const BASS_ROOT_HZ = 65.41;
/** Опора пэда: C3. */
const PAD_ROOT_HZ = 130.81;
/** Опора мелодии: C4 (261.6 Гц) — середина клавиатуры, ниже голоса эффектов. */
const KEYS_ROOT_HZ = 261.63;

/**
 * Тональность по Поколению, в полутонах от до мажора.
 *
 * Не лестница вверх, а прогулка вокруг до: прежний подъём на два полутона за Поколение к восьмому
 * загонял бас в середину и мелодию в писк. Здесь каждое Поколение звучит в своей тональности, а
 * весь луп остаётся в пределах кварты от исходной.
 */
const KEY_CYCLE = [0, 2, 4, -3, -1, 1, 3, -2] as const;

interface Chord {
  /** Корень баса в полутонах от C2. */
  bass: number;
  /** Голоса пэда в полутонах от C3: широкое расположение, без тесных секунд. */
  pad: readonly number[];
}

/** Круг аккордов, по два такта на аккорд. */
const CHORDS: readonly Chord[] = [
  { bass: 0, pad: [4, 7, 11, 14] }, // Cmaj9: E3 G3 B3 D4 над C
  { bass: -3, pad: [0, 4, 7, 11] }, // Am9: C3 E3 G3 B3 над A
  { bass: 5, pad: [0, 4, 7, 9] }, // Fmaj9: C3 E3 G3 A3 над F
  { bass: 7, pad: [2, 7, 9, 16] }, // G6/9: D3 G3 A3 E4 над G, без вводного B
];
const BARS_PER_CHORD = 2;
const STEPS_PER_CHORD = STEPS_PER_BAR * BARS_PER_CHORD;

/** Ноты мелодии: до-мажорная пентатоника на полторы октавы от C4 (262–659 Гц). */
const KEYS_POOL = [0, 2, 4, 7, 9, 12, 14, 16] as const;
/**
 * Ритмические мотивы мелодии: на каких восьмых такта звучит нота. Пустые мотивы — паузы: мелодия,
 * которая не замолкает, перестаёт быть фоном.
 */
const KEYS_MOTIFS: readonly (readonly number[])[] = [
  [0, 3, 4],
  [2, 5],
  [0, 2, 3, 6],
  [],
  [1, 4, 7],
  [0, 5],
  [3, 4, 6],
  [],
];

/** Бас: корень на первую долю и мягче на «и» третьей — качнуть такт, а не отбивать его. */
const BASS_HITS: readonly (readonly [at: number, accent: number, dur: number])[] = [
  [0, 1, 2.2],
  [5, 0.55, 1.1],
];
/** Бочка в такт басу, щётка на вторую и четвёртую доли. */
const KICK_STEPS = [0, 5];
const SNARE_STEPS = [2, 6];
/** Тихая «призрачная» щётка на последней восьмой — не в каждом такте. */
const GHOST_STEP = 7;
const GHOST_CHANCE = 0.35;

/** Фраза из 32 тактов; в последней её четверти луп «выдыхает». */
const PHRASE_BARS = 32;
const BREATH_FROM_BAR = 24;

/**
 * Уровни слоёв. Музыка держится ниже эффектов: всё вместе на пике не громче потолка одного
 * сигнала из sfx.ts.
 */
const PAD_LEVEL = 0.005;
/** Голосов на ноту пэда: два, с расстройкой в разные стороны. */
const PAD_VOICES = 2;
const PAD_DETUNE_CENTS = 4;
const PAD_ATTACK_SEC = 1.2;
/** Хвост пэда заходит на следующий аккорд: смена гармонии — перелив, а не переключение. */
const PAD_OVERLAP_SEC = 1.6;
const BASS_LEVEL = 0.035;
const BASS_GROWTH = 0.01;
const KEYS_LEVEL = 0.02;
/** Октавный обертон клавиш: −18 дБ к основному тону, «электропиано», а не флейта. */
const KEYS_PARTIAL = 0.12;
const KEYS_DUR_SEC = 1.6;
const DRUMS_LEVEL = 0.03;
const SNARE_RATIO = 0.3;
/** Интенсивность, на которой клавиши начинают проступать, и та, на которой выходят на полную. */
const KEYS_INTENSITY_FLOOR = 0.15;
const KEYS_INTENSITY_CEILING = 0.75;
/** Барабаны приходят позже клавиш: начало Забега — чистый эмбиент. */
const DRUMS_INTENSITY_FLOOR = 0.35;
const DRUMS_INTENSITY_CEILING = 0.9;
/**
 * С третьего Поколения (индекс 2) клавиши есть всегда.
 *
 * Интенсивность падает вместе с Престижем — после него Доход начинается с нуля, — и мелодия
 * была бы слышна только у игрока с большим забегом. Порог по Поколению держит обещание: к третьему
 * Поколению музыка звучит иначе, чем в первом, сколько бы Токенов ни накопил игрок.
 */
const KEYS_FROM_GENERATION = 2;
const KEYS_GENERATION_LEVEL = 0.014;

/** Срезы фильтров в холоде и прибавка к ним на краю шкалы Температуры. */
const PAD_CUTOFF_HZ = 800;
const PAD_CUTOFF_HEAT_HZ = 500;
const KEYS_CUTOFF_HZ = 1600;
const KEYS_CUTOFF_HEAT_HZ = 600;
const BASS_CUTOFF_HZ = 320;

/**
 * Спад голоса музыки — на 60 дБ ниже его собственного уровня, а не до общего 0.001: голоса здесь
 * тише эффектов, и обрыв на 0.001 был бы слышен.
 */
const FADE_RATIO = 0.001;

/** Приглушение под стингер События и Престижа: музыка уходит в фон, но не пропадает. */
const DUCK_LEVEL = 0.3;
const DUCK_SEC = 2;
const DUCK_ATTACK = 0.05;
const DUCK_RELEASE = 0.4;

/** Период тика шедулера и горизонт планирования. */
const SCHEDULER_TICK_MS = 100;
const SCHEDULE_AHEAD_SEC = 0.2;
/** Спад при остановке: уже запланированные ноты доживают тихо, вместо обрыва щелчком. */
const MUSIC_FADE_OUT_SEC = 0.08;
/** Первая нота планируется чуть позже текущего момента, чтобы луп не начинал на полуфразе. */
const MUSIC_START_DELAY_SEC = 0.05;

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function hzFromSemitones(rootHz: number, semitones: number): number {
  return rootHz * 2 ** (semitones / 12);
}

/**
 * Детерминированный «случай» 0..1 по номеру такта и соли.
 *
 * Не Math.random: такт обязан звучать одинаково при каждом проходе шедулера и в тесте, а
 * разнообразие нужно между тактами, а не между запусками.
 */
function hash01(n: number, salt: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function barOf(step: number): number {
  return Math.floor(step / STEPS_PER_BAR);
}

function inBarIndex(step: number): number {
  return ((step % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR;
}

function chordAt(step: number): Chord {
  const index = Math.floor(step / STEPS_PER_CHORD) % CHORDS.length;
  return CHORDS[(index + CHORDS.length) % CHORDS.length];
}

/** Такт в «выдохе» фразы: последняя четверть каждых 32 тактов. */
function inBreath(bar: number): boolean {
  return ((bar % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS >= BREATH_FROM_BAR;
}

/** Тональность Поколения (индекс с нуля) в полутонах от до мажора. */
export function calcTransposition(generation: number): number {
  // Пол и потолок — страховка от чужого номера Поколения: за краем таблицы берётся её край.
  const index = Number.isFinite(generation) ? Math.floor(generation) : 0;
  return KEY_CYCLE[Math.min(KEY_CYCLE.length - 1, Math.max(0, index))];
}

/** Тоника баса в этом Поколении. */
export function calcBaseFrequency(generation: number): number {
  return hzFromSemitones(BASS_ROOT_HZ, calcTransposition(generation));
}

/** Сдвиг слабой восьмой под свинг, в секундах; сильная восьмая приходит ровно в сетку. */
export function calcSwingOffset(step: number): number {
  return inBarIndex(step) % 2 === 1 ? (SWING - 0.5) * 2 * MUSIC_STEP_SEC : 0;
}

/** Громкости слоёв: пэд и бас есть всегда, клавиши и барабаны приходят вместе с Доходом. */
export interface MusicLayers {
  /** Уровень одного голоса пэда. */
  pad: number;
  bass: number;
  keys: number;
  /** Уровень бочки; щётка — его доля. */
  drums: number;
}

export function calcMusicLayers(intensity: number, generation: number): MusicLayers {
  const level = clamp01(intensity);
  const keysFromIntensity = KEYS_LEVEL * smoothstep(KEYS_INTENSITY_FLOOR, KEYS_INTENSITY_CEILING, level);
  return {
    pad: PAD_LEVEL,
    bass: BASS_LEVEL + BASS_GROWTH * level,
    keys: generation >= KEYS_FROM_GENERATION ? Math.max(keysFromIntensity, KEYS_GENERATION_LEVEL) : keysFromIntensity,
    drums: DRUMS_LEVEL * smoothstep(DRUMS_INTENSITY_FLOOR, DRUMS_INTENSITY_CEILING, level),
  };
}

/**
 * Пиковая сумма всех слоёв: все голоса пэда, бас, клавиша с обертоном и бочка разом. Нужна тесту
 * потолка — музыка не должна спорить с эффектами.
 */
export function calcMusicPeak(layers: MusicLayers): number {
  const padVoices = Math.max(...CHORDS.map((chord) => chord.pad.length)) * PAD_VOICES;
  return layers.pad * padVoices + layers.bass + layers.keys * (1 + KEYS_PARTIAL) + layers.drums;
}

/** Срезы фильтров по Температуре (доля шкалы 0..1): жар делает звук ярче, но не быстрее. */
export function calcMusicCutoffs(temp01: number): { pad: number; keys: number } {
  const heat = clamp01(temp01);
  return {
    pad: PAD_CUTOFF_HZ + PAD_CUTOFF_HEAT_HZ * heat,
    keys: KEYS_CUTOFF_HZ + KEYS_CUTOFF_HEAT_HZ * heat,
  };
}

/** Частоты голосов пэда, если на этом шаге начинается аккорд; null — пэд тянет прежний. */
export function calcPadFrequencies(step: number, generation: number): number[] | null {
  if (step % STEPS_PER_CHORD !== 0) return null;
  const shift = calcTransposition(generation);
  return chordAt(step).pad.map((semitones) => hzFromSemitones(PAD_ROOT_HZ, semitones + shift));
}

/** Басовая нота на шаге и её доля от уровня слоя; null, если бас молчит. */
export function calcBassNote(step: number, generation: number): { hz: number; accent: number; dur: number } | null {
  const hit = BASS_HITS.find(([at]) => at === inBarIndex(step));
  if (!hit) return null;
  return {
    hz: hzFromSemitones(BASS_ROOT_HZ, chordAt(step).bass + calcTransposition(generation)),
    accent: hit[1],
    dur: hit[2],
  };
}

/**
 * Нота мелодии на шаге: частота и сила нажатия 0.7..1; null — пауза.
 *
 * Мотив и начальная нота такта выбираются по хешу такта, дальше линия ходит по пентатонике
 * шагами не больше двух ступеней: скачки через октаву звучали бы как случайный перебор.
 * В «выдохе» фразы играет только каждый второй такт.
 */
export function calcMelodyNote(step: number, generation: number): { hz: number; velocity: number } | null {
  const bar = barOf(step);
  if (inBreath(bar) && bar % 2 === 1) return null;
  const motif = KEYS_MOTIFS[Math.floor(hash01(bar, 1) * KEYS_MOTIFS.length)];
  const position = motif.indexOf(inBarIndex(step));
  if (position < 0) return null;
  let degree = 2 + Math.floor(hash01(bar, 2) * 4);
  for (let i = 1; i <= position; i += 1) {
    const move = Math.floor(hash01(bar * 8 + i, 3) * 5) - 2;
    degree = Math.min(KEYS_POOL.length - 1, Math.max(0, degree + move));
  }
  return {
    hz: hzFromSemitones(KEYS_ROOT_HZ, KEYS_POOL[degree] + calcTransposition(generation)),
    velocity: 0.7 + 0.3 * hash01(bar * 8 + position, 4),
  };
}

/** Удары на шаге: бочка, щётка и её сила. Перед концом каждой фразы барабаны молчат два такта. */
export function calcDrumHits(step: number): { kick: boolean; snare: number } {
  const bar = barOf(step);
  const inPhrase = ((bar % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS;
  if (inPhrase >= PHRASE_BARS - 2) return { kick: false, snare: 0 };
  const at = inBarIndex(step);
  const kick = KICK_STEPS.includes(at);
  if (SNARE_STEPS.includes(at)) return { kick, snare: 1 };
  if (at === GHOST_STEP && hash01(bar, 5) < GHOST_CHANCE) return { kick, snare: 0.4 };
  return { kick, snare: 0 };
}

/** Курсор лупа: номер шага и время AudioContext, на которое приходится его доля по сетке. */
export interface LoopCursor {
  step: number;
  time: number;
}

/**
 * Какие шаги надо запланировать до горизонта — решение шедулера без AudioContext. Время шага
 * отдаётся уже со свингом.
 *
 * Пропущенное время (сон лаптопа, троттлинг скрытой вкладки) не возвращается пачкой: музыка
 * продолжается с текущего момента, а номер шага всё равно растёт, иначе гармония застревала бы на
 * месте. Шаг, попавший в прошлое, считается сыгранным.
 */
export function planSteps(cursor: LoopCursor, now: number, horizon: number): { next: LoopCursor; times: number[] } {
  let { step, time } = cursor;
  while (time < now) {
    time += MUSIC_STEP_SEC;
    step += 1;
  }
  const times: number[] = [];
  while (time + calcSwingOffset(step) <= now + horizon) {
    times.push(time + calcSwingOffset(step));
    time += MUSIC_STEP_SEC;
    step += 1;
  }
  return { next: { step, time }, times };
}

/** Что игра сообщает музыке на каждом тике. */
export interface MusicParams {
  settings: SoundSettings;
  /** Насколько «включилась» игра: логарифм Дохода, 0..1. */
  intensity: number;
  /** Температура как доля шкалы, 0..1. */
  temp01: number;
  /** Индекс Поколения, с нуля. */
  generation: number;
}

let timer: ReturnType<typeof setInterval> | null = null;
let bus: AudioBus | null = null;
let cursor: LoopCursor = { step: 0, time: 0 };
let params: MusicParams = {
  settings: { muted: false, volume: 1, musicVolume: 1, sfxVolume: 1 },
  intensity: 0,
  temp01: 0,
  generation: 0,
};
let duckUntil = 0;
/** Куда сейчас уехала музыкальная шина: нужно, чтобы не переписывать AudioParam на каждом тике. */
let busLevel = 0;

/**
 * Запустить луп. Идемпотентна: повторный вызов не заводит второго лупа.
 *
 * Без жеста игрока музыки не слышно, но луп уже тикает: контекст suspended, его время не идёт, и
 * первое озвученное касание оживит и его.
 */
export function startMusic(settings: SoundSettings): void {
  params = { ...params, settings };
  const buses = audioBus(settings);
  if (!buses || timer !== null) return;
  bus = buses;
  duckUntil = 0;
  cursor = { step: 0, time: buses.ctx.currentTime + MUSIC_START_DELAY_SEC };
  setBusLevel(1);
  timer = setInterval(tick, SCHEDULER_TICK_MS);
}

/** Остановить луп. Повторный вызов и остановка незапущенного ничего не делают. */
export function stopMusic(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  const current = bus;
  bus = null;
  busLevel = 0;
  duckUntil = 0;
  if (!current) return;
  const now = current.ctx.currentTime;
  const level = current.musicBus.gain.value;
  current.musicBus.gain.cancelScheduledValues(now);
  current.musicBus.gain.setValueAtTime(level, now);
  current.musicBus.gain.linearRampToValueAtTime(0, now + MUSIC_FADE_OUT_SEC);
}

/**
 * Обновить то, что музыка слышит от игры. Зовётся каждый тик.
 *
 * Настройки читаются отсюда, а не запоминаются при старте: ползунки громкости и мьют доходят до
 * мастера и канала музыки на следующем же тике, без перезапуска лупа. Мьют луп не останавливает —
 * его глушит мастер, и снятие мьюта возвращает музыку с того же такта.
 */
export function updateMusic(next: MusicParams): void {
  params = next;
  if (!bus) return;
  audioBus(next.settings);
  setBusLevel(bus.ctx.currentTime < duckUntil ? DUCK_LEVEL : 1);
}

/** Короткое приглушение: стингер События или Престижа не должен спорить с лупом. */
export function duckMusic(): void {
  if (!bus) return;
  duckUntil = bus.ctx.currentTime + DUCK_SEC;
  setBusLevel(DUCK_LEVEL);
}

/** Идёт ли луп. */
export function isMusicPlaying(): boolean {
  return timer !== null;
}

/** Громкость музыкальной шины: 1 в норме, 0.3 под приглушением. Обратный подъём медленнее падения. */
function setBusLevel(target: number): void {
  if (!bus || target === busLevel) return;
  const now = bus.ctx.currentTime;
  const ramp = target < busLevel ? DUCK_ATTACK : DUCK_RELEASE;
  bus.musicBus.gain.cancelScheduledValues(now);
  bus.musicBus.gain.setValueAtTime(bus.musicBus.gain.value, now);
  bus.musicBus.gain.linearRampToValueAtTime(target, now + ramp);
  busLevel = target;
}

/**
 * Тик шедулера: досыпать ноты до горизонта.
 *
 * Планирования нет, пока контекст suspended (его время не идёт) и пока вкладка скрыта (там
 * setInterval душится до раза в секунду, и заметки всё равно не поспевают). Без второй проверки
 * курсор отстал бы на всё это время и вернул ноты пачкой в одно касание. Под мьютом и на нулевой
 * громкости — общей или канала музыки — курсор идёт, но нот не создаёт: молчащие осцилляторы
 * стоили бы работы и не дали бы ничего.
 */
function tick(): void {
  if (!bus) return;
  // Не только suspended: Safari ставит контексту ещё и 'interrupted', и время там тоже не идёт.
  if (bus.ctx.state !== 'running') return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

  const { ctx, musicBus } = bus;
  const { intensity, temp01, generation, settings } = params;
  const plan = planSteps(cursor, ctx.currentTime, SCHEDULE_AHEAD_SEC);
  const firstStep = plan.next.step - plan.times.length;
  cursor = plan.next;
  if (masterVolume(settings) === 0 || channelVolume(settings, 'music') === 0) return;

  const layers = calcMusicLayers(intensity, generation);
  const cutoffs = calcMusicCutoffs(temp01);
  plan.times.forEach((time, idx) => {
    const step = firstStep + idx;

    const pad = calcPadFrequencies(step, generation);
    if (pad) {
      const chordSec = STEPS_PER_CHORD * MUSIC_STEP_SEC;
      for (const hz of pad) {
        // Треугольник и синус с расстройкой в разные стороны: медленное биение вместо ровного тона.
        for (const [wave, detune] of [
          ['triangle', -PAD_DETUNE_CENTS],
          ['sine', PAD_DETUNE_CENTS],
        ] as const) {
          playVoice({
            ctx,
            out: musicBus,
            wave,
            freq: [[0, hz]],
            start: time,
            dur: chordSec + PAD_OVERLAP_SEC,
            attack: PAD_ATTACK_SEC,
            hold: chordSec - PAD_ATTACK_SEC - PAD_OVERLAP_SEC / 2,
            detune,
            level: layers.pad,
            fadeTo: layers.pad * FADE_RATIO,
            filter: { type: 'lowpass', freq: cutoffs.pad, q: 0.5 },
          });
        }
      }
    }

    const bass = calcBassNote(step, generation);
    if (bass) {
      playVoice({
        ctx,
        out: musicBus,
        wave: 'triangle',
        freq: [[0, bass.hz]],
        start: time,
        dur: bass.dur,
        attack: 0.04,
        level: layers.bass * bass.accent,
        fadeTo: layers.bass * bass.accent * FADE_RATIO,
        filter: { type: 'lowpass', freq: BASS_CUTOFF_HZ, q: 0.5 },
      });
    }

    const note = layers.keys > 0 ? calcMelodyNote(step, generation) : null;
    if (note) {
      const level = layers.keys * note.velocity;
      // Основной тон и тихая октава над ним: мягкое «электропиано» без звона.
      for (const [ratio, share] of [
        [1, 1],
        [2, KEYS_PARTIAL],
      ] as const) {
        playVoice({
          ctx,
          out: musicBus,
          wave: 'sine',
          freq: [[0, note.hz * ratio]],
          start: time,
          dur: KEYS_DUR_SEC,
          attack: 0.02,
          level: level * share,
          fadeTo: level * share * FADE_RATIO,
          filter: { type: 'lowpass', freq: cutoffs.keys, q: 0.6 },
        });
      }
    }

    if (layers.drums > 0) {
      const hits = calcDrumHits(step);
      if (hits.kick) {
        // Бочка — синус, сползающий 75 → 48 Гц: «тук» подушкой, без щелчка сверху.
        playVoice({
          ctx,
          out: musicBus,
          wave: 'sine',
          freq: [
            [0, 75],
            [0.11, 48],
          ],
          start: time,
          dur: 0.32,
          attack: 0.006,
          level: layers.drums,
          fadeTo: layers.drums * FADE_RATIO,
        });
      }
      if (hits.snare > 0) {
        // Щётка — короткий шум в полосе около 1.4 кГц, без высокого «тсс».
        playNoise({
          ctx,
          out: musicBus,
          start: time,
          dur: 0.14,
          attack: 0.004,
          level: layers.drums * SNARE_RATIO * hits.snare,
          fadeTo: layers.drums * SNARE_RATIO * hits.snare * FADE_RATIO,
          filter: { type: 'bandpass', freq: 1400, q: 0.8 },
        });
      }
    }
  });
}
