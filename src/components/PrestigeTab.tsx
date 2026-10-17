import React from 'react';
import { useGameStore, useStateSlice, type PrestigeSection } from '../store/useGameStore';
import { challengeCardView, challengeView, prestigeCardView } from '../store/selectors';
import { CATALOG, LAST_GENERATION } from '../economy/catalog';
import { challengePool, INHERITED_REWARD_PCT, type ChallengeDef } from '../economy/challenges';
import { COURSE_BY_ID, courseById, type Course } from '../data/courses';
import { LABS } from '../data/labs';
import { courseMissing } from '../economy/course';
import { COMPUTE_BONUS, isContentFinale, passedGenerations } from '../economy/engine';
import { generationRule } from '../economy/rules';
import { PRESTIGE_KEEPS, PRESTIGE_RESETS, type PrestigeEffect } from '../economy/prestigeForecast';
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
  // Предложение лежит, а Курс не выбран: кнопка честно говорит, чего не хватает, а окно подтверждения объяснит.
  const needsCourse = useGameStore((s) => courseMissing(s.state));
  // На Финале переход ведёт в выбранное пройденное Поколение: без выбора назвать его нельзя.
  const finaleTarget = useGameStore((s) => s.finaleTarget);
  const view = useStateSlice(prestigeCardView);
  const { finale, ready } = view;
  const next = CATALOG[Math.min(generation + 1, LAST_GENERATION)];
  const destination = finale ? (finaleTarget === null ? null : CATALOG[finaleTarget]) : next;

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

      {/* Числа доступны и на Финале: Престиж там тоже платит Compute, а вернуться можно в пройденное Поколение. */}
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
        {destination ? (
          <>
            Престиж завершит Забег и {finale ? 'вернёт' : 'перенесёт'} тебя в Поколение {destination.id}: {destination.name}.
          </>
        ) : (
          'Выбери пройденное Поколение выше: туда и вернёт Престиж.'
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <EffectList title="Сбросится" items={PRESTIGE_RESETS} marker="−" tone="var(--red-text)" />
        <EffectList title="Останется" items={PRESTIGE_KEEPS} marker="+" tone="var(--green-text)" />
      </div>

      {/* Кнопка не гаснет, даже когда Престиж невозможен: погашенная кнопка молчит о
          причине, а окно подтверждения её объясняет и отказывает тем же переходом,
          который проверяет стор. */}
      <button onClick={requestPrestige} className="pixel-btn pixel-btn-gold" style={{ width: '100%' }}>
        {!ready
          ? 'Нужен 1 Агент Флагмана'
          : needsCourse
            ? 'Сначала выбери Курс'
            : finale && finaleTarget === null
              ? 'Сначала выбери Поколение'
              : 'Сделать Престиж!'}
      </button>

      {/* Финал контента: Престиж здесь возвращает в пройденное Поколение (список выше), поэтому плашка
          больше не тупик. CTA ведёт на вкладку «Модели» тем же локальным setTab, без новой навигации;
          текст не противоречит плашке Сцены в OfficeColumn. */}
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
            Ты дошёл до последнего Поколения — продолжение выйдет с новыми моделями. Престиж вернёт тебя
            в любое пройденное Поколение, выбери его выше. А пока закрой все Достижения и развей офис до максимума
          </div>
          <button onClick={onBackToModels} className="pixel-btn pixel-btn-accent" style={{ width: '100%' }}>
            К Моделям
          </button>
        </div>
      )}
    </div>
  );
};

/** Одно пройденное Поколение в списке возврата: номер, название и Правило, которое в нём действует. */
const GenerationOption: React.FC<{ index: number; chosen: boolean; onPick: () => void }> = ({ index, chosen, onPick }) => {
  const gen = CATALOG[index];
  const rule = generationRule(index);
  return (
    <button
      type="button"
      aria-pressed={chosen}
      onClick={onPick}
      className="pixel-card course-option"
      style={{
        textAlign: 'left',
        backgroundColor: 'var(--bg-card)',
        border: chosen ? 'var(--frame-w) solid var(--accent-color)' : 'var(--frame-w) solid var(--border)',
        padding: 'var(--space-2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
        width: '100%',
        minHeight: 'var(--tap-min)',
        cursor: 'pointer',
        font: 'inherit',
        color: 'inherit',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
        <span style={{ fontSize: '1rem', color: 'var(--text-main)' }}>
          Поколение <Num>{gen.id}</Num>: {gen.name}
        </span>
        <span style={{ fontSize: 'var(--text-xs)', color: chosen ? 'var(--accent-color)' : 'var(--text-muted)', flexShrink: 0 }}>
          {chosen ? 'Выбрано' : 'Пройдено'}
        </span>
      </span>
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
        {rule ? `Правило Поколения: ${rule.name}` : 'Без Правила Поколения'}
      </span>
    </button>
  );
};

/**
 * Возврат с Финала контента (ADR-0013, слой 5): список всех пройденных Поколений, из которых игрок
 * выбирает, куда вернуться. Виден только на Финале; вне Финала карточки нет. Решение «можно ли» — за
 * ядром (`prestigeDestination`) и стором (`chooseFinaleTarget`): здесь только показ и выбор.
 */
export const ReturnGenerationCard: React.FC = () => {
  const finale = useStateSlice(isContentFinale);
  // Примитивы, а не состояние: список меняется только с Престижем, а не с тиком.
  const maxGeneration = useGameStore((s) => s.state.maxGeneration);
  const chosen = useGameStore((s) => s.finaleTarget);
  const chooseFinaleTarget = useGameStore((s) => s.chooseFinaleTarget);
  if (!finale) return null;
  const options = passedGenerations(maxGeneration);

  return (
    <div
      className="pixel-card"
      style={{ padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
    >
      <div className="pixel-22" style={{ color: 'var(--gold)' }}>
        Вернуться в пройденное Поколение
      </div>
      <div style={{ fontSize: '0.875rem', color: chosen === null ? 'var(--text-main)' : 'var(--text-muted)' }}>
        {chosen === null
          ? 'Выбери одно: Престиж вернёт тебя туда и начнёт Забег заново. Сменить выбор можно, пока не подтвердил Престиж.'
          : 'Выбор можно сменить, пока не подтвердил Престиж.'}
      </div>
      <div role="group" aria-label="Пройденные Поколения" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {options.map((index) => (
          <GenerationOption key={index} index={index} chosen={chosen === index} onPick={() => chooseFinaleTarget(index)} />
        ))}
      </div>
    </div>
  );
};

const ChallengeOption: React.FC<{ def: ChallengeDef; canStart: boolean }> = ({ def, canStart }) => {
  const toggleChallenge = useGameStore((s) => s.toggleChallenge);
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
      <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
        <span style={{ fontSize: '1rem', color: 'var(--text-main)' }}>{def.name}</span>
        {/* Тяжесть — вклад Испытания в Класс риска; видно до выбора, чтобы Класс собирали с открытыми глазами. */}
        <span
          className="pixel-22"
          style={{ color: active ? 'var(--accent-color)' : 'var(--text-muted)', flexShrink: 0 }}
        >
          +<Num>{def.weight}</Num>
        </span>
      </span>
      <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{def.desc}</div>
      {done && (
        <div style={{ fontSize: '0.875rem', color: 'var(--green-text)' }}>
          Закрывалось раньше: +<Num>{INHERITED_REWARD_PCT}</Num>% к Доходу уже у тебя.
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={() => toggleChallenge(def.id)}
          disabled={!canStart}
          aria-pressed={active}
          className={`pixel-btn ${active ? '' : 'pixel-btn-accent'}`}
          style={{ padding: 'var(--space-1) var(--space-2)' }}
        >
          {active ? 'Снять' : canStart ? 'Взять' : 'Забег идёт'}
        </button>
      </div>
    </div>
  );
};

/**
 * Выбор Испытаний Забега рядом с прогнозом. Берут их только на свежем Забеге — без Агентов,
 * Апгрейдов и Кликов, — и можно несколько сразу; карточка говорит об этом словами, а не молча
 * гасит кнопки. Решение «можно ли» — за ядром (`toggleChallenge` в сторе): здесь только показ.
 */
export const ChallengeCard: React.FC = () => {
  const { canStart, none, risk, multText, capped, inheritedText, doneCount } = useStateSlice(challengeCardView);
  // Открытые Исследованием Испытания (ТЗ #118): список переписывается только при открытии, а не каждый тик.
  const unlocks = useStateSlice((s) => s.researchUnlocks);

  return (
    <div
      className="pixel-card"
      style={{ padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
    >
      <div className="pixel-22" style={{ color: 'var(--text-main)' }}>
        Испытания Забега
      </div>
      <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
        Добровольные ограничения на весь Забег; взять можно несколько сразу. Престиж закроет взятые
        и заплатит за них Compute — тем больше, чем выше Класс риска.
        {doneCount > 0 && (
          <>
            {' '}
            Закрывалось раньше: +<Num>{inheritedText}</Num>% к Доходу навсегда.
          </>
        )}
      </div>
      {/* Класс риска виден до старта: сумма тяжести взятых и множитель Compute за этот Престиж. */}
      <div
        style={{
          backgroundColor: 'var(--tint-strong)',
          padding: 'var(--space-2)',
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 'var(--space-2)',
          flexWrap: 'wrap',
        }}
      >
        <span className="pixel-22" style={{ color: none ? 'var(--text-muted)' : 'var(--accent-color)' }}>
          Класс риска:{' '}
          <Num>
            {risk} → ×{multText}
          </Num>{' '}
          Compute
        </span>
        <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          {capped ? 'потолок достигнут' : 'растёт с тяжестью, до потолка'}
        </span>
      </div>
      {!canStart && (
        <div style={{ fontSize: '0.875rem', color: 'var(--text-main)' }}>
          {none
            ? 'Испытания берутся в начале Забега: пока нет Агентов, Апгрейдов и Кликов. Сделай Престиж, и выбор откроется снова.'
            : 'Испытания взяты и закроются Престижем. Сменить их уже нельзя: Забег идёт.'}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {challengePool({ researchUnlocks: unlocks }).map((def) => (
          <ChallengeOption key={def.id} def={def} canStart={canStart} />
        ))}
      </div>
    </div>
  );
};

/** Один вариант Курса: название, что он делает и голос Маскота, который его предлагает. */
const CourseOption: React.FC<{ course: Course; chosen: boolean; onPick: () => void }> = ({ course, chosen, onPick }) => {
  const lab = LABS[course.lab];
  return (
    <button
      type="button"
      aria-pressed={chosen}
      onClick={onPick}
      className="pixel-card course-option"
      style={{
        textAlign: 'left',
        backgroundColor: 'var(--bg-card)',
        border: chosen ? 'var(--frame-w) solid var(--accent-color)' : 'var(--frame-w) solid var(--border)',
        padding: 'var(--space-2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
        width: '100%',
        minHeight: 'var(--tap-min)',
        cursor: 'pointer',
        font: 'inherit',
        color: 'inherit',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
        <span style={{ fontSize: '1rem', color: 'var(--text-main)' }}>{course.name}</span>
        <span style={{ fontSize: 'var(--text-xs)', color: chosen ? 'var(--accent-color)' : 'var(--text-muted)', flexShrink: 0 }}>
          {chosen ? 'Выбрано' : course.effect.kind === 'rule' ? 'Правило Поколения' : 'Собственный Курс'}
        </span>
      </span>
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-main)' }}>{course.summary}</span>
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
        <span style={{ color: lab.color }}>{lab.mascot}</span>: {course.quip}
      </span>
    </button>
  );
};

/**
 * Выбор Курса нового Забега (ADR-0013): три варианта, предложенные при найме Флагмана, лежат в
 * состоянии и не меняются от перезагрузки. Выбор свободный до подтверждения Престижа; после него
 * Курс держится весь Забег, и карточка говорит об этом словами. Решение «можно ли» — за ядром
 * (`chooseCourse` в сторе): здесь только показ.
 */
export const CourseCard: React.FC = () => {
  const chooseCourse = useGameStore((s) => s.chooseCourse);
  // Подписка на примитивы и стабильные ссылки: `courseOffer` меняется предложением, а не тиком.
  const offer = useGameStore((s) => s.state.courseOffer);
  const next = useGameStore((s) => s.state.courseNext);
  const current = courseById(useGameStore((s) => s.state.course));
  const options = offer.map((id) => COURSE_BY_ID[id]).filter((c): c is Course => !!c);

  return (
    <div
      className="pixel-card"
      style={{ padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
    >
      <div className="pixel-22" style={{ color: 'var(--text-main)' }}>
        Курс нового Забега
      </div>
      {options.length === 0 ? (
        <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          Когда наймёшь Флагмана, Маскоты предложат три Курса. Выбранный действует весь следующий Забег, и
          сменить его до следующего Престижа нельзя.
        </div>
      ) : (
        <>
          <div style={{ fontSize: '0.875rem', color: next ? 'var(--text-muted)' : 'var(--text-main)' }}>
            {next
              ? 'Курс можно сменить, пока не подтвердил Престиж: после него он действует весь Забег.'
              : 'Выбери один из трёх Курсов: без выбора Престиж не начнётся. Курс действует весь следующий Забег.'}
          </div>
          <div role="group" aria-label="Курсы на выбор" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {options.map((c) => (
              <CourseOption key={c.id} course={c} chosen={next === c.id} onPick={() => chooseCourse(c.id)} />
            ))}
          </div>
        </>
      )}
      <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
        {current ? (
          <>
            Сейчас действует Курс «{current.name}»: {current.summary}
          </>
        ) : (
          'Сейчас Забег идёт без Курса.'
        )}
      </div>
    </div>
  );
};
