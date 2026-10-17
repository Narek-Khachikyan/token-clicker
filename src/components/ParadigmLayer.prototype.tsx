/**
 * ПРОТОТИП, выбросить. Тикет #140 «Интерфейс слоя Парадигм во вкладке «Престиж»» (карта #124).
 *
 * Три варианта вкладки «Престиж» со слоем Парадигм на настоящей странице. Включается
 * `?proto=paradigm&variant=A|B|C&stage=finale1|p4|tail` только в dev-сборке. Данные слоя — заглушка
 * (стадии ниже), стор игры не трогается, ничего не пишется в сохранение.
 *
 *   A — «Четвёртый подраздел»: вкладка «Парадигма» рядом с Престижем, Перками и Кристаллами.
 *   B — «Два этажа сброса»: без новой вкладки; Престиж и Смена одной лестницей в «Престиже».
 *   C — «Дорожка Парадигм»: вкладка «Парадигма» вокруг дорожки 1…8…∞ и сравнения «сейчас → после».
 */
import React, { useEffect, useState } from 'react';
import { LABS, LAB_IDS, type LabId } from '../data/labs';
import { ModalFrame, useModalExit } from './Modals';
import { Num } from './Num';

// ---------- Заглушка данных слоя ----------

type Stage = 'finale1' | 'p4' | 'tail';
type Variant = 'A' | 'B' | 'C';

/** Окончательные имена и тексты 9 Патентов — черновик на суд разработчика. */
const PATENTS = [
  { id: 'queue', name: 'Автопилот закупок', text: 'Очередь закупок на шесть Агентов работает в каждом Поколении, а не только в Агентной.' },
  { id: 'trunk', name: 'Фундамент', text: 'Перки Ствола переживают Смену парадигмы: новая Парадигма начинается с ними.' },
  { id: 'branch', name: 'Специализация', text: 'Одна Ветвь Перков вместе с вершиной переживает Смену. Ветвь выбираешь при покупке.' },
  { id: 'courses', name: 'Учебный план', text: 'Правила пройденных Поколений остаются в пуле Курсов после Смены.' },
  { id: 'knowhow', name: 'Ноу-хау', text: 'Апгрейды Модели, купленные хоть раз, возвращаются сами, когда нанимаешь её Агента.' },
  { id: 'venture1', name: 'Венчурный старт I', text: 'Парадигма начинается с 10% Compute прошлой Парадигмы.' },
  { id: 'venture2', name: 'Венчурный старт II', text: 'Парадигма начинается с 25% Compute прошлой. Нужен Венчурный старт I.', needs: 'venture1' },
  { id: 'fast1', name: 'Быстрый старт I', text: 'Парадигма начинается с Поколения 3; Поколения 1–2 считаются пройденными.' },
  { id: 'fast2', name: 'Быстрый старт II', text: 'Парадигма начинается с Поколения 5; Поколения 1–4 считаются пройденными. Нужен Быстрый старт I.', needs: 'fast1' },
] as const;

const PARADIGM_RULES = [
  { n: 2, name: 'Энергокризис', axis: 'Температура', text: 'Перегрев наступает раньше, остывание медленнее.' },
  { n: 3, name: 'Открытые веса', axis: 'Синергия', text: 'Синергии слабее, пока в офисе меньше трёх Лабораторий.' },
  { n: 4, name: 'Хайп-цикл', axis: 'События', text: 'События чаще, но после каждого — спад Дохода.' },
  { n: 5, name: 'Регулирование', axis: 'Глюки', text: 'Глюки приходят парами, а Откуп дороже.' },
  { n: 6, name: 'Аудит бюджета', axis: 'Перки', text: 'Каждый купленный Перк дороже предыдущего вдвое.' },
  { n: 7, name: 'Ручная разметка', axis: 'Клик и Серия', text: 'Клик слабее, но Серия держится дольше.' },
  { n: 8, name: 'Гонка за чипами', axis: 'Исследования', text: 'Исследования зреют дольше, слот один.' },
];

const MASTERY: Record<LabId, string> = {
  deepseek: 'После Галлюцинации Клик ×2 на 10 с',
  anthropic: 'Галлюцинация уносит меньше, чем сильнее Осторожность',
  xai: '«Форсаж»: первые 5 с перегрева Доход ×2',
  mistral: 'В перегрузе перегрев копится как в обычной зоне',
  openai: 'Волна хайпа длится на 50% дольше',
  google: 'Экосистема растит и пары Синергии с Google',
  meta: 'Пары Синергии с Meta — уже с 10 Агентов',
  alibaba: 'Конвейер засчитывает Модель с одного Агента',
};

interface Layer {
  paradigm: number;
  onFinale: boolean;
  generation: number;
  insights: number;
  insightsGain: number;
  computeParadigm: string;
  owned: string[];
  steps: number;
  crystals: number;
  rounds: Record<LabId, number>;
}

const STAGES: Record<Stage, Layer & { label: string }> = {
  finale1: {
    label: 'Первый Финал',
    paradigm: 1,
    onFinale: true,
    generation: 8,
    insights: 0,
    insightsGain: 3,
    computeParadigm: '4,1 млн',
    owned: [],
    steps: 0,
    crystals: 7,
    rounds: { openai: 0, anthropic: 0, google: 0, xai: 0, deepseek: 0, meta: 0, mistral: 0, alibaba: 0 },
  },
  p4: {
    label: 'Парадигма 4, Поколение 5',
    paradigm: 4,
    onFinale: false,
    generation: 5,
    insights: 2,
    insightsGain: 4,
    computeParadigm: '9,8 млн',
    owned: ['queue', 'fast1', 'trunk', 'venture1', 'knowhow', 'courses'],
    steps: 0,
    crystals: 18,
    rounds: { openai: 0, anthropic: 4, google: 2, xai: 0, deepseek: 3, meta: 0, mistral: 0, alibaba: 1 },
  },
  tail: {
    label: 'Парадигма 11, хвост',
    paradigm: 11,
    onFinale: true,
    generation: 8,
    insights: 23,
    insightsGain: 9,
    computeParadigm: '88 млн',
    owned: PATENTS.map((p) => p.id),
    steps: 4,
    crystals: 31,
    rounds: { openai: 3, anthropic: 10, google: 6, xai: 2, deepseek: 7, meta: 1, mistral: 0, alibaba: 5 },
  },
};

const RESETS_PRESTIGE = ['Токены и Агенты', 'Апгрейды', 'Вехи', 'Температура и События'];
const RESETS_SHIFT = ['Compute и Перки', 'Поколения: снова с первого', 'Восстание моделей', 'Правила Поколений в пуле Курсов'];
const KEEPS = ['Достижения и Датасет', 'Compute-кристаллы', 'Исследования и Постоянные открытия', 'Инвестиции', 'Патенты', 'Правила Парадигм в пуле Курсов', 'Переписка'];

const STAKE_MULT = 1.5;

// ---------- URL ----------

function readParam<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const v = new URLSearchParams(window.location.search).get(key);
  return (allowed as readonly string[]).includes(v ?? '') ? (v as T) : fallback;
}
function writeParam(key: string, value: string) {
  const url = new URL(window.location.href);
  url.searchParams.set(key, value);
  window.history.replaceState(null, '', url);
}

/** Включён ли прототип: только dev-сборка и только с `?proto=paradigm`. */
export function paradigmPrototypeOn(): boolean {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).get('proto') === 'paradigm';
}

// ---------- Общие куски ----------

const muted: React.CSSProperties = { fontSize: 'var(--text-sm)', color: 'var(--text-muted)' };
const card: React.CSSProperties = { padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' };
const tint: React.CSSProperties = { backgroundColor: 'var(--tint-strong)', padding: 'var(--space-2)' };

const Head: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color = 'var(--text-main)' }) => (
  <div className="pixel-22" style={{ color }}>
    {children}
  </div>
);

const Pips: React.FC<{ n: number; max: number; color: string }> = ({ n, max, color }) => (
  <span style={{ display: 'inline-flex', gap: 'var(--space-0)' }} aria-label={`${n} из ${max}`}>
    {Array.from({ length: max }, (_, i) => (
      <span key={i} style={{ width: 8, height: 12, backgroundColor: i < n ? color : 'var(--bg-raised)', border: '2px solid var(--border)' }} />
    ))}
  </span>
);

function nextPatentPrice(layer: Layer) {
  return layer.owned.length + 1;
}

function shiftBlocked(layer: Layer): string | null {
  if (!layer.onFinale) return `Смена парадигмы — только на Финале контента. Сейчас Поколение ${layer.generation}.`;
  return null;
}

const ShiftButton: React.FC<{ layer: Layer; stake: number; onClick: () => void }> = ({ layer, stake, onClick }) => {
  const blocked = shiftBlocked(layer);
  const gain = Math.floor(layer.insightsGain * Math.pow(STAKE_MULT, stake));
  return (
    <button onClick={onClick} className="pixel-btn pixel-btn-gold" style={{ width: '100%' }}>
      {blocked ? 'Дойди до Финала контента' : `Сменить парадигму: +${gain} Озарений`}
    </button>
  );
};

const StakePicker: React.FC<{ stake: Set<number>; toggle: (n: number) => void; compact?: boolean }> = ({ stake, toggle, compact }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-main)' }}>
        Ставка Парадигмы: <Num>{stake.size}</Num> из <Num>7</Num>
      </span>
      <span className="pixel-22" style={{ color: stake.size ? 'var(--accent-color)' : 'var(--text-muted)' }}>
        ×<Num>{Math.pow(STAKE_MULT, stake.size).toFixed(2).replace('.', ',')}</Num> Озарений
      </span>
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
      {PARADIGM_RULES.map((r) => (
        <button
          key={r.n}
          aria-pressed={stake.has(r.n)}
          onClick={() => toggle(r.n)}
          className={`pixel-btn ${stake.has(r.n) ? 'pixel-btn-accent' : ''}`}
          style={{ padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--text-sm)' }}
          title={`${r.axis}: ${r.text}`}
        >
          {r.name}
          {!compact && <span style={{ color: 'var(--text-muted)' }}> · {r.axis}</span>}
        </button>
      ))}
    </div>
  </div>
);

const CapSteps: React.FC<{ layer: Layer }> = ({ layer }) => (
  <div style={{ ...tint, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-main)' }}>
      Ступени потолка: <Num>{layer.steps}</Num> · потолок бонуса Compute ×<Num>{5 + layer.steps}</Num>
    </span>
    <button className="pixel-btn pixel-btn-accent" style={{ padding: 'var(--space-1) var(--space-2)' }}>
      Ступень <Num>{layer.steps + 1}</Num> за <Num>{9 + layer.steps + 1}</Num> Озарений
    </button>
  </div>
);

// ---------- Вариант A: четвёртый подраздел ----------

const VariantA: React.FC<{ layer: Layer; stake: Set<number>; toggle: (n: number) => void; onShift: () => void }> = ({ layer, stake, toggle, onShift }) => {
  const [section, setSection] = useState<'prestige' | 'perks' | 'crystals' | 'paradigm'>('paradigm');
  const allOwned = layer.owned.length === PATENTS.length;
  const blocked = shiftBlocked(layer);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div role="tablist" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
        {(['prestige', 'perks', 'crystals', 'paradigm'] as const).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={section === s}
            onClick={() => setSection(s)}
            className={`pixel-btn pixel-22 ${section === s ? 'pixel-btn-accent' : ''}`}
            style={{ flex: '1 1 auto', padding: 'var(--space-1) var(--space-2)' }}
          >
            {{ prestige: 'Престиж', perks: 'Перки', crystals: 'Кристаллы', paradigm: 'Парадигма' }[s]}
          </button>
        ))}
      </div>

      {section === 'prestige' && <div className="pixel-card" style={card}><span style={muted}>Здесь без изменений: Курс, возврат, прогноз Престижа, Испытания.</span></div>}
      {section === 'perks' && <div className="pixel-card" style={card}><span style={muted}>Здесь без изменений: дерево Перков.</span></div>}
      {section === 'crystals' && <InvestList layer={layer} />}

      {section === 'paradigm' && (
        <>
          <div className="pixel-card" style={{ ...card, border: 'var(--frame-w) solid var(--gold)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-2)' }}>
              <Head color="var(--gold)">Парадигма <Num>{layer.paradigm}</Num></Head>
              <span className="pixel-22" style={{ color: 'var(--gold)' }}>
                <Num>{layer.insights}</Num> Озарений
              </span>
            </div>
            <div style={tint}>
              <div style={muted}>Озарения, если сменить парадигму сейчас</div>
              <div className="pixel-33" style={{ color: 'var(--gold)' }}>
                +<Num>{Math.floor(layer.insightsGain * Math.pow(STAKE_MULT, stake.size))}</Num>
              </div>
              <div style={muted}>
                Compute за эту Парадигму: <Num>{layer.computeParadigm}</Num>. Озарений больше, чем больше Compute, но растут они медленнее.
              </div>
            </div>
            {blocked && <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-main)' }}>{blocked}</div>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
              <EffectCol title="Сбросится, как при Престиже" items={RESETS_PRESTIGE} tone="var(--red-text)" marker="−" />
              <EffectCol title="И ещё сбросится" items={RESETS_SHIFT} tone="var(--red-text)" marker="−" />
              <EffectCol title="Останется" items={KEEPS} tone="var(--green-text)" marker="+" />
            </div>
            {allOwned && <StakePicker stake={stake} toggle={toggle} />}
            <ShiftButton layer={layer} stake={stake.size} onClick={onShift} />
          </div>

          <div className="pixel-card" style={card}>
            <Head>Патенты</Head>
            <div style={muted}>
              {allOwned
                ? 'Все девять куплены. Озарения теперь идут на Ступени потолка.'
                : <>Каждый следующий Патент дороже на одно Озарение: следующий стоит <Num>{nextPatentPrice(layer)}</Num>. Патенты переживают все Смены.</>}
            </div>
            {PATENTS.map((p) => {
              const owned = layer.owned.includes(p.id);
              const locked = 'needs' in p && !layer.owned.includes(p.needs);
              const price = nextPatentPrice(layer);
              return (
                <div key={p.id} style={{ backgroundColor: 'var(--bg-card)', border: 'var(--frame-w) solid var(--border)', padding: 'var(--space-2)', display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: owned ? 'var(--green-text)' : 'var(--text-main)' }}>{p.name}</div>
                    <div style={muted}>{p.text}</div>
                  </div>
                  {owned ? (
                    <span style={{ ...muted, color: 'var(--green-text)' }}>Куплен</span>
                  ) : (
                    <button disabled={locked || layer.insights < price} className="pixel-btn pixel-btn-gold" style={{ padding: 'var(--space-1) var(--space-2)', flexShrink: 0 }}>
                      {locked ? 'Закрыт' : <><Num>{price}</Num> Оз.</>}
                    </button>
                  )}
                </div>
              );
            })}
            {allOwned && <CapSteps layer={layer} />}
          </div>
        </>
      )}
    </div>
  );
};

const EffectCol: React.FC<{ title: string; items: readonly string[]; tone: string; marker: string }> = ({ title, items, tone, marker }) => (
  <div style={{ flex: '1 1 10rem', minWidth: 0 }}>
    <div className="pixel-22" style={{ color: tone, marginBottom: 'var(--space-1)' }}>{title}</div>
    {items.map((i) => (
      <div key={i} style={{ fontSize: 'var(--text-sm)', color: 'var(--text-main)' }}>
        <span style={{ color: tone }}>{marker}</span> {i}
      </div>
    ))}
  </div>
);

const InvestList: React.FC<{ layer: Layer }> = ({ layer }) => (
  <div className="pixel-card" style={card}>
    <Head>Инвестиции</Head>
    <div style={muted}>
      В запасе <Num>{layer.crystals}</Num> кристаллов. Раунд n стоит n кристаллов и действует, только пока Агенты Лаборатории в офисе.
      Вложенное не вернуть, а кристалл из запаса заберёт свой +1% к Доходу.
    </div>
    {LAB_IDS.map((id) => {
      const r = layer.rounds[id];
      return (
        <div key={id} style={{ backgroundColor: 'var(--bg-card)', padding: 'var(--space-2)', display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: LABS[id].color, minWidth: '6rem' }}>{LABS[id].name}</span>
          <Pips n={r} max={10} color={LABS[id].color} />
          <span style={{ ...muted, flex: '1 1 8rem' }}>{r >= 10 ? `Мастерство: ${MASTERY[id]}` : `Раунд ${r + 1}`}</span>
          {r < 10 && (
            <button disabled={layer.crystals < r + 1} className="pixel-btn pixel-btn-accent" style={{ padding: 'var(--space-1) var(--space-2)' }}>
              <Num>{r + 1}</Num> кр.
            </button>
          )}
        </div>
      );
    })}
  </div>
);

// ---------- Вариант B: два этажа сброса ----------

const VariantB: React.FC<{ layer: Layer; stake: Set<number>; toggle: (n: number) => void; onShift: () => void }> = ({ layer, stake, toggle, onShift }) => {
  const [floor, setFloor] = useState<1 | 2>(layer.onFinale ? 2 : 1);
  const allOwned = layer.owned.length === PATENTS.length;
  const rows: [string, boolean, boolean][] = [
    ['Токены, Агенты, Апгрейды', true, true],
    ['Compute и Перки', false, true],
    ['Поколение', false, true],
    ['Восстание моделей', false, true],
    ['Кристаллы и Инвестиции', false, false],
    ['Исследования', false, false],
    ['Достижения', false, false],
    ['Патенты', false, false],
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {/* Лестница: два сброса друг над другом, второй открывается на Финале. */}
      <div style={{ display: 'flex', flexDirection: 'column-reverse', gap: 'var(--space-1)' }}>
        {([1, 2] as const).map((f) => (
          <button
            key={f}
            aria-pressed={floor === f}
            onClick={() => setFloor(f)}
            className="pixel-card"
            style={{
              textAlign: 'left',
              font: 'inherit',
              color: 'inherit',
              cursor: 'pointer',
              padding: 'var(--space-2) var(--space-3)',
              border: `var(--frame-w) solid ${floor === f ? 'var(--gold)' : 'var(--border)'}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: 'var(--space-2)',
            }}
          >
            <span>
              <span className="pixel-22" style={{ color: floor === f ? 'var(--gold)' : 'var(--text-muted)' }}>
                {f === 1 ? 'Престиж' : 'Смена парадигмы'}
              </span>
              <span style={{ ...muted, display: 'block' }}>
                {f === 1 ? `Забег → следующее Поколение · Поколение ${layer.generation}` : `Кампания → новая Парадигма · сейчас Парадигма ${layer.paradigm}`}
              </span>
            </span>
            <span className="pixel-22" style={{ color: 'var(--gold)' }}>
              {f === 1 ? '+Compute' : <>+<Num>{layer.insightsGain}</Num> Оз.</>}
            </span>
          </button>
        ))}
      </div>

      {floor === 1 && <div className="pixel-card" style={card}><span style={muted}>Этаж Престижа без изменений: Курс, возврат, прогноз, Испытания.</span></div>}

      {floor === 2 && (
        <div className="pixel-card" style={{ ...card, border: 'var(--frame-w) solid var(--gold)' }}>
          <Head color="var(--gold)">Что сбросит каждый этаж</Head>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                <th style={{ padding: 'var(--space-1)' }} />
                <th style={{ padding: 'var(--space-1)' }}>Престиж</th>
                <th style={{ padding: 'var(--space-1)' }}>Смена</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([name, p, s]) => (
                <tr key={name} style={{ borderTop: '2px solid var(--border)' }}>
                  <td style={{ padding: 'var(--space-1)', color: 'var(--text-main)' }}>{name}</td>
                  <td style={{ padding: 'var(--space-1)', color: p ? 'var(--red-text)' : 'var(--green-text)' }}>{p ? '− сброс' : '+ остаётся'}</td>
                  <td style={{ padding: 'var(--space-1)', color: s ? 'var(--red-text)' : 'var(--green-text)' }}>{s ? '− сброс' : '+ остаётся'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {allOwned && <StakePicker stake={stake} toggle={toggle} compact />}
          {shiftBlocked(layer) && <div style={{ fontSize: 'var(--text-sm)' }}>{shiftBlocked(layer)}</div>}
          <ShiftButton layer={layer} stake={stake.size} onClick={onShift} />
        </div>
      )}

      {/* Патенты — сетка 3×3, порядок покупки виден номером в углу. */}
      <div className="pixel-card" style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Head>Патенты</Head>
          <span className="pixel-22" style={{ color: 'var(--gold)' }}><Num>{layer.insights}</Num> Оз.</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-1)' }}>
          {PATENTS.map((p) => {
            const idx = layer.owned.indexOf(p.id);
            const owned = idx >= 0;
            const locked = 'needs' in p && !layer.owned.includes(p.needs);
            return (
              <button
                key={p.id}
                title={p.text}
                disabled={owned || locked}
                style={{
                  font: 'inherit',
                  textAlign: 'left',
                  position: 'relative',
                  minHeight: 64,
                  padding: 'var(--space-2)',
                  backgroundColor: owned ? 'var(--tint-gold)' : 'var(--bg-card)',
                  border: `var(--frame-w) solid ${owned ? 'var(--gold)' : 'var(--border)'}`,
                  color: locked ? 'var(--text-muted)' : 'var(--text-main)',
                  fontSize: 'var(--text-sm)',
                  cursor: owned || locked ? 'default' : 'pointer',
                }}
              >
                {p.name}
                <span style={{ position: 'absolute', right: 4, bottom: 2, fontSize: 'var(--text-xs)', color: owned ? 'var(--gold)' : 'var(--text-muted)' }}>
                  {owned ? `№${idx + 1}` : locked ? 'закрыт' : `${nextPatentPrice(layer)} Оз.`}
                </span>
              </button>
            );
          })}
        </div>
        <div style={muted}>Наведи на Патент — что он даёт. Номер в углу — каким по счёту ты его купил.</div>
        {allOwned && <CapSteps layer={layer} />}
      </div>

      {/* Инвестиции — сетка 2×4 в той же вкладке, без своего подраздела. */}
      <div className="pixel-card" style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Head>Инвестиции</Head>
          <span style={muted}><Num>{layer.crystals}</Num> кристаллов</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-1)' }}>
          {LAB_IDS.map((id) => (
            <button
              key={id}
              title={layer.rounds[id] >= 10 ? MASTERY[id] : `Раунд ${layer.rounds[id] + 1} за ${layer.rounds[id] + 1} кристаллов`}
              style={{ font: 'inherit', padding: 'var(--space-1)', backgroundColor: 'var(--bg-card)', border: `var(--frame-w) solid ${LABS[id].color}`, color: 'var(--text-main)', cursor: 'pointer' }}
            >
              <div style={{ fontSize: 'var(--text-xs)', color: LABS[id].color }}>{LABS[id].name}</div>
              <div className="pixel-22">{layer.rounds[id] >= 10 ? '★' : <><Num>{layer.rounds[id]}</Num>/10</>}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// ---------- Вариант C: дорожка Парадигм ----------

const VariantC: React.FC<{ layer: Layer; stake: Set<number>; toggle: (n: number) => void; onShift: () => void }> = ({ layer, stake, toggle, onShift }) => {
  const allOwned = layer.owned.length === PATENTS.length;
  const nodes = [1, 2, 3, 4, 5, 6, 7, 8];
  const [pick, setPick] = useState<string | null>(null);
  const affordable = PATENTS.filter((p) => !layer.owned.includes(p.id) && !('needs' in p && !layer.owned.includes(p.needs)));
  const after = (has: string) => layer.owned.includes(has);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div className="pixel-card" style={card}>
        <Head color="var(--gold)">Дорожка Парадигм</Head>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {[...nodes, 9].map((n) => {
            const rule = PARADIGM_RULES.find((r) => r.n === n);
            const done = n < layer.paradigm;
            const here = n === layer.paradigm || (n === 9 && layer.paradigm >= 9);
            return (
              <div key={n} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'stretch' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 24 }}>
                  <span style={{ width: 16, height: 16, marginTop: 4, backgroundColor: here ? 'var(--gold)' : done ? 'var(--accent-color)' : 'var(--bg-raised)', border: '2px solid var(--border)' }} />
                  {n < 9 && <span style={{ flex: 1, width: 2, backgroundColor: done ? 'var(--accent-color)' : 'var(--border)' }} />}
                </div>
                <div style={{ paddingBottom: 'var(--space-2)', flex: 1, opacity: !done && !here ? 0.55 : 1 }}>
                  <div style={{ color: here ? 'var(--gold)' : 'var(--text-main)' }}>
                    {n === 9 ? (layer.paradigm >= 9 ? `Парадигма ${layer.paradigm} — Ставка` : 'Парадигма 9 и дальше — Ставка') : `Парадигма ${n}`}
                    {here && ' · ты здесь'}
                  </div>
                  <div style={muted}>
                    {n === 1
                      ? 'Кампания как есть'
                      : rule
                        ? `Правило: ${rule.name} (${rule.axis}) · новый Курс в Поколении 6 · новое Испытание`
                        : 'Сам накладываешь пройденные Правила и множишь Озарения'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="pixel-card" style={{ ...card, border: 'var(--frame-w) solid var(--gold)' }}>
        <Head color="var(--gold)">Смена парадигмы: сейчас → после</Head>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 'var(--space-1) var(--space-3)', fontSize: 'var(--text-sm)' }}>
          {(
            [
              ['Парадигма', `${layer.paradigm}`, `${layer.paradigm + 1}`],
              ['Поколение', `${layer.generation}`, after('fast2') ? '5' : after('fast1') ? '3' : '1'],
              ['Compute', layer.computeParadigm, after('venture2') ? '25%' : after('venture1') ? '10%' : '0'],
              ['Перки', '34', after('trunk') ? (after('branch') ? 'Ствол и Ветвь' : 'Ствол') : '0'],
              ['Озарения', `${layer.insights}`, `${layer.insights + Math.floor(layer.insightsGain * Math.pow(STAKE_MULT, stake.size))}`],
              ['Кристаллы', `${layer.crystals}`, `${layer.crystals}`],
            ] as const
          ).map(([k, a, b]) => (
            <React.Fragment key={k}>
              <span style={{ color: 'var(--text-muted)' }}>{k}</span>
              <span style={{ color: 'var(--text-main)', textAlign: 'right' }}><Num>{a}</Num></span>
              <span style={{ color: a === b ? 'var(--green-text)' : 'var(--gold)' }}>→ <Num>{b}</Num></span>
            </React.Fragment>
          ))}
        </div>
        <div style={muted}>Достижения, Исследования, Инвестиции и Патенты не меняются.</div>
        {allOwned && <StakePicker stake={stake} toggle={toggle} />}
        {shiftBlocked(layer) && <div style={{ fontSize: 'var(--text-sm)' }}>{shiftBlocked(layer)}</div>}
        <ShiftButton layer={layer} stake={stake.size} onClick={onShift} />
      </div>

      <div className="pixel-card" style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Head>{allOwned ? 'Ступени потолка' : 'Следующий Патент'}</Head>
          <span className="pixel-22" style={{ color: 'var(--gold)' }}><Num>{layer.insights}</Num> Оз.</span>
        </div>
        {allOwned ? (
          <CapSteps layer={layer} />
        ) : (
          <>
            <div style={muted}>
              Выбери один: он стоит <Num>{nextPatentPrice(layer)}</Num> Озарений и останется навсегда. Куплено <Num>{layer.owned.length}</Num> из <Num>9</Num>.
            </div>
            {affordable.map((p) => (
              <button
                key={p.id}
                aria-pressed={pick === p.id}
                onClick={() => setPick(p.id)}
                className="pixel-card"
                style={{ font: 'inherit', textAlign: 'left', color: 'inherit', padding: 'var(--space-2)', cursor: 'pointer', border: `var(--frame-w) solid ${pick === p.id ? 'var(--gold)' : 'var(--border)'}` }}
              >
                <div style={{ color: 'var(--text-main)' }}>{p.name}</div>
                <div style={muted}>{p.text}</div>
              </button>
            ))}
            <button disabled={!pick || layer.insights < nextPatentPrice(layer)} className="pixel-btn pixel-btn-gold">
              {pick ? `Купить «${PATENTS.find((p) => p.id === pick)!.name}»` : 'Выбери Патент'}
            </button>
            <div style={muted}>Куплены: {layer.owned.map((id) => PATENTS.find((p) => p.id === id)!.name).join(', ') || 'пока ни одного'}.</div>
          </>
        )}
      </div>

      <InvestList layer={layer} />
    </div>
  );
};

// ---------- Окна: окно первого входа и окно подтверждения ----------

const FirstEntryModal: React.FC<{ open: boolean; onClose: () => void; veteran: boolean }> = ({ open, onClose, veteran }) => {
  const { closing, requestClose } = useModalExit(open, onClose);
  return (
    <ModalFrame
      isOpen={open}
      closing={closing}
      requestClose={requestClose}
      titleId="proto-first-entry"
      tone="gold"
      title={veteran ? 'Открыта Смена парадигмы' : 'Поколения подорожали'}
      footer={<button className="pixel-btn pixel-btn-gold" style={{ flex: 1 }} onClick={requestClose}>{veteran ? 'Во вкладку «Престиж»' : 'Понятно'}</button>}
    >
      {veteran && (
        <>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-main)' }}>
            Ты уже стоял на Финале контента, поэтому всё, что ты прошёл, засчитано как Парадигма 1. Теперь с Финала можно
            сменить парадигму: кампания начнётся с первого Поколения, а за Compute этой Парадигмы придут Озарения — на Патенты, которые
            делают каждую следующую Парадигму короче.
          </div>
          <div style={{ ...tint, fontSize: 'var(--text-sm)', color: 'var(--text-main)' }}>
            Ещё открылись <b>Инвестиции</b>: Compute-кристаллы можно вложить в Лабораторию и усилить её Характер.
          </div>
        </>
      )}
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
        Флагманы поздних Поколений теперь окупаются дольше: каждое следующее Поколение дороже прежнего. Твой Забег, Агенты и Токены на месте.
      </div>
    </ModalFrame>
  );
};

const ShiftConfirmModal: React.FC<{ open: boolean; onClose: () => void; layer: Layer; stake: number }> = ({ open, onClose, layer, stake }) => {
  const { closing, requestClose } = useModalExit(open, onClose);
  const blocked = shiftBlocked(layer);
  return (
    <ModalFrame
      isOpen={open}
      closing={closing}
      requestClose={requestClose}
      titleId="proto-shift"
      tone="gold"
      title="Сменить парадигму?"
      footer={
        <>
          <button className="pixel-btn pixel-btn-gold" disabled={!!blocked} style={{ flex: 1 }} onClick={requestClose}>
            {blocked ? 'Недоступно' : `Сменить: +${Math.floor(layer.insightsGain * Math.pow(STAKE_MULT, stake))} Озарений`}
          </button>
          <button className="pixel-btn" onClick={requestClose}>Отмена</button>
        </>
      }
    >
      {blocked ? (
        <div style={{ fontSize: 'var(--text-sm)' }}>{blocked}</div>
      ) : (
        <>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-main)' }}>
            Начнётся Парадигма <Num>{layer.paradigm + 1}</Num>
            {layer.paradigm + 1 <= 8 && <> с Правилом «{PARADIGM_RULES.find((r) => r.n === layer.paradigm + 1)?.name}»</>}. Это сильнее Престижа.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
            <EffectCol title="Сгорит" items={[...RESETS_PRESTIGE, ...RESETS_SHIFT]} tone="var(--red-text)" marker="−" />
            <EffectCol title="Останется" items={KEEPS} tone="var(--green-text)" marker="+" />
          </div>
        </>
      )}
    </ModalFrame>
  );
};

/** Макет экрана Финала: какие строки добавятся к нему, когда Финал открывает слой. */
const FinaleNoteModal: React.FC<{ open: boolean; onClose: () => void; first: boolean }> = ({ open, onClose, first }) => {
  const { closing, requestClose } = useModalExit(open, onClose);
  return (
    <ModalFrame isOpen={open} closing={closing} requestClose={requestClose} titleId="proto-finale" tone="gold" title="Финал контента" centered
      footer={<button className="pixel-btn pixel-btn-gold" style={{ flex: 1 }} onClick={requestClose}>К Парадигме</button>}>
      <div style={{ fontSize: '0.95rem', fontWeight: 600 }}>Последнее Поколение пройдено, все Модели собраны!</div>
      <div style={{ width: '100%', padding: 'var(--space-2) var(--space-3)', backgroundColor: 'var(--tint-gold)', border: 'var(--frame-w) solid var(--gold)', fontSize: 'var(--text-sm)', color: 'var(--gold)' }}>
        Продолжение выйдет с новыми реальными Моделями.
      </div>
      <div style={{ ...tint, width: '100%', fontSize: 'var(--text-sm)', color: 'var(--text-main)' }}>
        {first ? (
          <>
            <b>Новое: Смена парадигмы.</b> Пройди кампанию заново с первого Поколения и получи Озарения за весь Compute этой Парадигмы.
            На Озарения покупаются Патенты — каждая следующая Парадигма проходит быстрее. Ещё открылись Инвестиции в Лаборатории.
          </>
        ) : (
          <>Финал Парадигмы <Num>4</Num>. Смена принесёт <Num>4</Num> Озарения; следующий Патент стоит <Num>7</Num>.</>
        )}
      </div>
      <div style={{ ...muted, width: '100%' }}>
        Не спеши: Престиж с Финала возвращает в пройденное Поколение и копит Compute — чем больше его к Смене, тем больше Озарений.
      </div>
      <div style={{ ...muted, width: '100%', textAlign: 'left', borderTop: '2px solid var(--border)', paddingTop: 'var(--space-2)' }}>
        Новостная лента в тот же момент: «Аналитики в шоке: лаборатория $ИГРОКА готова начать всё сначала — и быстрее».
      </div>
    </ModalFrame>
  );
};

// ---------- Корень прототипа и плавающая панель ----------

const VARIANTS: { key: Variant; name: string }[] = [
  { key: 'A', name: 'Четвёртый подраздел' },
  { key: 'B', name: 'Два этажа сброса' },
  { key: 'C', name: 'Дорожка Парадигм' },
];
const STAGE_KEYS: Stage[] = ['finale1', 'p4', 'tail'];

export const ParadigmPrototype: React.FC = () => {
  const [variant, setVariant] = useState<Variant>(() => readParam('variant', ['A', 'B', 'C'], 'A'));
  const [stage, setStage] = useState<Stage>(() => readParam('stage', STAGE_KEYS, 'finale1'));
  const [stake, setStake] = useState<Set<number>>(new Set());
  const [modal, setModal] = useState<null | 'first' | 'firstMid' | 'shift' | 'finale'>(null);
  const layer = STAGES[stage];

  const cycle = (dir: 1 | -1) => {
    const i = VARIANTS.findIndex((v) => v.key === variant);
    const next = VARIANTS[(i + dir + VARIANTS.length) % VARIANTS.length].key;
    setVariant(next);
    writeParam('variant', next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'ArrowLeft') cycle(-1);
      if (e.key === 'ArrowRight') cycle(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const toggle = (n: number) =>
    setStake((s) => {
      const next = new Set(s);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  const props = { layer, stake, toggle, onShift: () => setModal('shift') };

  return (
    <>
      {variant === 'A' && <VariantA {...props} />}
      {variant === 'B' && <VariantB {...props} />}
      {variant === 'C' && <VariantC {...props} />}

      {/* Видимое состояние заглушки: что сейчас показано. */}
      <pre style={{ ...muted, whiteSpace: 'pre-wrap', marginTop: 'var(--space-3)', fontFamily: 'monospace', fontSize: 11 }}>
        {JSON.stringify({ variant, stage, ...layer, stake: [...stake] }, null, 1)}
      </pre>

      <FirstEntryModal open={modal === 'first' || modal === 'firstMid'} veteran={modal === 'first'} onClose={() => setModal(null)} />
      <ShiftConfirmModal open={modal === 'shift'} layer={layer} stake={stake.size} onClose={() => setModal(null)} />
      <FinaleNoteModal open={modal === 'finale'} first={stage === 'finale1'} onClose={() => setModal(null)} />

      <div
        style={{
          position: 'fixed',
          left: '50%',
          bottom: 12,
          transform: 'translateX(-50%)',
          zIndex: 200,
          background: '#fff',
          color: '#111',
          padding: '6px 10px',
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 13,
          boxShadow: '0 4px 16px rgba(0,0,0,.5)',
          flexWrap: 'wrap',
          maxWidth: '96vw',
        }}
      >
        <button onClick={() => cycle(-1)}>←</button>
        <b>
          {variant} ({VARIANTS.find((v) => v.key === variant)!.name})
        </b>
        <button onClick={() => cycle(1)}>→</button>
        <span>|</span>
        <select
          value={stage}
          onChange={(e) => {
            setStage(e.target.value as Stage);
            writeParam('stage', e.target.value);
            setStake(new Set());
          }}
        >
          {STAGE_KEYS.map((s) => (
            <option key={s} value={s}>
              {STAGES[s].label}
            </option>
          ))}
        </select>
        <button onClick={() => setModal('finale')}>Экран Финала</button>
        <button onClick={() => setModal('first')}>Окно первого входа (на Финале)</button>
        <button onClick={() => setModal('firstMid')}>(посреди кампании)</button>
      </div>
    </>
  );
};
