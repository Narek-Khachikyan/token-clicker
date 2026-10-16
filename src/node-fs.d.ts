/**
 * Минимальные объявления для чтения файла из теста.
 *
 * В проекте нет `@types/node` — он тянется за собой ради двух функций, а весь остальной код
 * игры работает в браузере. Объявлять ровно то, чем пользуется тест, дешевле зависимости:
 * добавление @types/node расширило бы `globals` во всём проекте, включая `src/economy`,
 * где никакого Node нет и быть не должно.
 *
 * Объявления намеренно узкие. Если тест начнёт читать что-то ещё, TypeScript скажет об
 * этом — и это правильно: файловую систему в игровом коде использовать незачем.
 */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  /** Байты файла: тест шрифтов читает таблицу `cmap` прямо из woff2. */
  export function readFileSync(path: string): Uint8Array;
}

declare module 'node:zlib' {
  /** woff2 хранит таблицы одним потоком brotli. */
  export function brotliDecompressSync(input: Uint8Array): Uint8Array;
}
