import React from 'react';
import { useStateSlice } from '../store/useGameStore';
import { milestoneView } from '../store/selectors';
import { MILESTONES } from '../economy/milestones';
import { Hint } from './Hint';
import { Num } from './Num';

/**
 * Полоса вех: единственное место, где игрок видит, сколько шагов осталось до конца первого
 * получаса.
 *
 * Стоит под Температурой, а не в магазине: веха — это цель, а магазин про покупки. Игрок
 * возвращается к цели после каждой выплаты, а до магазина идёт, когда уже знает, зачем.
 *
 * Одна строка: десять делений, название цели и награда. Раньше полоса занимала пять строк
 * (деления, название с «N / 10», подпись, награда) и вытесняла из невысокого окна Клик и
 * шкалу Температуры — то, ради чего колонка и существует. «N / 10» читается по делениям и
 * озвучивается в подписи группы, а подпись вехи («зачем это нужно») лежит в подсказке и в
 * озвучке: название цели само говорит, что делать, а подпись только поясняет.
 */
export const MilestoneStrip: React.FC = () => {
  const { current, hint, reward, done } = useStateSlice(milestoneView);

  if (!current) return null;

  return (
    <Hint content={hint} style={{ width: '100%' }}>
      <div
        className="milestone-strip"
        role="group"
        aria-label={`Веха ${done.length + 1} из ${MILESTONES.length}: ${current.title}. ${hint}. Награда: ${reward} Токенов`}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
        }}
      >
        {/* Деления: одно на веху, заполненное — выполненное. Чистый пиксельный счётчик,
            читаемый боковым зрением, без цифр. Заполненное деление берёт акцент Поколения,
            а незаполненное — пустоту сцены: контраст между «сделано» и «ещё нет» должен быть
            виден на расстоянии вытянутой руки. */}
        <div style={{ display: 'flex', gap: 'var(--space-0)', height: '12px', flexShrink: 0 }} aria-hidden="true">
          {MILESTONES.map((m) => {
            const isDone = done.includes(m.id);
            return (
              <div
                key={m.id}
                style={{
                  width: '6px',
                  backgroundColor: isDone ? 'var(--accent-color)' : 'var(--bg-void)',
                  border: isDone ? 'var(--frame-w) solid var(--accent-color)' : 'var(--frame-w) solid var(--border)',
                }}
              />
            );
          })}
        </div>

        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 'var(--text-sm)',
            color: 'var(--text-main)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {current.title}
        </span>
        {/* Награда видна сразу, а не по факту: игрок должен видеть, ради чего тянуть. */}
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--gold)', whiteSpace: 'nowrap', flexShrink: 0 }}>
          +<Num>{reward}</Num>
        </span>
      </div>
    </Hint>
  );
};
