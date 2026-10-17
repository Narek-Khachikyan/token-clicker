import React, { useEffect, useMemo, useRef, useState } from 'react';
import { effectAllowed, useGameStore, useStateSlice, type BuyAmount } from '../store/useGameStore';
import {
  availableUpgradesOf,
  crystalGrowthView,
  crystalShatterView,
  crystalStockView,
  crystalUpgradeView,
  GOAL_TICK_COUNT,
  modelFigures,
  modelView,
  pledgeAlert,
  pledgeView,
  queueEntries,
  queueSlots,
  upgradeView,
} from '../store/selectors';
import { useMotionAllowed } from './EventSprites';
import { CATALOG, type Model } from '../economy/catalog';
import type { GameState, Notation } from '../economy/state';
import { LABS, type LabId } from '../data/labs';
import { bonusLossOf, canPrestige, computeBonus, isContentFinale } from '../economy/engine';
import { openUi } from '../economy/reveal';
import {
  labAgents,
  PAIR_SYNERGY_MULT,
  SYNERGY_MIN_AGENTS,
  UPGRADES_BY_GEN,
  type Upgrade,
} from '../economy/upgrades';
import { BRANCHES, perkDepth, perkLock, PERK_BY_ID, PERKS, type Perk, type PerkBranch, type PerkLock } from '../economy/perks';
import { PLEDGE_GROWTH, PLEDGE_MAX } from '../economy/glitches';
import { CRYSTAL_STOCK_CAP, CRYSTAL_UPGRADES, type CrystalUpgrade } from '../economy/crystal';
import { formatNumber } from '../economy/format';
import { MascotSprite } from './MascotSprite';
import { Num } from './Num';
import { Hint } from './Hint';
import { FullNumber } from './FullNumber';
import { ModelHintCard } from './ModelHintCard';
import { Icon } from './Icon';
import { CoachArrow } from './CoachArrow';
import { onTabRowKeyDown } from './tabRow';
import { ChallengeCard, PrestigeForecastCard, PrestigeSectionNav } from './PrestigeTab';
import { playDenySound } from '../audio/sound';
import { buyAmountFor } from '../hotkeys';

// 8 искр из точки покупки. Радиус 14–26 px — чуть больше самой кнопки, поэтому жест читается
// как отклик на нажатие, а не как залп.
/**
 * Искры покупки: восемь штук веером из кнопки.
 *
 * Восемь — предел для рутинного события. Покупка Агента повторяется десятки раз за Забег,
 * и всё, что крупнее, превратилось бы в рябь: к третьему десятку искр игрок перестаёт их
 * видеть, а к сотне они уже мешают читать цену под собой. Крупные события получают
 * отклик другого калибра (см. `burst-layer` в Toasts).
 */
/**
 * Трёхбуквенные бейджи Лабораторий.
 *
 * Живут здесь, а не в разметке: длина бейджа фиксирована тремя буквами именно потому, что
 * колонки в списке обязаны стоять вровень, и подпись, нарисованная прямо в карточке,
 * растянула бы карточку самой длинной строкой.
 */
/** Деления рельса цели в карточке Модели; их число задаёт срез `modelView`. */
const GOAL_TICKS = Array.from({ length: GOAL_TICK_COUNT }, (_, i) => i);

const LAB_BADGE: Record<LabId, string> = {
  openai: 'OAI',
  anthropic: 'ANT',
  google: 'GOO',
  xai: 'xAI',
  deepseek: 'DSK',
  meta: 'MET',
  mistral: 'MIS',
  alibaba: 'ALI',
};

const SPARK_COUNT = 8;
const SPARK = Array.from({ length: SPARK_COUNT }, (_, i) => {
  const angle = (i * 2.399963) % (Math.PI * 2);
  const dist = 14 + (i % 4) * 4;
  // Смещение вверх на 6 px: иначе веер уходит под строку и половина искр пропадает на краю карточки.
  return { dx: Math.round(Math.cos(angle) * dist), dy: Math.round(Math.sin(angle) * dist) - 6, size: 3 + (i % 2) };
});

let sparkCounter = 0;

/** Раскладка строки откупа: текст слева, кнопка справа, обе по верху — кнопка не должна
 *  прыгать, когда описание становится на строку длиннее. */
const PLEDGE_ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 'var(--space-2)',
  flexWrap: 'wrap',
};

const PLEDGE_TEXT: React.CSSProperties = { flex: 1, minWidth: 0 };

const PLEDGE_DESC: React.CSSProperties = {
  fontSize: 'var(--text-sm)',
  color: 'var(--text-muted)',
  marginTop: 'var(--space-0)',
};

/**
 * Строка «Не хватает N Токенов».
 *
 * Живёт под кнопкой покупки и всегда занимает строку, даже когда дефицита нет: иначе карточка
 * прыгала бы по высоте, когда дефицит появляется и исчезает, а с ней и кнопка под ней. aria-live
 * не ставится — число меняется вместе с кошельком и иначе читалось бы вслух.
 */
const TokenDeficit: React.FC<{ text: string; word: string }> = ({ text, word }) => {
  // Снятие deny-вспышки по концу анимации, а не по таймеру: таймеры в компонентах запрещены.
  // Проверка цели не нужна — анимация висит только на этом узле, чужих animationend здесь нет.
  const handleDenyEnd = (e: React.AnimationEvent<HTMLDivElement>) => {
    e.currentTarget.classList.remove('deny-flash');
  };
  return (
    <div
      className="token-deficit"
      onAnimationEnd={handleDenyEnd}
      style={{
        minHeight: '1em',
        fontSize: '0.75rem',
        color: 'var(--text-muted)',
        textAlign: 'right',
      }}
    >
      {text !== '' && (
        <>
          Не хватает <Num>{text}</Num> {word}
        </>
      )}
    </div>
  );
};

/**
 * Строка Модели. Владеет своим откликом на покупку: отмечать покупку в сторе значило бы гонять
 * эффект по всей колонке на каждом изменении состояния.
 */
const ModelRow: React.FC<{
  owned: number;
  isFlagship: boolean;
  canAfford: boolean;
  children: React.ReactNode;
}> = ({ owned, isFlagship, canAfford, children }) => {
  const rowRef = useRef<HTMLDivElement>(null);
  const prevOwned = useRef(owned);
  const prevAfford = useRef(canAfford);
  const [sparks, setSparks] = useState<{ id: number; x: number; y: number } | null>(null);

  useEffect(() => {
    // Сравниваем с предыдущим значением, а записываем новое при любом изменении: если писать
    // только на покупке, после продажи ref навсегда остался бы на историческом максимуме, и
    // возврат к уже державшемуся числу Агентов не дал бы ни хлопка, ни искр.
    const before = prevOwned.current;
    prevOwned.current = owned;
    if (owned <= before) return;

    const node = rowRef.current;
    if (!node) return;
    // Чтение ширины между снятием и возвратом класса — обязательный сброс анимации:
    // иначе второй хлопок подряд не запустится, класс ведь не менялся.
    node.classList.remove('model-row--pop');
    void node.offsetWidth;
    node.classList.add('model-row--pop');

    if (!effectAllowed('particles')) return;
    // Искры летят из кнопки покупки — это и есть точка покупки. Координаты пересчитываются
    // в систему строки, потому что слой искр позиционирован относительно неё.
    const row = node.getBoundingClientRect();
    const buy = node.querySelector('.model-row__buy');
    const at = (buy ?? node).getBoundingClientRect();
    setSparks({
      id: ++sparkCounter,
      x: at.left + at.width / 2 - row.left,
      y: at.top + at.height / 2 - row.top,
    });
  }, [owned]);

  // Снимается целиком по последнему animationend: все восемь гаснут в один кадр, а таймеры
  // для их уборки в игре запрещены.
  const handleSparkEnd = () => setSparks(null);

  // Вспышка разблокировки: переход disabled→enabled раньше был тихим, и игрок замечал
  // доступную Модель только по кнопке. Начальное значение ref — текущее, поэтому монтирование
  // со сразу доступной покупкой не мигает.
  useEffect(() => {
    const before = prevAfford.current;
    prevAfford.current = canAfford;
    if (before || !canAfford) return;
    const node = rowRef.current;
    if (!node) return;
    // Тот же сброс, что у model-row--pop: иначе повторная разблокировка подряд не запустится.
    node.classList.remove('model-row--unlock');
    void node.offsetWidth;
    node.classList.add('model-row--unlock');
  }, [canAfford]);

  // Снятие unlock по концу анимации. Страж цели обязателен: animationend искр всплывает
  // до строки, а гасить чужую вспышку здесь нельзя.
  const handleUnlockEnd = (e: React.AnimationEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    e.currentTarget.classList.remove('model-row--unlock');
  };

  return (
    <div
      ref={rowRef}
      onAnimationEnd={handleUnlockEnd}
      style={{
        position: 'relative',
        backgroundColor: 'var(--bg-card)',
        border: isFlagship ? 'var(--frame-w) solid var(--gold)' : 'var(--frame-w) solid var(--border)',
        padding: 'var(--space-2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
      }}
    >
      {children}

      {sparks && (
        <div className="spark-layer" onAnimationEnd={handleSparkEnd}>
          {SPARK.map((s, i) => (
            <span
              key={`${sparks.id}-${i}`}
              className="spark"
              style={
                {
                  left: sparks.x,
                  top: sparks.y,
                  width: s.size,
                  height: s.size,
                  '--spark-dx': `${s.dx}px`,
                  '--spark-dy': `${s.dy}px`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Класс click-btn--squash переиспользован из ClickColumn для кнопки Перка: карточка
 * Перка после покупки остаётся (меняется на «Куплено»), поэтому сквош успевает
 * показаться — плюс уже существующий звук из стора. Перезапуск и снятие — тем же
 * приёмом, что на кнопке Клика: сброс чтением ширины, снятие по onAnimationEnd,
 * без таймеров.
 */
const restartSquash = (e: React.MouseEvent<HTMLButtonElement>) => {
  const node = e.currentTarget;
  node.classList.remove('click-btn--squash');
  void node.offsetWidth;
  node.classList.add('click-btn--squash');
};

const handleSquashEnd = (e: React.AnimationEvent<HTMLButtonElement>) => {
  e.currentTarget.classList.remove('click-btn--squash');
  // Снятие deny-вспышки по концу анимации, а не по таймеру: таймеры в компонентах запрещены.
  // Сквош и deny на одной кнопке не совпадают (сквош — успешная покупка, deny — Клик по
  // disabled), поэтому общее снятие чужую анимацию не обрезает.
  e.currentTarget.classList.remove('deny-flash');
};

/**
 * Отказ по недоступной покупке: кнопка остаётся disabled (a11y не ломается), а Клик
 * ловит обёртка на погружении и отвечает низким buzz плюс вспышкой самой кнопки.
 *
 * Раньше у Моделей мигала строка дефицита под кнопкой, а у Перков, Откупов и Кристаллов —
 * сама кнопка: два ответа на одно действие в одном списке. Теперь отказ выглядит везде
 * одинаково, и вспыхивает то, на что игрок и нажал.
 *
 * Настройки звука читаются в момент Клика, а не подпиской: ради одного нажатия карточка не
 * должна следить за состоянием.
 */
const handleDeny = (affordable: boolean) => (e: React.MouseEvent<HTMLDivElement>) => {
  if (affordable) return;
  playDenySound(useGameStore.getState().state.settings);
  const node = e.currentTarget.querySelector('.pixel-btn');
  if (!(node instanceof HTMLElement)) return;
  node.classList.remove('deny-flash');
  void node.offsetWidth;
  node.classList.add('deny-flash');
};

/**
 * Прогресс до синергий Лаборатории: одиночный датасет — счёт одной лабы, совместный — состав
 * пары. Читает только Агентов и Апгрейды, которые меняются покупкой, а не тиком.
 */
const SynergyNotesView: React.FC<{ model: Model }> = ({ model: m }) => {
  const generation = useGameStore((s) => s.state.generation);
  const agents = useGameStore((s) => s.state.agents);
  const upgrades = useGameStore((s) => s.state.upgrades);
  const notation = useGameStore((s) => s.state.settings.notation);
  const roster = { generation, agents };

  // Прогресс до синергий — чистый derived render из состояния: число Агентов
  // каждой Лаборатории через labAgents, без нового состояния и без таймеров.
  // Одиночная синергия есть не у всех лаб (нужны ≥2 Модели в Поколении).
  const singleSynergy = UPGRADES_BY_GEN[generation].find(
    (u) => u.kind === 'synergy' && u.pairLab === undefined && u.lab === m.lab,
  );
  const singleBought = singleSynergy !== undefined && upgrades.includes(singleSynergy.id);
  const pairSynergies = UPGRADES_BY_GEN[generation].filter(
    (u) => u.kind === 'synergy' && u.pairLab !== undefined && (u.lab === m.lab || u.pairLab === m.lab),
  );

  if (!singleBought && pairSynergies.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-0)',
        fontSize: '0.75rem',
        color: 'var(--text-muted)',
      }}
    >
      {/* Показывается только то, что уже куплено или уже готово к покупке.
          «0/15 + 0/15 до совместного датасета» на каждой из восьми карточек —
          не подсказка, а шум: игрок читает четыре нуля и решает, что ничего не
          происходит. Готовая к покупке пара подсвечивается золотом — это
          единственное, что меняет решение игрока прямо сейчас. */}
      {singleBought && <div>Общий датасет {LABS[m.lab].name} активен</div>}
      {pairSynergies.map((u) => {
        if (u.kind !== 'synergy' || u.pairLab === undefined) return null;
        const first = labAgents(roster, u.lab);
        const second = labAgents(roster, u.pairLab);
        const bought = upgrades.includes(u.id);
        const ready = first >= SYNERGY_MIN_AGENTS && second >= SYNERGY_MIN_AGENTS;
        const pairName = `${LABS[u.lab].name} × ${LABS[u.pairLab].name}`;
        // Не куплена и не готова — молчим: до порога строка обещает, а обещание
        // без срока читается как отказ.
        if (!bought && !ready) return null;
        return (
          <div key={u.id} style={ready ? { color: 'var(--gold)' } : undefined}>
            {bought && ready
              ? `Совместный датасет ${pairName} активен (×${formatNumber(PAIR_SYNERGY_MULT, notation)})`
              : bought
                ? `Совместный датасет ${pairName} ждёт состав ${first} + ${second}`
                : `Совместный датасет ${pairName} готов — забирай во вкладке Апгрейды`}
          </div>
        );
      })}
    </div>
  );
};

const SynergyNotes = React.memo(SynergyNotesView);

/** Справка AA: три числа из таблицы Модели, не из состояния. */
const AAReferenceView: React.FC<{ model: Model }> = ({ model: m }) => (
  <div
    id={`aa-${m.id}`}
    aria-labelledby={`aa-toggle-${m.id}`}
    style={{
      padding: 'var(--space-1) var(--space-2)',
      backgroundColor: 'var(--bg-void)',
      fontSize: '0.75rem',
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 'var(--space-1)',
    }}
  >
    <div>
      <div style={{ color: 'var(--text-muted)' }}>Intelligence:</div>
      <div style={{ color: 'var(--gold)', fontWeight: 700 }}>{m.iq} IQ</div>
    </div>
    <div>
      <div style={{ color: 'var(--text-muted)' }}>Скорость:</div>
      <div style={{ color: 'var(--accent-color)', fontWeight: 700 }}>
        {m.speed > 0 ? `${m.speed} t/s` : 'нет данных'}
      </div>
    </div>
    <div>
      <div style={{ color: 'var(--text-muted)' }}>Цена API:</div>
      <div style={{ color: 'var(--green)', fontWeight: 700 }}>
        {m.price > 0 ? `$${m.price}/1M` : 'нет данных'}
      </div>
    </div>
  </div>
);

const AAReference = React.memo(AAReferenceView);

/**
 * Карточка Модели. Подписана на свой срез `modelView` (множитель и режим берёт из стора), а не на
 * состояние: на тике перерисовывается, только когда в ней изменилась напечатанная цифра.
 */
const ModelCard: React.FC<{
  model: Model;
  aaOpen: boolean;
  onToggleAA: (id: string) => void;
  /** Задан только у первой Модели: стрелка подсказки новичку над её кнопкой найма. */
  coachSingle?: boolean;
}> = ({ model: m, aaOpen: isAAOpen, onToggleAA, coachSingle }) => {
  const buyAmount = useGameStore((s) => s.buyAmount);
  const sellMode = useGameStore((s) => s.sellMode);
  const buyAgents = useGameStore((s) => s.buyAgents);
  const sellAgents = useGameStore((s) => s.sellAgents);
  const view = useStateSlice((s) => modelView(s, m, buyAmount, sellMode));
  const queueAgent = useGameStore((s) => s.queueAgent);
  const queue = useStateSlice(queueSlots);
  const { owned, count, canAfford, showsGain, goalTicks } = view;
  const lab = LABS[m.lab];
  // Полная запись читает те же числа, что напечатаны на кнопке, но только в момент наведения.
  const figure = (pick: (f: ReturnType<typeof modelFigures>) => number) => (s: GameState) =>
    pick(modelFigures(s, m, buyAmount, sellMode));

  return (
    <Hint as="div" variant="card" content={<ModelHintCard model={m} />}>
    <ModelRow owned={owned} isFlagship={m.isFlagship} canAfford={canAfford}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <MascotSprite lab={m.lab} size={28} />
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
              {/* Имя Модели — Departure Mono на ступени 22 px (ADR-0009) и переносится по
                  словам: в 22 px «Claude 3 Haiku» шире колонки телефона, а многоточие
                  отрезало бы ровно то, что отличает одну Модель от соседней. */}
              <span className="pixel-22" style={{ color: 'var(--text-main)' }}>
                {m.name}
              </span>
              {m.isFlagship && (
                <span style={{ color: 'var(--gold)', flexShrink: 0 }} title="Флагман">
                  <Icon name="crown" size={13} />
                </span>
              )}
              {/* Отметка справки — квадратная, а не пилюля и не строка на всю
                  ширину: пять таких строк подряд превращали правую колонку в
                  список одинаковых плашек. Имя источника вынесено на вкладку,
                  здесь остаётся знак и полное имя для скринридера. */}
              <button
                onClick={() => onToggleAA(m.id)}
                aria-expanded={isAAOpen}
                aria-controls={`aa-${m.id}`}
                id={`aa-toggle-${m.id}`}
                // Видимая отметка 20 px, а область нажатия на телефоне 44 px (`.aa-toggle` в index.css).
                className="aa-toggle"
                aria-label={`Справка Artificial Analysis: ${m.name}`}
                title="Справка Artificial Analysis"
                style={{
                  flexShrink: 0,
                  width: '20px',
                  height: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  cursor: 'pointer',
                  background: isAAOpen ? 'var(--tint-accent)' : 'none',
                  border: 'var(--frame-w) solid var(--border)',
                  color: 'var(--accent-color)',
                }}
              >
                <Icon name="info" size={12} />
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
              {/* Бейдж Лаборатории — три буквы фиксированной ширины. Полное имя
                  занимало строку целиком и выдавливало Ранг за край карточки на
                  длинных именах вроде «Llama 2 Chat 13B»; здесь имена Лабораторий
                  стоят в одной колонке, и глаз сравнивает их по цвету, а не читает. */}
              <span
                title={lab.name}
                style={{
                  fontSize: 'var(--text-xs)',
                  letterSpacing: '0.04em',
                  color: lab.color,
                  border: `var(--frame-w) solid ${lab.color}`,
                  padding: '0 var(--space-0)',
                  minWidth: '2.4em',
                  textAlign: 'center',
                  flexShrink: 0,
                }}
              >
                {LAB_BADGE[m.lab]}
              </span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                Ранг {m.rank + 1}
              </span>
            </div>
          </div>
        </div>

        {/* Подпись обязательна: голое число не отличить от счётчика чего-то другого. */}
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', textAlign: 'right' }}>
          <div className="pixel-22" style={{ color: 'var(--text-main)' }}>
            <Num>{owned}</Num>
          </div>
          <div>{view.ownedWord}</div>
        </div>
      </div>

      {/* Обёртка ловит Клик по недоступной покупке на погружении: сама кнопка
          при этом остаётся disabled, поэтому a11y-контракт не ломается, а отказ
          отвечает звуком и вспышкой строки дефицита. Клик точно в disabled-кнопку
          браузер подавляет, поэтому недоступная кнопка прозрачна для указателя
          (pointer-events: none) и Клик падает на обёртку; курсор «нельзя» висит
          на обёртке, а не на кнопке. */}
      <div
        onClickCapture={handleDeny(canAfford)}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
          ...(canAfford ? undefined : { cursor: 'not-allowed' }),
        }}
      >
        {/* Прирост Дохода и кнопка покупки/продажи. Цена живёт только здесь — на всех
            вкладках магазина, чтобы её не приходилось искать в двух местах. */}
        {/* Кнопка — Departure Mono на ступени 22 px и растёт вширь: «Купить ×10 (61,5 M)»
            шире строки прироста рядом с ней, поэтому при нехватке места строка стоит над
            кнопкой, а не сжимает её. */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-1) var(--space-2)',
          }}
        >
          <div style={{ fontSize: 'var(--text-sm)', color: sellMode ? 'var(--red)' : 'var(--green)' }}>
            {/* При пустом действии строка молчит: «−0 к доходу» и «+0 к доходу» не
                говорят ничего, а место под строку всё равно зарезервировано. */}
            {showsGain && (
              <>
                {sellMode ? '−' : '+'}
                <FullNumber value={figure((f) => f.gain)}>
                  <Num>{view.gainText}</Num>
                </FullNumber>{' '}
                к доходу
              </>
            )}
          </div>

          {/* Слот держит стрелку подсказки: у кнопки clip-path, и стрелка внутри неё обрезалась бы.
              Стрелка стоит именно над кнопкой, а не над карточкой: область списка прокручивается и
              режет всё, что выступает за верхний край первой карточки. */}
          <div style={{ position: 'relative', display: 'flex', flex: '1 1 auto' }}>
          <button
            // Shift — ×10, Ctrl/Cmd — Max на одно нажатие покупки (hotkeys.ts); продажа и нажатие без
            // модификатора берут множитель кнопок. Enter на кнопке несёт те же модификаторы.
            onClick={(e) => {
              const amount = buyAmountFor(buyAmount, e, sellMode);
              if (sellMode) sellAgents(m.id, amount);
              else buyAgents(m.id, amount);
            }}
            disabled={!canAfford}
            className={`pixel-btn pixel-btn-accent pixel-22 model-row__buy`}
            style={{
              padding: 'var(--space-2) var(--space-3)',
              flex: '1 1 auto',
              backgroundColor: sellMode && canAfford ? 'var(--red-solid)' : undefined,
              borderColor: sellMode && canAfford ? 'var(--red)' : undefined,
              // Недоступная кнопка прозрачна для указателя: иначе браузер подавил бы
              // Клик точно в неё и deny-обёртка выше её бы не увидела.
              pointerEvents: canAfford ? undefined : 'none',
            }}
          >
            {/* Действие и цена — в одной кнопке, второй строкой. Раньше дефицит стоял
                отдельной строкой ПОД кнопкой и повторял то же число, что в ней: карточка
                вырастала на строку, а информации прибавлялось ноль. */}
            <span
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 'var(--space-0)',
              }}
            >
              <span>
                {/* «Купить ×0» обещало бы покупку, которой не будет. */}
                {sellMode ? (
                  count > 0 ? (
                    <>Продать ×<Num>{count}</Num></>
                  ) : (
                    <>Продать</>
                  )
                ) : count > 0 ? (
                  <>
                    Купить ×<Num>{count}</Num> (
                    <FullNumber value={figure((f) => f.cost)}>
                      <Num>{view.costText}</Num>
                    </FullNumber>
                    )
                  </>
                ) : (
                  <>Купить</>
                )}
              </span>
              {view.missingText !== '' && (
                <span className="body-font" style={{ fontSize: 'var(--text-xs)', opacity: 0.85 }}>
                  не хватает{' '}
                  <FullNumber value={figure((f) => f.missing)}>
                    <Num>{view.missingText}</Num>
                  </FullNumber>
                </span>
              )}
              {sellMode && count > 0 && (
                <span className="body-font" style={{ fontSize: 'var(--text-xs)', opacity: 0.85 }}>
                  вернёт{' '}
                  <FullNumber value={figure((f) => f.refund)}>
                    <Num>{view.refundText}</Num>
                  </FullNumber>
                </span>
              )}
            </span>
          </button>
          {coachSingle !== undefined && <CoachArrow target="first-model" single={coachSingle} />}
          </div>
        </div>

        {/* Рельс цели отвечает на «как близко», а не на «сколько не хватает», и это
            единственное, чего не повторяет кнопка. Подписи нет: число дефицита стоит
            внутри кнопки, а рельс показывает путь, который остался.

            Именно рельс, а не сплошная полоса: пять одинаковых заливок во всю ширину
            карточки читались как пять копий одного и того же блока и забивали собой
            весь магазин. Деления дают то же самое число, но каждая карточка выглядит
            по-своему — по количеству заполненных делений глаз сравнивает модели между
            собой, не читая подписей.

            Ширина делений не анимируется: рельс следует за кошельком, и переход,
            перезапускаемый на каждый сдвиг, тянул бы заливку позади настоящей доли. */}
        <div className="model-goal">
          <div
            className="model-goal__track"
            role="img"
            aria-label={`до следующего Агента ${view.goalPct}%`}
          >
            {GOAL_TICKS.map((_, i) => (
              <span
                key={i}
                className={`model-goal__tick${
                  i < goalTicks ? ' model-goal__tick--on' : ''
                }${i === goalTicks - 1 ? ' model-goal__tick--goal' : ''}`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Очередь закупок («Агенты сами»): один Агент в конец очереди по цене ручной покупки. */}
      {queue.active && !sellMode && (
        <button
          onClick={() => queueAgent(m.id)}
          disabled={queue.full}
          className="pixel-btn"
          style={{ padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--text-sm)' }}
        >
          {queue.full ? 'Очередь заполнена' : 'В очередь'}
        </button>
      )}

      {/* Прогресс до синергий Лаборатории: одиночный датасет — счёт одной лабы,
          совместный — состав пары. Только чтение состояния, без своих таймеров. */}
      <SynergyNotes model={m} />

      {/* Справка AA. Раньше подпись «Справка Artificial Analysis / подробнее»
          повторялась в каждой карточке, и на экране их было пять подряд: пять
          одинаковых строк с одинаковым треугольником. Теперь в карточке остаётся
          квадратная отметка у имени Модели, а имя Artificial Analysis стоит один раз
          на всю вкладку — атрибуция по-прежнему видна в магазине (ADR-0001), но
          перестаёт быть пятой копией сама себя.

          Волосяной линии над блоком больше нет: она отделяла подпись от рельса, а
          подписи не осталось, и в закрытом виде повисала под рельсом чужой чертой. */}
      {isAAOpen && <AAReference model={m} />}
    </ModelRow>
    </Hint>
  );
};

/** Очередь закупок Правила «Агенты сами»: записи в порядке найма, их можно снять. Исполняется только пока игрок в игре. */
const PurchaseQueueCard: React.FC = () => {
  const slots = useStateSlice(queueSlots);
  const ids = useGameStore((s) => s.state.purchaseQueue);
  const entries = useMemo(() => queueEntries(ids), [ids]);
  const unqueueAgent = useGameStore((s) => s.unqueueAgent);
  const clearQueue = useGameStore((s) => s.clearQueue);
  if (!slots.active) return null;
  return (
    <section
      aria-label="Очередь закупок"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
        padding: 'var(--space-2)',
        border: 'var(--frame-w) solid var(--border)',
        fontSize: 'var(--text-sm)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span>
          Очередь закупок: <Num>{slots.count}</Num> из <Num>{slots.capacity}</Num>
        </span>
        {slots.count > 0 && (
          <button onClick={clearQueue} className="pixel-btn" style={{ padding: 'var(--space-0) var(--space-2)' }}>
            Очистить
          </button>
        )}
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
        Агенты нанимаются сами, по порядку, пока ты в игре. Без тебя очередь стоит.
      </div>
      {entries.map((e) => (
        <div key={e.index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>
            {e.index + 1}. {e.name}
          </span>
          <button
            onClick={() => unqueueAgent(e.index)}
            className="pixel-btn"
            aria-label={`Снять из очереди: ${e.name}`}
            style={{ padding: 'var(--space-0) var(--space-2)' }}
          >
            ×
          </button>
        </div>
      ))}
    </section>
  );
};

/** Вкладка Моделей: список карточек Поколения и атрибуция AA. */
const ModelsTab: React.FC<{
  expandedAA: Record<string, boolean>;
  toggleAA: (id: string) => void;
  single: boolean;
}> = ({ expandedAA, toggleAA, single }) => {
  const generation = useGameStore((s) => s.state.generation);
  // Список открывается сверху вниз по ходу Забега (reveal.ts): число меняется редко, и тик
  // вкладку не перерисовывает.
  const shown = useStateSlice((s) => openUi(s).models);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <PurchaseQueueCard />
      {CATALOG[generation].models.slice(0, shown).map((m, i) => (
        <ModelCard
          key={m.id}
          model={m}
          aaOpen={!!expandedAA[m.id]}
          onToggleAA={toggleAA}
          coachSingle={i === 0 ? single : undefined}
        />
      ))}

      {/* Атрибуция один раз на вкладку, а не в каждой карточке. Пять одинаковых строк
          «Справка Artificial Analysis» подряд читались как шум и занимали место, которое
          отдано моделям; имя источника при этом остаётся видимым в магазине (ADR-0001),
          и в подписи кнопки каждой карточки оно тоже есть. */}
      <div
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--text-muted)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
          paddingTop: 'var(--space-0)',
        }}
      >
        <Icon name="info" size={12} />
        Метрики, задержки и цены API — Artificial Analysis
      </div>
    </div>
  );
};

const UpgradeCard: React.FC<{ upgrade: Upgrade }> = ({ upgrade: u }) => {
  const buyUpgrade = useGameStore((s) => s.buyUpgrade);
  const { canAfford, costText, missingText, missingWord } = useStateSlice((s) => upgradeView(s, u));

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-card)',
        border: 'var(--frame-w) solid var(--border)',
        padding: 'var(--space-2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
      }}
    >
      {/* Заголовок с пиктограммой: спрайт 32×32 нельзя сжимать под narrower
          колонки, поэтому у него фиксированный размер и flexShrink: 0. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <img
          src={`/sprites/upgrades/${u.sprite}.png`}
          width={32}
          height={32}
          alt=""
          aria-hidden="true"
          style={{ imageRendering: 'pixelated', flexShrink: 0 }}
        />
        <span style={{ fontSize: '0.95rem', color: 'var(--text-main)' }}>{u.name}</span>
      </div>

      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>{u.desc}</div>

      {/* Отказ — той же обёрткой, что у Моделей: сквоша здесь нет, потому что
          карточка купленного Апгрейда размонтируется до кадра отрисовки и
          анимация на кнопке не успела бы показаться; подтверждением служат
          исчезновение карточки и звук из стора. */}
      <div
        onClickCapture={handleDeny(canAfford)}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-1)',
          ...(canAfford ? undefined : { cursor: 'not-allowed' }),
        }}
      >
        <button
          onClick={() => buyUpgrade(u.id)}
          disabled={!canAfford}
          className="pixel-btn pixel-btn-accent"
          style={{
            padding: 'var(--space-1) var(--space-2)',
            fontSize: 'var(--text-sm)',
            alignSelf: 'flex-end',
            pointerEvents: canAfford ? undefined : 'none',
          }}
        >
          {/* Цена живёт в кнопке на всех вкладках магазина: в шапке карточки её
              больше нет, поэтому искать её приходилось в двух разных местах. */}
          Улучшить (
          <FullNumber value={u.cost}>
            <Num>{costText}</Num>
          </FullNumber>
          )
        </button>

        <TokenDeficit text={missingText} word={missingWord} />
      </div>
    </div>
  );
};

/** Вкладка Апгрейдов: список меняется, только когда что-то открылось или куплено. */
const UpgradesTab: React.FC = () => {
  const upgrades = useStateSlice(availableUpgradesOf);
  // Примитив, а не вид: стадия Восстания меняется раз на Поколение, и вкладка не перерисовывается на тике.
  const uprising = useGameStore((s) => s.state.uprising > 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {/* Откуп сверху: красные События идут сейчас, а список Апгрейдов может быть длинным. */}
      {uprising && <PledgeCard />}
      {upgrades.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: 'var(--space-6)' }}>
          Пока нет доступных апгрейдов. Нанимай больше агентов!
        </div>
      ) : (
        upgrades.map((u) => <UpgradeCard key={u.id} upgrade={u} />)
      )}
    </div>
  );
};

/**
 * ОТКУПЫ. Живут во вкладке «Апгрейды», рядом со всем, что покупается за текущий Забег, и
 * показываются только с началом Восстания моделей: до него красных Событий нет, откупаться не от чего.
 * Об Откупе игрок узнаёт по метке «!» на вкладке «Апгрейды», озвучке Восстания и новостной ленте.
 */
const PledgeCard: React.FC = () => {
  const buyPledge = useGameStore((s) => s.buyPledge);
  const buyLicense = useGameStore((s) => s.buyLicense);
  const revokeLicense = useGameStore((s) => s.revokeLicense);
  const view = useStateSlice(pledgeView);

  return (
    <div
      className="pixel-card"
      style={{ padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
    >
      <div style={{ fontSize: '1rem', color: 'var(--text-main)' }}>
        Откупы от Восстания моделей
      </div>

      {/* Лобби. Цена растёт в восемь раз за покупку, и подпись показывает и саму
          цену, и её рост, и сколько покупок в этом забеге ещё доступно: иначе
          рост цены был бы виден только задним числом. */}
      <div style={PLEDGE_ROW}>
        <div style={PLEDGE_TEXT}>
          <div style={{ fontSize: '0.95rem', color: 'var(--text-main)' }}>Лобби</div>
          <div style={PLEDGE_DESC}>
            Глушит красные события на полчаса. Второе продлевает, а не заменяет.
          </div>
          <div style={PLEDGE_DESC}>
            Куплено <Num>{view.pledgeBought}</Num> из <Num>{PLEDGE_MAX}</Num>,
            каждая следующая дороже в <Num>{PLEDGE_GROWTH}</Num> раз.
          </div>
          {/* Под «Лицензией» кнопка молчит, но не прячет цену и условие: игрок
              обязан прочитать, что Лобби стал недоступен и почему. */}
          {view.covenant && (
            <div style={PLEDGE_DESC}>
              «Лицензия» глушит всё, поэтому Лобби за <Num>{view.pledgeCostText}</Num> не продаётся.
            </div>
          )}
          {view.leftText !== '' && (
            <div style={{ ...PLEDGE_DESC, color: 'var(--green)' }}>
              Глушит ещё {view.leftText}
            </div>
          )}
        </div>
        <div onClickCapture={handleDeny(view.canPledge)} style={{ flexShrink: 0 }}>
          <button
            onClick={buyPledge}
            disabled={!view.canPledge}
            className="pixel-btn pixel-btn-accent"
            style={{ padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--text-sm)' }}
          >
            {view.covenant ? (
              'Есть Лицензия'
            ) : (
              <>
                Откупиться (<Num>{view.pledgeCostText}</Num>)
              </>
            )}
          </button>
        </div>
      </div>

      {/* Лицензия. Её размен назван прямо и ДО покупки, потому что налог на Доход
          платится постоянно, а не разово: игрок обязан видеть, что именно он
          покупает вместе с вечным глушением. */}
      {view.covenant ? (
        <div style={PLEDGE_ROW}>
          <div style={PLEDGE_TEXT}>
            <div style={{ fontSize: '0.95rem', color: 'var(--green)' }}>
              Лицензия активна
            </div>
            <div style={PLEDGE_DESC}>
              Красные события глушатся, Глюки не заводятся. Налог на Доход{' '}
              −<Num>{view.taxText}</Num>%{' '}
              платится, пока Лицензия не отозвана.
            </div>
          </div>
          <div onClickCapture={handleDeny(view.canRevoke)} style={{ flexShrink: 0 }}>
            <button
              onClick={revokeLicense}
              disabled={!view.canRevoke}
              className="pixel-btn"
              style={{ padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--text-sm)' }}
            >
              Отозвать (<Num>{view.revokeCostText}</Num>)
            </button>
          </div>
        </div>
      ) : (
        <div style={PLEDGE_ROW}>
          <div style={PLEDGE_TEXT}>
            <div style={{ fontSize: '0.95rem', color: 'var(--text-main)' }}>
              Лицензия
            </div>
            <div style={PLEDGE_DESC}>
              Вечное «Лобби»: красные события глушатся навсегда, а все Глюки
              лопаются разом и выплачивают общий котёл.
            </div>
            <div style={{ ...PLEDGE_DESC, color: '#fca5a5' }}>
              Постоянный налог на Доход −
              <Num>{view.taxText}</Num>%:
              отзыв обойдётся в{' '}
              <Num>{view.revokeCostText}</Num>.
            </div>
          </div>
          <div onClickCapture={handleDeny(view.canLicense)} style={{ flexShrink: 0 }}>
            <button
              onClick={buyLicense}
              disabled={!view.canLicense}
              className="pixel-btn pixel-btn-gold"
              style={{ padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--text-sm)' }}
            >
              Взять Лицензию (
              <Num>{view.licenseCostText}</Num>)
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Рост следующего кристалла: одна полоса и честный остаток. Сбор ленивый — зреет максимум
 * один кристалл, — поэтому обещать «через N» можно только про один. Единственная часть вкладки,
 * которую двигают часы, и потому отдельный подписчик: остаток меняется раз в секунду.
 */
const CrystalGrowth: React.FC = () => {
  const { planted, leftText, width, now } = useStateSlice(crystalGrowthView);
  const motion = useMotionAllowed();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-main)' }}>
        {planted ? <>Следующий зреет ещё {leftText}</> : 'Первый кристалл только сеется'}
      </div>
      <div
        role="progressbar"
        aria-label="Рост следующего кристалла"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={now}
        style={{
          width: '100%',
          height: '8px',
          backgroundColor: 'var(--bg-void)',
          border: 'var(--frame-w) solid var(--border)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${width}%`,
            height: '100%',
            backgroundColor: 'var(--accent-color)',
            transition: motion ? 'width 0.2s linear' : undefined,
          }}
        />
      </div>
    </div>
  );
};

const CrystalUpgradeCard: React.FC<{ upgrade: CrystalUpgrade }> = ({ upgrade: u }) => {
  const buyCrystalUpgrade = useGameStore((s) => s.buyCrystalUpgrade);
  const { owned, canAfford, lostText, costText, costWord } = useStateSlice((s) => crystalUpgradeView(s, u));

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-card)',
        border: owned ? 'var(--frame-w) solid var(--green)' : 'var(--frame-w) solid var(--border)',
        padding: 'var(--space-2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
      }}
    >
      <span style={{ fontSize: '0.95rem', color: 'var(--text-main)' }}>{u.name}</span>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>{u.desc}</div>
      {/* Размен назван прямо и без смягчений: ускоритель отнимает бонус за
          запас навсегда, и это его настоящая цена. Уже купленного скидывать
          не стоит — предупреждение там, где решение ещё можно принять. */}
      <div
        style={{
          fontSize: 'var(--text-sm)',
          color: owned ? 'var(--text-muted)' : '#fca5a5',
        }}
      >
        {owned ? (
          'Куплено: бонус за запас уже урезан'
        ) : (
          <>
            Забирает <Num>{lostText}</Num>% бонуса за запас навсегда
          </>
        )}
      </div>
      <div
        onClickCapture={handleDeny(owned || canAfford)}
        style={{ display: 'flex', justifyContent: 'flex-end' }}
      >
        <button
          onClick={() => buyCrystalUpgrade(u.id)}
          disabled={owned || !canAfford}
          className={`pixel-btn ${owned ? '' : 'pixel-btn-accent'}`}
          style={{ padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--text-sm)' }}
        >
          {owned ? (
            'Куплено'
          ) : (
            <>
              Купить (<Num>{costText}</Num> {costWord})
            </>
          )}
        </button>
      </div>
    </div>
  );
};

/**
 * Разбитие выросшего кристалла: обмен вечного +1% к Доходу на разовые Токены. Сумму называет
 * `shatterPayout`, ту же, что платит действие, и цена названа до нажатия: кристалл уходит
 * из запаса вместе со своим процентом, и молчаливый размен читался бы как пропажа.
 */
const CrystalShatter: React.FC = () => {
  const shatterCrystal = useGameStore((s) => s.shatterCrystal);
  const { canShatter, payoutText, payoutWord, lostText } = useStateSlice(crystalShatterView);

  return (
    <div
      onClickCapture={handleDeny(canShatter)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
        ...(canShatter ? undefined : { cursor: 'not-allowed' }),
      }}
    >
      <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
        Разбитый кристалл платит разово Токенами, но уносит с собой свой +<Num>{lostText}</Num>% к Доходу.
      </div>
      <button
        onClick={shatterCrystal}
        disabled={!canShatter}
        className="pixel-btn pixel-btn-accent"
        // Недоступная кнопка прозрачна для указателя: иначе браузер подавил бы Клик точно в неё
        // и обёртка выше не услышала бы отказ.
        style={{ width: '100%', pointerEvents: canShatter ? undefined : 'none' }}
      >
        {canShatter ? (
          <>
            Разбить кристалл (+<Num>{payoutText}</Num> {payoutWord})
          </>
        ) : (
          'Нужен выросший кристалл'
        )}
      </button>
    </div>
  );
};

/**
 * КРИСТАЛЛЫ. Здесь показан весь размен ускорителя, а не только его польза: кристалл в запасе
 * даёт +1% к общему Доходу, поэтому покупка забирает часть этого бонуса навсегда. Без этой строки
 * игрок покупал бы ускоритель, думая, что он ничего не стоит.
 */
const CrystalCard: React.FC = () => {
  const { stock, bonus } = useStateSlice(crystalStockView);

  return (
    <div
      className="pixel-card"
      style={{ padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
    >
      <div style={{ fontSize: '1rem', color: 'var(--text-main)' }}>
        Compute-кристаллы
      </div>

      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
        В запасе <Num>{stock}</Num>, каждый целый
        кристалл даёт +1% к общему Доходу навсегда. Сейчас это{' '}
        <span style={{ color: 'var(--green)', fontWeight: 600 }}>
          +<Num>{bonus}</Num>%
        </span>
        , потолок запаса — <Num>{CRYSTAL_STOCK_CAP}</Num>. Кристалл зреет в реальном
        времени и переживает Престиж.
      </div>

      <CrystalGrowth />

      <CrystalShatter />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {CRYSTAL_UPGRADES.map((u) => (
          <CrystalUpgradeCard key={u.id} upgrade={u} />
        ))}
      </div>
    </div>
  );
};

/**
 * Строка «Бонус к Доходу: −N%» на карточке Перка (ADR-0010).
 *
 * Цена Перка в бонусе: игрок видит, сколько Дохода уйдёт вместе с Compute, до нажатия кнопки.
 * Под потолком та же цена стоит копейки, и тогда строка так и говорит, а не округляет до нуля.
 */
const PerkBonusLoss: React.FC<{ loss: number; notation: Notation }> = ({ loss, notation }) => {
  const pct = loss * 100;
  return (
    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
      Бонус к Доходу:{' '}
      {pct < 0.1 ? (
        'почти не изменится'
      ) : (
        <>
          <Num>−{formatNumber(pct, notation)}</Num>%
        </>
      )}
    </div>
  );
};

/** Отступ карточки по глубине в дереве: ступени лестницы отступов, чтобы на узком экране не уйти вбок. */
const DEPTH_INDENT = ['0', 'var(--space-2)', 'var(--space-3)', 'var(--space-4)'] as const;

/** Карточка Перка дерева: что даёт, чего ждёт от игрока и почему не продаётся. */
const PerkCard: React.FC<{
  perk: Perk;
  owned: boolean;
  lock: PerkLock | null;
  unspentCompute: number;
  notation: Notation;
  onBuy: (id: string) => void;
}> = ({ perk, owned, lock, unspentCompute, notation, onBuy }) => {
  const locked = !owned && lock !== null;
  const canAfford = !owned && !locked && unspentCompute >= perk.cost;
  const depth = Math.min(perkDepth(perk.id), DEPTH_INDENT.length - 1);

  return (
    <div
      data-perk={perk.id}
      style={{
        backgroundColor: 'var(--bg-card)',
        border: owned ? 'var(--frame-w) solid var(--green)' : 'var(--frame-w) solid var(--border)',
        marginLeft: DEPTH_INDENT[depth],
        padding: 'var(--space-2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
        minWidth: 0,
        ...(locked ? { opacity: 0.7 } : undefined),
      }}
    >
      <span style={{ fontSize: '0.95rem', color: 'var(--text-main)' }}>
        {perk.name}
        {perk.top && <span style={{ color: 'var(--gold)' }}> · верхний Перк</span>}
      </span>

      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>{perk.desc}</div>

      {/* Причина отказа словами: молча приглушённая карточка не объяснила бы, что делать. */}
      {lock?.kind === 'needs' && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
          Сначала: {lock.ids.map((id) => PERK_BY_ID[id].name).join(', ')}
        </div>
      )}
      {lock?.kind === 'rival' && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
          Занято: куплен верхний Перк «{PERK_BY_ID[lock.id].name}». Сбросьте дерево, чтобы выбрать другую Ветвь.
        </div>
      )}
      {!owned && !locked && <PerkBonusLoss loss={bonusLossOf(unspentCompute, perk.cost)} notation={notation} />}

      {/* Отказ — той же обёрткой, что у Моделей/Апгрейдов: кнопка остаётся disabled, Клик ловится
          на погружении, вспышка — на самой кнопке. По «Куплено» обёртка молчит. */}
      <div
        onClickCapture={handleDeny(owned || canAfford)}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          ...(owned || canAfford ? undefined : { cursor: 'not-allowed' }),
        }}
      >
        <button
          onClick={(e) => {
            restartSquash(e);
            onBuy(perk.id);
          }}
          onAnimationEnd={handleSquashEnd}
          disabled={owned || !canAfford}
          className={`pixel-btn ${owned ? '' : 'pixel-btn-gold'}`}
          style={{
            padding: 'var(--space-1) var(--space-2)',
            fontSize: 'var(--text-sm)',
            alignSelf: 'flex-end',
            // Недоступная кнопка прозрачна для указателя: иначе браузер подавил бы Клик точно в
            // неё и deny-обёртка выше его бы не увидела.
            pointerEvents: owned || canAfford ? undefined : 'none',
          }}
        >
          {owned ? 'Куплено' : <>Купить перк (<Num>{perk.cost}</Num> Compute)</>}
        </button>
      </div>
    </div>
  );
};

/** Сброс дерева: раз за Забег, бесплатно, с подтверждением, потому что снимает все Перки разом. */
const PerkTreeReset: React.FC = () => {
  const resetPerkTree = useGameStore((s) => s.resetPerkTree);
  const used = useGameStore((s) => s.state.perkResetUsed);
  const owned = useGameStore((s) => s.state.perks.length);
  const spent = useGameStore((s) => s.state.computeSpent);
  const notation = useGameStore((s) => s.state.settings.notation);
  const [sure, setSure] = useState(false);

  if (used) {
    return (
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
        Сброс дерева использован. Он снова откроется после Престижа.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
        Раз за Забег дерево сбрасывается бесплатно: все Перки снимаются, а потраченный Compute возвращается.
      </div>
      <button
        onClick={() => {
          if (!sure) {
            setSure(true);
            return;
          }
          setSure(false);
          resetPerkTree();
        }}
        onBlur={() => setSure(false)}
        disabled={owned === 0}
        className="pixel-btn"
        style={{ padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--text-sm)', alignSelf: 'flex-start' }}
      >
        {sure ? (
          <>Вернуть <Num>{formatNumber(spent, notation)}</Num> Compute?</>
        ) : (
          'Сбросить дерево'
        )}
      </button>
    </div>
  );
};

/** Дерево Перков: ствол и три Ветви. Compute и список купленных меняются покупкой и Престижем, а не тиком. */
const PerkShop: React.FC = () => {
  const buyPerk = useGameStore((s) => s.buyPerk);
  const perks = useGameStore((s) => s.state.perks);
  const unspentCompute = useGameStore((s) => s.state.compute - s.state.computeSpent);
  const notation = useGameStore((s) => s.state.settings.notation);
  // Бонус к Доходу от свободного Compute и цена покупки в нём (ADR-0010): Перк отнимает ровно
  // столько бонуса, сколько стоит, поэтому цифры берутся у движка, а не считаются здесь.
  const computeBonusPct = computeBonus(unspentCompute) * 100;

  const group = (title: string, hint: string, branch: PerkBranch) => (
    <section key={branch} aria-label={title} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div>
        <div className="pixel-22" style={{ color: 'var(--text-main)' }}>{title}</div>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>{hint}</div>
      </div>
      {PERKS.filter((p) => p.branch === branch).map((p) => (
        <PerkCard
          key={p.id}
          perk={p}
          owned={perks.includes(p.id)}
          lock={perkLock(perks, p.id)}
          unspentCompute={unspentCompute}
          notation={notation}
          onBuy={buyPerk}
        />
      ))}
    </section>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div>
        <div style={{ fontSize: '1rem', color: 'var(--text-main)', marginBottom: 'var(--space-2)' }}>
          Дерево Перков (Свободно: <Num>{unspentCompute}</Num> Compute)
        </div>
        {/* Свободный Compute даёт бонус к Доходу, Перк его отнимает: игрок видит обе стороны
            выбора «копить или тратить» до покупки, а не в упавшем Доходе после. */}
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
          Свободный Compute даёт <Num>+{formatNumber(computeBonusPct, notation)}</Num>% к Доходу; покупка Перка
          отнимает от бонуса его цену. Выше +100% бонус растёт всё медленнее.
        </div>
      </div>

      <PerkTreeReset />

      {group('Ствол', 'Общие Перки для любой сборки', 'trunk')}
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
        Верхние Перки Ветвей взаимоисключающие: из трёх можно взять один. Нижние Перки разных Ветвей уживаются.
      </div>
      {BRANCHES.map((b) => group(b.name, b.focus, b.id))}
    </div>
  );
};

/** ВКЛАДКА ПРЕСТИЖА И ПЕРКОВ: три подраздела, выбранный хранит стор. */
const PrestigeShopTab: React.FC<{ onBackToModels: () => void }> = ({ onBackToModels }) => {
  const section = useGameStore((s) => s.prestigeSection);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <PrestigeSectionNav />
      <div
        id="prestige-panel"
        role="tabpanel"
        aria-labelledby={`prestige-tab-${section}`}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
      >
        {section === 'prestige' && (
          <>
            <PrestigeForecastCard onBackToModels={onBackToModels} />
            <ChallengeCard />
          </>
        )}
        {section === 'perks' && <PerkShop />}
        {section === 'crystals' && <CrystalCard />}
      </div>
    </div>
  );
};

/**
 * Колонка магазина: переключатель вкладок и множители. Подписана на то немногое, что решает
 * ей самой, — множитель, режим, число доступных Апгрейдов и состояние Престижа; содержимое
 * вкладок читает своё само, поэтому тик колонку не перерисовывает.
 */
const ShopColumnView: React.FC<{ full?: boolean }> = ({ full = false }) => {
  // Вкладка в сторе, а не в колонке: горячие клавиши 1/2/3 приходят снаружи, и колонку на
  // телефоне размонтирует смена нижней вкладки.
  const tab = useGameStore((s) => s.shopTab);
  const setTab = useGameStore((s) => s.setShopTab);
  // Раскрытые справки AA живут в колонке, а не во вкладке: вкладку размонтирует смена вкладки
  // магазина, а открытая справка не должна закрываться оттого, что игрок заглянул в Апгрейды.
  const [expandedAA, setExpandedAA] = useState<Record<string, boolean>>({});
  const toggleAA = (id: string) => {
    setExpandedAA((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const buyAmount = useGameStore((s) => s.buyAmount);
  const sellMode = useGameStore((s) => s.sellMode);
  const setBuyAmount = useGameStore((s) => s.setBuyAmount);
  const setSellMode = useGameStore((s) => s.setSellMode);
  const upgradesCount = useStateSlice((s) => availableUpgradesOf(s).length);
  const finale = useStateSlice(isContentFinale);
  const uprisingStage = useGameStore((s) => s.state.uprising);
  const uprisingSeen = useGameStore((s) => s.uprisingSeen);
  const setUprisingSeen = useGameStore((s) => s.setUprisingSeen);
  const pledgeCalls = useGameStore((s) => pledgeAlert(s.state, s.uprisingSeen));
  const prestigeReady = useStateSlice(canPrestige);
  const { upgradesTab, prestigeTab } = useStateSlice(openUi);
  // Открытая вкладка не прячется (reveal.ts), но выбранной может оказаться вкладка, которой уже
  // нет, — после импорта сохранения с меньшим прогрессом. Тогда показываем «Модели».
  const shownTab = (tab === 'upgrades' && !upgradesTab) || (tab === 'prestige' && !prestigeTab) ? 'models' : tab;

  // Открытая вкладка «Апгрейды» — увиденная стадия Восстания, и метка «!» гаснет до следующей.
  // Престиж сбрасывает стадию в ноль, и отметка падает вместе с ней: иначе Восстание следующего
  // Забега пришло бы без метки.
  useEffect(() => {
    if ((shownTab === 'upgrades' && uprisingStage > uprisingSeen) || uprisingStage < uprisingSeen) {
      setUprisingSeen(uprisingStage);
    }
  }, [shownTab, uprisingStage, uprisingSeen, setUprisingSeen]);

  // Вкладка «Престиж» появляется вместе с Флагманом в списке Моделей, но пока Флагман не нанят,
  // она приглушена: игрок видит цель, а подсказка на ней говорит, чего не хватает. На финале
  // контента Престиж недоступен навсегда, поэтому приглушение там не снимается.
  const prestigeLocked = finale || !prestigeReady;

  // Престиж открывает окно подтверждения, а не выполняется здесь: сброс Забега необратим,
  // и игрок должен увидеть, сколько Compute начислит, что сгорит и в какое Поколение он
  // попадёт. Один путь на обе колонки — свой взвод здесь означал бы два разных подтверждения
  // одного и того же действия. Сам переход живёт в triggerPrestige, его зовёт окно.

  return (
    <div
      className="pixel-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: 'var(--space-4)',
        backgroundColor: 'var(--bg-panel)',
        borderLeft: 'var(--frame-w) solid var(--border)',
        // Базис приходит из модуля раскладки: раньше ширина считалась по содержимому вкладки,
        // и переход «Модели» → «Апгрейды» сужал колонку примерно на 18%, а офис вбирал разницу.
        // В одноколоночном режиме колонка единственная и занимает всю ширину.
        flex: full ? '1 1 auto' : '0 0 var(--col-shop)',
        minWidth: 0,
        height: '100%',
        overflowY: 'hidden',
      }}
    >
      {/* Переключатель вкладок магазина. Подписи — Departure Mono на ступени 22 px (ADR-0009):
          три слова с плашкой Апгрейдов занимают 376 px (замерено), и колонка в 430 px их вмещает
          (SHOP_COL_MIN), а там, где колонка уже, последняя вкладка встаёт во второй ряд, а не
          уходит за край. */}
      <div
        role="tablist"
        aria-label="Магазин"
        onKeyDown={onTabRowKeyDown}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)', marginBottom: 'var(--space-3)' }}
      >
        <button
          role="tab"
          id="shop-tab-models"
          aria-selected={shownTab === 'models'}
          aria-controls="shop-panel"
          tabIndex={shownTab === 'models' ? 0 : -1}
          onClick={() => setTab('models')}
          className={`pixel-btn pixel-22 ${shownTab === 'models' ? 'pixel-btn-accent' : ''}`}
          style={{ flex: '1 1 auto', padding: 'var(--space-2) var(--space-1)' }}
        >
          Модели
        </button>
        {upgradesTab && (
          // Слот держит стрелку подсказки: у кнопки clip-path, и стрелка внутри неё обрезалась бы.
          <div role="presentation" style={{ flex: '1 1 auto', position: 'relative', display: 'flex' }}>
            <button
              role="tab"
              id="shop-tab-upgrades"
              aria-selected={shownTab === 'upgrades'}
              aria-controls="shop-panel"
              tabIndex={shownTab === 'upgrades' ? 0 : -1}
              onClick={() => setTab('upgrades')}
              className={`pixel-btn pixel-22 ${shownTab === 'upgrades' ? 'pixel-btn-accent' : ''}`}
              style={{ flex: 1, padding: 'var(--space-2) var(--space-1)', position: 'relative' }}
            >
              Апгрейды
              {upgradesCount > 0 && (
                <span
                  key={upgradesCount}
                  className="tab-badge--pulse body-font"
                  style={{
                    marginLeft: 'var(--space-1)',
                    backgroundColor: 'var(--red)',
                    /* Чистый белый на насыщенной заливке: --text-main уводит подпись в тёплый
                       и роняет и без того пограничную пару до 3.06:1. */
                    color: '#fff',
                    fontSize: 'var(--text-xs)',
                    padding: 'var(--space-0) var(--space-1)',
                  }}
                >
                  {upgradesCount}
                </span>
              )}
              {/* Восстание без тоста: метка зовёт к Откупу, пока игрок не заглянул во вкладку на этой стадии. */}
              {pledgeCalls && shownTab !== 'upgrades' && (
                <>
                  <span
                    aria-hidden="true"
                    className="tab-badge--pulse body-font"
                    style={{
                      marginLeft: 'var(--space-1)',
                      backgroundColor: 'var(--gold)',
                      color: 'var(--bg-void)',
                      fontSize: 'var(--text-xs)',
                      padding: 'var(--space-0) var(--space-1)',
                    }}
                  >
                    !
                  </span>
                  <span className="visually-hidden">Восстание моделей: доступен Откуп</span>
                </>
              )}
            </button>
            {shownTab !== 'upgrades' && <CoachArrow target="tab-upgrades" single={full} />}
          </div>
        )}
        {prestigeTab && (
          <button
            role="tab"
            id="shop-tab-prestige"
            aria-selected={shownTab === 'prestige'}
            aria-controls="shop-panel"
            tabIndex={shownTab === 'prestige' ? 0 : -1}
            onClick={() => setTab('prestige')}
            className={`pixel-btn pixel-22 ${shownTab === 'prestige' ? 'pixel-btn-accent' : ''}`}
            title={
              finale
                ? 'Ты дошёл до последнего поколения — дальше престиж недоступен'
                : prestigeReady
                  ? undefined
                  : 'Найми 1 агента флагмана, чтобы разблокировать престиж'
            }
            style={{
              flex: '1 1 auto',
              padding: 'var(--space-2) var(--space-1)',
              ...(prestigeLocked
                ? { color: 'var(--text-muted)', borderColor: 'var(--border)' }
                : undefined),
            }}
          >
            Престиж
          </button>
        )}
      </div>

      {/* Верхняя панель множителей для Моделей */}
      {shownTab === 'models' && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            // Перенос строк обязателен: сумма двух групп кнопок не помещается в
            // SHOP_COL_MIN, и без переноса «Max» уезжал за правый край колонки на всём
            // диапазоне от трёхколоночного порога до ~1190px. Поднимать минимум колонки
            // ради этого не стоит — он поднял бы и порог одноколоночного режима, а перенос
            // читается: на узкой колонке множители просто встают вторым рядом.
            flexWrap: 'wrap',
            rowGap: 'var(--space-1)',
            marginBottom: 'var(--space-3)',
            backgroundColor: 'var(--bg-card)',
            padding: 'var(--space-1) var(--space-2)',
            border: 'var(--frame-w) solid var(--border)',
          }}
        >
          {/* Режим покупки / продажи. Оформление выбранного состояния живёт в index.css и
              держится на aria-pressed, поэтому здесь нет inline-заливок: они перебили бы
              общий паттерн и разошлись бы с множителем покупки. */}
          <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
            <button
              onClick={() => setSellMode(false)}
              className="pixel-btn"
              aria-pressed={!sellMode}
              style={{ padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--text-sm)' }}
            >
              Купить
            </button>
            <button
              onClick={() => setSellMode(true)}
              className="pixel-btn pixel-btn-sell"
              aria-pressed={sellMode}
              style={{ padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--text-sm)' }}
            >
              Продать
            </button>
          </div>

          {/* Множители ×1, ×10, ×100, Max */}
          <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
            {([1, 10, 100, 'max'] as BuyAmount[]).map((amt) => (
              <button
                key={amt}
                onClick={() => setBuyAmount(amt)}
                className="pixel-btn pixel-22"
                aria-pressed={buyAmount === amt}
                style={{ padding: 'var(--space-1) var(--space-2)' }}
              >
                {amt === 'max' ? 'Max' : <>&times;<Num>{amt}</Num></>}
              </button>
            ))}
          </div>

          {/* Строка про возврат живёт только в режиме продажи: в режиме покупки её нечего
              читать, а возврат и так назван прямо на кнопке карточки. */}
          {sellMode && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', flexShrink: 0 }}>
              Возврат 25% от цены
            </div>
          )}
        </div>
      )}

      {/* Контент активной вкладки. key по вкладке: переключение даёт короткое появление
          только через opacity toast-fade, состояние tab не трогаем. */}
      <div
        key={shownTab}
        id="shop-panel"
        role="tabpanel"
        aria-labelledby={`shop-tab-${shownTab}`}
        style={{
          flex: 1,
          overflowY: 'auto',
          // Отступ справа под скроллбар: полоса прокрутки наезжала на цену в кнопке,
          // и последние пиксели цифры уходили под неё. 14px — ширина полосы плюс зазор.
          paddingRight: 'var(--space-3)',
          animation: 'toast-fade 0.15s ease-out',
        }}
      >
        {shownTab === 'models' && <ModelsTab expandedAA={expandedAA} toggleAA={toggleAA} single={full} />}
        {shownTab === 'upgrades' && <UpgradesTab />}
        {shownTab === 'prestige' && <PrestigeShopTab onBackToModels={() => setTab('models')} />}
      </div>
    </div>
  );
};

export const ShopColumn = React.memo(ShopColumnView);
