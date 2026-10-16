import React, { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { hintCardWidth, placeHint, type HintPlacement } from '../layout';
import { readSafeInsets } from './safeInsets';

/**
 * Подсказка при наведении: свой компонент вместо `title=`.
 *
 * `title` не показывается на тач-устройстве, не стилизуется под игру и не держит ни разметки, ни
 * живых чисел. Здесь подсказка открывается тремя способами, и каждый — отдельная причина быть
 * открытой:
 *
 * - **наведение мыши или пера**, пока указатель над целью;
 * - **фокус с клавиатуры** на любом элементе внутри цели (`:focus-visible`): клик мышью фокус
 *   тоже ставит, но подсказку по нему открывать не нужно — она уже открыта наведением;
 * - **нажатие пальцем** по цели вне кнопок и ссылок: открывает и закрывает подсказку, а нажатие
 *   вне неё или Esc — закрывает. Нажатие по кнопке внутри цели (купить, справка) подсказку не
 *   трогает: кнопка делает своё дело, а не подсказывает.
 *
 * Содержимое монтируется, только пока подсказка открыта: карточка, подписанная на состояние,
 * не перерисовывается двадцать раз в секунду за закрытой дверью. Рисуется она порталом в
 * `.app-root`, а не рядом с целью: там живут переменные палитры Поколения, а колонка магазина
 * обрезает всё, что выходит за неё. Место считает `placeHint` из модуля раскладки.
 */

type Variant = 'card' | 'text';

/**
 * Вложенная подсказка (полная запись цены внутри строки Модели) заслоняет внешнюю: две подсказки
 * рядом читаются как каша, а игрок навёл на число и хочет число. Внутренняя сообщает наружу,
 * открыта ли она, и внешняя на это время не рисуется — но остаётся открытой, поэтому, как
 * только указатель уходит с числа на поля строки, карточка возвращается сама.
 */
const NestedHint = createContext<((open: boolean) => void) | null>(null);

interface HintProps {
  /** Что показать. Узел создаётся при каждом рендере цели, но монтируется, только пока открыт. */
  content: React.ReactNode;
  children: React.ReactNode;
  /** `card` — карточка фиксированной ширины с рамкой; `text` — короткая строка по ширине текста. */
  variant?: Variant;
  /** Тег цели: строка Модели — блок, число в строке — `span`. */
  as?: 'div' | 'span';
  style?: React.CSSProperties;
  className?: string;
  /**
   * Нужна ли подсказка прямо сейчас. Спрашивается в момент события, а не при рендере: цель,
   * чьё число живёт в сторе (счётчик Токенов), не перерисовывается, чтобы ответить на этот вопрос.
   */
  canOpen?: () => boolean;
}

/** Элементы, нажатие на которые делает своё дело и подсказку не переключает. */
const ACTIONABLE = 'button, a, input, select, textarea, [role="button"]';

export const Hint: React.FC<HintProps> = ({
  content,
  children,
  variant = 'text',
  as: Tag = 'div',
  style,
  className,
  canOpen,
}) => {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const wanted = hover || focus || pinned;
  const [nestedOpen, setNestedOpen] = useState(0);
  const reportNested = useCallback((isOpen: boolean) => setNestedOpen((n) => Math.max(0, n + (isOpen ? 1 : -1))), []);
  const open = wanted && nestedOpen === 0;
  const parentReport = useContext(NestedHint);
  useEffect(() => {
    if (!open || !parentReport) return;
    parentReport(true);
    return () => parentReport(false);
  }, [open, parentReport]);

  const anchorRef = useRef<HTMLElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const lastPointer = useRef<string>('mouse');
  const id = useId();

  const allowed = useCallback(() => (canOpen ? canOpen() : true), [canOpen]);

  const close = useCallback(() => {
    setHover(false);
    setFocus(false);
    setPinned(false);
  }, []);

  // Esc и нажатие мимо: слушатели живут, только пока подсказка открыта.
  useEffect(() => {
    if (!wanted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onDown = (e: PointerEvent) => {
      if (!pinned) return;
      const target = e.target as Node | null;
      if (target && (anchorRef.current?.contains(target) || popRef.current?.contains(target))) return;
      setPinned(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [wanted, pinned, close]);

  // Место: меряем подсказку на невидимом первом кадре, затем ставим. Размер меняется и без
  // перерисовки цели (живая строка карточки), поэтому за ним следит ResizeObserver, а за
  // прокруткой и окном — слушатели.
  const [place, setPlace] = useState<HintPlacement | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    const bump = () => setTick((t) => t + 1);
    window.addEventListener('resize', bump);
    window.addEventListener('scroll', bump, true);
    const pop = popRef.current;
    const observer = typeof ResizeObserver === 'undefined' || !pop ? null : new ResizeObserver(bump);
    if (pop) observer?.observe(pop);
    return () => {
      window.removeEventListener('resize', bump);
      window.removeEventListener('scroll', bump, true);
      observer?.disconnect();
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const pop = popRef.current;
    if (!anchor || !pop) return;
    const a = anchor.getBoundingClientRect();
    // Высота без ограничения: прокручиваемое содержимое меряется по scrollHeight, рамка — по разности.
    const chrome = pop.offsetHeight - pop.clientHeight;
    const next = placeHint(
      { left: a.left, top: a.top, width: a.width, height: a.height },
      { width: pop.offsetWidth, height: pop.scrollHeight + chrome },
      { width: window.innerWidth, height: window.innerHeight, insets: readSafeInsets() },
    );
    setPlace((prev) =>
      prev && prev.left === next.left && prev.top === next.top && prev.maxHeight === next.maxHeight && prev.side === next.side
        ? prev
        : next,
    );
  }, [open, tick, content]);

  const host = open ? (anchorRef.current?.closest('.app-root') ?? document.body) : null;

  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      lastPointer.current = e.pointerType;
    },
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (allowed()) setHover(true);
    },
    onPointerLeave: () => setHover(false),
    onFocus: (e: React.FocusEvent) => {
      // Только фокус с клавиатуры: у мыши подсказку открывает наведение.
      if (!(e.target instanceof Element) || !e.target.matches(':focus-visible')) return;
      if (allowed()) setFocus(true);
    },
    onBlur: (e: React.FocusEvent) => {
      if (e.relatedTarget instanceof Node && anchorRef.current?.contains(e.relatedTarget)) return;
      setFocus(false);
    },
    onClick: (e: React.MouseEvent) => {
      if (lastPointer.current !== 'touch') return;
      const target = e.target instanceof Element ? e.target : null;
      const hit = target?.closest(ACTIONABLE);
      if (hit && anchorRef.current?.contains(hit)) return;
      if (!pinned && !allowed()) return;
      // Нажатие обработано здесь: внешняя подсказка (карточка Модели) своё переключение не делает.
      e.stopPropagation();
      setPinned((p) => !p);
    },
  };

  // Ширина карточки — от безопасной области: вырез по бокам в альбомной ориентации отнимает у неё место.
  const inset = readSafeInsets();
  const width = typeof window === 'undefined' ? undefined : hintCardWidth(window.innerWidth - inset.left - inset.right);

  return (
    <>
      <Tag
        ref={anchorRef as React.Ref<never>}
        className={className}
        style={style}
        aria-describedby={open ? id : undefined}
        {...handlers}
      >
        <NestedHint.Provider value={reportNested}>{children}</NestedHint.Provider>
      </Tag>
      {host &&
        createPortal(
          <div
            ref={popRef}
            id={id}
            role="tooltip"
            className={`pixel-card hint-pop hint-pop--${variant}`}
            style={{
              left: place?.left ?? 0,
              top: place?.top ?? 0,
              maxHeight: place?.maxHeight,
              width: variant === 'card' ? width : undefined,
              maxWidth: width,
              // Первый кадр — только замер: подсказка видна, когда у неё есть место.
              visibility: place ? 'visible' : 'hidden',
              // Наведённая подсказка не ловит указатель: она не должна красть наведение у цели.
              // Закреплённая нажатием ловит — её длинное содержимое прокручивают пальцем.
              pointerEvents: pinned ? 'auto' : 'none',
            }}
          >
            {content}
          </div>,
          host,
        )}
    </>
  );
};
