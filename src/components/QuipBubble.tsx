import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LABS } from '../data/labs';
import { QUIPS } from '../data/quips';
import { useGameStore, type LastQuip } from '../store/useGameStore';
import { Icon } from './Icon';
import { MascotSprite } from './MascotSprite';
import { Num } from './Num';
import { useDialogFocus } from './useDialogFocus';
import {
  MASCOT_CARD_EDGE,
  mascotCardBottom,
  QUIP_BUBBLE_GAP,
  quipBubbleLeft,
  quipBubbleWidth,
  quipTailLeft,
  THREE_COL_MIN,
} from '../layout';

export interface QuipBubbleProps {
  /**
   * Место монтажа. Пузырь над Маскотом на Сцене — отдельный компонент (SceneQuipBubble), а этот
   * живёт только в колонке Клика, над кнопкой «Отправить промпт»: на десктопе (>= THREE_COL_MIN)
   * он скрывается, чтобы не дублировать Сцену, а на мобильном (< THREE_COL_MIN) оживает, потому
   * что Сцена спрятана за нижней навигацией и игрок, который кликает, её не видит.
   */
  placement?: "prompt";
}

function useIsSingleCol(): boolean {
  const [isSingle, setIsSingle] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < THREE_COL_MIN : false
  );

  useEffect(() => {
    const handleResize = () => setIsSingle(window.innerWidth < THREE_COL_MIN);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return isSingle;
}

/** Портрет говорящего, имя Лаборатории и текст реплики: одно содержимое для обоих мест пузыря. */
const QuipContent: React.FC<{ quip: LastQuip }> = ({ quip }) => {
  const lab = quip.lab ? LABS[quip.lab] : null;
  return (
    <>
      {lab && quip.lab && <MascotSprite lab={quip.lab} size={32} />}
      <div style={{ minWidth: 0 }}>
        {lab && (
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{lab.name}</div>
        )}
        <div style={{ fontSize: "0.9rem", color: "var(--text-main)" }}>{quip.text}</div>
      </div>
    </>
  );
};

/**
 * Пузырь реплики говорящей Модели над кнопкой Клика на узком экране.
 *
 * Слой декоративный (pointerEvents none). Здесь он в потоке колонки, а не на Сцене: на
 * телефоне вкладка с Сценой скрыта, и реплика на ней осталась бы неувиденной.
 */
export const QuipBubble: React.FC<QuipBubbleProps> = () => {
  const lastQuip = useGameStore((s) => s.lastQuip);
  const isSingle = useIsSingleCol();

  // На десктопе пузырь в ClickColumn не нужен — там уже открыта Сцена.
  if (!lastQuip || !isSingle) return null;

  return (
    <div
      key={lastQuip.nonce}
      className="quip-bubble pixel-card"
      style={{
        position: "relative",
        margin: '0 auto var(--space-3) auto',
        zIndex: 4,
        pointerEvents: "none",
        maxWidth: "min(360px, 94%)",
        width: "max-content",
        padding: 'var(--space-2) var(--space-3)',
        display: "flex",
        alignItems: "center",
        gap: 'var(--space-2)',
        boxSizing: "border-box",
      }}
    >
      <QuipContent quip={lastQuip} />
    </div>
  );
};

/** Где стоит пузырь на Сцене: числа в пикселях Сцены, посчитанные из места Маскота. */
interface SceneAnchor {
  left: number;
  width: number;
  bottom: number;
  /** Хвостик, px от левого края пузыря; null — говорящего на Сцене нет, и указывать не на кого. */
  tail: number | null;
}

/**
 * Пузырь реплики над Маскотом, который говорит, на собственной подложке (ADR-0002): тот же
 * `pixel-card`, что у карточки Маскота, и поэтому читается на любой из четырёх Сцен.
 *
 * Положение считается по месту Маскота (`.scene__booth[data-lab]`) до первой отрисовки, как у
 * карточки: ширина Сцены зависит от окна, а пузырь над крайним Маскотом не должен выйти за
 * рамку, и хвостик при этом остаётся под говорящим. Нет места Маскота — Лаборатория реплики ещё
 * не куплена (до первой покупки говорит любая) — пузырь стоит по центру у низа Сцены без
 * хвостика. Слой декоративный: Глюки и Золотой Токен ловятся сквозь него.
 */
export const SceneQuipBubble: React.FC<{
  sceneRef: React.RefObject<HTMLElement | null>;
  /** Карточка Маскота открыта: она ложится на то же место, и пузырь уступает ей, а не торчит
   *  из-под неё обрезком. Реплика остаётся в «Переписке». */
  yieldToCard: boolean;
}> = ({ sceneRef, yieldToCard }) => {
  const lastQuip = useGameStore((s) => s.lastQuip);
  const nodeRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<SceneAnchor | null>(null);
  const nonce = lastQuip?.nonce;
  const lab = lastQuip?.lab ?? null;

  useLayoutEffect(() => {
    const scene = sceneRef.current;
    const node = nodeRef.current;
    if (!scene || !node) return;
    const place = () => {
      const sceneW = scene.clientWidth;
      const sceneH = scene.clientHeight;
      const width = quipBubbleWidth(sceneW);
      // Высота зависит от ширины (текст переносится), поэтому ширина встаёт до замера высоты.
      node.style.width = `${width}px`;
      const booth = lab ? scene.querySelector<HTMLElement>(`.scene__booth[data-lab="${lab}"]`) : null;
      if (!booth) {
        setAnchor({
          left: quipBubbleLeft(sceneW / 2, sceneW),
          width,
          bottom: mascotCardBottom(MASCOT_CARD_EDGE * 3, node.offsetHeight, sceneH),
          tail: null,
        });
        return;
      }
      const sr = scene.getBoundingClientRect();
      const br = booth.getBoundingClientRect();
      // clientLeft/Top — рамка Сцены: абсолютные дети отсчитываются от внутреннего края.
      const centerX = br.left + br.width / 2 - sr.left - scene.clientLeft;
      const boothTop = br.top - sr.top - scene.clientTop;
      const left = quipBubbleLeft(centerX, sceneW);
      setAnchor({
        left,
        width,
        bottom: mascotCardBottom(sceneH - boothTop + QUIP_BUBBLE_GAP, node.offsetHeight, sceneH),
        tail: quipTailLeft(centerX, left, width),
      });
    };
    place();
    // Окно меняет ширину Сцены, пока пузырь висит (4.5 с), а покупка новой Лаборатории
    // пересобирает ряд мест: наблюдатель держит пузырь под Маскотом, и живёт он, пока пузырь есть.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(place);
    observer.observe(scene);
    return () => observer.disconnect();
  }, [sceneRef, nonce, lab]);

  if (!lastQuip) return null;

  return (
    <div
      ref={nodeRef}
      key={lastQuip.nonce}
      className="quip-bubble pixel-card"
      style={{
        position: "absolute",
        left: anchor?.left ?? 0,
        bottom: anchor?.bottom ?? 0,
        width: anchor?.width,
        // Поверх HUD (zIndex 2) и Маскотов; карточка Маскота (5) выше и закрывает его сама.
        zIndex: 4,
        // Первый кадр до замера не показываем: пузырь в левом нижнем углу мелькнул бы одним кадром.
        visibility: anchor && !yieldToCard ? "visible" : "hidden",
        pointerEvents: "none",
        padding: 'var(--space-2) var(--space-3)',
        display: "flex",
        alignItems: "center",
        gap: 'var(--space-2)',
        boxSizing: "border-box",
        ...({
          "--quip-tail": anchor?.tail != null ? `${anchor.tail}px` : "50%",
          "--quip-tail-show": anchor?.tail != null ? "block" : "none",
        } as React.CSSProperties),
      }}
    >
      <QuipContent quip={lastQuip} />
    </div>
  );
};

interface QuipLogProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * «Переписка»: собранные реплики говорящих Моделей с портретами Маскотов.
 *
 * Читает quipsSeen из состояния и QUIPS из данных: порядок — каталожный, счётчик —
 * «N / всего». Пустая — тоже состояние, а не отсутствие окна: новичок должен увидеть,
 * что коллекция существует, до первой реплики. Оформление — как остальные окна
 * (скрим, pixel-card, вход toast-fade — только opacity, поэтому при reducedMotion
 * картина та же). Фокус — через useDialogFocus, как везде.
 *
 * Каркас окна лежит в Modals.tsx, и этот файл его не импортирует: общий файл компонентов
 * завести нельзя, а копия шести окон — это ровно то расхождение, из-за которого Переписка
 * выглядела шире соседних окон. Поэтому размеры, отступы и шапка здесь повторяют значения
 * Modals.tsx буквально: если каркас поменяется, это место надо поправить вместе с ним.
 */
export const QuipLogModal: React.FC<QuipLogProps> = ({ isOpen, onClose }) => {
  // Читает только список услышанных реплик: он растёт на новой реплике, а не на каждом тике.
  const quipsSeen = useGameStore((s) => s.state.quipsSeen);
  // Хук обязан стоять до раннего выхода: иначе окно то открывалось бы с ловушкой, то без неё.
  const cardRef = useDialogFocus<HTMLDivElement>(isOpen, onClose);
  if (!isOpen) return null;

  const seen = new Set(quipsSeen);
  const found = QUIPS.filter((q) => seen.has(q.id));

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "var(--bg-scrim)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // Тот же слой, что у окон в Modals.tsx: тосты лежат выше (100), оверлей Престижа
        // ниже (40), а Переписка с остальными окнами не пересекается.
        zIndex: 50,
        padding: 'var(--space-4)',
        animation: "toast-fade 0.18s ease-out",
      }}
      onClick={onClose}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quiplog-title"
        className="pixel-card"
        style={{
          width: "100%",
          // 520 и 85vh — те же значения, что у пяти окон в Modals.tsx: одинаковая ширина
          // и высота означают, что переход в Переписку не «прыгает» карточкой на экране.
          maxWidth: "520px",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          padding: 'var(--space-4)',
          gap: 'var(--space-3)',
          animation: "toast-fade 0.18s ease-out",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 'var(--space-2)',
            flexShrink: 0,
          }}
        >
          <h2
            id="quiplog-title"
            className="pixel-22"
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 'var(--space-2)',
              minWidth: 0,
              color: "var(--gold)",
              // Капс даёт text-transform, а не текст в DOM: иначе скринридер читал бы
              // «П Е Р Е П И С К А» по буквам, а имя окна — это то, что он произносит.
              textTransform: "uppercase",
            }}
          >
            Переписка <QuipCount seen={seen.size} total={QUIPS.length} />
          </h2>
          <button
            className="pixel-btn"
            onClick={onClose}
            aria-label="Закрыть"
            title="Закрыть"
            style={{ padding: 'var(--space-1) var(--space-2)', flexShrink: 0 }}
          >
            <Icon name="close" />
          </button>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 'var(--space-2)',
          }}
        >
          {found.length === 0 ? (
            <div style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>
              Пока пусто — кликай, и Модели заговорят.
            </div>
          ) : (
            found.map((q) => (
              <div
                key={q.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 'var(--space-2)',
                  padding: 'var(--space-2)',
                  backgroundColor: "var(--bg-card)",
                }}
              >
                <MascotSprite lab={q.lab} size={28} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                    {LABS[q.lab].name}
                  </div>
                  <div style={{ fontSize: "0.9rem", color: "var(--text-main)" }}>{q.text}</div>
                </div>
              </div>
            ))
          )}
        </div>

        <button
          className="pixel-btn"
          onClick={onClose}
          style={{ alignSelf: "flex-end", flexShrink: 0 }}
        >
          Закрыть
        </button>
      </div>
    </div>
  );
};

/**
 * Счётчик у названия Переписки: «7 из 42». Слово «из», а не слеш, — и для глаза, и для
 * произносимого вслух. Стоит внутри заголовка окна, набранного Departure Mono на 22 px, а сам
 * мельче ступени, поэтому `body-font` возвращает его в Nunito (ADR-0009).
 */
const QuipCount: React.FC<{ seen: number; total: number }> = ({ seen, total }) => (
  <span className="body-font" style={{ fontSize: "0.9rem", color: "var(--text-muted)", fontWeight: 400 }}>
    (<Num>{seen}</Num> из <Num>{total}</Num>)
  </span>
);
