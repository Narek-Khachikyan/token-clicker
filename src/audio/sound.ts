/**
 * 8-битный звуковой синтезатор на Web Audio API.
 *
 * Звук синтезируется целиком: ни mp3, ни wav, ни лицензии на них. Источники одноразовые — каждый
 * эффект держит свой осциллятор, огибающую «экспонента в 0.001» и уходит.
 *
 * Громкость игрока — мастер-шина плюс два канала поверх неё: эффекты и музыка. Каждый источник
 * подключается к своему каналу, а оба канала — к мастеру, поэтому ни один звук не может оказаться
 * громче выбранного уровня, мьют глушит всё разом, а ноль на ползунке канала глушит только его.
 * Музыка приходит из music.ts, но контекст и граф остаются здесь: второй AudioContext на
 * страницу браузер не даёт.
 *
 * Скрытая страница молчит тем же путём, что и мьют, но отдельным флагом: тишина фона — не
 * настройка игрока, и снимается сама, не трогая ни мьют, ни ползунок.
 *
 * AudioContext создаётся лениво и один на страницу. Без жеста игрока он остаётся suspended, и
 * звука нет: браузер не даёт звучать без жеста, и никакой код этого не обойдёт — это не баг. Ошибку
 * resume() глотаем, иначе каждое касание до первого клика сыпало бы в консоль unhandled rejection.
 */

export interface SoundSettings {
  muted: boolean;
  /** Общая громкость игрока 0..1: мастер, на котором сидят оба канала. */
  volume: number;
  /** Громкость канала музыки 0..1 поверх мастера. */
  musicVolume: number;
  /** Громкость канала эффектов 0..1 поверх мастера. */
  sfxVolume: number;
}

/**
 * Мастер-громкость страницы.
 *
 * Отдельная чистая функция, потому что её результат — единственное число, на котором держится
 * тишина при мьюте, и его обязано быть видно в тесте без AudioContext.
 */
export function masterVolume(settings: Pick<SoundSettings, 'muted' | 'volume'>): number {
  if (settings.muted) return 0;
  const volume = settings.volume;
  // Сохранение, сделанное до появления громкости, приезжает без этого поля: NaN в AudioParam бросил
  // бы TypeError на каждом звуке, поэтому настройка без громкости читается как полная.
  if (!Number.isFinite(volume)) return 1;
  return Math.min(1, Math.max(0, volume));
}

/**
 * Громкость канала: 0..1, а нет числа — полный канал.
 *
 * Сохранение, сделанное до появления каналов, приезжает без этих полей, а NaN в AudioParam бросил
 * бы TypeError на каждом звуке. Полный, а не нулевой, потому что отсутствие настройки — это не
 * просьба о тишине: игрок, не трогавший каналов, слышит игру как раньше.
 */
export function channelVolume(settings: SoundSettings, channel: 'music' | 'sfx'): number {
  const level = channel === 'music' ? settings.musicVolume : settings.sfxVolume;
  if (!Number.isFinite(level)) return 1;
  return Math.min(1, Math.max(0, level));
}

let audioCtx: AudioContext | null = null;
let masterNode: GainNode | null = null;
let musicNode: GainNode | null = null;
let musicChannelNode: GainNode | null = null;
let sfxNode: GainNode | null = null;
/** Громкости, уже записанные в узлы: тик зовёт audioBus двадцать раз в секунду. */
const applied: { master: number | null; music: number | null; sfx: number | null } = {
  master: null,
  music: null,
  sfx: null,
};
/** Страница скрыта: мастер закрыт, эффекты не создают источников. Живёт на модуле, а не в
 *  настройках игрока: это «где игрок сейчас», и в сейв оно не попадает. */
let hidden = false;

/** Что мастер обязан держать сейчас: тишина скрытой страницы перекрывает и мьют, и ползунок. */
const targetVolume = (settings: SoundSettings): number => (hidden ? 0 : masterVolume(settings));

/** Скрыта ли страница; читают те, кто держит собственное состояние звука и не должен
 *  заводить его впустую (непрерывный голос Температуры). */
export function isAudioHidden(): boolean {
  return hidden;
}

/**
 * Страница скрыта или снова видна.
 *
 * Мастер переписывается сразу, а не на следующем тике: тик скрытой вкладки приходит раз в
 * секунду или реже, и звук тянулся бы всё это время после ухода. Настройки приходят аргументом
 * — модуль их не хранит, поэтому возвращение читает мьют и ползунок на момент возврата. Если
 * звук ещё ни разу не просили, контекста нет и будить его незачем: до первого жеста браузер
 * всё равно молчит, и первый же озвученный звук застанет верный флаг.
 */
export function setAudioHidden(isHidden: boolean, settings: SoundSettings): void {
  hidden = isHidden;
  if (!audioCtx || !masterNode) return;
  applyMasterVolume(masterNode, audioCtx.currentTime, settings);
}

/** Записывает громкость мастера, если она изменилась. Короткое сглаживание, а не скачок:
 *  мьют, ползунок и уход вкладки двигают мастер, пока звучат гул и музыка, и ступенька щёлкала бы. */
function applyMasterVolume(master: GainNode, now: number, settings: SoundSettings): void {
  const volume = targetVolume(settings);
  if (volume === applied.master) return;
  master.gain.setTargetAtTime(volume, now, 0.01);
  applied.master = volume;
}

/**
 * Контекст игры, общий для всех модулей звука.
 *
 * Экспортируется потому, что `thermal.ts` держит непрерывный голос и обязан играть на том же
 * контексте: два контекста означают два системных приоритета и рассинхрон между модулями.
 * Побочный эффект общего контекста — общий resume, поэтому жеста пользователя хватает обоим.
 *
 * `latencyHint: 'interactive'` обязателен: значение по умолчанию на десктопе даёт задержку
 * около 20 мс плюс буфер вывода, и клик перестаёт ощущаться мгновенным. Интерактивный режим
 * просит у системы минимальный буфер, и это единственное, что можно сделать без
 * собственного аудиопотока.
 */
export function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass({ latencyHint: 'interactive' });
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/** Граф, к которому подключается всё звучание страницы. Отдаётся music.ts, который строит луп. */
export interface AudioBus {
  ctx: AudioContext;
  /** Канал эффектов: на него подключается каждый одноразовый источник и голос Температуры. */
  sfx: GainNode;
  /** Музыкальная шина: её глушит дакинг под Событие, не трогая звуки. */
  musicBus: GainNode;
}

/**
 * Шина (или null, если окна/AudioContext нет) с уже применённой громкостью игрока.
 *
 * Граф: источник эффекта → канал эффектов → мастер; нота лупа → шина дакинга → канал музыки →
 * мастер; мастер → колонки. Шины создаются один раз на контекст и переживают источники:
 * подключение на каждый клик плодило бы узлы, а отключать их всё равно пришлось бы вручную.
 *
 * Каждая громкость игрока живёт ровно в одном узле: общая — на мастере, музыки и эффектов — на
 * своих каналах. Источники пишут только собственный уровень, иначе громкость применялась бы
 * дважды: ползунок канала на 0.5 при общем 0.5 дал бы 0.25, а не то, что показывают ползунки.
 */
export function audioBus(settings: SoundSettings): AudioBus | null {
  const ctx = audioContext();
  if (!ctx) return null;
  const now = ctx.currentTime;
  if (!masterNode) {
    masterNode = ctx.createGain();
    masterNode.connect(ctx.destination);
  }
  applyMasterVolume(masterNode, now, settings);
  if (!musicNode) {
    musicNode = ctx.createGain();
    // Музыки ещё нет, поэтому шина закрыта: startMusic открывает её, а лишний молчащий узел
    // ничего не слышит и не стоит ничего.
    musicNode.gain.setValueAtTime(0, now);
  }
  if (!musicChannelNode) {
    musicChannelNode = ctx.createGain();
    musicNode.connect(musicChannelNode);
    // Реверберация стоит после шины дакинга, поэтому хвост приглушается вместе с нотами, и до
    // канала музыки, поэтому её глушит тот же ползунок. Уровень «мокрого» сигнала зашит в сам
    // отклик: лишний GainNode на пути ноты сосчитал бы громкость игрока ещё раз.
    const reverb = ctx.createConvolver();
    reverb.normalize = false;
    reverb.buffer = reverbImpulse(ctx);
    musicNode.connect(reverb);
    reverb.connect(musicChannelNode);
    musicChannelNode.connect(masterNode);
  }
  if (!sfxNode) {
    sfxNode = ctx.createGain();
    sfxNode.connect(masterNode);
  }
  // Короткое сглаживание, а не скачок, как и у мастера: ползунки двигают громкость, пока звучат
  // гул и музыка, и мгновенная ступенька щёлкала бы.
  const music = channelVolume(settings, 'music');
  if (music !== applied.music) {
    musicChannelNode.gain.setTargetAtTime(music, now, 0.01);
    applied.music = music;
  }
  const sfx = channelVolume(settings, 'sfx');
  if (sfx !== applied.sfx) {
    sfxNode.gain.setTargetAtTime(sfx, now, 0.01);
    applied.sfx = sfx;
  }
  return { ctx, sfx: sfxNode, musicBus: musicNode };
}

/** Длина хвоста реверберации: за это время он падает на 60 дБ. */
const REVERB_SEC = 2.4;
/** Предзадержка: первые отражения чуть позже прямого звука, и нота не размывается в атаке. */
const REVERB_PREDELAY_SEC = 0.015;
/** Громкость хвоста относительно сухого сигнала (по мощности белого шума). */
const REVERB_WET = 0.3;
/** Сглаживание отклика однополюсным фильтром: тёмный хвост вместо шипящего, около 2 кГц. */
const REVERB_DAMP = 0.25;

/**
 * Импульсный отклик «комнаты»: затухающий стереошум, собранный в коде, как и всё звучание игры.
 *
 * Каналы шумят независимо, поэтому хвост расходится по стереобазе, даже если нота моно.
 * Отклик нормирован вручную до `REVERB_WET`: нормировка браузера подгоняла бы его громкость к
 * единице, а реверберация должна лежать под нотами, а не рядом с ними.
 */
function reverbImpulse(ctx: AudioContext): AudioBuffer {
  const length = Math.ceil(ctx.sampleRate * REVERB_SEC);
  const predelay = Math.floor(ctx.sampleRate * REVERB_PREDELAY_SEC);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    let smooth = 0;
    let energy = 0;
    for (let i = 0; i < length; i += 1) {
      const t = (i - predelay) / ctx.sampleRate;
      smooth += REVERB_DAMP * (Math.random() * 2 - 1 - smooth);
      // −60 дБ к концу отклика: exp(−6.9) ≈ 0.001.
      data[i] = i < predelay ? 0 : smooth * Math.exp((-6.9 * t) / (REVERB_SEC - REVERB_PREDELAY_SEC));
      energy += data[i] * data[i];
    }
    const scale = energy > 0 ? REVERB_WET / Math.sqrt(energy) : 0;
    for (let i = 0; i < length; i += 1) data[i] *= scale;
  }
  return impulse;
}

/**
 * Шина для эффекта: мьют и скрытая страница не создают даже контекста, лишний звук всё равно не
 * прозвучит. Экспортируется ради sfx.ts: вторая такая проверка там разошлась бы с этой.
 */
export function effectBus(settings: SoundSettings): AudioBus | null {
  if (settings.muted || hidden) return null;
  return audioBus(settings);
}

/**
 * Шина для сигнала, который приходит из тика, а не от нажатия: только на уже звучащем контексте.
 *
 * До первого жеста контекст стоит, его время не идёт, и такие сигналы копились бы на одном
 * моменте, чтобы выстрелить пачкой на первом касании. Сигнал от нажатия так не ограничен: само
 * нажатие и будит контекст.
 */
export function runningBus(settings: SoundSettings): AudioBus | null {
  const bus = effectBus(settings);
  return bus && bus.ctx.state === 'running' ? bus : null;
}

/**
 * Антитрещотка Кликов.
 *
 * Игрок, который молотит по кнопке, даёт до восьми звуков в секунду: на прежней фиксированной
 * громкости это уже не отклик, а треск. Поэтому одиночный Клик тише прежнего (0.08 → 0.045), а чем
 * короче пауза до следующего, тем тише он звучит — вплоть до CLICK_MIN_LEVEL: чем чаще жмёшь, тем
 * меньше шума на кнопку. Полного молчания нет намеренно: клик без звука читается как сломанная
 * кнопка, поэтому тихий пол всё равно слышен.
 *
 * Счётчик живёт на модуле, а не в состоянии игры: он отвечает на «как давно был клик», а не на
 * состояние забега, и в сейв ему не место. Отдельного интервала нет и здесь — окно считается по
 * времени предыдущего клика, тем же приёмом, что lastTemplateIndex в сторе.
 */
const CLICK_STREAK_WINDOW_MS = 250;
const CLICK_LEVEL = 0.045;
const CLICK_MIN_LEVEL = 0.012;
let lastClickAt = 0;

/**
 * Громкость Клика по паузе до предыдущего: чем меньше пауза, тем тише клик.
 *
 * Чистая функция: правило антитрещотки проверяется тестом без AudioContext и без часов.
 */
export function clickVolumeForStreak(streakMs: number): number {
  if (Number.isNaN(streakMs)) return CLICK_LEVEL;
  const t = Math.min(1, Math.max(0, streakMs / CLICK_STREAK_WINDOW_MS));
  return CLICK_MIN_LEVEL + (CLICK_LEVEL - CLICK_MIN_LEVEL) * t;
}

/**
 * Голос синтезатора: осциллятор, экспоненциальная огибающая в 0.001 и, по желанию, фильтр.
 *
 * Голос — единственное место, где живёт правило огибающей: и одноразовые эффекты, и ноты лупа из
 * music.ts собираются через него, поэтому «экспонента в 0.001» не может разъехаться по файлам.
 * Все времена — в секундах AudioContext.
 */
export interface Voice {
  ctx: AudioContext;
  /** Куда подключать: мастер-шина эффекта или музыкальная шина лупа. */
  out: AudioNode;
  wave: OscillatorType;
  /** Точки частоты: первая звучит с начала, остальные — в указанное время. Одна точка = ровный тон. */
  freq: readonly (readonly [at: number, hz: number])[];
  start: number;
  /** Длина огибающей: столько же живёт осциллятор. */
  dur: number;
  level: number;
  /** Соединять соседние точки частоты экспонентой. false — ступенчато, как у покупки. */
  glide?: boolean;
  filter?: { type: BiquadFilterType; freq: number; freqTo?: number; q: number };
  /** Плавный вход с нуля, в секундах. Без него голос начинается сразу с `level`, как щелчок эффекта. */
  attack?: number;
  /** Сколько секунд после входа голос держит `level`, прежде чем начать спадать. */
  hold?: number;
  /** Расстройка в центах: два голоса на одной ноте с разной расстройкой звучат шире одного. */
  detune?: number;
  /**
   * Куда спадает огибающая, вместо 0.001. Тихому голосу музыки 0.001 — это пятая часть его
   * уровня, и обрыв осциллятора на ней слышен щелчком; ему нужен спад относительно себя.
   */
  fadeTo?: number;
}

export function playVoice(t: Voice): void {
  const osc = t.ctx.createOscillator();
  const gain = t.ctx.createGain();

  osc.type = t.wave;
  osc.frequency.setValueAtTime(t.freq[0][1], t.start);
  for (let i = 1; i < t.freq.length; i += 1) {
    const [at, hz] = t.freq[i];
    if (t.glide === false) osc.frequency.setValueAtTime(hz, t.start + at);
    else osc.frequency.exponentialRampToValueAtTime(hz, t.start + at);
  }
  if (t.detune) osc.detune.setValueAtTime(t.detune, t.start);
  const attack = t.attack ?? 0;
  if (attack > 0) {
    gain.gain.setValueAtTime(0, t.start);
    gain.gain.linearRampToValueAtTime(t.level, t.start + attack);
  } else {
    gain.gain.setValueAtTime(t.level, t.start);
  }
  if (t.hold) gain.gain.setValueAtTime(t.level, t.start + attack + t.hold);
  gain.gain.exponentialRampToValueAtTime(t.fadeTo ?? 0.001, t.start + t.dur);

  osc.connect(gain);
  let tail: AudioNode = gain;
  if (t.filter) {
    const filter = t.ctx.createBiquadFilter();
    filter.type = t.filter.type;
    filter.Q.value = t.filter.q;
    filter.frequency.setValueAtTime(t.filter.freq, t.start);
    if (t.filter.freqTo) filter.frequency.exponentialRampToValueAtTime(t.filter.freqTo, t.start + t.dur);
    gain.connect(filter);
    tail = filter;
  }
  tail.connect(t.out);

  osc.start(t.start);
  osc.stop(t.start + t.dur);
}

/** Две секунды белого шума: из него делаются удары, шипение и гул Температуры. */
const NOISE_SEC = 2;
let noise: AudioBuffer | null = null;

/**
 * Буфер шума, один на страницу.
 *
 * Шум всегда один и тот же, поэтому одноразовые удары начинают его со случайного сдвига: иначе
 * два удара подряд звучали бы как два одинаковых сэмпла.
 */
export function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (!noise) {
    noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * NOISE_SEC), ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }
  return noise;
}

export interface Noise {
  ctx: AudioContext;
  out: AudioNode;
  start: number;
  dur: number;
  level: number;
  filter: { type: BiquadFilterType; freq: number; freqTo?: number; q: number };
  /** Плавный вход с нуля, в секундах: мягкий удар щёткой вместо щелчка. */
  attack?: number;
  /** Куда спадает огибающая, вместо 0.001: как у `Voice`. */
  fadeTo?: number;
}

/** Шумовой удар: отфильтрованный кусок общего буфера шума. Отдаётся music.ts для щёточного малого. */
export function playNoise(n: Noise): void {
  const src = n.ctx.createBufferSource();
  const filter = n.ctx.createBiquadFilter();
  const gain = n.ctx.createGain();

  src.buffer = noiseBuffer(n.ctx);
  filter.type = n.filter.type;
  filter.Q.value = n.filter.q;
  filter.frequency.setValueAtTime(n.filter.freq, n.start);
  if (n.filter.freqTo) filter.frequency.exponentialRampToValueAtTime(n.filter.freqTo, n.start + n.dur);
  if (n.attack) {
    gain.gain.setValueAtTime(0, n.start);
    gain.gain.linearRampToValueAtTime(n.level, n.start + n.attack);
  } else {
    gain.gain.setValueAtTime(n.level, n.start);
  }
  gain.gain.exponentialRampToValueAtTime(n.fadeTo ?? 0.001, n.start + n.dur);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(n.out);

  src.start(n.start, Math.random() * Math.max(0, NOISE_SEC - n.dur), n.dur);
  src.stop(n.start + n.dur);
}

/**
 * Подъём высоты Клика по уровню Серии, в полутонах: мажорная пентатоника от основной ноты.
 * Не равномерные ступени, а ноты лада, поэтому быстрая Серия звучит как мелодия вверх, а не как
 * сирена. Индекс — уровень Серии; значение за краем таблицы берётся с её края.
 */
const CLICK_SEMITONES = [0, 2, 4, 7, 9];

/** Во сколько раз Клик уровня `level` выше Клика вне Серии. */
export function clickPitchRatio(level: number): number {
  const i = Math.min(CLICK_SEMITONES.length - 1, Math.max(0, Math.floor(Number.isFinite(level) ? level : 0)));
  return 2 ** (CLICK_SEMITONES[i] / 12);
}

/**
 * Клик: мягкий деревянный «ток», выше с уровнем Серии. Громкость — по антитрещотке, паузе до
 * предыдущего клика.
 *
 * Клик — самый частый звук игры, его слышат тысячи раз за Забег. Прежний квадратный взлёт
 * 320→740 Гц звучал как писк лазера и через минуту резал ухо. Теперь это треугольник за фильтром,
 * который за 25 мс оседает на тон ниже, — так звучит молоточек по дереву, а не сигнал.
 * Основная нота — G4: её пентатоника (G A B D E) целиком лежит в до мажоре музыки первого
 * Поколения, и быстрая Серия звучит заодно с лупом.
 */
const CLICK_BASE_HZ = 392;
/** На сколько выше ноты начинается удар: два полутона, осевшие за CLICK_SETTLE_SEC. */
const CLICK_STRIKE_RATIO = 2 ** (2 / 12);
const CLICK_SETTLE_SEC = 0.025;
const CLICK_DUR_SEC = 0.12;

export function playClickSound(settings: SoundSettings, level = 0): void {
  const bus = effectBus(settings);
  if (!bus) return;
  const now = Date.now();
  const vol = clickVolumeForStreak(now - lastClickAt);
  lastClickAt = now;
  const hz = CLICK_BASE_HZ * clickPitchRatio(level);

  playVoice({
    ctx: bus.ctx,
    out: bus.sfx,
    wave: 'triangle',
    freq: [
      [0, hz * CLICK_STRIKE_RATIO],
      [CLICK_SETTLE_SEC, hz],
    ],
    start: bus.ctx.currentTime,
    dur: CLICK_DUR_SEC,
    // 2 мс входа снимают щелчок фронта, но удар остаётся ударом.
    attack: 0.002,
    level: vol,
    fadeTo: vol * 0.001,
    filter: { type: 'lowpass', freq: 1800, q: 0.5 },
  });
}

/**
 * Мягкая огибающая для сигналов: вход за несколько миллисекунд и спад на 60 дБ ниже своего
 * уровня. Все сигналы ниже звучат в одной манере, как набор одного инструмента: ни щелчка на
 * фронте, ни обрыва на хвосте.
 */
function soft(level: number, attack = 0.004): Pick<Voice, 'attack' | 'level' | 'fadeTo'> {
  return { attack, level, fadeTo: level * 0.001 };
}

/*
 * Палитра сигналов.
 *
 * Все сигналы — синус и треугольник, где нужно — за фильтром нижних частот: квадрат и пила
 * звенели поверх спокойной музыки, как будильник в библиотеке. Высоты взяты из до мажора, в
 * котором играет луп первого Поколения, поэтому сигнал ложится на музыку, а не спорит с ней.
 * Различаются сигналы не резкостью, а мелодией, длиной и регистром.
 */

/** Покупка: две мягкие ноты A4 → E5 — подтверждение без праздника. */
export function playBuySound(settings: SoundSettings): void {
  const bus = effectBus(settings);
  if (!bus) return;
  const now = bus.ctx.currentTime;

  playVoice({
    ctx: bus.ctx,
    out: bus.sfx,
    wave: 'triangle',
    freq: [[0, 440], [0.06, 659.25]],
    glide: false,
    start: now,
    dur: 0.18,
    ...soft(0.07),
    filter: { type: 'lowpass', freq: 2000, q: 0.5 },
  });
}

/** Апгрейд: восходящее арпеджио C5–E5–G5–C6 — арфа, а не чиптюн. */
export function playUpgradeSound(settings: SoundSettings): void {
  const bus = effectBus(settings);
  if (!bus) return;
  const now = bus.ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6

  notes.forEach((freq, idx) => {
    playVoice({
      ctx: bus.ctx,
      out: bus.sfx,
      wave: 'sine',
      freq: [[0, freq]],
      start: now + idx * 0.055,
      dur: 0.35,
      ...soft(0.05),
    });
  });
}

/**
 * Престиж: медленно раскрывающийся аккорд плюс арпеджио-мост.
 *
 * Второй слой нужен, потому что подъём умирает раньше, чем живёт оверлей (2.6 с), и хвост
 * оставался бы немым. Подъём — не пилообразный свип 150→1200 Гц, как раньше, а пара
 * расстроенных треугольников на C4, у которых открывается фильтр: торжество слышно как
 * рассвет, а не как взлёт ракеты.
 */
export function playPrestigeSound(settings: SoundSettings): void {
  const bus = effectBus(settings);
  if (!bus) return;
  const now = bus.ctx.currentTime;

  for (const detune of [-7, 7]) {
    playVoice({
      ctx: bus.ctx,
      out: bus.sfx,
      wave: 'triangle',
      freq: [[0, 261.63]],
      start: now,
      dur: 1.1,
      detune,
      ...soft(0.045, 0.25),
      filter: { type: 'lowpass', freq: 400, freqTo: 1800, q: 0.6 },
    });
  }

  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
  notes.forEach((freq, idx) => {
    playVoice({
      ctx: bus.ctx,
      out: bus.sfx,
      wave: 'sine',
      freq: [[0, freq]],
      start: now + 0.35 + idx * 0.13,
      dur: 0.4,
      ...soft(0.055),
    });
  });
}

/**
 * Достижение: восходящее арпеджио A4–C5–E5–A5 — ля минор, в отличие от мажорного Престижа.
 * Треугольник за фильтром звучит как деревянный колокольчик и не путается с синусовой арфой
 * Апгрейда.
 */
export function playAchievementSound(settings: SoundSettings): void {
  const bus = effectBus(settings);
  if (!bus) return;
  const now = bus.ctx.currentTime;
  const notes = [440, 523.25, 659.25, 880]; // A4, C5, E5, A5

  notes.forEach((freq, idx) => {
    playVoice({
      ctx: bus.ctx,
      out: bus.sfx,
      wave: 'triangle',
      freq: [[0, freq]],
      start: now + idx * 0.08,
      dur: 0.32,
      ...soft(0.05),
      filter: { type: 'lowpass', freq: 2200, q: 0.5 },
    });
  });
}

/**
 * Сигнал, что появилось Событие.
 *
 * Отдельный тембр, а не ещё один вызов playUpgradeSound: этот сигнал игрок обязан узнать на слух
 * из соседней вкладки, а привычка «звук = покупка» сбила бы его с толку. Ноты E5–B5–E6 идут
 * квинтой вверх и квартой — такой ход не совпадает ни с арпеджио Апгрейда, ни с покупкой,
 * поэтому сигнал узнаётся, а не путается. Синус вместо квадрата: стеклянный звон узнаётся не
 * хуже писка, но не дёргает.
 *
 * Жест игрока здесь тот же, что у всех остальных звуков: `getAudioContext` сам пробует resume,
 * и если AudioContext остался suspended, сигнал просто не прозвучит. Это не баг, который надо
 * чинить: браузер не даёт звучать без жеста, и никакой код этого не обойдёт.
 */
export function playEventAlertSound(settings: SoundSettings): void {
  const bus = runningBus(settings);
  if (!bus) return;
  const now = bus.ctx.currentTime;

  // E5, B5, E6: последняя нота тянется дольше предыдущих — окно короткое, и хвост нужен,
  // чтобы сигнал не оборвался на полуфразе.
  [659.25, 987.77, 1318.51].forEach((freq, idx) => {
    const hold = idx === 2 ? 0.45 : 0.14;
    playVoice({
      ctx: bus.ctx,
      out: bus.sfx,
      wave: 'sine',
      freq: [[0, freq]],
      start: now + idx * 0.08,
      dur: hold,
      ...soft(0.05, 0.005),
    });
  });
}

/** Отказ по недоступной покупке: низкий мягкий «бум» вниз, а не высокий тик — высокий тик совпал
 *  бы с покупкой и читался бы как подтверждение, а не как отказ. */
export function playDenySound(settings: SoundSettings): void {
  const bus = effectBus(settings);
  if (!bus) return;

  playVoice({
    ctx: bus.ctx,
    out: bus.sfx,
    wave: 'triangle',
    freq: [[0, 196], [0.12, 130.81]],
    start: bus.ctx.currentTime,
    dur: 0.15,
    ...soft(0.07),
    filter: { type: 'lowpass', freq: 700, q: 0.5 },
  });
}

/**
 * Перестук поверх реплики говорящей Модели.
 *
 * Шесть коротких капель через 35 мс: реплика «печатается» очередью, а не нотой. Прежние
 * квадратные блёстки на 1.7–2.6 кГц стрекотали, как сломанный принтер; теперь это синусы из
 * пентатоники G5–E6, тише одиночного Клика вдвое — перестук идёт поверх него на том же нажатии и
 * не должен его перекрикивать. Как остальные: при muted молчит, а при suspended AudioContext
 * просто не звучит — жеста не было, и это не баг.
 */
export function playQuipSound(settings: SoundSettings): void {
  const bus = effectBus(settings);
  if (!bus) return;
  const now = bus.ctx.currentTime;
  const ticks = [1046.5, 880, 1174.66, 783.99, 1318.51, 1046.5]; // C6 A5 D6 G5 E6 C6

  ticks.forEach((freq, idx) => {
    playVoice({
      ctx: bus.ctx,
      out: bus.sfx,
      wave: 'sine',
      freq: [[0, freq]],
      start: now + idx * 0.035,
      dur: 0.04,
      ...soft(0.022, 0.003),
    });
  });
}

/**
 * Удар по Глюку: глухой шлепок по мягкому паразиту.
 *
 * Удар и лопание слышатся попарно, поэтому разводить их приходится по трём осям сразу: удар —
 * тёмный шум плюс низкий треугольник (тук), лопание — «хлоп» вниз и россыпь верхних нот. И то и
 * другое мягче отказа по покупке, но отличается от него тембром: здесь шум, а не нота.
 */
export function playGlitchHitSound(settings: SoundSettings): void {
  const bus = effectBus(settings);
  if (!bus) return;
  const now = bus.ctx.currentTime;

  playNoise({
    ctx: bus.ctx,
    out: bus.sfx,
    start: now,
    dur: 0.07,
    attack: 0.003,
    level: 0.03,
    fadeTo: 0.00003,
    filter: { type: 'lowpass', freq: 900, q: 0.5 },
  });
  playVoice({
    ctx: bus.ctx,
    out: bus.sfx,
    wave: 'triangle',
    freq: [[0, 200], [0.08, 100]],
    start: now,
    dur: 0.08,
    ...soft(0.045, 0.003),
  });
}

/**
 * Лопание Глюка: хлоп с россыпью. От удара отличается всем — выше по регистру, длиннее, с хвостом из
 * верхних бликов, поэтому лопнувший паразит слышен и в соседней вкладке, а удары по нему остаются
 * локальной отметкой. Блики — ноты пентатоники, а не случайные частоты: россыпь звучит
 * как перебор колокольчиков, а не как треск.
 */
export function playGlitchPopSound(settings: SoundSettings): void {
  const bus = effectBus(settings);
  if (!bus) return;
  const now = bus.ctx.currentTime;

  playVoice({
    ctx: bus.ctx,
    out: bus.sfx,
    wave: 'triangle',
    freq: [[0, 620], [0.1, 200]],
    start: now,
    dur: 0.1,
    ...soft(0.06, 0.003),
    filter: { type: 'lowpass', freq: 1500, q: 0.5 },
  });
  playNoise({
    ctx: bus.ctx,
    out: bus.sfx,
    start: now,
    dur: 0.08,
    attack: 0.003,
    level: 0.02,
    fadeTo: 0.00002,
    filter: { type: 'bandpass', freq: 1200, q: 0.7 },
  });
  [783.99, 1046.5, 1318.51, 1046.5, 1567.98].forEach((freq, idx) => {
    playVoice({
      ctx: bus.ctx,
      out: bus.sfx,
      wave: 'sine',
      freq: [[0, freq]],
      start: now + 0.06 + idx * 0.04,
      dur: 0.12,
      ...soft(0.03, 0.003),
    });
  });
}

/**
 * Крах: красное Событие отнимает Токены, поэтому оно должно звучать серьёзнее любой находки.
 *
 * Расходящийся вниз двойной свип с расстроенной парой и закрывающимся фильтром: падение вниз
 * читается как потеря, а низкая полка фильтра убирает из звука игривость обычного События.
 * Тревога здесь — в направлении и длине, а не в резкости: прежняя пила с четвертьтоновым
 * биением «не отпускала ухо», и это и было проблемой. Длина 0.55 с — вдвое больше любого
 * короткого сигнала, чтобы потеря успела отзвучать вместе с экраном.
 */
export function playCrashSound(settings: SoundSettings): void {
  const bus = effectBus(settings);
  if (!bus) return;
  const now = bus.ctx.currentTime;

  for (const [from, to] of [
    [329.63, 82.41],
    [331.5, 82.9],
  ]) {
    playVoice({
      ctx: bus.ctx,
      out: bus.sfx,
      wave: 'triangle',
      freq: [[0, from], [0.5, to]],
      start: now,
      dur: 0.55,
      ...soft(0.05, 0.01),
      filter: { type: 'lowpass', freq: 800, freqTo: 220, q: 0.5 },
    });
  }
  playNoise({
    ctx: bus.ctx,
    out: bus.sfx,
    start: now,
    dur: 0.3,
    attack: 0.01,
    level: 0.035,
    fadeTo: 0.000035,
    filter: { type: 'lowpass', freq: 400, q: 0.5 },
  });
}

/**
 * Финал контента: восходящая пентатоника с долгой последней нотой.
 *
 * Финал не должен звучать как Престиж или Достижение: там короткое торжество, здесь — точка.
 * Поэтому арпеджио длиннее и выше (до E6), а последняя нота тянется втрое дольше прочих и
 * продублирована квинтой — так короткое окно экрана ещё звучит, когда его уже закрыли.
 */
export function playFinaleSound(settings: SoundSettings): void {
  const bus = effectBus(settings);
  if (!bus) return;
  const now = bus.ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 880, 1046.5, 1318.51]; // C5, E5, G5, A5, C6, E6

  notes.forEach((freq, idx) => {
    const last = idx === notes.length - 1;
    playVoice({
      ctx: bus.ctx,
      out: bus.sfx,
      wave: 'triangle',
      freq: [[0, freq]],
      start: now + idx * 0.1,
      dur: last ? 0.6 : 0.3,
      ...soft(0.055),
      filter: { type: 'lowpass', freq: 2500, q: 0.5 },
    });
  });
  // Квинта под последней нотой (A5 под E6) держит звук на месте, когда игрок уже закрыл окно.
  playVoice({
    ctx: bus.ctx,
    out: bus.sfx,
    wave: 'sine',
    freq: [[0, 880]],
    start: now + 0.5,
    dur: 0.6,
    ...soft(0.035, 0.02),
  });
}

/**
 * Рестарт: всё, что набежало, стёрто.
 *
 * Свип вниз сквозь закрывающийся фильтр и низкий подвал под ним. От отказа отличается регистром
 * и длиной, от Краха — ровностью: у рестарта нет расстроенной пары, потому что это не потеря,
 * а осознанный возврат к нулю.
 */
export function playRestartSound(settings: SoundSettings): void {
  const bus = effectBus(settings);
  if (!bus) return;
  const now = bus.ctx.currentTime;

  playVoice({
    ctx: bus.ctx,
    out: bus.sfx,
    wave: 'triangle',
    freq: [[0, 523.25], [0.2, 164.81]],
    start: now,
    dur: 0.22,
    ...soft(0.06),
    filter: { type: 'lowpass', freq: 1200, freqTo: 400, q: 0.5 },
  });
  playVoice({
    ctx: bus.ctx,
    out: bus.sfx,
    wave: 'sine',
    freq: [[0, 130.81], [0.24, 65.41]],
    start: now + 0.16,
    dur: 0.26,
    ...soft(0.05, 0.01),
  });
}
