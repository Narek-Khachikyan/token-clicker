import { describe, expect, it } from 'vitest';
import { formatNumber } from './economy/format';
import { STREAK_MAX_LEVEL } from './economy/streak';
import {
  FLOATER_STEPS,
  floaterLeft,
  floaterStep,
  CLICK_COL_MAX,
  CLICK_COL_MIN,
  CLICK_COL_PAD,
  clickColWidth,
  COUNTER_CHARS,
  counterWidth,
  HEADER_H,
  MASCOT_CARD_EDGE,
  MASCOT_CARD_W,
  mascotCardBottom,
  mascotCardLeft,
  mascotCardWidth,
  NARROW_MAX,
  OFFICE_COL_MIN,
  SCENE_COL_PAD,
  SCENE_MIN_H,
  SHOP_COL_MAX,
  SHOP_COL_MIN,
  shopColWidth,
  TAB_BAR_H,
  TAP_MIN,
  THREE_COL_MIN,
  TOAST_CLEARANCE,
  TOAST_MARGIN,
  toastStackWidth,
  toastStackBand,
  TOAST_GAP,
  TOAST_CARD_BUDGET,
  TOAST_VISIBLE_MAX,
  TOAST_QUEUE_H,
} from './layout';

// Раскладку не проверяет ничто, кроме этих чисел, поэтому тест ловит ровно тот класс дефекта,
// из-за которого задача и появилась: значения в трёх местах разъезжаются (порог, базис колонок
// и CSS). Имена окна взяты из ручного чек-листа спеки.

const WINDOWS = [999, 1000, 1001, 1024, 1100, 1280, 1440];

describe('layout', () => {
  it('derives the three-column threshold from the column minima', () => {
    expect(THREE_COL_MIN).toBe(CLICK_COL_MIN + SHOP_COL_MIN + OFFICE_COL_MIN);
  });

  it('keeps every column minimum below its maximum', () => {
    expect(CLICK_COL_MIN).toBeLessThan(CLICK_COL_MAX);
    expect(SHOP_COL_MIN).toBeLessThan(SHOP_COL_MAX);
    expect(OFFICE_COL_MIN).toBeGreaterThan(0);
  });

  it('fits three columns exactly at the threshold and above it', () => {
    for (const vw of WINDOWS) {
      const columns = clickColWidth(vw) + shopColWidth(vw) + OFFICE_COL_MIN;
      expect(columns <= vw).toBe(vw >= THREE_COL_MIN);
    }
  });

  it('never lets a column leave its own bounds', () => {
    for (let vw = 320; vw <= 2560; vw += 7) {
      expect(clickColWidth(vw)).toBeGreaterThanOrEqual(CLICK_COL_MIN);
      expect(clickColWidth(vw)).toBeLessThanOrEqual(CLICK_COL_MAX);
      expect(shopColWidth(vw)).toBeGreaterThanOrEqual(SHOP_COL_MIN);
      expect(shopColWidth(vw)).toBeLessThanOrEqual(SHOP_COL_MAX);
    }
  });

  it('never shrinks a column as the window grows', () => {
    // Базис зависит только от ширины окна, поэтому колонка может упереться в минимум и
    // простоять там, но не может скачком сузиться — это и есть «сетка не прыгает».
    for (let vw = THREE_COL_MIN; vw < 2560; vw += 7) {
      expect(clickColWidth(vw + 7)).toBeGreaterThanOrEqual(clickColWidth(vw));
      expect(shopColWidth(vw + 7)).toBeGreaterThanOrEqual(shopColWidth(vw));
    }
  });

  it('reaches the former maximums on a full window', () => {
    expect(clickColWidth(1440)).toBe(CLICK_COL_MAX);
    expect(shopColWidth(1440)).toBe(SHOP_COL_MAX);
  });

  // Вертикальный ритм слоя 7 жил только в браузерных замерах, а числа обязаны держаться
  // тестом: они стоят в трёх местах сразу (CSS-шапка, таб-бар, отступ тостов), и разъезд
  // между ними выглядел бы как «плашка налезает на кнопку» — без единой ошибки в консоли.
  it('orders the shell bars so none is shorter than a touch target', () => {
    expect(TAP_MIN).toBeGreaterThanOrEqual(44);
    expect(HEADER_H).toBeGreaterThanOrEqual(TAP_MIN);
    expect(TAB_BAR_H).toBeGreaterThanOrEqual(TAP_MIN);
  });

  it('keeps the toast clearance clear of the bars it sits above', () => {
    // Отступ — это воздух, а не полоса: он обязан быть положительным и меньше самой
    // короткой полосы, иначе стопка тостов начала бы отодвигать половину экрана.
    expect(TOAST_CLEARANCE).toBeGreaterThan(0);
    expect(TOAST_CLEARANCE).toBeLessThan(TAP_MIN);
  });

  it('keeps the narrow breakpoint strictly inside the one-column range', () => {
    // NARROW_MAX — порог сжатия шапки, а не порог раскладки: на 600..999 px раскладка уже
    // одноколоночная, но шапка ещё может быть широкой. Равенство означало бы, что два разных
    // вопроса получили один ответ.
    expect(NARROW_MAX).toBeLessThan(THREE_COL_MIN);
  });

  // Стек тостов уже лечился от замороженного числа в нижнем отступе — ширина болела тем же:
  // число, посчитанное для одного конкретного окна, на 320 px уводило правый край карточки
  // за экран на 46 px. Ширина обязана приезжать из расчёта колонок и влезать в окно везде.
  it('fits the toast stack inside the window at 320, 360 and 390', () => {
    for (const vw of [320, 360, 390]) {
      const w = toastStackWidth(vw);
      expect(w).toBeGreaterThan(0);
      // Левое поле плюс стек плюс правое поле — внутри окна: горизонтальной прокрутки нет.
      expect(TOAST_MARGIN * 2 + w).toBeLessThanOrEqual(vw);
    }
    // Замер из задачи: на 320 px стек занимает окно за вычетом полей.
    expect(toastStackWidth(320)).toBe(320 - TOAST_MARGIN * 2);
  });

  // Тост не должен лежать на счётчике, а пока есть место — и на шкале Температуры; на любой
  // сетке окон, а не на одном замеренном.
  it('never puts the toast stack over the counter, and over the scale while there is room', () => {
    for (let counterBottom = 100; counterBottom <= 260; counterBottom += 20) {
      for (let keepVisibleBottom = counterBottom + 40; keepVisibleBottom <= 700; keepVisibleBottom += 30) {
        for (let contentBottom = keepVisibleBottom; contentBottom <= 760; contentBottom += 40) {
          for (let limit = 480; limit <= 900; limit += 20) {
            const { top, slots } = toastStackBand({ counterBottom, keepVisibleBottom, contentBottom, limit });
            expect(top, 'стек начинается над счётчиком').toBeGreaterThanOrEqual(counterBottom + TOAST_GAP);
            if (keepVisibleBottom + TOAST_GAP + (TOAST_CARD_BUDGET - TOAST_GAP) <= limit) {
              expect(top, 'стек закрыл шкалу Температуры').toBeGreaterThanOrEqual(keepVisibleBottom + TOAST_GAP);
            }
            expect(slots).toBeGreaterThanOrEqual(1);
            expect(slots).toBeLessThanOrEqual(TOAST_VISIBLE_MAX);
          }
        }
      }
    }
  });

  it('keeps one toast card inside the window whenever the counter leaves room for it', () => {
    for (let counterBottom = 100; counterBottom <= 260; counterBottom += 20) {
      for (let limit = 480; limit <= 900; limit += 20) {
        if (counterBottom + TOAST_GAP + (TOAST_CARD_BUDGET - TOAST_GAP) > limit) continue;
        const { top } = toastStackBand({ counterBottom, keepVisibleBottom: limit, contentBottom: limit + 100, limit });
        expect(top + TOAST_CARD_BUDGET - TOAST_GAP, 'тост вышел за нижнюю полосу').toBeLessThanOrEqual(limit);
      }
    }
  });

  it('starts the toast stack under the column when there is room and lifts it when there is not', () => {
    const roomy = toastStackBand({ counterBottom: 140, keepVisibleBottom: 400, contentBottom: 480, limit: 900 });
    expect(roomy.top).toBe(480 + TOAST_GAP);
    expect(roomy.slots).toBe(TOAST_VISIBLE_MAX);
    const tight = toastStackBand({ counterBottom: 140, keepVisibleBottom: 400, contentBottom: 640, limit: 686 });
    expect(tight.top).toBe(686 - (TOAST_CARD_BUDGET - TOAST_GAP));
    expect(tight.slots).toBe(1);
    // Измеренная карточка ниже запаса: стек опускается ближе к шкале, а не прячется под запас.
    const measured = toastStackBand({ counterBottom: 140, keepVisibleBottom: 400, contentBottom: 640, limit: 686, cardHeight: 81 });
    expect(measured.top).toBe(686 - 81);
    // Совсем тесно (шкала уже за нижней полосой): окно важнее шкалы, но счётчик свободен.
    const cramped = toastStackBand({ counterBottom: 140, keepVisibleBottom: 600, contentBottom: 660, limit: 640 });
    expect(cramped.top).toBe(640 - (TOAST_CARD_BUDGET - TOAST_GAP));
    expect(cramped.top).toBeGreaterThanOrEqual(140 + TOAST_GAP);
  });

  it('lifts the stack by the height of the queue button when more toasts wait than fit', () => {
    const plain = toastStackBand({ counterBottom: 140, keepVisibleBottom: 400, contentBottom: 640, limit: 686, cardHeight: 81 });
    const queued = toastStackBand({ counterBottom: 140, keepVisibleBottom: 400, contentBottom: 640, limit: 686, cardHeight: 81, below: TOAST_QUEUE_H });
    expect(queued.top).toBe(plain.top - TOAST_QUEUE_H);
  });

  it('derives the toast stack width from the column math on every window', () => {
    for (let vw = 320; vw <= 2560; vw += 7) {
      const w = toastStackWidth(vw);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(TOAST_MARGIN * 2 + w).toBeLessThanOrEqual(vw);
      // В трёхколоночном режиме стек живёт над колонкой Клика и не шире неё.
      if (vw >= THREE_COL_MIN) expect(w).toBeLessThanOrEqual(clickColWidth(vw));
    }
  });

  it('never shrinks the toast stack as the window of the same layout grows', () => {
    // Разрыв на самом пороге законен: ниже него колонка Клика — всё окно, выше —
    // треть, — поэтому монотонность проверяется внутри каждого режима, а не через порог.
    for (let vw = 320; vw < THREE_COL_MIN - 7; vw += 7) {
      expect(toastStackWidth(vw + 7)).toBeGreaterThanOrEqual(toastStackWidth(vw));
    }
    for (let vw = THREE_COL_MIN; vw < 2560; vw += 7) {
      expect(toastStackWidth(vw + 7)).toBeGreaterThanOrEqual(toastStackWidth(vw));
    }
  });

  // Счётчик Токенов набран моноширинным шрифтом на ступени 33 px, поэтому его ширина — это
  // число знаков, помноженное на ширину знака. Самая длинная запись обязана влезть в самую
  // узкую колонку Клика, иначе она полезла бы за край и колонка получила бы горизонтальную
  // прокрутку.
  it('reserves enough characters for the longest number either notation prints', () => {
    let longest = 0;
    for (let exp = 0; exp <= 297; exp++) {
      for (const mantissa of [1, 1.5, 9.99, 99.9, 842.6, 999.94]) {
        for (const notation of ['short', 'sci'] as const) {
          longest = Math.max(longest, formatNumber(mantissa * 10 ** exp, notation).length);
        }
      }
    }
    expect(COUNTER_CHARS).toBeGreaterThanOrEqual(longest);
    // Резерв не раздут: лишние знаки отнимали бы место у колонки зря.
    expect(COUNTER_CHARS).toBeLessThanOrEqual(longest + 1);
  });

  it('fits the counter inside the Click column on every window, down to 320 px', () => {
    for (let vw = 320; vw <= 2560; vw += 7) {
      const column = vw < THREE_COL_MIN ? vw : clickColWidth(vw);
      expect(counterWidth()).toBeLessThanOrEqual(column - CLICK_COL_PAD * 2);
    }
  });

  // Сцена главная на десктопе: карточка Маскота живёт внутри неё, и на самых узких Сценах
  // (одна колонка на 320 px и Сцена в колонке на пороге) она обязана остаться на виду целиком.
  describe('mascot card on the Scene', () => {
    const narrowest = [320 - SCENE_COL_PAD * 2, THREE_COL_MIN - clickColWidth(THREE_COL_MIN) - shopColWidth(THREE_COL_MIN) - SCENE_COL_PAD * 2];

    it('keeps the Scene taller than the card with its margins', () => {
      expect(SCENE_MIN_H).toBeGreaterThan(MASCOT_CARD_EDGE * 2);
      expect(SCENE_COL_PAD).toBeGreaterThan(0);
    });

    it('fits the card at full width inside the narrowest Scenes', () => {
      for (const sceneW of narrowest) {
        expect(mascotCardWidth(sceneW)).toBe(MASCOT_CARD_W);
      }
    });

    it('shrinks the card, never the margins, on a Scene narrower than the card', () => {
      expect(mascotCardWidth(MASCOT_CARD_W)).toBe(MASCOT_CARD_W - MASCOT_CARD_EDGE * 2);
      expect(mascotCardWidth(100)).toBe(100 - MASCOT_CARD_EDGE * 2);
      expect(mascotCardWidth(4)).toBe(0);
    });

    it('never lets the card leave the Scene, whichever Mascot is under the pointer', () => {
      for (let sceneW = 120; sceneW <= 1200; sceneW += 13) {
        const width = mascotCardWidth(sceneW);
        for (let center = -40; center <= sceneW + 40; center += 11) {
          const left = mascotCardLeft(center, sceneW);
          expect(left).toBeGreaterThanOrEqual(MASCOT_CARD_EDGE);
          if (sceneW >= width + MASCOT_CARD_EDGE * 2) {
            expect(left + width).toBeLessThanOrEqual(sceneW - MASCOT_CARD_EDGE);
          }
        }
      }
    });

    it('lifts the card over the booth when there is room above it', () => {
      expect(mascotCardBottom(120, 90, 700)).toBe(120);
    });

    it('lays the card over the booth, never past the top of the Scene, when there is no room', () => {
      for (let sceneH = 300; sceneH <= 900; sceneH += 25) {
        for (let bottom = 0; bottom <= sceneH; bottom += 20) {
          for (const cardH of [72, 94, 134]) {
            const placed = mascotCardBottom(bottom, cardH, sceneH);
            expect(placed + cardH).toBeLessThanOrEqual(sceneH - MASCOT_CARD_EDGE);
            expect(placed).toBeGreaterThanOrEqual(MASCOT_CARD_EDGE);
            // Выше места карточка не поднимается больше, чем просили.
            expect(placed).toBeLessThanOrEqual(Math.max(bottom, MASCOT_CARD_EDGE));
          }
        }
      }
    });

    it('centres the card over a Mascot in the middle of the Scene', () => {
      expect(mascotCardLeft(400, 800)).toBe(400 - MASCOT_CARD_W / 2);
    });

    it('presses the card to the edge over the first and last Mascot', () => {
      expect(mascotCardLeft(30, 500)).toBe(MASCOT_CARD_EDGE);
      expect(mascotCardLeft(470, 500)).toBe(500 - MASCOT_CARD_EDGE - MASCOT_CARD_W);
    });
  });
});

describe('+N Серии', () => {
  it('has a step for every level, never shrinks as the Серия grows and tops out at the largest step', () => {
    expect(FLOATER_STEPS).toHaveLength(STREAK_MAX_LEVEL + 1);
    for (let i = 1; i < FLOATER_STEPS.length; i += 1) {
      expect(FLOATER_STEPS[i]).toBeGreaterThanOrEqual(FLOATER_STEPS[i - 1]);
    }
    expect(floaterStep(0)).toBe(22);
    expect(floaterStep(STREAK_MAX_LEVEL)).toBe(44);
    expect(floaterStep(99)).toBe(44);
    expect(floaterStep(-1)).toBe(22);
    expect(floaterStep(Number.NaN)).toBe(22);
  });

  it('keeps the whole record inside the window at every width, for the longest record', () => {
    const chars = COUNTER_CHARS + 1;
    for (const width of [320, 360, 390, 1024, 1440]) {
      for (const step of [22, 33, 44] as const) {
        const recordW = chars * step * (350 / 550);
        for (const x of [0, 10, width / 2, width - 10, width]) {
          const left = floaterLeft(x, chars, step, width);
          if (recordW < width) {
            expect(left - recordW / 2).toBeGreaterThanOrEqual(-1e-9);
            expect(left + recordW / 2).toBeLessThanOrEqual(width + 1e-9);
          } else {
            expect(left).toBe(width / 2);
          }
        }
      }
    }
  });

  it('leaves a point that already fits where it was', () => {
    expect(floaterLeft(700, 6, 22, 1440)).toBe(700);
  });
});
