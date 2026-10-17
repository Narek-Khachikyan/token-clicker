import React from 'react';
import { useGameStore, useStateSlice } from '../store/useGameStore';
import { researchBoostView, researchSlotView, RESEARCH_TERM_TEXT } from '../store/selectors';
import { RESEARCH_BOOST_WINDOW_MS, RESEARCH_SLOTS, RESEARCH_TERM_IDS } from '../economy/research';
import type { ResearchTermId } from '../economy/state';
import { Num } from './Num';
import { useMotionAllowed } from './EventSprites';

/**
 * Слоты Исследований (ТЗ #115). Одно место для двух раскладок: на десктопе блок стоит в колонке Офиса,
 * на телефоне — отдельной вкладкой. Слоты созревают по стенным часам, готовое ждёт сбора, а сбор
 * выплачивает временное усиление. Всё, что здесь показано, читается через срезы селекторов.
 */
export const ResearchBlock: React.FC = () => {
  const hasFree = useStateSlice((s) => s.research.length < RESEARCH_SLOTS);
  const boost = useStateSlice(researchBoostView);

  return (
    <div
      className="pixel-card"
      style={{ padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', flexShrink: 0 }}
    >
      <div style={{ fontSize: '1rem', color: 'var(--text-main)' }}>Исследования</div>

      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
        Два слота созревают по стенным часам и переживают Престиж. Готовое ждёт сбора и до него ничего не платит.
      </div>

      {Array.from({ length: RESEARCH_SLOTS }, (_, index) => (
        <ResearchSlot key={index} index={index} />
      ))}

      {hasFree && <TermChoice />}

      <div
        style={{
          fontSize: 'var(--text-sm)',
          color: boost.active ? 'var(--green)' : 'var(--text-muted)',
        }}
      >
        {boost.active ? (
          <>
            Временное усиление: Доход ×<Num>{boost.multText}</Num>, ещё <Num>{boost.leftText}</Num>. Заканчивается с Престижем.
          </>
        ) : (
          'Усиления нет: собранное Исследование поднимет Доход на время.'
        )}
      </div>
    </div>
  );
};

/** Один слот: пустой, созревающий или ждущий сбора. Подписан на свой индекс, а не на весь список. */
const ResearchSlot: React.FC<{ index: number }> = ({ index }) => {
  const view = useStateSlice((s) => researchSlotView(s, index));
  const collectResearch = useGameStore((s) => s.collectResearch);
  const motion = useMotionAllowed();

  if (!view.busy) {
    return (
      <div
        style={{
          border: 'var(--frame-w) dashed var(--border)',
          padding: 'var(--space-2)',
          fontSize: 'var(--text-sm)',
          color: 'var(--text-muted)',
        }}
      >
        Слот {index + 1} свободен
      </div>
    );
  }

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-card)',
        border: view.ready ? 'var(--frame-w) solid var(--green)' : 'var(--frame-w) solid var(--border)',
        padding: 'var(--space-2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', fontSize: 'var(--text-sm)' }}>
        <span style={{ color: 'var(--text-main)' }}>
          Слот {index + 1}: Исследование на {view.termText}
        </span>
        <span style={{ color: view.ready ? 'var(--green)' : 'var(--text-muted)' }}>{view.leftText}</span>
      </div>

      <div
        role="progressbar"
        aria-label={`Созревание Исследования в слоте ${index + 1}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={view.progress}
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
            width: `${view.progress}%`,
            height: '100%',
            backgroundColor: 'var(--accent-color)',
            transition: motion ? 'width 0.2s linear' : undefined,
          }}
        />
      </div>

      {view.ready && (
        <button
          onClick={() => collectResearch(index)}
          className="pixel-btn pixel-btn-accent"
          style={{ padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--text-sm)', alignSelf: 'flex-end' }}
        >
          Собрать результат
        </button>
      )}
    </div>
  );
};

/**
 * Выбор срока для свободного слота: три кнопки, у каждой названа отдача — окно усиления и его множитель.
 * Закладка идёт в первый свободный слот, так что выбор один на оба.
 */
const TermChoice: React.FC = () => {
  const plantResearch = useGameStore((s) => s.plantResearch);
  const multText = useStateSlice((s) => researchBoostView(s).multText);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>Заложить в свободный слот:</div>
      {/* Столбиком, а не рядом: на 320 px три кнопки в ряд переносили бы срок и отдачу по строкам. */}
      {RESEARCH_TERM_IDS.map((term: ResearchTermId) => (
        <button
          key={term}
          onClick={() => plantResearch(term)}
          className="pixel-btn"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 'var(--space-1)',
            padding: 'var(--space-1) var(--space-2)',
            fontSize: 'var(--text-sm)',
            textAlign: 'left',
          }}
        >
          <span>{RESEARCH_TERM_TEXT[term]}</span>
          <span style={{ color: 'var(--text-muted)' }}>
            ×<Num>{multText}</Num> на <Num>{RESEARCH_BOOST_WINDOW_MS[term] / 60_000}</Num> мин
          </span>
        </button>
      ))}
    </div>
  );
};

/** Вкладка телефона: тот же блок на всю ширину, с прокруткой, как у остальных вкладок нижней панели. */
export const ResearchTab: React.FC = () => (
  <div style={{ height: '100%', overflowY: 'auto', padding: 'var(--space-4)' }}>
    <ResearchBlock />
  </div>
);
