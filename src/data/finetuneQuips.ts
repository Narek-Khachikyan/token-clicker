import type { FinetuneArchetype } from '../economy/state';

/**
 * Реплики Модели о её архетипе, когда Заготовка стала Файнтюном (ТЗ #116). Голос — Маскот Лаборатории
 * Модели, как у реплик Клика; сама Модель в имени несёт архетип («Claude Sonnet 4.5 Thinking»).
 *
 * Отдельная таблица, как и `CHARACTER_QUIPS`: в «Переписку» (`quipsSeen`) они не пишутся, Достижений не
 * открывают и экономики не имеют. В тексте нет чисел — Доход и жар называет карточка Модели, и реплика
 * не должна разойтись с ней при правке множителей.
 */
export interface FinetuneQuip {
  id: string;
  archetype: FinetuneArchetype;
  text: string;
}

export const FINETUNE_QUIPS: FinetuneQuip[] = [
  { id: 'finetune-thinking-1', archetype: 'thinking', text: 'Думаю дольше — зато Доход выше. Жар, правда, тоже копится быстрее.' },
  { id: 'finetune-thinking-2', archetype: 'thinking', text: 'Включил размышления. Теперь за мной нужно следить по шкале Температуры.' },
  { id: 'finetune-thinking-3', archetype: 'thinking', text: 'Thinking — это когда думаю вслух и за двоих. Держи Температуру в уме, я займусь Доходом.' },
  { id: 'finetune-turbo-1', archetype: 'turbo', text: 'Turbo: отвечаю быстро и работаю прохладно. Доход чуть ниже, зато офис остынет.' },
  { id: 'finetune-turbo-2', archetype: 'turbo', text: 'Охлаждаюсь на ходу: безопасная Температура офиса поднимается, мой Доход чуть ниже.' },
  { id: 'finetune-turbo-3', archetype: 'turbo', text: 'Turbo — это скорость без лишнего жара. Меньше Токенов с меня, зато меньше перегревов.' },
];
