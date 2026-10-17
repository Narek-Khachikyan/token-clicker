import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motionAllowed, useGameStore, useStateSlice } from '../store/useGameStore';
import { glitchesOf, labBoothLabels, labCardView, ruleStatusText } from '../store/selectors';
import { CATALOG } from '../economy/catalog';
import { LABS, LAB_IDS, type LabId } from '../data/labs';
import { canPrestige, isContentFinale } from '../economy/engine';
import { labAgents } from '../economy/upgrades';
import { generationRule } from '../economy/rules';
import { courseById } from '../data/courses';
import { formatCount, formatNumber } from '../economy/format';
import { Hint } from './Hint';
import { Icon } from './Icon';
import { MascotSprite } from './MascotSprite';
import { Num } from './Num';
import { STATION_SURFACE_ROW, WorkstationSprite } from './WorkstationSprite';
import { QuipLogModal, SceneQuipBubble } from './QuipBubble';
import { SceneDrone, SceneGlitchBand } from './SceneEvents';
import { GLITCH_CLICKS } from '../economy/glitches';
import { GlitchPopSprite, GlitchSprite } from './EventSprites';
import {
  MASCOT_CARD_GAP,
  mascotCardBottom,
  mascotCardLeft,
  mascotCardWidth,
  OFFICE_COL_MIN,
  SCENE_MIN_H,
} from '../layout';
import { sceneFilter, sceneFloorGradient, sceneGrade, sceneHeatLayers } from '../render/sceneGrade';

// Сцен четыре, по два Поколения на каждую (ADR-0002), поэтому индекс Сцены —
// floor(Поколение / 2). Список имён выводится из количества, а не дублируется руками:
// иначе четвёртая Сцена и её файл разъехались бы при добавлении пятой.
const SCENE_COUNT = 4;
const SCENE_SRC = Array.from({ length: SCENE_COUNT }, (_, i) => `/scenes/scene-${i + 1}.png`);

// Жёсткий контур вокруг счётчика Агентов поверх Сцены. Не плашка: она закрывала бы пол Сцены
// прямоугольником, а контур из четырёх смещений держит читаемость на любом фоне, не добавляя
// подложки. Тот же приём, что у .floater.
const BADGE_OUTLINE = '1px 0 0 #000, -1px 0 0 #000, 0 1px 0 #000, 0 -1px 0 #000, 0 2px 3px #000';

// Контактная тень под рабочим местом. Живёт здесь, а не в WorkstationSprite: тень —
// свойство стоящего в комнате, а не спрайта.
//
// Плоский эллипс, а не filter: drop-shadow() обводит силуэт по альфе и оставляет ореол
// вокруг всех внутренних пробелов блочного спрайта. 0.38 выбрано как середина рабочего
// диапазона: 0.30 уже не читается на почти чёрном полу Сцены 4, а 0.45 на светлом полу
// Сцены 2 превращается в яму. Тот же чёрный, что у --bg-scrim и контура .floater.
const CONTACT_SHADOW = 'rgba(0, 0, 0, 0.38)';

const MASCOT_SIZE = 48;

// Нижняя граница ширины колонки ленты Маскотов, и число колонок на этот раз считает сама
// сетка: фиксированный repeat() на 320 px делил восемь колонок по 33 px, и Маскоты в 48 px
// наезжали друг на друга, а крайние ещё и обрезались краями Сцены. Порог задаёт не Маскот,
// а его счётчик — самая широкая обычная строка formatNumber, «×1.23e300» в sci, это 63.5 px
// в Nunito 12.8 px (замерено; контур text-shadow рисуется поверх и места не занимает). Восемь таких колонок — 512 px —
// влезают в Сцену десктопа, поэтому там все восемь Лабораторий по-прежнему стоят в ряд.
//
// Порог нельзя опустить и ниже 64 px: стол занимает колонку целиком, и при 56 px
// восемь столов в ряд уже не поместились бы — мебель оказалась бы уже мебели.
const MASCOT_COL_MIN = 64;

// Ширина стола равна ширине колонки: спрайт 32 px сетки тянется на всю колонку,
// поэтому восемь мест занимают ряд ровно и не наезжают друг на друга — граница
// между столами проходит по границе колонок сетки, а не по нарисованной кромке.
const STATION_W = MASCOT_COL_MIN;

/** Высота стола: из пропорции сетки 32:16, как у самого спрайта. */
const STATION_H = Math.round((STATION_W * 16) / 32);

/**
 * Ноги Маскота стоят на 83% его бокса — та же средняя линия, что и раньше: ступни
 * восьми Маскотов стоят вразброс от 70% (краб, кит) до 87% (капибара, вихрь).
 * Линия столешницы приводится в эту точку, и стол перекрывает Маскота ровно по
 * щиколотку: корпус и руки видны, ноги стоят за тумбой.
 */
const MASCOT_FEET_Y = Math.round(MASCOT_SIZE * 0.83);

/** Смещение верха стола от верха бокса Маскота: столешница встаёт на линию ног. */
const STATION_TOP = MASCOT_FEET_Y - Math.round((STATION_H * STATION_SURFACE_ROW) / 12);

/** Высота бокса места: стол уходит ниже ног Маскота, и это место занимает его целиком. */
const BOOTH_H = STATION_TOP + STATION_H;

// Тень под столом, а не под Маскотом: на полу стоит мебель, и её контактная тень
// шире Маскота. Геометрия выведена из STATION_W, а не зашита пикселями — тень
// обязана переехать вместе со столом при любой смене размера.
const SHADOW_W = STATION_W * 0.86;
const SHADOW_H = STATION_H / 3;
// Ось эллипса — под нижней строкой стола: ножки тумбы стоят в строке 11 сетки,
// и тень накрывает их вместе с полом под ними, поэтому столы нигде не отрываются
// от пола Сцены.
const SHADOW_CENTER_Y = BOOTH_H - SHADOW_H / 2;

// Пыль в воздухе Сцены: точки, которые делают кадр живым, а не статичным. Таблица строится
// один раз на модуль и сразу на максимум точек: Math.random в теле компонента перемешивал бы
// пыль на каждой перерисовке офиса.
const MOTE_MIN = 18;
const MOTE_MAX = 36;
const MOTES = Array.from({ length: MOTE_MAX }, (_, i) => {
  // Золотое сечение по двум осям: ряд равномерный, но не в сетке — по сетке пыль читалась бы
  // как узор, а не как воздух.
  const x = ((i * 0.618034) % 1) * 96;
  const y = 1 - ((i * 0.381966 + 0.17) % 1) * 0.92;
  const dur = 6 + (i % 4) * 0.9;
  return {
    left: `${x.toFixed(2)}%`,
    bottom: `${(y * 100).toFixed(2)}%`,
    size: 2 + (i % 3),
    // Четные плывут влево, нечётные вправо: соседние точки не идут в одну сторону.
    dx: `${(i % 2 ? 1 : -1) * (8 + (i % 4) * 5)}px`,
    dy: `-${18 + (i % 5) * 7}px`,
    dur: `${dur.toFixed(1)}s`,
    // Отрицательные задержки: пыль уже в пути на первом кадре, а не начинает движение
    // спустя первые шесть секунд.
    delay: `-${(((i * 1.7) % dur)).toFixed(2)}s`,
  };
});

const moteStyle = (i: number): React.CSSProperties =>  ({
    left: MOTES[i].left,
    bottom: MOTES[i].bottom,
    width: MOTES[i].size,
    height: MOTES[i].size,
    '--mote-dx': MOTES[i].dx,
    '--mote-dy': MOTES[i].dy,
    '--mote-dur': MOTES[i].dur,
    '--mote-delay': MOTES[i].delay,
  }) as React.CSSProperties;

// Плотность пыли растёт вместе с офисом: пустой кадр не должен выглядеть гуще забитого.
// Шкала логарифмическая, потому что Агентов бывает и тысяча, и 1e300, а длина округляется
// до целого — иначе список узлов пересоздавался бы на каждой покупке.
const moteCount = (agents: number): number => {
  // До первого найма Сцена не должна быть мёртвой: держим активный воздух (24 мотылька),
  // чтобы пустой офис дышал и жил с первых секунд игры.
  if (agents === 0) return 24;
  const full = Math.min(Math.max(Math.log10(agents + 1) / 4, 0), 1);
  return Math.round(MOTE_MIN + (MOTE_MAX - MOTE_MIN) * full);
};

// Конфетти праздника Флагмана: 28 квадратов, число не растёт ни с Агентами, ни с Поколением.
// Угол и дальность разводит золотой угол, как у веера Достижения (Toasts.tsx): по равномерной
// сетке веер встал бы розеткой. Все летят вверх (dy < 0) и расходятся в стороны; таблица строится
// один раз на модуль, а не на каждый рендер.
const CONFETTI_COUNT = 28;
const CONFETTI = Array.from({ length: CONFETTI_COUNT }, (_, i) => {
  const spread = (((i * 0.618034) % 1) * 2 - 1) * 110;
  return {
    dx: Math.round(spread),
    dy: -(70 + ((i * 7) % 11) * 10),
    size: 6 + (i % 2) * 2,
    // Задержка до 0.3 с: конфетти выстреливает волной, а не одним кадром.
    delay: ((i * 3) % 10) * 0.03,
  };
});

const GLITCH_SIZE = 28;
const DARK_STRIP = 'var(--bg-void)';

const GLITCH_CHIP = {
  backgroundColor: DARK_STRIP,
  border: 'var(--frame-w) solid var(--border)',
  color: 'var(--text-main)',
  fontSize: 'var(--text-xs)',
  lineHeight: 1.4,
  padding: '0 var(--space-1)',
} as const;

interface PoppedGlitchItem {
  id: number;
  nonce: number;
}

let glitchNonceCounter = 0;

/** Паразиты на Сцене: отклик на удар через масштаб и яркость, при лопании — мгновенный разлёт пикселей. */
const OfficeGlitchSwarm: React.FC = () => {
  const glitches = useStateSlice(glitchesOf);
  const hitGlitch = useGameStore((s) => s.hitGlitch);
  const notation = useGameStore((s) => s.state.settings.notation);

  // Лопнувшие Глюки: кратковременный локальный отклик в точке лопания до 0.4с.
  const [popped, setPopped] = useState<PoppedGlitchItem[]>([]);
  const [hitNonces, setHitNonces] = useState<Record<number, number>>({});

  const handleGlitchHit = (gId: number, clicks: number) => {
    const left = GLITCH_CLICKS - clicks;
    if (left <= 1) {
      // 3-й удар — Глюк лопается. В точке лопания создаётся отклик выстрела.
      setPopped((prev) => [...prev, { id: gId, nonce: ++glitchNonceCounter }]);
    } else {
      // Первые удары — отклик через сжатие и яркость, без горизонтальной тряски.
      setHitNonces((prev) => ({ ...prev, [gId]: (prev[gId] ?? 0) + 1 }));
    }
    hitGlitch(gId);
  };

  const removePopped = (nonce: number) => {
    setPopped((prev) => prev.filter((p) => p.nonce !== nonce));
  };

  if (glitches.length === 0 && popped.length === 0) return null;

  return (
    <div
      className="scene__glitches"
      style={{
        position: 'absolute',
        top: '30%',
        left: '6%',
        right: '6%',
        zIndex: 3,
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        alignContent: 'flex-start',
        gap: 'var(--space-2) var(--space-3)',
        pointerEvents: 'none',
      }}
    >
      {glitches.map((g) => {
        const left = GLITCH_CLICKS - g.clicks;
        const nonce = hitNonces[g.id] ?? 0;
        return (
          <Hint
            key={g.id}
            as="span"
            content={`Осталось ${left} ${formatCount(left, 'удар', 'удара', 'ударов', notation)} — кликни, чтобы лопнул`}
            style={{ display: 'flex' }}
          >
            <button
              className="glitch-node"
              onClick={() => handleGlitchHit(g.id, g.clicks)}
              aria-label={`Глюк: осталось ${left} ${formatCount(left, 'удар', 'удара', 'ударов', notation)}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 'var(--space-0)',
                padding: 0,
                background: 'none',
                border: 'none',
                lineHeight: 0,
                cursor: 'pointer',
                pointerEvents: 'auto',
              }}
            >
              <span
                key={nonce}
                className="glitch-jitter"
                style={{
                  display: 'block',
                  lineHeight: 0,
                  // Отклик на удар: масштаб и яркость вместо горизонтальной тряски экрана.
                  animation:
                    nonce > 0
                      ? motionAllowed()
                        ? 'click-squash 0.18s cubic-bezier(0.2, 0.8, 0.3, 1.2)'
                        : 'glitch-hit-fade 0.18s ease-out'
                      : undefined,
                }}
              >
                <GlitchSprite size={GLITCH_SIZE} />
              </span>
              <span style={GLITCH_CHIP}>
                ×<Num>{formatNumber(left, notation)}</Num>
              </span>
            </button>
          </Hint>
        );
      })}

      {/* Лопнувшие Глюки: мгновенный разряд в точке паразита до 0.4с */}
      {popped.map((p) => (
        <div
          key={p.nonce}
          onAnimationEnd={() => removePopped(p.nonce)}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'var(--space-0)',
            pointerEvents: 'none',
            animation: motionAllowed()
              ? 'tab-badge-pulse 0.32s cubic-bezier(0.2, 0.8, 0.3, 1.2) forwards'
              : 'toast-fade 0.25s ease-out forwards',
          }}
        >
          <span style={{ display: 'block', lineHeight: 0, position: 'relative' }}>
            <GlitchPopSprite size={GLITCH_SIZE + 4} />
            {motionAllowed() && (
              <span
                style={{
                  position: 'absolute',
                  inset: '-4px',
                  border: 'var(--frame-w) solid var(--accent-color)',
                  animation: 'burst-fly 0.35s ease-out forwards',
                  pointerEvents: 'none',
                }}
              />
            )}
          </span>
          {/* Подписи рядом нет, поэтому у значка свой текст: иначе для скринридера лопнувший
              Глюк остался бы немой картинкой. */}
          <span
            role="img"
            aria-label="Глюк лопнул"
            style={{
              ...GLITCH_CHIP,
              padding: 'var(--space-0) var(--space-1)',
              lineHeight: 0,
              borderColor: 'var(--green)',
              color: 'var(--green)',
              animation: 'toast-fade 0.25s ease-out forwards',
            }}
          >
            <Icon name="check" />
          </span>
        </div>
      ))}
    </div>
  );
};


/**
 * Стиль картинки Сцены.
 *
 * Общая функция, потому что при кроссфейде рисуются две копии одной и той же сцены, и
 * разъезд оформления между ними был бы виден прямо в момент Престижа — там, где игрок
 * смотрит. Фильтр передаётся параметром: у нижнего кадра он один, у верхнего другой.
 */
const sceneImgStyle = (filter: string): React.CSSProperties => ({
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  objectPosition: 'center',
  display: 'block',
  // Арт 384×256 и растягивается нецелым кратным: без этого он читался бы как мыло.
  imageRendering: 'pixelated',
  userSelect: 'none',
  filter,
});

/** Где стоит карточка Маскота на Сцене: точка в пикселях Сцены, посчитанная из места Маскота. */
interface CardAnchor {
  labId: LabId;
  left: number;
  width: number;
  bottom: number;
  /** Высота Сцены, px: карточка не должна вылезти за её верх. */
  sceneH: number;
}

/**
 * Карточка Лаборатории над Маскотом при наведении или фокусе: Агенты, работа, доля в Доходе и
 * Синергия. Заменила блок «Состав Лабораторий» под Сценой: те же числа, но не отдельная полоса,
 * съедавшая высоту, а подсказка там, куда игрок и так смотрит. Подложка у карточки своя и
 * непрозрачная (ADR-0002), и то же самое — для чтеца с экрана — сказано в подписи кнопки Маскота,
 * поэтому сама карточка от него скрыта и не читается дважды. Подписана на срез, а не на состояние:
 * тик её не перерисовывает.
 */
const MascotCard: React.FC<{ anchor: CardAnchor; showShare: boolean }> = ({ anchor, showShare }) => {
  const view = useStateSlice((s) => labCardView(s, anchor.labId, showShare));
  const lab = LABS[anchor.labId];
  // Высота карточки известна только после вёрстки, а от неё зависит, хватит ли над местом
  // Маскота высоты Сцены: поэтому нижний край уточняется до первой отрисовки, и кадра с
  // карточкой над рамкой игрок не видит.
  const nodeRef = useRef<HTMLDivElement>(null);
  const [bottom, setBottom] = useState(anchor.bottom);
  useLayoutEffect(() => {
    const node = nodeRef.current;
    setBottom(node ? mascotCardBottom(anchor.bottom, node.offsetHeight, anchor.sceneH) : anchor.bottom);
  }, [anchor, view.work, view.share, view.synergy]);
  return (
    <div
      ref={nodeRef}
      className="mascot-card pixel-card"
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: anchor.left,
        bottom,
        width: anchor.width,
        boxSizing: 'border-box',
        zIndex: 5,
        // Подсказка не ловит указатель: иначе она вставала бы между курсором и Маскотом, и
        // наведение мигало бы, а Глюки и Золотой Токен под ней перестали бы ловиться.
        pointerEvents: 'none',
        padding: 'var(--space-2) var(--space-3)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
        animation: 'toast-fade 0.12s ease-out',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        {/* Цвет Лаборатории живёт только здесь: на --bg-panel он не задаёт контраст текста,
            а плашкой служит лишь ориентиром, чья это карточка. */}
        <span
          style={{
            width: '10px',
            height: '10px',
            backgroundColor: lab.color,
            border: 'var(--frame-w) solid var(--border)',
            flexShrink: 0,
          }}
        />
        <span className="pixel-22" style={{ color: 'var(--text-main)' }}>{lab.name}</span>
      </div>
      <div style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>
        ×<Num>{view.agents}</Num> {view.agentsWord}
        {/* Название работы приходит из MODEL_TIERS, а не пишется здесь строкой. */}
        {view.work !== '' && <span style={{ color: 'var(--text-muted)' }}> · {view.work}</span>}
      </div>
      {/* Доля в Доходе — величина сравнительная, и читается она только когда различает: с
          одной Лабораторией она всегда 100%, а ниже процента неотличима от нуля. */}
      {view.share >= 0 && (
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
          Доля в Доходе: <Num>{view.share}</Num>%
        </div>
      )}
      {view.synergy >= 0 && (
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--gold)' }}>
          Синергия: +<Num>{view.synergyText}</Num>% к Доходу всех Моделей {lab.name}
        </div>
      )}
    </div>
  );
};

/**
 * Колонка Офиса: одна Сцена на всю колонку. Цель Поколения, кнопка Престижа и «Переписка» стоят
 * на её HUD-полосе, а Лаборатория, число её Агентов и Синергия — в карточке над Маскотом. Подписана на то, что меняется покупкой и Престижем
 * (Поколение, Агенты, Апгрейды), а не на состояние: тик колонку не перерисовывает, а всё, что на
 * Сцене живёт тиком — Глюки, Дрон, покачивание Маскотов, — подписано на свои срезы само.
 */
const OfficeColumnView: React.FC<{ full?: boolean }> = ({ full = false }) => {
  const generation = useGameStore((s) => s.state.generation);
  const agents = useGameStore((s) => s.state.agents);
  const notation = useGameStore((s) => s.state.settings.notation);
  const quipsSeenCount = useGameStore((s) => s.state.quipsSeen.length);
  // Выключатель частиц из «Настроек»: пыль в воздухе Сцены — один из них.
  const particles = useGameStore((s) => s.state.settings.particles);
  const requestPrestige = useGameStore((s) => s.requestPrestige);
  // Момент награды (вход Маскота, праздник Флагмана): живёт два секунды, и на нём строится весь
  // отклик Сцены. Подписка на сам объект, а не на тик: поле меняется раз за покупку.
  const moment = useGameStore((s) => s.sceneMoment);
  const prestigeReady = useStateSlice(canPrestige);
  const finale = useStateSlice(isContentFinale);
  // Два поля, которых хватает для подсчёта Агентов по Лабораториям: так видно, что от состояния
  // колонке нужны только они.
  const roster = { generation, agents };

  const gen = CATALOG[generation];
  const rule = generationRule(generation);
  // Живая строка Правила (лидер Арены, места в очереди): пустая — и HUD показывает описание Правила.
  const ruleStatus = useStateSlice(ruleStatusText);
  // Курс виден весь Забег: игрок выбрал его один раз и менять не может, а забыть — значит играть вслепую.
  const course = courseById(useGameStore((s) => s.state.course));
  const flagship = gen.flagship;
  const flagshipOwned = (agents[flagship.id] ?? 0) >= 1;

  const sceneIndex = Math.min(Math.floor(generation / 2), SCENE_COUNT - 1);

  // Художественный режим Сцены и жар поверх неё. Оба считаются здесь, а не в разметке: любое
  // из них в состоянии означало бы второй источник правды о том, как выглядит кадр.
  const grade = sceneGrade(sceneIndex);
  const heat = sceneHeatLayers();

  // Кроссфейд Сцены: предыдущий кадр лежит под новым, входящий проявляется
  // opacity 0→1 за 0.4s (класс scene-crossfade--in, только opacity — разрешена
  // и при reducedMotion). Предыдущий убирается по onAnimationEnd входящего,
  // таймеров нет. Пара {prev, curr}, а не очередь: Сцена меняется не чаще,
  // чем игрок жмёт Престиж.
  const [sceneShown, setSceneShown] = useState({ prev: -1, curr: sceneIndex });
  useEffect(() => {
    setSceneShown((s) => (s.curr === sceneIndex ? s : { prev: s.curr, curr: sceneIndex }));
  }, [sceneIndex]);

  // Престиж открывает окно подтверждения, а не выполняется здесь: сброс Забега необратим,
  // и игрок должен увидеть, сколько Compute начислит, что сгорит и в какое Поколение он
  // попадёт. Один путь на обе колонки — свой взвод здесь означал бы два разных подтверждения
  // одного и того же действия. Сам переход живёт в triggerPrestige, его зовёт окно.

  // Прогрев соседних Сцен: без неё Престиж на секунду показывает пустой кадр, потому что
  // кадр начинает грузиться только когда src уже назначен. Вперёд — для следующего
  // Престижа, назад — для возврата взглядом: раньше обратного прелоада не было (аудит).
  // Края массива отсекаются по SCENE_COUNT, чтобы не зациклиться.
  useEffect(() => {
    for (const i of [sceneIndex + 1, sceneIndex - 1]) {
      if (i < 0 || i >= SCENE_COUNT) continue;
      const preload = new Image();
      preload.src = SCENE_SRC[i];
    }
  }, [sceneIndex]);

  const activeLabs = LAB_IDS.filter((l) => labAgents(roster, l) > 0);
  const totalAgents = activeLabs.reduce((sum, l) => sum + labAgents(roster, l), 0);

  // Окно «Переписки» — локальный UI-слой колонки, а не стор: кроме неё оно никому не нужно,
  // а счётчик собранных реплик читается прямо из состояния.
  const [quipLogOpen, setQuipLogOpen] = useState(false);

  // Прыжок Маскота при покупке Агента его Лаборатории. Предыдущие числа — в ref, как
  // prevOwned в ModelRow: отмечать покупку в сторе значило бы гонять эффект по всей колонке
  // на каждом изменении состояния. Сравнение идёт по всем
  // LAB_IDS, а не по activeLabs: иначе появление первой покупки новой Лаборатории (0 → 1)
  // не отличить от первого рендера, и Маскот либо не прыгнул бы, либо прыгнули бы все сразу.
  const prevLabCounts = useRef<Partial<Record<LabId, number>>>({});
  const hopNodes = useRef(new Map<LabId, HTMLDivElement>());
  const [hoppingLabId, setHoppingLabId] = useState<LabId | null>(null);

  useEffect(() => {
    const prev = prevLabCounts.current;
    // Первый замер только запоминает числа: иначе все Маскоты с Агентами прыгнули бы
    // на загрузке сохранения. LAB_IDS статичен, поэтому пустой ref — это ровно первый замер.
    let known = false;
    for (const labId of LAB_IDS) {
      if (prev[labId] !== undefined) {
        known = true;
        break;
      }
    }
    if (!known) {
      for (const labId of LAB_IDS) prev[labId] = labAgents(roster, labId);
      return;
    }
    // Покупка растит ровно одну Лабораторию, поэтому прыгает первая выросшая; импорт
    // сохранения может вырастить несколько сразу — там прыжка одной достаточно, это редкий
    // путь, а не игровой отклик.
    for (const labId of LAB_IDS) {
      const before = prev[labId] ?? 0;
      const now = labAgents(roster, labId);
      prev[labId] = now;
      if (now <= before) continue;
      // Первый Агент Лаборатории не прыгает: Маскот входит (момент награды), а прыжок поверх
      // входа и импорт сохранения, который растит Лабораторию с нуля, лишь мешали бы.
      if (before === 0) continue;
      setHoppingLabId(labId);
      const node = hopNodes.current.get(labId);
      if (!node) continue;
      // Чтение ширины между снятием и возвратом класса — обязательный сброс анимации:
      // иначе быстрая повторная покупка той же Лаборатории не перезапустила бы прыжок,
      // класс ведь не менялся. Тот же приём, что у model-row--pop.
      node.classList.remove('mascot-hop');
      void node.offsetWidth;
      node.classList.add('mascot-hop');
      break;
    }
  }, [agents]);

  // Карточка Маскота: одна на всю Сцену, а не по одной на место. Точка считается в пикселях
  // Сцены при наведении, а не хранится в разметке: ширина Сцены зависит от окна, и карточка
  // над крайним Маскотом обязана остаться внутри (mascotCardLeft).
  const sceneRef = useRef<HTMLDivElement>(null);
  const [card, setCard] = useState<CardAnchor | null>(null);

  const showCard = (labId: LabId, booth: HTMLElement) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const sr = scene.getBoundingClientRect();
    const br = booth.getBoundingClientRect();
    // clientLeft/Top — рамка Сцены: абсолютные дети отсчитываются от внутреннего края.
    const centerX = br.left + br.width / 2 - sr.left - scene.clientLeft;
    const boothTop = br.top - sr.top - scene.clientTop;
    setCard({
      labId,
      width: mascotCardWidth(scene.clientWidth),
      left: mascotCardLeft(centerX, scene.clientWidth),
      bottom: scene.clientHeight - boothTop + MASCOT_CARD_GAP,
      sceneH: scene.clientHeight,
    });
  };
  const hideCard = (labId: LabId) => setCard((cur) => (cur?.labId === labId ? null : cur));

  // На сенсорном экране указатель «уходит» сразу после касания, а фокус кнопка может и не
  // взять, поэтому карточка, открытая касанием, закрывается касанием мимо любого Маскота.
  const cardOpen = card !== null;
  useEffect(() => {
    if (!cardOpen) return;
    const away = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest('.scene__booth')) return;
      setCard(null);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [cardOpen]);

  // Подписи мест Маскотов для чтеца: те же числа, что в карточке (см. labBoothLabels).
  const boothLabels = useStateSlice(labBoothLabels);

  // Подпись цели: одна строка и для экрана, и для title — полное имя Флагмана и условие Престижа.
  const goalHint = flagshipOwned
    ? 'Флагман нанят — Престиж открыт'
    : 'Найми хотя бы 1 Агента Флагмана, чтобы открыть Престиж';

  return (
    <div
      style={{
        flex: 1,
        // Офис — единственная растягиваемая колонка. Её минимум держит офис читаемым в сетке
        // из трёх колонок, а в одноколоночном режиме он снимается: иначе на узком экране колонка
        // не влезла бы и обёртка пустила горизонтальную прокрутку.
        minWidth: full ? 0 : OFFICE_COL_MIN,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--bg-primary)',
        height: '100%',
        overflowY: 'auto',
        padding: 'var(--space-4)',
        gap: 'var(--space-4)',
      }}
    >
      {/* Сцена: Пиксельный офис, в котором стоят Маскоты купленных Лабораторий. Классы нужны,
          чтобы адресовать части Сцены из проверок; оформление живёт в style, как во всём
          остальном интерфейсе. */}
      <div
        ref={sceneRef}
        className="scene scene-plate"
        style={{
          flex: 1,
          minHeight: SCENE_MIN_H,
          position: 'relative',
          overflow: 'hidden',
          border: 'var(--frame-w) solid var(--border)',
          backgroundColor: 'var(--bg-void)',
          // Жар кладётся на рамку, а не на картинку: горящий офис обводится по краю, и заливка
          // изнутри закрыла бы лица Маскотов. Кольцо жёсткое (ADR-0008): толщина --heat-ring
          // кратна пикселю арта и растёт ступенями с состоянием Температуры.
          boxShadow: 'inset 0 0 0 var(--heat-ring, 0px) var(--accent-color)',
        }}
      >
        {/* Кроссфейд: предыдущий кадр лежит нижним слоем, новый проявляется поверх
            (класс scene-crossfade--in, только opacity). Предыдущий убирается по концу
            входящей анимации — таймеров нет, текст и HUD-полосы вне Сцены (ADR-0002). */}
        {sceneShown.prev >= 0 && sceneShown.prev !== sceneShown.curr ? (
          <>
            <img
              className="scene__img"
              src={SCENE_SRC[sceneShown.prev]}
              alt=""
              draggable={false}
              aria-hidden="true"
              style={sceneImgStyle(sceneFilter(sceneGrade(sceneShown.prev)))}
            />
            <img
              className="scene__img scene-crossfade--in"
              src={SCENE_SRC[sceneShown.curr]}
              alt=""
              draggable={false}
              onAnimationEnd={(e) => {
                // Конец здесь — это конец входящего кроссфейда: событие всплывает от
                // потомков Сцены, поэтому чужое имя игнорируется.
                if (e.animationName !== 'scene-crossfade-in') return;
                setSceneShown((s) => (s.prev < 0 ? s : { prev: -1, curr: s.curr }));
              }}
              style={sceneImgStyle(sceneFilter(grade))}
            />
          </>
        ) : (
          <img
            className="scene__img"
            src={SCENE_SRC[sceneShown.curr]}
            alt=""
            // Декоративная картинка, и по правилу репозитория декоративное помечается
            // aria-hidden, а не только пустым alt: озвучка иначе читает «изображение» перед
            // подписью «ОФИС АГЕНТОВ», которая и так всё объясняет.
            aria-hidden="true"
            draggable={false}
            style={sceneImgStyle(sceneFilter(grade))}
          />
        )}

        {/* Жар на площади Сцены. Прозрачность обоих слоёв ставит CSS из `--heat-glow`,
            поэтому здесь только сами градиенты: одна шкала нагрева на весь интерфейс.
            Слои лежат под HUD и под Маскотами — жар заливает комнату, а не подписи на ней. */}
        <div
          className="scene__heat"
          aria-hidden="true"
          style={{ backgroundImage: heat.tint }}
        />
        <div
          className="scene__heat scene__heat--haze"
          aria-hidden="true"
          style={{ backgroundImage: heat.haze }}
        />

        {/* Полосы прижаты к верхнему краю Сцены общей обёрткой: HUD и полоса Глюков
            стоят одна под другой, а высоты HUD никто не знает наперёд, поэтому её измерять
            и подставлять в позицию полосы Глюков незачем — достаточно потока внутри
            обёртки. Обе несут собственный скрим, поэтому читаемость подписей не зависит от
            того, что нарисовала машина (ADR-0002). */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 2,
          }}
        >
          <div
            className="scene__hud"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-1)',
              padding: 'var(--space-2) var(--space-3)',
              // Сплошное затемнение, а не градиент в прозрачность: на HUD теперь стоят три
              // строки, и нижняя при градиенте лежала бы на почти открытой картинке (ADR-0002).
              background: 'var(--bg-scrim)',
              borderBottom: 'var(--frame-w) solid var(--border)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                flexWrap: 'wrap',
                gap: 'var(--space-1) var(--space-2)',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 'var(--space-0) var(--space-2)' }}>
                <span className="pixel-22" style={{ color: 'var(--text-main)' }}>ОФИС АГЕНТОВ</span>
                <span style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>
                  <Num>{formatNumber(totalAgents, notation)}</Num>{' '}
                  {formatCount(totalAgents, 'Агент', 'Агента', 'Агентов', notation)}
                </span>
              </span>
              {/* Коллекция реплик: счётчик — длина quipsSeen, окно — локальное. Кнопка живёт на
                  HUD, потому что полосы «Состав» больше нет, а собрать услышанное по-прежнему
                  нужно где-то под рукой. Рамка и заливка кнопки — её собственная подложка. */}
              <button
                className="pixel-btn"
                onClick={() => setQuipLogOpen(true)}
                style={{ padding: 'var(--space-0) var(--space-2)', whiteSpace: 'nowrap' }}
              >
                Переписка ({quipsSeenCount})
              </button>
            </div>

            {/* Цель Поколения. key пересоздаёт строку на смене Поколения или финала, поэтому
                появление через существующий toast-fade (только opacity, без движения)
                проигрывается один раз на смену текста. */}
            <div
              key={`${generation}-${finale ? 'finale' : 'goal'}`}
              className="scene__goal"
              style={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 'var(--space-1) var(--space-3)',
                animation: 'toast-fade 0.15s ease-out',
              }}
            >
              {finale ? (
                <div style={{ flex: '1 1 12rem', minWidth: 0 }}>
                  <div className="pixel-22" style={{ color: 'var(--gold)' }}>Финал контента MVP!</div>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--gold)' }}>
                    Ты на острие ИИ! Жди новые реальные модели в будущих апдейтах.
                  </div>
                </div>
              ) : (
                <Hint content={goalHint} style={{ flex: '1 1 20rem', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', minWidth: 0 }}>
                    <span
                      className="pixel-22"
                      style={{ color: flagshipOwned ? 'var(--gold)' : 'var(--accent-color)', flexShrink: 0 }}
                    >
                      ЦЕЛЬ
                    </span>
                    {/* Имя обрезается многоточием, а не переносится: на телефоне цель стоит одной
                        строкой, а полное имя лежит в подсказке и в подписи ниже. */}
                    <span
                      style={{
                        fontSize: '1rem',
                        color: 'var(--text-main)',
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Флагман <span style={{ color: 'var(--gold)' }}>{flagship.name}</span> ({LABS[flagship.lab].name})
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 'var(--text-sm)',
                      color: flagshipOwned ? 'var(--green)' : 'var(--text-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {goalHint}
                  </div>
                </Hint>
              )}

              {prestigeReady && !finale && (
                <button
                  onClick={requestPrestige}
                  // Загорается один раз, когда найм Флагмана открыл Престиж: класс держится, пока
                  // жив момент награды, и снимается вместе с ним.
                  className={`pixel-btn pixel-btn-gold pixel-22${moment?.flagship ? ' prestige-ignite' : ''}`}
                  style={{ padding: 'var(--space-1) var(--space-3)' }}
                >
                  <Icon name="rocket" />
                  Совершить Престиж
                </button>
              )}
            </div>

            {/* Правило Поколения стоит на HUD всё время Забега: оно действует, пока игрок в этом Поколении,
                и забыть его после входа — значит играть вслепую. Полный текст — в подсказке, а строка
                обрезается многоточием, как цель выше. «Рассвет» Правила не имеет, и строки там нет. */}
            {rule && (
              <Hint
                key={rule.id}
                content={<><b>{rule.name}.</b> {rule.summary}</>}
                className="scene__rule"
                style={{ minWidth: 0, animation: 'toast-fade 0.15s ease-out' }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', minWidth: 0 }}>
                  <span className="pixel-22" style={{ color: 'var(--accent-color)', flexShrink: 0 }}>
                    ПРАВИЛО
                  </span>
                  <span
                    style={{
                      fontSize: '1rem',
                      color: 'var(--text-main)',
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {rule.name}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 'var(--text-sm)',
                    color: 'var(--text-muted)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {ruleStatus || rule.summary}
                </div>
              </Hint>
            )}
            {course && (
              <Hint
                key={course.id}
                content={<><b>Курс «{course.name}».</b> {course.summary}</>}
                className="scene__course"
                style={{ minWidth: 0, animation: 'toast-fade 0.15s ease-out' }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', minWidth: 0 }}>
                  <span className="pixel-22" style={{ color: 'var(--accent-color)', flexShrink: 0 }}>
                    КУРС
                  </span>
                  <span
                    style={{
                      fontSize: '1rem',
                      color: 'var(--text-main)',
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {course.name}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 'var(--text-sm)',
                    color: 'var(--text-muted)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {course.summary}
                </div>
              </Hint>
            )}
          </div>
          {/* Полоса кражи Дохода появляется вместе с первым Глюком и держит обратную связь
              на самой Сцене: без неё игрок узнавал бы об утечке только из модалки. */}
          <SceneGlitchBand />
        </div>

        {/* Пузырь реплики стоит над Маскотом говорящей Лаборатории, на своей подложке: поверх Сцены
            (zIndex 4 — выше HUD-полосы и Маскотов), но вне HUD-обёртки, чтобы не ломать её скрим
            из ADR-0002. Клики не перехватывает, поэтому Глюки и Золотой Токен ловятся сквозь него. */}
        <SceneQuipBubble yieldToCard={card !== null} />

        {/* Маскоты стоят на общей линии у нижнего края Сцены, а подписи Лабораторий живут
            в карточке над Маскотом — на её собственной подложке, где контраст не зависит от Сцены. */}
        <div
          className="scene__mascots"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2,
            display: 'grid',
            // Колонок столько, сколько влезло: на телефоне восемь Лабораторий встают в два
            // ряда, и верхний ряд поднимается выше затемнения — но его счётчики в него ещё
            // помещаются, а лента остаётся прижата к полу.
            gridTemplateColumns: `repeat(auto-fit, minmax(${MASCOT_COL_MIN}px, 1fr))`,
            // Ряды не примыкают друг к другу: сумма двух рядов места со столом —
            // 166 px, а затемнение при минимальной Сцене в 300 px накрывает только
            // нижние 114 px, и без зазора верхний счётчик сел бы встык со столом
            // нижнего ряда.
            rowGap: 'var(--space-2)',
            alignItems: 'end',
            padding: '0 var(--space-2) var(--space-3)',
          }}
        >
          {activeLabs.map((labId) => {
            // Отклик на покупку, которая принесла момент награды, достаётся месту её Лаборатории.
            const entering = moment?.entry === true && moment.lab === labId;
            const celebrating = moment?.flagship === true && moment.lab === labId;
            return (
            // Место Маскота — кнопка: наведение мышью, фокус с клавиатуры и касание открывают
            // одну и ту же карточку (MascotCard). Подпись читает то же, что видно в карточке, а
            // сама карточка от чтеца скрыта. Escape её закрывает (WCAG 1.4.13).
            <button
              key={labId}
              type="button"
              className="scene__booth"
              data-lab={labId}
              aria-label={boothLabels[LAB_IDS.indexOf(labId)]}
              onPointerEnter={(e) => showCard(labId, e.currentTarget)}
              onPointerLeave={() => hideCard(labId)}
              onFocus={(e) => showCard(labId, e.currentTarget)}
              onBlur={() => hideCard(labId)}
              onClick={(e) => showCard(labId, e.currentTarget)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') hideCard(labId);
              }}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 'var(--space-1)',
                minWidth: 0,
                width: '100%',
                padding: 0,
                background: 'none',
                border: 'none',
                font: 'inherit',
                color: 'inherit',
                cursor: 'default',
              }}
            >
              {/* Место целиком: Маскот стоит за своим столом, и стол рисуется поверх
                  Маскота по щиколотку. Без перекрытия это были бы восемь фигур,
                  висящих в воздухе над восемью столами — сцена читалась бы как
                  инвентарь, а не как офис. */}
              <div
                className={entering ? 'booth--enter' : undefined}
                style={{
                  position: 'relative',
                  width: '100%',
                  height: BOOTH_H,
                  // Своя высота SVG у спрайта стола: обёртка задаёт константы
                  // раскладки, а не подгоняется под картинку.
                  lineHeight: 0,
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: SHADOW_CENTER_Y - SHADOW_H / 2,
                    width: SHADOW_W,
                    height: SHADOW_H,
                    marginLeft: -SHADOW_W / 2,
                    // Эллипс на полу — рисунок Сцены, а не панель интерфейса: пол пиксель-арта
                    // не бывает квадратным, и срезанная ступенями тень выглядела бы дырой.
                    backgroundColor: CONTACT_SHADOW,
                    zIndex: 0,
                    // Декорация: ни клика, ни фокуса.
                    pointerEvents: 'none',
                  }}
                />
                {/* Прыжок висит на родителе узла покачивания, а не на нём самом: animation на том
                    же узле перезаписала бы бесконечное mascot-bob, а вложенный transform
                    складывается с ним — прыжок идёт поверх покачивания, не вместо него. Тень
                    остаётся на полу: прыгает только Маскот, а не его контакт с полом. */}
                {/* Обёртка входа: подъём Маскота из-за стола висит на ней, а не на узле прыжка, чтобы
                    классы двух анимаций не затирали друг друга. Стол (zIndex 2) лежит выше. */}
                <div
                  className={entering ? 'mascot-rise' : undefined}
                  style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none' }}
                >
                <div
                  ref={(node) => {
                    if (node) hopNodes.current.set(labId, node);
                    else hopNodes.current.delete(labId);
                  }}
                  className={hoppingLabId === labId ? 'mascot-hop' : undefined}
                  onAnimationEnd={(e) => {
                    // Покачивание бесконечно и конца не даёт, поэтому конец здесь — это конец
                    // прыжка. Таймеров в игре нет, снятие только по событию анимации.
                    if (e.animationName !== 'mascot-hop') return;
                    e.currentTarget.classList.remove('mascot-hop');
                    setHoppingLabId((cur) => (cur === labId ? null : cur));
                  }}
                  style={{ position: 'absolute', top: 0, left: '50%', marginLeft: -MASCOT_SIZE / 2, zIndex: 1, lineHeight: 0 }}
                >
                  <MascotSprite lab={labId} size={MASCOT_SIZE} animated />
                </div>
                </div>
                {/* Стол перекрывает Маскота по щиколотку: zIndex 2 выше Маскота,
                    а top сдвинут к его ногам. Поэтому стол читается как передний
                    план, Маскот — как тот, кто за ним сидит. */}
                <WorkstationSprite
                  lab={labId}
                  width={STATION_W}
                  className="scene__station"
                  style={{ position: 'absolute', left: '50%', top: STATION_TOP, marginLeft: -STATION_W / 2, zIndex: 2 }}
                />
                {/* Праздник Флагмана: рамка золота вокруг места мигает прозрачностью (она остаётся
                    и при «меньше анимации»), а конфетти летит только при включённых частицах и
                    разрешённом движении. Клики не ловит: это украшение, не кнопка. */}
                {celebrating && (
                  <>
                    <span className="booth-ring" aria-hidden="true" />
                    {particles && motionAllowed() && (
                      <span className="confetti" aria-hidden="true" style={{ top: Math.round(MASCOT_SIZE * 0.3) }}>
                        {CONFETTI.map((c, i) => (
                          <span
                            key={`${moment.nonce}-${i}`}
                            className="confetti__bit"
                            style={
                              {
                                width: c.size,
                                height: c.size,
                                '--cf-dx': `${c.dx}px`,
                                '--cf-dy': `${c.dy}px`,
                                '--cf-delay': `${c.delay.toFixed(2)}s`,
                              } as React.CSSProperties
                            }
                          />
                        ))}
                      </span>
                    )}
                  </>
                )}
              </div>
              <span
                aria-hidden="true"
                style={{ fontSize: 'var(--text-sm)', color: 'var(--text-main)', textShadow: BADGE_OUTLINE }}
              >
                ×<Num>{formatNumber(labAgents(roster, labId), notation)}</Num>
              </span>
            </button>
            );
          })}
        </div>

        {/* Карточка Маскота: над местом, на которое навели, поверх пузыря реплики. */}
        {card && <MascotCard anchor={card} showShare={activeLabs.length > 1} />}

        {/* Глюки сидят на Сцене: каждый показывает, сколько кликов до разрыва, и лопается
            от третьего. Полоса с долей кражи — выше, в обёртке HUD. */}
        <OfficeGlitchSwarm />

        {/* Пыль в воздухе Сцены: часть Сцены, а не слой поверх неё, поэтому гаснет вместе
            с полом, а не светится поверх затемнения. Держит порядок разметка: у пыли и у
            скрима одинаковый z-index 1, а при равном z-index рисуется тот, кто позже в DOM. */}
        <div className="scene__motes">
          {MOTES.slice(0, particles ? moteCount(totalAgents) : 0).map((_, i) => (
            <span key={i} className="mote" style={moteStyle(i)} />
          ))}
        </div>

        {/* Затемнение низа Сцены: под ним читаются и Маскоты, и их счётчики — иначе на
            светлом полу Сцены 2 они стояли бы белым по белому. Скрин лежит под Маскотами
            (zIndex 1 против 2), поэтому гасит пол, а не сами фигурки. */}

        <div
          className="scene__scrim"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 1,
            pointerEvents: 'none',
            background: sceneFloorGradient(grade),
          }}
        />

        {activeLabs.length === 0 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 3,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 'var(--space-4)',
              pointerEvents: 'none',
            }}
          >
            {/* Подложка непрозрачная: пустое состояние читается на любой из четырёх Сцен. */}
            <div
              style={{
                backgroundColor: 'var(--bg-panel)',
                border: 'var(--frame-w) solid var(--border)',
                padding: 'var(--space-4) var(--space-5)',
                textAlign: 'center',
                boxShadow: '0 var(--drop) 0 var(--bg-void)',
              }}
            >
              {/* Пиксельный питающий индикатор активности Сцены */}
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  marginBottom: 'var(--space-2)',
                  padding: 'var(--space-0) var(--space-2)',
                  backgroundColor: 'var(--bg-void)',
                  border: 'var(--frame-w) solid var(--border)',
                }}
              >
                <span
                  className="pulse-glow"
                  style={{
                    display: 'inline-block',
                    width: '8px',
                    height: '8px',
                    backgroundColor: 'var(--green)',
                  }}
                />
                <span
                  style={{
                    fontSize: '0.75rem',
                    color: 'var(--green)',
                    fontWeight: 600,
                    letterSpacing: '0.5px',
                    textTransform: 'uppercase',
                  }}
                >
                  Стендбай: Сцена готова к запуску
                </span>
              </div>
              <div className="pixel-22" style={{ color: 'var(--text-main)' }}>
                Офис пока пуст
              </div>
              {/* Куда идти — по раскладке, а не всегда «вправо». `full` и есть признак
                  одноколоночного режима, где магазин не колонка справа, а вкладка внизу:
                  подсказка «справа» на телефоне указывала в пустоту. */}
              <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
                Найми первого ИИ-агента в магазине{full ? '' : ' справа'}!
              </div>
            </div>
          </div>
        )}

        {/* Дрон летит последним слоем: он пересекает и пол, и ленту Маскотов, поэтому должен
            рисоваться поверх обоих. Слой не перехватывает указатель — см. .scene__drone. */}
        <SceneDrone />
      </div>

      <QuipLogModal isOpen={quipLogOpen} onClose={() => setQuipLogOpen(false)} />
    </div>
  );
};

export const OfficeColumn = React.memo(OfficeColumnView);
