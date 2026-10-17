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
];
