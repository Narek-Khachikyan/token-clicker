import { GENERATION_RULES, type GenerationRule } from './generationRules';
import type { LabId } from './labs';

/**
 * Курс (ADR-0013): выбор на весь Забег, который игрок делает при Престиже из трёх случайно
 * предложенных. Таблица — только содержимое и числа; предложение и действие Курса считает
 * `src/economy/course.ts`.
 *
 * Пул Курса — собственные Курсы ниже плюс Правило каждого пройденного Поколения (`rule`):
 * контент работает дважды. Курс не трогает базовые цену и Доход Модели в каталоге и множит то,
 * что игрок платит и получает, одинаково для всех Моделей Поколения, поэтому лестница Ранга и
 * полоса окупаемости 3× (ADR-0001) остаются как есть. Держит это тест над всем каталогом.
 *
 * Числа выбраны замером `tools/sim.ts --campaign --course <id>` (жадная политика, 5 Кликов/с);
 * итог — в докблоке `paceCurve.ts` и в `docs/adr/0013`.
 */
export type CourseEffect =
  /** Цена покупки всех Моделей × `mult` (меньше единицы — дешевле). */
  | { kind: 'price'; mult: number }
  /** Доход всех Моделей × `mult`: постоянный множитель, он достаётся и Оффлайн-доходу под его потолком. */
  | { kind: 'income'; mult: number }
  /** Клик × `mult`; возврат «Ночного кодинга» не умножается, как и у Характера. */
  | { kind: 'click'; mult: number }
  /** Скорость перегрева × `heat` и частота Галлюцинаций × `hallu` (меньше единицы — спокойнее). */
  | { kind: 'cool'; heat: number; hallu: number }
  /** Пауза между Событиями × `windowMult`: Золотой Токен приходит чаще, а платит по-прежнему поймавшему. */
  | { kind: 'signal'; windowMult: number }
  /** Оффлайн-доход × `mult` под потолком простоя: платит за время без игрока, живой Доход не меняет (ТЗ #118). */
  | { kind: 'offline'; mult: number }
  /** Правило пройденного Поколения: действует так же, как в своём Поколении. */
  | { kind: 'rule'; rule: GenerationRule['id'] };

export interface Course {
  /** Собственные — короткие слова, Правила — `rule:<id>`. Id лежит в сохранении: переименование его стирает. */
  id: string;
  name: string;
  /** Одна строка для карточки выбора и HUD: что Курс делает. */
  summary: string;
  effect: CourseEffect;
  /** Маскот какой Лаборатории предлагает этот Курс. */
  lab: LabId;
  /** Голос Маскота при предложении: реплика ничего не даёт и в «Переписку» не пишется. */
  quip: string;
  /** Открывается постоянным открытием Исследования (ТЗ #118): пока не открыт, в пул не входит. */
  gated?: true;
}

/** Собственные Курсы: по одному на ось экономики (цена, Доход, Клик, Температура, События). */
export const OWN_COURSES: readonly Course[] = [
  {
    id: 'frugal',
    name: 'Бережливость',
    summary: 'Все Модели дешевле на 20%.',
    effect: { kind: 'price', mult: 0.8 },
    lab: 'alibaba',
    quip: 'Скидка в пятую часть цены — тоже Доход. Считай, что мы уже в плюсе.',
  },
  {
    id: 'scale',
    name: 'Масштабирование',
    summary: 'Доход всех Моделей выше на 10%.',
    effect: { kind: 'income', mult: 1.1 },
    lab: 'openai',
    quip: 'Больше данных, больше карт, больше Дохода. Законы масштабирования ещё никого не подводили.',
  },
  {
    id: 'manual',
    name: 'Ручная работа',
    summary: 'Клик вдвое сильнее.',
    effect: { kind: 'click', mult: 2 },
    lab: 'deepseek',
    quip: 'Не отходи от кнопки: каждый Клик здесь стоит вдвое. Я подожду.',
  },
  {
    id: 'cool',
    name: 'Холодная голова',
    summary: 'Перегрев копится вдвое медленнее, Галлюцинаций вдвое меньше.',
    effect: { kind: 'cool', heat: 0.5, hallu: 0.5 },
    lab: 'anthropic',
    quip: 'Безопасность прежде всего. Как всегда. Охладим серверы и никого не потеряем.',
  },
  {
    id: 'signal',
    name: 'Охота за сигналом',
    summary: 'Паузы между Событиями на пятую часть короче: Золотой Токен летает чаще.',
    effect: { kind: 'signal', windowMult: 0.8 },
    lab: 'xai',
    quip: 'Золотые Токены летают, а ты их не ловишь? Я настроил антенны. Лови, пока горячо.',
  },
];

/** Правило каждого Поколения, взятое Курсом: название, описание и голос те же, что у Правила. */
export const RULE_COURSES: readonly Course[] = GENERATION_RULES.map((r) => ({
  id: `rule:${r.id}`,
  name: r.name,
  summary: r.summary,
  effect: { kind: 'rule', rule: r.id },
  lab: r.quip.lab,
  quip: r.quip.text,
}));

/**
 * Курсы постоянных открытий Исследований (ТЗ #118): в пул попадают только открытые. Эффект — оффлайн-доход,
 * единственная ось, которой у собственных Курсов нет; живой Доход и потолок простоя остаются прежними.
 * Число 1,5 — черновик, его утверждает замер симулятора.
 */
export const RESEARCH_COURSES: readonly Course[] = [
  {
    id: 'night',
    name: 'Ночная смена',
    summary: 'Оффлайн-доход в полтора раза больше, в пределах того же потолка простоя.',
    effect: { kind: 'offline', mult: 1.5 },
    lab: 'alibaba',
    quip: 'Пока ты спишь, конвейер крутится. Ночная смена без премии, зато без перерыва.',
    gated: true,
  },
];

export const COURSES: readonly Course[] = [...OWN_COURSES, ...RULE_COURSES, ...RESEARCH_COURSES];

export const COURSE_BY_ID: Readonly<Record<string, Course>> = Object.fromEntries(COURSES.map((c) => [c.id, c]));

/** Курс по id; `null` для неизвестного id и для `null` (Забег без Курса). */
export function courseById(id: string | null): Course | null {
  return id !== null && Object.prototype.hasOwnProperty.call(COURSE_BY_ID, id) ? COURSE_BY_ID[id] : null;
}
