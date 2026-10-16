import React, { useCallback, useEffect, useRef, useState } from 'react';
import { effectAllowed, motionAllowed, useGameStore, type ToastMessage } from '../store/useGameStore';
import {
  pinnedToastAnchors,
  TOAST_GAP,
  TOAST_MARGIN,
  TOAST_QUEUE_H,
  TOAST_VISIBLE_MAX,
  toastStackBand,
  toastStackWidth,
} from '../layout';
import { Icon } from './Icon';
import { Num } from './Num';

const TOAST_MS = 4000;

// Тосты — только о Достижениях, а пачку из одного тика стор склеивает в одну карточку «+N
// Достижения». Показываем только свежие, а длину очереди (тики подряд) передаём счётчиком:
// молча выбрасывать их нельзя — они остаются в окне «Достижения» и в счётчике в шапке, но игрок
// должен видеть, что список не кончился.
// Сколько карточек влезает и где стоять стопке, решает `toastStackBand` из модуля раскладки.

// 24 искры вокруг Достижения. Угол и дальность разводит золотой угол: по равномерной сетке
// веер встаёт в правильную розетку и читается как гирлянда, а не как вспышка.
const FAN_COUNT = 24;
const FAN = Array.from({ length: FAN_COUNT }, (_, i) => {
  const angle = (i * 2.399963) % (Math.PI * 2);
  const dist = 34 + ((i * 7) % 11) * 5;
  return { dx: Math.round(Math.cos(angle) * dist), dy: Math.round(Math.sin(angle) * dist), size: 4 + (i % 3) };
});

let fanCounter = 0;

/**
 * Одноразовая CSS-анимация, которая обязана довести элемент до конца.
 *
 * Снимает элемент только кадр анимации, и прерванная анимация кадра не порождает: правила
 * `[data-motion='reduced'] .toast-card--out { animation: none }` и
 * `[data-motion='reduced'] .burst-particle { animation: none }` при смене настройки на ходу
 * убивают идущую анимацию, а animationend после отмены не наступает уже никогда — карточка
 * (а с веером это ещё и слой `inset: 0` поверх всей игры) остаётся в DOM до конца сессии.
 *
 * Каналов три, таймеров нет:
 *   1. animationend — анимация дошла до конца;
 *   2. animationcancel — её сняли, то есть её больше не будет. Слушатель нативный: React 19
 *      не знает про это событие (свойства onAnimationCancel в типах нет), а по кольцу оно
 *      приходит ещё и от каждой искры веера, что и нужно — снимать веер целиком;
 *   3. настройка игрока, прочитанная из магазина: она меняется в том же коммите, что и
 *      data-motion, и потому снимает элемент раньше, чем браузер применит новые стили.
 *
 * Канала 1 в одиночку мало и потому, что системное «уменьшить движение» меняется без
 * действия игрока: магазин о нём не узнаёт, и событие от CSS остаётся единственным сигналом.
 *
 * Имя анимации нужно по делу: у карточки одновременно идут toast-in на ней самой и toast-flash
 * на ::before, и отменяются они тем же событием, что и toast-out.
 */
function useOneShot(started: boolean, name: string, settle: () => void) {
  const reducedMotion = useGameStore((s) => s.state.settings.reducedMotion);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (started && reducedMotion) settle();
  }, [started, reducedMotion, settle]);

  useEffect(() => {
    const node = ref.current;
    if (!node || !started) return;
    const onCancel = (e: AnimationEvent) => {
      if (e.animationName === name) settle();
    };
    node.addEventListener('animationcancel', onCancel);
    return () => node.removeEventListener('animationcancel', onCancel);
  }, [started, name, settle]);

  // Кадр отбирается по имени анимации, а не по факту её окончания: входная анимация карточки
  // завершается раньше, и снимать по ней элемент нельзя.
  const onAnimationEnd = (e: React.AnimationEvent<HTMLDivElement>) => {
    if (e.animationName === name) settle();
  };

  return { ref, onAnimationEnd };
}

const ToastItem: React.FC<{ toast: ToastMessage; onRemove: (id: string) => void }> = ({
  toast,
  onRemove,
}) => {
  const [leaving, setLeaving] = useState(false);

  // Выходной кадр ставится только при разрешённом движении: без анимации тост обязан уйти
  // сразу, иначе animationend не наступит и карточка останется на экране навсегда.
  const dismiss = () => {
    if (motionAllowed()) setLeaving(true);
    else onRemove(toast.id);
  };

  const settle = useCallback(() => onRemove(toast.id), [onRemove, toast.id]);
  const { ref, onAnimationEnd } = useOneShot(leaving, 'toast-out', settle);

  useEffect(() => {
    const timer = setTimeout(dismiss, TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onRemove]);

  // Название и описание приезжают в тосте текстом, а не id. Раньше компонент сам искал запись
  // в ACHIEVEMENTS, и теневой id — а он в другой таблице — выводился бы на экран как есть.
  return (
    <div
      ref={ref}
      onClick={dismiss}
      onAnimationEnd={onAnimationEnd}
      className={`pixel-card toast-card${leaving ? ' toast-card--out' : ''}`}
      style={{
        padding: 'var(--space-3)',
        backgroundColor: 'var(--bg-card)',
        border: 'var(--frame-w) solid var(--gold)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        cursor: 'pointer',
        // Карточка не шире стека: сам стек уже ограничен расчётом колонок
        // (см. `toastStackWidth`), а здесь предел — доля, а не пиксели, иначе на
        // 320 px замороженное число снова увело бы правый край за экран.
        maxWidth: '100%',
        // Длинная строка обязана переноситься внутри карточки: горизонтальной
        // прокрутки в игре нет, и обрезанный текст было бы не доскроллить.
        overflowWrap: 'break-word',
        minWidth: 0,
      }}
    >
      <Icon name="trophy" size={22} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.85rem', color: 'var(--gold)' }}>{toast.title}</div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-main)', fontWeight: 600 }}>
          {toast.name}
        </div>
        {toast.desc && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{toast.desc}</div>}
      </div>
      {/* Видимая кнопка закрытия: автозакрытие и клик по карточке остаются, но ждать четыре
          секунды, чтобы убрать тост, игрок не обязан. stopPropagation обязателен — иначе нажатие
          дополнительно уйдёт в обработчик карточки и уведёт её на выход кадром, который
          никто не запускал. */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          dismiss();
        }}
        className="pixel-btn toast-close"
        aria-label="Закрыть уведомление"
        title="Закрыть"
        style={{ padding: 'var(--space-0) var(--space-1)', fontSize: '0.8rem', flexShrink: 0 }}
      >
        ✕
      </button>
    </div>
  );
};

/**
 * Где стопке стоять и сколько в неё влезает — измерение, а не расчёт: расчёт (`toastStackBand`)
 * живёт в модуле раскладки и покрыт тестом, а здесь только читаются края колонки Клика.
 *
 * Стопка стоит под колонкой Клика и никогда не лежит на числе Токенов, Доходе, кнопке Клика и
 * шкале Температуры: раньше она начиналась ровно на счётчике и перекрывала его целиком, а её
 * размещение объясняли заботой о магазине — то есть перекрытие числа не было задумано ни как
 * цена, ни как правило. Колонка идёт в порядке главного действия (счётчик, Клик, Температура,
 * Вехи), поэтому полосы «между счётчиком и шкалой» больше нет: между ними стоит сама кнопка.
 *
 * Измеряется по событиям раскладки — `ResizeObserver` и изменение окна, — а не по таймеру:
 * собственный таймер здесь означал бы шестое место, где что-то перерисовывается двадцать раз
 * в секунду.
 */
function useStackBand(count: number): { top: number; slots: number; width: number } {
  const measure = React.useCallback((): { top: number; slots: number; width: number } | null => {
    const counter = document.querySelector<HTMLElement>('.click-counter');
    if (!counter) return null;
    const bottomOf = (el: Element | null): number | null => (el ? el.getBoundingClientRect().bottom : null);
    const counterBottom = counter.getBoundingClientRect().bottom;
    // Линия перегрева под шкалой — черта, выше которой тост не заходит: она часть шкалы, и
    // прятать её в момент Достижения нельзя, как и ручку; без неё (вкладка без колонки Клика) её
    // роль берёт кнопка Клика: накрывать её тоже нельзя.
    const keepVisibleBottom =
      bottomOf(document.querySelector('[role="progressbar"][aria-label="Перегрев"]')) ??
      bottomOf(document.querySelector('[role="slider"]')) ?? bottomOf(document.querySelector('.click-btn')) ?? counterBottom;
    const contentBottom = bottomOf(document.querySelector('.milestone-strip')) ?? keepVisibleBottom;
    // Нижние полосы оболочки: их высоту App.tsx меряет и кладёт в --toast-bottom.
    const root = document.querySelector('.app-root');
    const bottomBand = (root && parseFloat(getComputedStyle(root).getPropertyValue('--toast-bottom'))) || 0;
    const limit = window.innerHeight - bottomBand;
    const cardHeight = document.querySelector('.toast-card')?.getBoundingClientRect().height;
    // На телефоне Токены и Доход стоят в закреплённой полосе над вкладкой, а шкала Температуры и
    // кнопка Клика — в причале у нижней полосы: «под шкалой» там нет места, и стек встаёт прямо
    // под полосу (см. `pinnedToastAnchors`), а не на кнопку Клика.
    const strip = document.querySelector('.status-strip');
    const anchors = strip
      ? pinnedToastAnchors({ stripBottom: strip.getBoundingClientRect().bottom, limit, cardHeight })
      : { counterBottom, keepVisibleBottom, contentBottom, limit, cardHeight };
    // Хвост очереди («ещё N») стоит в стопке под карточками и тоже должен поместиться в окно:
    // сначала считаем без него, и если карточек больше, чем влезло, — пересчитываем с ним.
    let band = toastStackBand(anchors);
    if (count > Math.min(band.slots, TOAST_VISIBLE_MAX)) band = toastStackBand({ ...anchors, below: TOAST_QUEUE_H });
    const { top, slots } = band;
    // Ширина — из расчёта колонок, а не замороженным числом: расчёт уже держит её в окне.
    return { top, slots, width: Math.round(toastStackWidth(window.innerWidth)) };
  }, [count]);

  const [band, setBand] = useState<{ top: number; slots: number; width: number } | null>(null);

  useEffect(() => {
    const update = () => setBand(measure());
    update();
    const watched = [
      document.querySelector<HTMLElement>('.click-counter'),
      document.querySelector<HTMLElement>('[role="progressbar"][aria-label="Перегрев"]') ?? document.querySelector<HTMLElement>('.click-btn'),
      document.querySelector<HTMLElement>('.milestone-strip'),
    ];
    // Наблюдатель срабатывает и на изменение высоты окна, и на изменение высоты самих блоков,
    // то есть на оба случая, когда счётчик, шкала или Вехи уезжают.
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    if (ro) {
      ro.observe(document.documentElement);
      for (const el of watched) if (el) ro.observe(el);
    }
    window.addEventListener('resize', update);
    return () => { ro?.disconnect(); window.removeEventListener('resize', update) };
  // `measure` зависит от числа тостов: вместе с ним эффект перепривязывает наблюдателя к тому, что
  // стоит на экране сейчас, а вкладка или раскладка могли сменить узлы.
  }, [measure]);

  // До первого измерения показывается одна карточка: это самый осторожный выбор, и он же
  // переживает раскладку, где измерять нечего. Ширина до измерения — тоже из расчёта
  // колонок: первый кадр уже обязан помещаться в окно.
  return band ?? { top: 0, slots: 1, width: Math.round(toastStackWidth(typeof window === 'undefined' ? 0 : window.innerWidth)) };
}

export const Toasts: React.FC = () => {
  const toasts = useGameStore((s) => s.toasts);
  const removeToast = useGameStore((s) => s.removeToast);
  const burst = useGameStore((s) => s.burst);
  const stackRef = useRef<HTMLDivElement>(null);
  const [fan, setFan] = useState<{ id: number; x: number; y: number } | null>(null);
  const band = useStackBand(toasts.length);

  // Обрезаем хвост, а не начало: последний элемент — самый свежий, и именно он должен
  // остаться на виду. Порядок внутри оставшихся не трогаем: счётчик веера берёт последнюю
  // карточку как метку о Достижении.
  const slots = band.slots;
  const visible = toasts.slice(-slots);
  const queuedToasts = toasts.slice(0, -slots);
  const queued = queuedToasts.length;

  useEffect(() => {
    if (burst?.kind !== 'achievement') return;
    if (!effectAllowed('particles')) return;
    // Якорь — свежайшая карточка в стопке: она и есть отметка о Достижении, на неё и летят
    // искры. Именно карточка, а не последний узел: когда хвост очереди не пуст, последним
    // узлом стоит счётчик «ещё N», и веер вылетал бы из-под него, то есть из цифры, а не
    // из Достижения, ради которого он и появляется.
    const cards = stackRef.current?.querySelectorAll<HTMLElement>('.toast-card');
    const card = cards && cards.length ? cards[cards.length - 1] : null;
    const rect = card && card.getBoundingClientRect();
    setFan({
      id: ++fanCounter,
      x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
      y: rect ? rect.top + rect.height / 2 : window.innerHeight / 2,
    });
  }, [burst?.nonce]);

  // Веер снимается целиком: у искр одна и та же анимация без задержки, поэтому гаснут они
  // одним кадром и ждать последнюю отдельно незачем. Гасит его useOneShot — иначе отмена
  // анимации оставила бы слой `inset: 0` висеть до конца сессии.
  const stopFan = useCallback(() => setFan(null), []);
  const { ref: fanRef, onAnimationEnd: onFanEnd } = useOneShot(fan !== null, 'burst-fly', stopFan);

  if (toasts.length === 0 && !fan) return null;

  return (
    <>
      {/* Стопка начинается под счётчиком Токенов и идёт вниз. Правый нижний угол закрывал карточки
          магазина — то самое место, ради которого игрок смотрит на тост.

          `top` и количество карточек приходят из измерения (см. `useStackBand`), а не из CSS:
          колонка растёт вместе с полосой Вех, и число в таблице стилей рано или поздно перестаёт
          совпадать с ней. Пока измерения ещё не было, положение задаёт .toast-stack в index.css —
          это первый кадр, а не рабочее состояние. */}
      <div
        ref={stackRef}
        className="toast-stack"
        style={{
          position: 'fixed',
          left: `${TOAST_MARGIN}px`,
          // Ширина по левой колонке, а не во всю окно: тост, растянувшийся под магазин,
          // снова закрыл бы карточки, ради которых игрок его и читает. Число — из расчёта
          // колонок (см. `toastStackWidth`), а страховка держит стек в окне, даже если окно
          // успели сузить между измерением и кадром.
          width: `${band.width}px`,
          maxWidth: `calc(100vw - ${TOAST_MARGIN * 2}px)`,
          top: band.top || undefined,
          // `bottom` обязан быть снят, когда `top` измерен: вместе они растянули бы стопку на весь
          // экран и накрыли бы шкалу. Без измерения (вкладка без колонки Клика) стопку держит
          // `.toast-stack` в index.css — над нижними полосами.
          bottom: band.top ? 'auto' : undefined,
          display: 'flex',
          flexDirection: 'column',
          gap: `${TOAST_GAP}px`,
          zIndex: 100,
        }}
      >
        {visible.map((t) => (
          <ToastItem key={t.id} toast={t} onRemove={removeToast} />
        ))}

        {/* Хвост очереди виден, но не занимает место: счётчик не перекрывает колонку,
            а игрок понимает, что Достижения ещё предъявят. Он же и кнопка закрытия
            очереди — молчаливый хвост выглядел бы как зависшая игра. */}
        {queued > 0 && (
          <button
            onClick={() => queuedToasts.forEach((t) => removeToast(t.id))}
            className="pixel-card"
            style={{
              alignSelf: 'flex-start',
              padding: 'var(--space-1) var(--space-2)',
              backgroundColor: 'var(--bg-card)',
              fontSize: '0.8rem',
              color: 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            ещё <Num>{queued}</Num>
          </button>
        )}
      </div>

      {fan && (
        <div className="burst-layer" ref={fanRef} onAnimationEnd={onFanEnd}>
          {FAN.map((p, i) => (
            <span
              key={`${fan.id}-${i}`}
              className="burst-particle"
              style={
                {
                  left: fan.x,
                  top: fan.y,
                  width: p.size,
                  height: p.size,
                  '--burst-dx': `${p.dx}px`,
                  '--burst-dy': `${p.dy}px`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      )}
    </>
  );
};
