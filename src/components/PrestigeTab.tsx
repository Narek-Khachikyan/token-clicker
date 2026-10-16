import React from 'react';
import { useGameStore, useStateSlice, type PrestigeSection } from '../store/useGameStore';
import { challengeCardView, challengeView, prestigeCardView } from '../store/selectors';
import { CATALOG, LAST_GENERATION } from '../economy/catalog';
import { CHALLENGES, CHALLENGE_REWARD_PCT, type ChallengeDef } from '../economy/challenges';
import { COMPUTE_BONUS } from '../economy/engine';
import { PRESTIGE_KEEPS, PRESTIGE_RESETS, type PrestigeEffect } from '../economy/prestigeForecast';
import { Hint } from './Hint';
import { Num } from './Num';
import { onTabRowKeyDown } from './tabRow';

/**
 * Вкладка «Престиж» делится на три подраздела, чтобы пять систем не лежали одной лентой.
 * Выбранный подраздел живёт в сторе (UI-слой, не в сохранении): нижняя вкладка на телефоне
 * размонтирует колонку, а игрок должен вернуться туда, где был.
 */
const SECTIONS: readonly { id: PrestigeSection; label: string }[] = [
  { id: 'prestige', label: 'Престиж' },
  { id: 'perks', label: 'Перки' },
  { id: 'crystals', label: 'Кристаллы' },
];

export const PrestigeSectionNav: React.FC = () => {
  const section = useGameStore((s) => s.prestigeSection);
  const setSection = useGameStore((s) => s.setPrestigeSection);

  return (
    <div
      role="tablist"
      aria-label="Разделы вкладки «Престиж»"
      onKeyDown={onTabRowKeyDown}
      style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)', marginBottom: 'var(--space-3)' }}
    >
      {SECTIONS.map((s) => (
        <button
          key={s.id}
          role="tab"
          id={`prestige-tab-${s.id}`}
          aria-selected={section === s.id}
          aria-controls="prestige-panel"
          tabIndex={section === s.id ? 0 : -1}
          onClick={() => setSection(s.id)}
          className={`pixel-btn pixel-22 ${section === s.id ? 'pixel-btn-accent' : ''}`}
          style={{ flex: '1 1 auto', padding: 'var(--space-1) var(--space-2)' }}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
};

const EffectList: React.FC<{ title: string; items: readonly PrestigeEffect[]; marker: string; tone: string }> = ({
  title,
  items,
  marker,
  tone,
}) => (
  <div style={{ flex: '1 1 12rem', minWidth: 0 }}>
    <div className="pixel-22" style={{ color: tone, marginBottom: 'var(--space-1)' }}>
      {title}
    </div>
    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      {items.map((e) => (
        <li key={e.label} style={{ fontSize: '0.875rem', color: 'var(--text-main)', display: 'flex', gap: 'var(--space-1)' }}>
          <span aria-hidden="true" style={{ color: tone, flexShrink: 0 }}>
            {marker}
          </span>
          <span>{e.label}</span>
        </li>
      ))}
    </ul>
  </div>
);

/**
 * Карточка Престижа: что игрок получит сейчас, сколько доиграть до заметной прибавки, что
 * сгорит и что останется. Числа даёт `prestigeForecast`, а списки — таблица, которую тест сверяет
 * с самим переходом, поэтому карточка не обещает того, чего Престиж не делает.
 */
export const PrestigeForecastCard: React.FC<{ onBackToModels: () => void }> = ({ onBackToModels }) => {
  const requestPrestige = useGameStore((s) => s.requestPrestige);
  const generation = useGameStore((s) => s.state.generation);
  const view = useStateSlice(prestigeCardView);
  const { finale, ready } = view;
  const next = CATALOG[Math.min(generation + 1, LAST_GENERATION)];

  return (
    <div
      className="pixel-card"
      style={{
        padding: 'var(--space-3)',
        border: 'var(--frame-w) solid var(--gold)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
      }}
    >
      <div className="pixel-22" style={{ color: 'var(--gold)' }}>
        Престиж в следующее поколение
      </div>

      {!finale && (
        <>
          <div
            style={{
              backgroundColor: 'var(--tint-strong)',
              padding: 'var(--space-2)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-1)',
            }}
          >
            <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Compute, если сделать Престиж сейчас</div>
            {/* Через formatNumber (в срезе), иначе в поздней игре это число с пятнадцатью
                значащими цифрами. То же число показывает окно подтверждения. */}
            <div className="pixel-33" style={{ color: 'var(--gold)' }}>
              +<Num>{view.gain}</Num>
            </div>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              Свободная единица даёт +<Num>{Math.round(COMPUTE_BONUS * 100)}</Num>% к Доходу, а потраченная
              на Перк уже ничего не прибавляет.
            </div>
          </div>

          <div style={{ fontSize: '0.875rem', color: 'var(--text-main)' }}>
            {view.boostIsHalf ? 'До прибавки +50% Compute' : 'До следующей единицы Compute'}: ещё{' '}
            <Num>{view.boostShortfall}</Num> {view.boostShortfallWord} в этом Забеге, и Престиж даст{' '}
            <Num>{view.boostGain}</Num>.
          </div>

          <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
            Престиж завершит Забег и перенесёт тебя в Поколение {next.id}: {next.name}.
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
            <EffectList title="Сбросится" items={PRESTIGE_RESETS} marker="−" tone="var(--red-text)" />
            <EffectList title="Останется" items={PRESTIGE_KEEPS} marker="+" tone="var(--green-text)" />
          </div>
        </>
      )}

      {/* Кнопка не гаснет, даже когда Престиж невозможен: погашенная кнопка молчит о
          причине, а окно подтверждения её объясняет и отказывает тем же переходом,
          который проверяет стор. */}
      <button onClick={requestPrestige} className="pixel-btn pixel-btn-gold" style={{ width: '100%' }}>
        {finale ? 'Финал контента' : ready ? 'Сделать Престиж!' : 'Нужен 1 Агент Флагмана'}
      </button>

      {/* Финал контента: кнопка Престижа выше ничего не выполнит, поэтому плашка без
          действия — тупик. CTA ведёт на вкладку «Модели» тем же локальным setTab,
          без новой навигации; текст не противоречит плашке Сцены в OfficeColumn. */}
      {finale && (
        <div
          style={{
            backgroundColor: 'var(--tint-strong)',
            padding: 'var(--space-2)',
            fontSize: '0.875rem',
            color: 'var(--text-muted)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
            animation: 'toast-fade 0.15s ease-out',
          }}
        >
          <div>
            Ты дошёл до последнего Поколения — продолжение выйдет с новыми моделями. А
            пока закрой все Достижения и развей офис до максимума
          </div>
          <button onClick={onBackToModels} className="pixel-btn pixel-btn-accent" style={{ width: '100%' }}>
            К Моделям
          </button>
        </div>
      )}
    </div>
  );
};

const ChallengeOption: React.FC<{ def: ChallengeDef; canStart: boolean }> = ({ def, canStart }) => {
  const startChallenge = useGameStore((s) => s.startChallenge);
  const { active, done } = useStateSlice((s) => challengeView(s, def));

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-card)',
        border: active ? 'var(--frame-w) solid var(--accent-color)' : 'var(--frame-w) solid var(--border)',
        padding: 'var(--space-2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
      }}
    >
      <span style={{ fontSize: '1rem', color: 'var(--text-main)' }}>{def.name}</span>
      <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{def.desc}</div>
      {done && (
        <div style={{ fontSize: '0.875rem', color: 'var(--green-text)' }}>
          Закрыто: +<Num>{CHALLENGE_REWARD_PCT}</Num>% к Доходу уже у тебя
          {active ? '' : ', повторное прохождение награды не добавит'}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        {active ? (
          <Hint as="span" content="Закроется Престижем" canOpen={() => !canStart}>
            <button
              onClick={() => startChallenge(null)}
              disabled={!canStart}
              className="pixel-btn"
              style={{ padding: 'var(--space-1) var(--space-2)' }}
            >
              {canStart ? 'Снять выбор' : 'Выбрано на этот Забег'}
            </button>
          </Hint>
        ) : (
          <button
            onClick={() => startChallenge(def.id)}
            disabled={!canStart}
            className="pixel-btn pixel-btn-accent"
            style={{ padding: 'var(--space-1) var(--space-2)' }}
          >
            Принять
          </button>
        )}
      </div>
    </div>
  );
};

/**
 * Выбор Испытания Забега рядом с прогнозом. Принять его можно только на свежем Забеге — без
 * Агентов, Апгрейдов и Кликов, — и карточка говорит об этом словами, а не молча гасит кнопки.
 * Решение за ядром (`startChallenge` в сторе): здесь только показ.
 */
export const ChallengeCard: React.FC = () => {
  const { canStart, none, bonusText, doneCount } = useStateSlice(challengeCardView);

  return (
    <div
      className="pixel-card"
      style={{ padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
    >
      <div className="pixel-22" style={{ color: 'var(--text-main)' }}>
        Испытание Забега
      </div>
      <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
        Добровольное ограничение на весь Забег. Закроешь его Престижем — Доход вырастет на{' '}
        <Num>{CHALLENGE_REWARD_PCT}</Num>% навсегда.
        {doneCount > 0 && (
          <>
            {' '}
            Закрыто <Num>{doneCount}</Num>, это уже +<Num>{bonusText}</Num>%.
          </>
        )}
      </div>
      {!canStart && (
        <div style={{ fontSize: '0.875rem', color: 'var(--text-main)' }}>
          {none
            ? 'Испытание выбирается в начале Забега: пока нет Агентов, Апгрейдов и Кликов. Сделай Престиж, и выбор откроется снова.'
            : 'Испытание принято и закроется Престижем. Сменить его уже нельзя: Забег идёт.'}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {CHALLENGES.map((def) => (
          <ChallengeOption key={def.id} def={def} canStart={canStart} />
        ))}
      </div>
    </div>
  );
};
