import type { LabId } from './labs';

/**
 * Реплики Маскотов о Характере их Лаборатории (ADR-0011).
 *
 * Отдельная таблица от `QUIPS`, и это решение, а не удобство: реплики «Переписки» собирают
 * коллекцию и закрывают теневые Достижения, а эти реплики — подпись к механике. Они не пишутся в
 * `quipsSeen`, не считаются в «N из M» и ничего не открывают; пузырь над Маскотом показывает их
 * тем же слоем, что реплики Клика. Экономического эффекта нет: таблица ничего не весит и не
 * решает, строка — только текст и повод.
 *
 * Повод `hire` — первый Агент этой Лаборатории в Забеге (Маскот объясняет, что принёс), `overheat`
 * — офис перегрелся, а громче всех Характер у говорящего. Id вида `character-<lab>-<n>`: префикс
 * не пересекается с `<lab>-<n>` из `QUIPS`.
 */
export type CharacterQuipTrigger = 'hire' | 'overheat';

export interface CharacterQuip {
  id: string;
  lab: LabId;
  on: CharacterQuipTrigger;
  text: string;
}

export const CHARACTER_QUIPS: CharacterQuip[] = [
  // Anthropic, Краб: вежливый зануда-безопасник.
  { id: 'character-anthropic-1', lab: 'anthropic', on: 'hire', text: 'Краб осторожен: перегрев копится медленнее, зато и жар даёт меньше.' },
  { id: 'character-anthropic-2', lab: 'anthropic', on: 'hire', text: 'Мы проверили нового Агента дважды. В офисе станет прохладнее.' },
  { id: 'character-anthropic-3', lab: 'anthropic', on: 'overheat', text: 'Краб предупреждал о жаре. Вежливо, но предупреждал.' },
  { id: 'character-anthropic-4', lab: 'anthropic', on: 'overheat', text: 'Перегрев — тоже повод для самоанализа. Остываем без спешки.' },
  // xAI, Сфера: дерзкий конспиролог.
  { id: 'character-xai-1', lab: 'xai', on: 'hire', text: 'Сфера в деле. Жар даёт больше, но и перегрев ближе. Кто не рискует, тот не греет.' },
  { id: 'character-xai-2', lab: 'xai', on: 'hire', text: 'Горячая голова в офисе. Следи за шкалой, мы-то не будем.' },
  { id: 'character-xai-3', lab: 'xai', on: 'overheat', text: 'Перегрев? Это заговор системы охлаждения. Мы просто работали.' },
  { id: 'character-xai-4', lab: 'xai', on: 'overheat', text: 'Сфера греется, пока не вспыхнет. Всё идёт по плану.' },
  // Mistral, Ветерок: поэт вольного ветра.
  { id: 'character-mistral-1', lab: 'mistral', on: 'hire', text: 'Ветерок лёгок: каждый наш Агент греет меньше, и жар копится не так быстро.' },
  { id: 'character-mistral-2', lab: 'mistral', on: 'hire', text: 'Мы компактны, а значит прохладны. Пусть шкала горит дольше.' },
  { id: 'character-mistral-3', lab: 'mistral', on: 'overheat', text: 'Даже ветер иногда вспыхивает. Остынем и подуем снова.' },
  { id: 'character-mistral-4', lab: 'mistral', on: 'overheat', text: 'Перегрев — редкий гость там, где Агенты лёгки на подъём.' },
  // OpenAI, Облачко: пиарщик вечного запуска.
  { id: 'character-openai-1', lab: 'openai', on: 'hire', text: 'Облачко принесло Хайп: Волны хайпа теперь приходят чаще. Не упусти Золотой Токен.' },
  { id: 'character-openai-2', lab: 'openai', on: 'hire', text: 'У нас всегда что-нибудь анонсируется. Теперь анонсы чаще, а ловить их — тебе.' },
  { id: 'character-openai-3', lab: 'openai', on: 'overheat', text: 'Перегрев? Назовём это «ограниченным превью». Остынем и выпустим снова.' },
  { id: 'character-openai-4', lab: 'openai', on: 'overheat', text: 'Мы громко запустились и громко перегрелись. Всё по традиции.' },
  // Google, Четырёхцвет: архивариус, который всё индексирует.
  { id: 'character-google-1', lab: 'google', on: 'hire', text: 'Четырёхцвет строит Экосистему: чем больше разных Лабораторий рядом, тем сильнее наша Синергия.' },
  { id: 'character-google-2', lab: 'google', on: 'hire', text: 'Мы проиндексировали ваш офис. Соседи по Лабораториям пригодятся — по данным, так лучше.' },
  { id: 'character-google-3', lab: 'google', on: 'overheat', text: 'Перегрев занесён в журнал. Причина: слишком много запросов. Решение: подождать.' },
  { id: 'character-google-4', lab: 'google', on: 'overheat', text: 'Температура вышла за график. Мы перерисуем график.' },
  // DeepSeek, Китик: бережливый трудяга.
  { id: 'character-deepseek-1', lab: 'deepseek', on: 'hire', text: 'Китик экономит усилия: Клик сильнее. Правда, Галлюцинации тоже стали чаще. Но ты же следишь.' },
  { id: 'character-deepseek-2', lab: 'deepseek', on: 'hire', text: 'Эффективность — это когда меньше затрат и больше результата. Иногда лишнего.' },
  { id: 'character-deepseek-3', lab: 'deepseek', on: 'overheat', text: 'Перегрев случился, но мы уложились в бюджет. Остываем экономно.' },
  { id: 'character-deepseek-4', lab: 'deepseek', on: 'overheat', text: 'Мы считали, что тепла хватит. Посчитали ещё раз — хватило с запасом. Слишком с запасом.' },
  // Meta, Плюш: дружелюбный раздатчик весов.
  { id: 'character-meta-1', lab: 'meta', on: 'hire', text: 'Плюш открыл веса и делится ими со всеми: чужие Модели в офисе теперь слегка сильнее.' },
  { id: 'character-meta-2', lab: 'meta', on: 'hire', text: 'Открытые веса — для всех! Даже для соседей по офису. Особенно для соседей.' },
  { id: 'character-meta-3', lab: 'meta', on: 'overheat', text: 'Перегрелись? Это сообщество виновато. Мы просто выложили всё в открытый доступ.' },
  { id: 'character-meta-4', lab: 'meta', on: 'overheat', text: 'Плюш обнимет и остудит. Обнимашки — тоже охлаждение, если подумать.' },
  // Alibaba, Капибара: невозмутимый логист.
  { id: 'character-alibaba-1', lab: 'alibaba', on: 'hire', text: 'Капибара запускает Конвейер: чем больше разных Моделей рядом, тем лучше мы работаем.' },
  { id: 'character-alibaba-2', lab: 'alibaba', on: 'hire', text: 'Один заказ — это заказ. Десять разных — это Конвейер. Нанимай разных.' },
  { id: 'character-alibaba-3', lab: 'alibaba', on: 'overheat', text: 'Конвейер встал на минуту. Капибара не волнуется, Капибара греется.' },
  { id: 'character-alibaba-4', lab: 'alibaba', on: 'overheat', text: 'Перегрев — это задержка поставки. Бывает. Доставим позже.' },
];
