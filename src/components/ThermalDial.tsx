import React from 'react';
import { useGameStore, useStateSlice } from '../store/useGameStore';
import { thermalView } from '../store/selectors';
import { TEMP_MAX, overloadShare } from '../economy/thermal';
import { Num } from './Num';
import { Icon, type IconName } from './Icon';
import type { ThermalStateId } from '../data/thermalCopy';
import { ThermalSparks } from './ThermalSparks';

/** Высота дорожки, px: шкала — главный рычаг игры, и палец или мышь должны в неё попадать. */
const SLIDER_H = 44;

/** Значок состояния. Холод и жар — свои рисунки, «Норма» — галочка, «Перегрев» — треугольник
 *  тревоги: четыре разные формы, чтобы состояние читалось без цвета. */
export const STATE_ICON: Record<ThermalStateId, IconName> = {
  cold: 'snow',
  normal: 'check',
  hot: 'flame',
  overheat: 'alert',
};

/** Цвет подписи состояния: подкрепляет значок и слово, а не заменяет их. Красный на тёмной
 *  панели — светлый `--red-text`, потому что `--danger` держит на ней лишь 3,6:1. */
export const STATE_COLOR: Record<ThermalStateId, string> = {
  cold: 'var(--text-main)',
  normal: 'var(--text-main)',
  hot: 'var(--accent-color)',
  overheat: 'var(--red-text)',
};

/**
 * Температура — живая шкала, а не покупка. Она стоит под кнопкой Клика, потому что это
 * главное решение, которое игрок принимает в секунду: чем горячее, тем выше Доход.
 *
 * Управление мышью и клавиатурой одновременно. Клавиатура обязательна не для доступности,
 * а потому что шкала — это играбельная величина: держать стрелками можно ровно столько,
 * сколько нужно, и не отпуская мышь.
 */
export const ThermalDial: React.FC = () => {
  const view = useStateSlice(thermalView);
  const setTemp = useGameStore((s) => s.setTemp);

  // Проценты шкалы, а не доли: CSS-переменная получает число, которое человек не делит в уме.
  const pct = (view.temp / TEMP_MAX) * 100;

  const setFromClientX = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    setTemp(((e.clientX - rect.left) / rect.width) * TEMP_MAX);
  };

  /**
   * Клавиатура шкалы.
   *
   * Ctrl обязателен: без него стрелки меняли бы Температуру на 8% за нажатие, и игрок,
   * прокручивающий страницу стрелками над шкалой, сдвигал бы её вместо прокрутки. Это
   * требование role=slider в спецификации ARIA, и оно же снимает ловушку.
   *
   * Shift — крупный шаг, чтобы перебрать шкалу грубо, не нажимая двадцать раз.
   */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey) return;
    const fine = TEMP_MAX / 20;
    const coarse = TEMP_MAX / 4;
    const step = e.shiftKey ? coarse : fine;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        setTemp(view.temp + step);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        setTemp(view.temp - step);
        break;
      case 'Home':
        setTemp(0);
        break;
      case 'End':
        setTemp(TEMP_MAX);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <div
      className="thermal-dial"
      style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
      data-thermal={view.tone}
      data-thermal-state={view.state}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          columnGap: 'var(--space-2)',
        }}
      >
        {/* Подпись — слово из CONTEXT.md, а не «температура генерации»: игрок читает шкалу,
            а не спецификацию, и слово «Температура» здесь и в вики означает одно и то же. */}
        <span className="pixel-22" style={{ color: 'var(--text-main)' }}>
          Температура
        </span>
        {/* Состояние — значок и слово, а не цвет: у шкалы четыре состояния, и каждое различимо
            в оттенках серого. Цвет только подкрепляет. Живой регион не нужен: ползунок и так
            озвучивает то же слово в aria-valuetext. */}
        <span
          className="pixel-22 thermal-dial__state"
          style={{
            // `display` живёт в index.css (`.thermal-dial__state`): инлайн не дал бы телефону его скрыть.
            alignItems: 'center',
            gap: 'var(--space-1)',
            color: STATE_COLOR[view.state],
          }}
        >
          <Icon name={STATE_ICON[view.state]} size={20} />
          {view.stateLabel}
        </span>
      </div>

      {/* Дорожка: сама ручка и вся зона нагрева. Полоса перегрева лежит СНАРУЖИ шкалы, а не
          поверх неё, потому что это две разные величины — жар и его последствие. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {/* Искры жара живут ПОВЕРХ дорожки и выходят за её пределы: офис должен выглядеть
            горящим, а не «штриховым». Слой не обрезается — обрезка съела бы половину жеста. */}
        <div style={{ position: 'relative' }}>
          <div
            role="slider"
            tabIndex={0}
            aria-label="Температура генерации"
            aria-valuemin={0}
            aria-valuemax={TEMP_MAX}
            aria-valuenow={Number(view.temp.toFixed(2))}
            aria-valuetext={view.valueText}
            aria-describedby="thermal-help"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              setFromClientX(e);
            }}
            onPointerMove={(e) => { if (e.buttons === 1) setFromClientX(e); }}
            onKeyDown={onKeyDown}
            style={{
              position: 'relative',
              height: `${SLIDER_H}px`,
              backgroundColor: 'var(--bg-void)',
              border: 'var(--frame-w) solid var(--border-strong)',
              // Курсор-решётка, а не стрелка: шкала тянут мышью, и это главный жест.
              cursor: 'ew-resize',
              touchAction: 'none',
              overflow: 'hidden',
            }}
          >
            {/* Заливка до текущей температуры: чем длиннее, тем горячее видно боковым зрением.
                Градиент кладётся на всю дорожку, а не на заливку: иначе при 20% температуры
                игрок увидел бы только холодный синий и не понял бы, куда вообще двинулась шкала. */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background:
                  'linear-gradient(90deg, var(--thermal-cold) 0%, var(--accent-color) 62%, var(--thermal-hot) 100%)',
                opacity: 0.28,
              }}
            />
            <div
              className="thermal-dial__fill"
              style={{
                position: 'absolute',
                inset: 0,
                width: `${pct}%`,
                background:
                  'linear-gradient(90deg, var(--thermal-cold) 0%, var(--accent-color) 62%, var(--thermal-hot) 100%)',
              }}
            />
            {/* Ручка — тёмная плашка в две клетки арта, читаемая на любом участке заливки. */}
            <div
              className="thermal-dial__handle"
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `calc(${pct}% - 4px)`,
                width: '8px',
                backgroundColor: 'var(--bg-void)',
                boxShadow: '0 0 0 var(--frame-w) var(--text-main)',
              }}
            />
            {/* Зона перегруза. Заливка читается как «здесь жарче всего», а не как «сломанная
                часть шкалы»: граница пунктирная, потому что пунктир в игровом интерфейсе уже
                занят Disabled-состоянием, а заливка перегрузной зоны — наоборот, единственное
                место, где доход гарантированно выше. */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${overloadShare() * 100}%`,
                right: 0,
                background:
                  'repeating-linear-gradient(135deg, color-mix(in srgb, var(--thermal-hot) 22%, transparent) 0 4px, transparent 4px 8px)',
                borderLeft: 'var(--frame-w) dashed var(--thermal-hot)',
                pointerEvents: 'none',
              }}
            />
            {/* Подпись зоны: без неё штриховка читается как «сюда нельзя», а не как «здесь
                больше всего». Стоит на подложке цвета пустоты, а не голым текстом поверх
                штриховки: на светлом конце градиента (--thermal-hot) тонкая подпись терялась. */}
            <div
              style={{
                position: 'absolute',
                right: 'var(--space-1)',
                top: '50%',
                transform: 'translateY(-50%)',
                padding: '0 var(--space-1)',
                fontSize: '0.75rem',
                lineHeight: 1.4,
                color: 'var(--thermal-hot)',
                backgroundColor: 'var(--bg-void)',
                pointerEvents: 'none',
              }}
            >
              перегруз
            </div>
          </div>
          <ThermalSparks />
        </div>

        {/* Линия перегрева. Единственная величина, которая тикает сама, поэтому её приходится
            показывать: без неё игрок не понимает, сколько ещё можно греть. Значок и подпись
            стоят при самой линии, а не только в цвете: красный и оранжевый на ней не различают. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
              flexShrink: 0,
              fontSize: '0.8rem',
              whiteSpace: 'nowrap',
              color: view.heatHigh ? 'var(--red-text)' : 'var(--text-muted)',
            }}
          >
            <Icon name="alert" size={16} />
            Перегрев <Num>{view.heatNow}%</Num>
          </span>
          <div
            role="progressbar"
            aria-label="Перегрев"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={view.heatNow}
            style={{
              position: 'relative',
              flex: 1,
              minWidth: 0,
              height: '10px',
              backgroundColor: 'var(--bg-void)',
              border: 'var(--frame-w) solid var(--border)',
              overflow: 'hidden',
            }}
          >
            <div
              className="thermal-dial__heat"
              style={{
                width: `${view.heatBar}%`,
                height: '100%',
                // Цвет перегрева — белый кал, а не красный: он остаётся различимым на
                // акценте любого из восьми Поколений, где красный уходил бы в тот же тон.
                backgroundColor: view.heatHigh ? 'var(--thermal-hot)' : 'var(--accent-color)',
              }}
            />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
        <span>
          Доход ×<Num>{view.mult}</Num>
        </span>
        <span style={{ color: view.riskHot ? 'var(--red-text)' : 'var(--text-muted)' }}>
          {view.risk}
        </span>
      </div>

      {/* Подсказка видна всегда, а не по наведению: игрок тянет шкалу мышью и не водит
          курсором по подписи, поэтому наведением она не открывалась бы никогда. Одна строка:
          что делать рукой и с клавиатуры; что даёт жар и чем он грозит, говорят строка Дохода
          и линия перегрева выше. */}
      <div
        id="thermal-help"
        style={{
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
          lineHeight: 1.35,
        }}
      >
        Тяни мышью или жми Ctrl + ← →
        {view.stunned ? ' · Сброс: жар в нуле, Доход вернётся' : ''}
      </div>
    </div>
  );
};
