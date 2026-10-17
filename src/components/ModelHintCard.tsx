import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { CHARACTERS } from '../data/characters';
import { characterReadout } from '../economy/character';
import { safeTemp } from '../economy/thermal';
import { finetuneName, finetuneOf } from '../economy/finetune';
import type { Model } from '../economy/catalog';
import { formatCount, formatDuration, formatMultiplier, formatNumber } from '../economy/format';
import {
  modelCardSummary,
  type Availability,
  type BreakdownKind,
  type BulkAmount,
} from '../economy/modelCard';
import type { Notation } from '../economy/state';

/**
 * Карточка Модели при наведении: из чего складывается её Доход, за сколько окупается следующий
 * Агент, через сколько Модель станет доступна и что купят ×10, ×100 и Max.
 *
 * Все числа приходят готовыми из `modelCardSummary` (src/economy/modelCard.ts): здесь только
 * подписи и формат. Карточка монтируется, только пока открыта, и потому читает состояние целиком,
 * как окно статистики: закрытая, она не стоит ничего, а открытая обязана жить вместе с тиком —
 * срок «доступно через» и Токены в кошельке меняются на глазах.
 */

/** Подписи строк разбивки. Порядок строк задаёт движок, а не эта таблица. */
const ROW_LABEL: Record<BreakdownKind, string> = {
  base: 'Доход одного Агента',
  agents: 'Агентов',
  upgrades: 'Апгрейды Модели',
  finetune: 'Файнтюн',
  synergy: 'Синергия Лаборатории',
  flagship: 'Флагман: младшие Агенты',
  labPerk: 'Партнёрство Лаборатории',
  pairSynergy: 'Парная Синергия',
  character: 'Характер Лабораторий',
  genPerk: 'Наследие поколений',
  orchestra: 'Оркестратор',
  rule: 'Правило Поколения',
  dataset: 'Датасет',
  compute: 'Compute',
  crystals: 'Кристаллы',
  covenant: 'Налог Лицензии',
  challenge: 'Испытания Забега',
  course: 'Курс',
  surge: 'Прорыв',
};

const BULK_LABEL: Record<BulkAmount, string> = { 10: '×10', 100: '×100', max: 'Max' };

/** Секунды окупаемости: до десяти — с десятой долей, дальше — привычная «мин с» и «ч мин». */
function paybackText(seconds: number, notation: Notation): string {
  if (seconds < 10) return `${formatNumber(seconds, notation)} с`;
  return formatDuration(seconds);
}

function availabilityText(a: Availability): string {
  if (a.kind === 'now') return 'сейчас';
  if (a.kind === 'long') return 'больше суток';
  return formatDuration(Math.ceil(a.seconds));
}

const LINE: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: 'var(--space-2)',
};

const VALUE: React.CSSProperties = { textAlign: 'right', color: 'var(--text-main)', flexShrink: 0 };

const Line: React.FC<{ label: string; value: React.ReactNode; muted?: boolean; color?: string }> = ({
  label,
  value,
  muted,
  color,
}) => (
  <div style={LINE}>
    <span style={{ color: muted ? 'var(--text-muted)' : 'var(--text-main)' }}>{label}</span>
    <span className="num" style={{ ...VALUE, color: color ?? VALUE.color }}>
      {value}
    </span>
  </div>
);

/** Заголовок раздела карточки: акцент Поколения на линии под ним, как у шапок разделов (ADR-0008). */
const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-0)' }}>
    <h3
      className="section-head"
      style={{ fontSize: 'var(--text-sm)', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}
    >
      {title}
    </h3>
    {children}
  </section>
);

export const ModelHintCard: React.FC<{ model: Model }> = ({ model }) => {
  const state = useGameStore((s) => s.state);
  const notation = state.settings.notation;
  const card = modelCardSummary(state, model);
  const owned = state.agents[model.id] ?? 0;
  const character = CHARACTERS[model.lab];
  const perSec = (n: number) => `${formatNumber(n, notation)} / сек`;
  const thermalColor =
    card.thermalMult < 1 ? 'var(--red-text)' : card.thermalMult > 1 ? 'var(--green-text)' : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-2)' }}>
        <span className="pixel-22" style={{ color: 'var(--text-main)' }}>
          {finetuneName(model.name, finetuneOf(state, model.id))}
        </span>
        <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>Ранг {model.rank + 1}</span>
      </div>

      <Section title="Доход Модели">
        {card.rows.map((row) => {
          if (row.kind === 'base') {
            return <Line key={row.kind} label={ROW_LABEL.base} value={perSec(row.value)} />;
          }
          if (row.kind === 'agents') {
            return <Line key={row.kind} label={ROW_LABEL.agents} value={`× ${formatNumber(row.value, notation)}`} />;
          }
          return <Line key={row.kind} label={ROW_LABEL[row.kind]} value={formatMultiplier(row.value, notation)} />;
        })}
        <div style={{ ...LINE, borderTop: 'var(--frame-w) solid var(--border)', paddingTop: 'var(--space-1)' }}>
          <span style={{ fontWeight: 700 }}>Доход Модели</span>
          <span className="num" style={{ ...VALUE, fontWeight: 700 }}>
            {perSec(card.income)}
          </span>
        </div>
        {owned === 0 && <Line label="Один Агент принесёт" value={perSec(card.perAgent)} muted />}
        {/* Температура — не сомножитель Модели, а множитель всего Дохода сейчас, поэтому
            отдельной строкой «сейчас» под итогом, а не в произведении. */}
        <Line label="Температура сейчас" value={formatMultiplier(card.thermalMult, notation)} muted color={thermalColor} />
        {/* Порог своя у каждого Ранга (кривая порогов), поэтому карточка называет его, а не
            отсылает к общей таблице: младшие Модели раскрываются на меньших числах Агентов. */}
        {card.nextUpgrade && (
          <Line
            label={`Следующий Апгрейд: ${card.nextUpgrade.name}`}
            value={
              card.nextUpgrade.ready
                ? 'в магазине'
                : `с ${formatNumber(card.nextUpgrade.threshold, notation)} ${formatCount(card.nextUpgrade.threshold, 'Агента', 'Агентов', 'Агентов', notation)}`
            }
            muted
          />
        )}
      </Section>

      {character && (
        <Section title="Характер Лаборатории">
          <div style={{ color: 'var(--text-main)' }}>
            <span style={{ fontWeight: 700 }}>{character.name}</span>: {character.summary}
          </div>
          {characterReadout(state, model).map((row) => (
            <Line key={row.label} label={row.label} value={row.value} muted />
          ))}
          {character.effects.some((e) => e.kind === 'heat' || e.kind === 'yield') && (
            <Line label="Безопасная Температура офиса" value={safeTemp(state).toFixed(2)} muted />
          )}
        </Section>
      )}

      <Section title="Следующий Агент">
        <Line
          label="Окупается за"
          value={card.paybackSec === null ? '—' : paybackText(card.paybackSec, notation)}
        />
        <Line label="Доступен через" value={availabilityText(card.availability)} />
      </Section>

      <Section title="Купить сразу">
        {card.bulk.map((b) => (
          <Line
            key={b.amount}
            label={`${BULK_LABEL[b.amount]}: ${
              b.count > 0
                ? `${formatNumber(b.count, notation)} ${formatCount(b.count, 'Агент', 'Агента', 'Агентов', notation)}`
                : 'пока ни одного'
            }`}
            value={b.count > 0 ? formatNumber(b.cost, notation, 'price') : '—'}
            color={b.affordable ? 'var(--green-text)' : 'var(--text-muted)'}
          />
        ))}
      </Section>
    </div>
  );
};
