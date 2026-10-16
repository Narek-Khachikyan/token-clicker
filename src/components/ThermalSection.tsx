import React from 'react';
import { THERMAL_COPY, THERMAL_RISKS, thermalZone } from '../data/thermalCopy';
import { useGameStore } from '../store/useGameStore';
import { isOverloaded, overloadShare } from '../economy/thermal';

/**
 * Справка по Температуре для окна «Инфо».
 *
 * Живёт своим компонентом, а не строкой в Modals: окно «Инфо» — это общий словарь на 37
 * терминов, и секция про главную механику игры должна стоять в нём ПЕРВОЙ, а не в общем
 * списке двадцать вторым. Всё содержимое приходит из `thermalCopy`, где числа вычислены из
 * констант баланса, поэтому правка механики обязана менять и этот текст.
 *
 * Текущая зона подсвечивается по живому состоянию: игрок читает про «перегруз» и видит, что
 * он в перегрузе прямо сейчас. Это и есть то, ради чего справка открывается.
 */
export const ThermalSection: React.FC = () => {
  const temp = useGameStore((s) => s.state.temp);
  const heat = useGameStore((s) => s.state.heat);
  const here = thermalZone(temp);
  const share = Math.round(overloadShare() * 100);

  return (
    <section
      style={{
        marginBottom: 'var(--space-2)',
        padding: 'var(--space-2)',
        backgroundColor: 'var(--bg-card)',
        borderLeft: 'calc(var(--frame-w) * 2) solid var(--thermal-cold)',
      }}
    >
      <h3 className="section-head" style={{ margin: '0 0 var(--space-2)', fontSize: '1rem' }}>
        {THERMAL_COPY.title}
      </h3>
      <p style={{ margin: '0 0 var(--space-2)', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
        {THERMAL_COPY.summary}
      </p>

      {/* Зоны шкалы. Текущая подсвечена акцентом Поколения, соседние приглушены: три строки
          текста читаются один раз, а подсветка отвечает на вопрос «а я где сейчас». */}
      <dl style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', margin: '0 0 var(--space-2)' }}>
        {THERMAL_COPY.zones.map((z) => {
          const current = z.id === here.id;
          return (
            <div key={z.id} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'baseline' }}>
              <dt
                style={{
                  flexShrink: 0,
                  width: '5.5rem',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: current ? 'var(--accent-color)' : 'var(--text-muted)',
                }}
              >
                {z.label}
                <span style={{ fontWeight: 400, opacity: 0.7 }}>
                  {' '}
                  {z.range[0]}–{z.range[1]}
                </span>
              </dt>
              <dd
                style={{
                  margin: 0,
                  fontSize: '0.8rem',
                  color: current ? 'var(--text-main)' : 'var(--text-muted)',
                }}
              >
                {z.text}
              </dd>
            </div>
          );
        })}
      </dl>

      {/* Риски: заголовок и текст из thermalCopy, ничего не собирается на месте. */}
      <ul style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', margin: '0 0 var(--space-2)', paddingLeft: 'var(--space-4)' }}>
        {THERMAL_RISKS.map((r) => (
          <li key={r.kind} style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>{r.title}</span>{' '}
            {r.text}
          </li>
        ))}
      </ul>

      <p style={{ margin: '0 0 var(--space-1)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{THERMAL_COPY.cold}</p>
      {/* Совет — единственная строка, выделенная цветом: это то, ради чего игрок сюда пришёл. */}
      <p
        style={{
          margin: 0,
          fontSize: '0.85rem',
          color: 'var(--text-main)',
          paddingTop: 'var(--space-1)',
          borderTop: 'var(--frame-w) solid var(--border)',
        }}
      >
        {THERMAL_COPY.tip}
      </p>

      {/* Живая строка состояния: где игрок на шкале и сколько ещё держит перегрев. Справка
          без неё читается как документация, а с ней — как ответ на вопрос о конкретной шкале
          перед игроком. */}
      <p style={{ margin: 'var(--space-2) 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        Сейчас: {here.label.toLowerCase()}
        {isOverloaded(temp) ? ` (зона перегруза начинается с ${share}% шкалы)` : ''}, перегрев{' '}
        {Math.round(heat * 100)}%.
      </p>
    </section>
  );
};
