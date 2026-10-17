import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { motionAllowed, reduceMotionMedia, useGameStore, useStateSlice } from '../store/useGameStore';
import { clickButtonView, incomeOf, incomeView, purchaseProgressView, thoughtMeterView } from '../store/selectors';
import { formatNumber } from '../economy/format';
import { COUNTER_CHARS, COUNTER_STEP, floaterLeft, floaterStep } from '../layout';
import { holdClickAllowed, isHoldKey, readKeyTarget } from './holdClickKeys';
import { Num } from './Num';
import { FullNumber } from './FullNumber';
import { Icon } from './Icon';
import { GoldenToken } from './GoldenToken';
import { QuipBubble } from './QuipBubble';
import { OnboardingCoach } from './OnboardingCoach';
import { CoachArrow } from './CoachArrow';
import { ThermalDial } from './ThermalDial';
import { MilestoneStrip } from './MilestoneStrip';
import { useMotionAllowed } from './EventSprites';

/** За сколько миллисекунд счётчик съедает 63% расстояния до цели: каждый кадр отнимает
 *  долю dt / APPROACH_MS остатка, поэтому число тормозит, а не разгоняется, и скорость
 *  не зависит от частоты кадров. */
const APPROACH_MS = 55;

/**
 * Счётчик Токенов. Живёт вне React: тик зовёт подписчика двадцать раз в секунду, и любое
 * значение, проведённое через состояние, копилось бы в очередь ререндеров вместо отрисовки.
 * Узел при этом рендерится пустым — иначе React затрёт написанное в textContent своими детьми.
 *
 * Компонент не перерисовывается от тика вовсе: нотация и настройка движения — единственное, что
 * пересобирает цикл, а новая цель приходит из подписки стора.
 */
export const TokenCounter: React.FC<{
  /** Ступень пиксельного шрифта: 33 px в колонке, 22 px в закреплённой полосе телефона. */
  step?: 22 | 33 | 44;
  /** Подпись «Токенов» под числом: в полосе телефона она не нужна, и там её нет. */
  caption?: boolean;
}> = ({ step = COUNTER_STEP, caption = true }) => {
  const notation = useGameStore((s) => s.state.settings.notation);
  const reducedMotion = useGameStore((s) => s.state.settings.reducedMotion);
  const counterRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef(useGameStore.getState().state.tokens);
  const shownRef = useRef(useGameStore.getState().state.tokens);

  useLayoutEffect(() => {
    const node = counterRef.current;
    if (!node) return;

    let painted = '';
    const paint = (value: number) => {
      // Запись дополняется пробелами до резерва `COUNTER_CHARS` (ячейки моноширинного шрифта
      // одинаковы, пробел тоже ячейка), поэтому ширина текста не зависит от числа знаков:
      // растущий счётчик не двигает ничего правее и ниже себя.
      const text = formatNumber(value, notation).padEnd(COUNTER_CHARS);
      if (text !== painted) {
        node.textContent = text;
        painted = text;
      }
    };

    // motionAllowed() дёргает matchMedia на каждом вызов, поэтому кадр читает кэш, а сам
    // кэш пересчитывается при смене системной настройки: настройка игрока пересобирает
    // эффект, система — стреляет в слушатель ниже.
    let allowed = motionAllowed();
    // Список берётся из магазина, а не создаётся здесь заново: литерал запроса и правило
    // «настройка нечитаема, значит движения нет» живут в одном месте. null — тот же ответ,
    // что allowed === false, и слушать в нём нечего, так что guard честнее заглушки.
    const media = reduceMotionMedia();

    let last = performance.now();
    let frame = 0;

    const step = (now: number) => {
      frame = 0;
      const target = targetRef.current;
      const shown = shownRef.current;
      if (shown >= target || !allowed) {
        // Цель ушла вниз (Престиж, Импорт, сброс) или движение выключено — системой или
        // настройкой: показываем ровно её, не пересчитывая вниз через весь ряд.
        shownRef.current = target;
        paint(target);
        return;
      }
      const next = shown + (target - shown) * (1 - Math.exp(-(now - last) / APPROACH_MS));
      // Как только строка совпала, показанное значение выравнивается по цели: около
      // 1e300 прибавка тонет в мантиссе и интерполяция иначе не завершилась бы.
      const settled = formatNumber(next, notation) === formatNumber(target, notation);
      shownRef.current = settled ? target : next;
      paint(shownRef.current);
      last = now;
      // Совпало — цикл встаёт: рисовать больше нечего, а новая цель поднимет его сама.
      if (!settled) frame = requestAnimationFrame(step);
    };

    const start = () => {
      if (frame !== 0) return;
      last = performance.now();
      frame = requestAnimationFrame(step);
    };

    paint(allowed ? shownRef.current : targetRef.current);
    start();

    // Новая цель приходит из стора, а не из рендера: тик зовёт подписчика двадцать раз
    // в секунду, как и разовые set (Клик, Престиж, Импорт), а state.tokens в
    // зависимостях пересобирал бы цикл на каждом тике — дороже, чем сам цикл.
    const unsubscribe = useGameStore.subscribe((s) => {
      if (s.state.tokens === targetRef.current) return;
      targetRef.current = s.state.tokens;
      start();
    });

    // Выключение обязано показать цель сразу, а не последним интерполированным кадром;
    // включению догонять нечего — при выключенном движении показанное уже равно цели.
    const recheck = () => {
      allowed = motionAllowed();
      start();
    };
    media?.addEventListener('change', recheck);

    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
      media?.removeEventListener('change', recheck);
    };
  }, [notation, reducedMotion]);

  return (
    <>
      {/* Пустой узел: текст сюда пишет только requestAnimationFrame, и любой ререндер
          React затирал бы его своими детьми. `pre` оставляет дополняющие пробелы ячейками, а
          не схлопывает их. */}
      <FullNumber value={(s) => s.tokens} as="div" style={{ width: 'fit-content' }}>
        <div
          ref={counterRef}
          className={`pixel-${step}`}
          style={{
            color: 'var(--accent-color)',
            whiteSpace: 'pre',
            textShadow: '0 0 12px var(--accent-glow)',
          }}
        />
      </FullNumber>
      {caption && (
        <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: 'var(--space-0)' }}>
          Токенов
        </div>
      )}
    </>
  );
};

/** Доход под счётчиком: перерисовывается, только когда сама строка Дохода изменилась. */
export const IncomeLine: React.FC<{
  /** Строка закреплённой полосы телефона: без отступа сверху и без подсказки про магазин —
   *  подсказке в полосе из двух строк места нет, а новичка ведёт подсказка онбординга. */
  compact?: boolean;
}> = ({ compact = false }) => {
  const { text, zero } = useStateSlice(incomeView);
  return (
    <>
      <div
        className="pixel-22"
        style={{ color: 'var(--green)', marginTop: compact ? undefined : 'var(--space-2)', whiteSpace: 'nowrap' }}
      >
        +
        <FullNumber value={incomeOf}>
          <Num bump>{text}</Num>
        </FullNumber>{' '}
        / сек
      </div>
      {/* Подсказка при нулевом Доходе: игрок без Агентов иначе видит голый «+0/сек»
          без следующего шага. Только текст, без анимаций. */}
      {zero && !compact && (
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
          Нанятый Агент приносит Доход сам — загляни в магазин
        </div>
      )}
    </>
  );
};

/** Всплывающие числа Клика: меняются только на Клик и на уход числа через 900 мс. */
const Floaters: React.FC = () => {
  const floaters = useGameStore((s) => s.floaters);
  // Выключатель из «Настроек»: стор число всё равно ведёт, а показывать его или нет решает экран.
  const enabled = useGameStore((s) => s.state.settings.floaters);
  if (!enabled) return null;
  return (
    <>
      {floaters.map((f) => {
        // Ступень растёт с Серией: 22/33/44 px, без промежуточных масштабов (ADR-0009).
        const step = floaterStep(f.level);
        return (
          <div
            key={f.id}
            className={`floater pixel-${step}`}
            style={{ left: floaterLeft(f.x, f.text.length, step, window.innerWidth), top: f.y }}
          >
            {f.text}
          </div>
        );
      })}
    </>
  );
};

/** Лучи искр по уровню Серии (индекс = уровень): одиночный Клик искр не даёт, как и прежде. */
const SPARKS_BY_LEVEL = [0, 3, 5, 7, 9];

/** Веер вверх от точки Клика: лучи делят верхний полукруг поровну, размах растёт с уровнем. */
const sparkFan = (level: number) => {
  const n = SPARKS_BY_LEVEL[Math.min(level, SPARKS_BY_LEVEL.length - 1)] ?? 0;
  return Array.from({ length: n }, (_, i) => {
    const angle = -Math.PI + (Math.PI * (i + 0.5)) / n;
    const dist = 22 + level * 8 + (i % 3) * 6;
    return {
      dx: Math.round(Math.cos(angle) * dist),
      dy: Math.round(Math.sin(angle) * dist),
      size: level >= 3 ? 4 : 3,
    };
  });
};

/**
 * Искры Серии над кнопкой Клика. Узлы рождает стор, и только когда частицы включены и движение
 * разрешено (`effectAllowed`), а убирает его таймер: слой сам ничего не решает и не хранит.
 */
const ClickSparks: React.FC = () => {
  const bursts = useGameStore((s) => s.clickSparks);
  if (bursts.length === 0) return null;
  return (
    <div aria-hidden="true" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 999 }}>
      {bursts.map((b) =>
        sparkFan(b.level).map((p, i) => (
          <span
            key={`${b.id}-${i}`}
            className="spark"
            style={
              {
                left: b.x,
                top: b.y,
                width: p.size,
                height: p.size,
                '--spark-dx': `${p.dx}px`,
                '--spark-dy': `${p.dy}px`,
              } as React.CSSProperties
            }
          />
        )),
      )}
    </div>
  );
};

const ClickButton: React.FC = () => {
  const clickPrompt = useGameStore((s) => s.clickPrompt);
  const holdClick = useGameStore((s) => s.holdClick);
  const setPointerHold = useGameStore((s) => s.setPointerHold);
  const consumeHeldClick = useGameStore((s) => s.consumeHeldClick);
  const { value, word, tier, power } = useStateSlice(clickButtonView);
  // «Подумай ещё»: пока Клик держат, подпись под названием называет накопленное. Подпись, а не полоса
  // над кнопкой: на телефоне то, что над причалом, прячется под ним, а высота причала на счету.
  const thought = useStateSlice(thoughtMeterView);
  const btnRef = useRef<HTMLButtonElement>(null);

  /** Точка Клика на кнопке и сквош: общие для мыши и для удержанной клавиши. */
  const press = (act: (x: number, y: number) => boolean | void) => {
    const node = btnRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const x = rect.left + rect.width / 2 + (Math.random() * 40 - 20);
    const y = rect.top + 10;
    if (act(x, y) === false) return;
    // Перезапуск сквоша тем же сбросом, что у ModelRow: снятие класса и чтение ширины
    // между снятием и возвратом, иначе быстрый повторный Клик не перезапустил бы анимацию.
    node.classList.remove('click-btn--squash');
    void node.offsetWidth;
    node.classList.add('click-btn--squash');
  };

  const handleClick = () => {
    // Пробел и Enter на кнопке обслуживает слушатель ниже и гасит их родное нажатие, поэтому
    // сюда доходит мышь, касание и вспомогательные технологии — их `click` без клавиши.
    // Отпускание долгого нажатия при «Подумай ещё» — конец удержания, а не новый Клик.
    if (consumeHeldClick()) return;
    press((x, y) => clickPrompt(x, y));
  };

  // Удержание мышью или пальцем: стор сам решает, держат ли достаточно долго и действует ли Правило.
  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setPointerHold(true, rect.left + rect.width / 2, rect.top + 10);
  };
  const handlePointerUp = () => setPointerHold(false);

  // Удержание Пробела/Enter повторяет Клик. Слушатель на окне, а не на кнопке: Клик должен идти,
  // и когда фокус в никуда (после клика мышью по Сцене). Потолок в секунду держит действие стора,
  // здесь только решение «это Клик» (holdClickKeys). Слушатель живёт, пока на экране кнопка Клика:
  // на телефоне вне вкладки «Промпт» клавиши ей не принадлежат.
  useEffect(() => {
    const handled = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || !isHoldKey(e) || !holdClickAllowed(readKeyTarget(e, btnRef.current))) return;
      // Без preventDefault Пробел прокрутил бы страницу, а Enter на кнопке дал бы второй Клик.
      e.preventDefault();
      handled.add(e.key);
      // `repeat` отличает первое нажатие (обычный Клик) от автоповтора удержанной клавиши («Подумай ещё»).
      press((x, y) => holdClick(x, y, e.repeat));
    };
    // Firefox нажимает кнопку на keyup Пробела, даже если keydown отменён, поэтому отмена и здесь.
    const onKeyUp = (e: KeyboardEvent) => {
      if (!handled.delete(e.key)) return;
      e.preventDefault();
    };
    // Потеря фокуса окном посреди удержания не должна оставить «нажатую» клавишу в памяти.
    const forget = () => handled.clear();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', forget);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', forget);
    };
  }, [holdClick]);

  // Снятие по концу анимации, а не по таймеру: таймеры в компонентах запрещены.
  const handleSquashEnd = () => {
    btnRef.current?.classList.remove('click-btn--squash');
  };

  return (
    <button
      ref={btnRef}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onAnimationEnd={handleSquashEnd}
      aria-label="Отправить промпт"
      data-power-tier={tier}
      className="pixel-btn pixel-btn-accent pulse-glow click-btn"
      style={{
        width: '100%',
        // Поле по бокам — ступень 12 px, а не 16: «Отправить промпт» на 22 px с значком — 256 px
        // содержимого, а колонка телефона на 320 px даёт кнопке 252 px при 16, и подпись
        // переносилась на вторую строку, съедая высоту у причала.
        // Вертикальное поле причала телефона ниже (`--click-pad-y` в index.css): он прибит к низу и не должен
        // быть выше рабочей области на самом низком окне.
        padding: 'var(--click-pad-y, var(--space-4)) var(--space-3)',
        flexDirection: 'column',
        gap: 'var(--space-1)',
        '--click-power': power,
      } as React.CSSProperties}
    >
      {/* Значок и подпись в одну строку: ступень 22 px, потому что «Отправить промпт» на 33 px
          шире колонки Клика (16 знаков по 21 px) и ломалась на две строки, съедая высоту. */}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <Icon name="chat" size={24} />
        <span className="pixel-22" style={{ whiteSpace: 'nowrap' }}>Отправить промпт</span>
      </span>
      <span
        style={{
          fontSize: 'var(--text-sm)',
          color: 'var(--text-main)',
          fontWeight: 400,
        }}
      >
        {/* Существительное склоняется по числу: «+1 Токенов за клик» — ошибка, которую игрок
            видит буквально на первой кнопке первой минуты. Величина может быть дробной
            («1,44 B»), и там множественное верно, поэтому одна форма на «1» сломала бы
            вторую половину диапазона. */}
        {thought.holding ? (
          <>
            Размышление: <Num>{thought.seconds}</Num> с · ×<Num>{thought.mult}</Num>
          </>
        ) : (
          <>
            +<Num>{value}</Num> {word} за клик
          </>
        )}
      </span>
    </button>
  );
};

/** Прогресс до ближайшей покупки Агента: цена приходит из движка, компонент только рисует. */
const PurchaseProgress: React.FC = () => {
  const { canHire, width, now, missingText, missingWord } = useStateSlice(purchaseProgressView);
  const motion = useMotionAllowed();

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      <div
        role="progressbar"
        aria-label="Прогресс до следующей покупки"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={now}
        style={{
          width: '100%',
          height: '8px',
          backgroundColor: 'var(--bg-card)',
          border: 'var(--frame-w) solid var(--border)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${width}%`,
            height: '100%',
            backgroundColor: 'var(--accent-color)',
            transition: motion ? 'width 0.2s ease-out' : undefined,
          }}
        />
      </div>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', textAlign: 'center' }}>
        {canHire ? (
          <>Можно нанять Агента — загляни в магазин</>
        ) : (
          <>
            До следующей покупки: не хватает <Num>{missingText}</Num> {missingWord}
          </>
        )}
      </div>
    </div>
  );
};

/**
 * Полоса размышления Правила «Подумай ещё»: сколько секунд накопило удержание и во сколько раз
 * вырастет выплата. Вне Правила её нет. Высота одна и та же с удержанием и без: строка либо
 * объясняет жест, либо называет накопленное, поэтому колонка не прыгает, когда игрок нажимает.
 */
const ThoughtMeter: React.FC = () => {
  const { active, holding, seconds, mult, width } = useStateSlice(thoughtMeterView);
  if (!active) return null;
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      <div
        role="progressbar"
        aria-label="Размышление"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={width}
        style={{
          width: '100%',
          height: '8px',
          backgroundColor: 'var(--bg-card)',
          border: 'var(--frame-w) solid var(--border)',
          overflow: 'hidden',
        }}
      >
        <div style={{ width: `${width}%`, height: '100%', backgroundColor: 'var(--accent-color)' }} />
      </div>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', textAlign: 'center' }}>
        {holding ? (
          <>
            Размышление: <Num>{seconds}</Num> с · ×<Num>{mult}</Num>
          </>
        ) : (
          <>Держи Клик (Пробел, Enter или палец) — ответ придёт крупнее</>
        )}
      </div>
    </div>
  );
};

/**
 * Колонка Клика: каркас и порядок блоков. Данные из состояния читает каждый блок сам, поэтому
 * колонка не перерисовывается от тика — единственное, что она решает сама, это есть ли сейчас
 * окно События с Золотым Токеном.
 */
const ClickColumnView: React.FC<{ full?: boolean }> = ({ full = false }) => {
  const hasEvent = useGameStore((s) => s.state.event !== null);

  // Обёртка нужна стрелке подсказки: у кнопки clip-path, и стрелка внутри неё обрезалась бы.
  const clickAction = (
    <div className="click-action">
      <ClickButton />
      <CoachArrow target="click-button" single={full} />
    </div>
  );

  return (
    <div
      className={full ? 'pixel-panel click-col--phone' : 'pixel-panel'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        // У колонки телефона нет нижнего поля — оно у причала (см. `.click-dock` в index.css) — а верхнее
        // ниже: над ней стоит полоса, и каждый px здесь отнят у причала на самом низком окне.
        padding: full ? 'var(--space-2) var(--space-4) 0' : 'var(--space-4)',
        backgroundColor: 'var(--bg-panel)',
        borderRight: 'var(--frame-w) solid var(--border)',
        // Базис приходит из модуля раскладки, а не из содержимого колонки: раньше ширина была
        // min/max по содержимому, и переключение вкладки магазина дёргало всю сетку.
        // В одноколоночном режиме колонка единственная и занимает всю ширину.
        flex: full ? '1 1 auto' : '0 0 var(--col-click)',
        minWidth: 0,
        gap: 'var(--space-3)',
        height: '100%',
        overflowY: 'auto',
      }}
    >
      {/* Floating numbers */}
      <Floaters />
      <ClickSparks />

      {/* Токены и Доход. На телефоне их нет: те же числа стоят в закреплённой полосе над
          рабочей областью (`StatusStrip`), на любой вкладке, и второй счётчик на той же вкладке
          только отнимал бы высоту у кнопки Клика. */}
      {!full && (
        <div className="click-counter" style={{ textAlign: 'left', width: '100%' }}>
          <TokenCounter />
          <IncomeLine />
        </div>
      )}

      {/* Подсказка онбординга живёт здесь, а не поверх экрана: плавающая карточка вставала
          бы на сток тостов и перекрывала главное действие. В потоке колонки она всегда рядом
          с кнопкой Клика и на узком экране, и на широком. */}
      <OnboardingCoach />

      {/* Реплика говорящей Модели: на узком экране монтируется над кнопкой Клика,
          на десктопе скрывается внутри QuipBubble по THREE_COL_MIN, чтобы не дублировать Офис. */}
      <QuipBubble placement="prompt" />

      {/* Золотой Токен: появляется на время окна события прямо над кнопкой Клика, чтобы
          находка попадала в ту же область взгляда, что и главное действие игры. Карточка
          монтируется и размонтируется вместе с окном, поэтому её появление и есть
          объявление. */}
      {hasEvent && <GoldenToken />}

      {/* Главное действие, сразу под ним — Температура, под ней — Вехи одной строкой. Порядок
          «счётчик → Клик → Температура → Вехи» держит и шкалу, и кнопку на экране невысокого
          окна: всё, что ниже, второстепенно и может уйти за прокрутку. На телефоне порядок
          другой: см. причал внизу колонки. */}
      {!full && (
        <>
          {clickAction}
          <ThermalDial />
        </>
      )}

      <MilestoneStrip />

      {/* Прогресс до ближайшей покупки Агента: сколько осталось до самой дешёвой Модели.
          При пустом кошельке первого запуска полоска нулевая, но подсказка уже стоит —
          пустой полоски без текста здесь не бывает. */}
      <PurchaseProgress />
      <ThoughtMeter />

      {/* Телефон: причал внизу колонки — шкала Температуры над кнопкой Клика, а кнопка самая
          нижняя на экране, ближе всего к большому пальцу. Причал прибит к низу колонки
          (`.click-dock` в index.css) и не уезжает за прокрутку, как бы много ни стояло над ним. */}
      {full && (
        <div className="click-dock">
          <ThermalDial />
          {clickAction}
        </div>
      )}
    </div>
  );
};

export const ClickColumn = React.memo(ClickColumnView);
