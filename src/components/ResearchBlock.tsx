import React, { useState } from 'react';
import { useGameStore, useStateSlice } from '../store/useGameStore';
import { finetuneYieldText, nextOpeningText, researchBoostView, researchHasteView, researchSlotView, RESEARCH_KIND_TEXT, RESEARCH_TERM_TEXT } from '../store/selectors';
import { RESEARCH_BOOST_WINDOW_MS, RESEARCH_KINDS, RESEARCH_TERM_IDS, researchSlots } from '../economy/research';
import { PERK_BY_ID } from '../economy/perks';
import type { ResearchKind, ResearchTermId } from '../economy/state';
import { Num } from './Num';
import { useMotionAllowed } from './EventSprites';

/**
 * Слоты Исследований (ТЗ #115). Одно место для двух раскладок: на десктопе блок стоит в колонке Офиса,
 * на телефоне — отдельной вкладкой. Слоты созревают по стенным часам, готовое ждёт сбора, а сбор
 * выплачивает временное усиление, Заготовку или постоянное открытие. Всё, что здесь показано, читается через срезы селекторов.
 */
export const ResearchBlock: React.FC = () => {
  // Слотов два, третий открывает Перк (ТЗ #118). Заложенное в третьем слоте видно и после сброса дерева, пока не собрано.
  const slots = useStateSlice((s) => Math.max(researchSlots(s), s.research.length));
  const hasFree = useStateSlice((s) => s.research.length < researchSlots(s));
  const thirdSlotLocked = useStateSlice((s) => !s.perks.includes('research_slot'));
  const boost = useStateSlice(researchBoostView);
  const stock = useStateSlice((s) => s.finetuneStock);

  return (
    <div
      className="pixel-card"
      style={{ padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', flexShrink: 0 }}
    >
      <div style={{ fontSize: '1rem', color: 'var(--text-main)' }}>Исследования</div>

      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
        Слоты созревают по стенным часам и переживают Престиж. Готовое ждёт сбора и до него ничего не платит.
      </div>

      {Array.from({ length: slots }, (_, index) => (
        <ResearchSlot key={index} index={index} />
      ))}

      {thirdSlotLocked && (
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
          Третий слот открывает Перк «{PERK_BY_ID.research_slot.name}» в дереве Перков.
        </div>
      )}

      {hasFree && <TermChoice />}

      {/* Запас переживает Престиж; применяется к нанятой Модели в её карточке в магазине (ТЗ #116). */}
      <div style={{ fontSize: 'var(--text-sm)', color: stock > 0 ? 'var(--text-main)' : 'var(--text-muted)' }}>
        Заготовки Файнтюна: <Num>{stock}</Num>
        {stock > 0 && <span style={{ color: 'var(--text-muted)' }}> — примените к Модели в магазине: Thinking или Turbo.</span>}
      </div>

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
          Слот {index + 1}: {view.resultText} на {view.termText}
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

      {!view.ready && <HasteControl index={index} />}

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
 * Ускорение созревающего слота одним кристаллом (ТЗ #117). Цена названа до нажатия: процент к Доходу,
 * который уйдёт с кристаллом, и сдвиг готовности. Без целого кристалла кнопка выключена и говорит, чего не хватает.
 */
const HasteControl: React.FC<{ index: number }> = ({ index }) => {
  const haste = useStateSlice((s) => researchHasteView(s, index));
  const hasteResearch = useGameStore((s) => s.hasteResearch);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      {/* Кнопка короткая и во всю ширину слота: цена стоит строкой под ней, до нажатия, и не рвёт кнопку на 320 px. */}
      <button
        onClick={() => hasteResearch(index)}
        disabled={!haste.canHaste}
        className="pixel-btn"
        style={{ width: '100%', padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--text-sm)' }}
      >
        Ускорить за кристалл
      </button>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
        {haste.canHaste ? (
          <>
            {haste.losesBonus ? (
              <>Цена: −<Num>{haste.lostText}</Num>% к Доходу</>
            ) : (
              'Цена: процент не теряется, запас выше потолка'
            )}
            . Готово раньше на <Num>{haste.shiftText}</Num>
          </>
        ) : (
          'Нужен целый кристалл в запасе'
        )}
      </div>
    </div>
  );
};

/**
 * Выбор результата и срока для свободного слота (ТЗ #116): сначала вид результата, потом срок. У каждого
 * срока названа отдача выбранного вида — окно усиления или число Заготовок. Закладка идёт в первый свободный
 * слот, так что выбор один на оба. Вид держит сама панель: он выбирается перед закладкой и не сохраняется.
 */
const TermChoice: React.FC = () => {
  const plantResearch = useGameStore((s) => s.plantResearch);
  const multText = useStateSlice((s) => researchBoostView(s).multText);
  const notation = useStateSlice((s) => s.settings.notation);
  // Название следующего открытия; пусто, когда открыто всё: тогда вид «открытие» закрыт.
  const opening = useStateSlice(nextOpeningText);
  const [kind, setKind] = useState<ResearchKind>('boost');
  const closed = kind === 'unlock' && opening === '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>Результат:</div>
      <div role="group" aria-label="Вид результата Исследования" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
        {RESEARCH_KINDS.map((k: ResearchKind) => (
          <button
            key={k}
            aria-pressed={kind === k}
            disabled={k === 'unlock' && opening === ''}
            onClick={() => setKind(k)}
            className="pixel-btn"
            style={{
              padding: 'var(--space-1) var(--space-2)',
              fontSize: 'var(--text-sm)',
              borderColor: kind === k ? 'var(--accent-color)' : undefined,
            }}
          >
            {RESEARCH_KIND_TEXT[k]}
          </button>
        ))}
      </div>
      {kind === 'unlock' && (
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
          {opening ? <>Откроется: {opening}. Переживает Престиж и входит в свой пул.</> : 'Все открытия уже открыты.'}
        </div>
      )}
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>Заложить в свободный слот:</div>
      {/* Столбиком, а не рядом: на 320 px три кнопки в ряд переносили бы срок и отдачу по строкам. */}
      {RESEARCH_TERM_IDS.map((term: ResearchTermId) => (
        <button
          key={term}
          disabled={closed}
          onClick={() => plantResearch(term, kind)}
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
            {kind === 'boost' ? (
              <>
                ×<Num>{multText}</Num> на <Num>{RESEARCH_BOOST_WINDOW_MS[term] / 60_000}</Num> мин
              </>
            ) : kind === 'unlock' ? (
              'навсегда'
            ) : (
              <>+{finetuneYieldText(term, notation)}</>
            )}
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
