import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';

/**
 * Шрифты (ADR-0009). Тест читает `index.css`, `index.html` и сами woff2-файлы, а не копию их
 * свойств: правило «пиксельный шрифт только на ступенях 22/33/44 и без чужих букв» ломается
 * тихо — игрок видит подмену, а в консоли ничего нет, — поэтому проверяется то, что уезжает
 * в браузер.
 */

const fromHere = (path: string): string => new URL(path, import.meta.url).pathname;

const stylesheet = readFileSync(fromHere('./index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const html = readFileSync(fromHere('../index.html'), 'utf8');

const stripFontFaces = (css: string) => css.replace(/@font-face\s*\{[^{}]*\}/g, '');

interface FontFace {
  family: string;
  url: string;
}

const fontFaces: FontFace[] = [...stylesheet.matchAll(/@font-face\s*\{([^{}]*)\}/g)].map(([, body]) => ({
  family: /font-family:\s*['"]([^'"]+)['"]/.exec(body)?.[1] ?? '',
  url: /src:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(body)?.[1] ?? '',
}));

// ── Чтение woff2 ─────────────────────────────────────────────────────────────────────────
// Ровно то, что нужно для вопроса «есть ли в шрифте буква и какой она ширины»: таблицы
// `cmap`, `hhea` и `hmtx`. woff2 кладёт таблицы одним потоком brotli подряд; сжимаются
// преобразованием только `glyf`/`loca` (и по желанию `hmtx`), а `cmap` лежит как есть.

const GLYF = 10;
const LOCA = 11;
const KNOWN_TAGS: Record<number, string> = { 0: 'cmap', 2: 'hhea', 3: 'hmtx' };

const readTables = (path: string): Map<string, DataView> => {
  const file = readFileSync(path);
  const head = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (head.getUint32(0) !== 0x774f4632) throw new Error(`${path}: не woff2`);
  const tableCount = head.getUint16(12);
  const compressedSize = head.getUint32(20);

  let pos = 48;
  const base128 = (): number => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = file[pos++];
      value = value * 128 + (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
    throw new Error(`${path}: битое число UIntBase128`);
  };

  const directory: Array<{ tag: string; length: number }> = [];
  for (let i = 0; i < tableCount; i++) {
    const flags = file[pos++];
    const index = flags & 0x3f;
    const version = flags >> 6;
    let tag = KNOWN_TAGS[index] ?? `#${index}`;
    if (index === 63) {
      tag = String.fromCharCode(...file.subarray(pos, pos + 4));
      pos += 4;
    }
    const origLength = base128();
    const transformed = index === GLYF || index === LOCA ? version === 0 : version !== 0;
    directory.push({ tag, length: transformed ? base128() : origLength });
  }

  const data = brotliDecompressSync(file.subarray(pos, pos + compressedSize));
  const tables = new Map<string, DataView>();
  let offset = 0;
  for (const { tag, length } of directory) {
    tables.set(tag, new DataView(data.buffer, data.byteOffset + offset, length));
    offset += length;
  }
  return tables;
};

/** Кодовая точка → номер глифа, только для реально существующих (нулевой глиф — «нет буквы»). */
const readCmap = (cmap: DataView): Map<number, number> => {
  const glyphs = new Map<number, number>();
  const records = cmap.getUint16(2);
  for (let i = 0; i < records; i++) {
    const platform = cmap.getUint16(4 + i * 8);
    const encoding = cmap.getUint16(6 + i * 8);
    const offset = cmap.getUint32(8 + i * 8);
    if (!(platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10)))) continue;
    const format = cmap.getUint16(offset);
    if (format === 4) {
      const segmentsX2 = cmap.getUint16(offset + 6);
      const ends = offset + 14;
      const starts = ends + segmentsX2 + 2;
      const deltas = starts + segmentsX2;
      const ranges = deltas + segmentsX2;
      for (let s = 0; s < segmentsX2 / 2; s++) {
        const end = cmap.getUint16(ends + s * 2);
        const start = cmap.getUint16(starts + s * 2);
        const delta = cmap.getInt16(deltas + s * 2);
        const rangeOffset = cmap.getUint16(ranges + s * 2);
        for (let code = start; code <= end && code < 0xffff; code++) {
          const raw =
            rangeOffset === 0 ? code : cmap.getUint16(ranges + s * 2 + rangeOffset + (code - start) * 2);
          const glyph = rangeOffset !== 0 && raw === 0 ? 0 : (raw + delta) & 0xffff;
          if (glyph !== 0) glyphs.set(code, glyph);
        }
      }
    } else if (format === 12) {
      const groups = cmap.getUint32(offset + 12);
      for (let g = 0; g < groups; g++) {
        const at = offset + 16 + g * 12;
        const start = cmap.getUint32(at);
        const end = cmap.getUint32(at + 4);
        const first = cmap.getUint32(at + 8);
        for (let code = start; code <= end; code++) glyphs.set(code, first + code - start);
      }
    }
  }
  return glyphs;
};

interface Font {
  has: (ch: string) => boolean;
  advance: (ch: string) => number;
}

const openFont = (family: string): Font => {
  const face = fontFaces.find((f) => f.family === family);
  if (!face) throw new Error(`@font-face для ${family} не объявлен`);
  const tables = readTables(fromHere(face.url));
  const cmap = readCmap(tables.get('cmap') ?? new DataView(new ArrayBuffer(0)));
  const hhea = tables.get('hhea');
  const hmtx = tables.get('hmtx');
  if (!hhea || !hmtx) throw new Error(`${family}: нет hhea/hmtx`);
  const metrics = hhea.getUint16(34);
  return {
    has: (ch) => cmap.has(ch.codePointAt(0) ?? -1),
    advance: (ch) => {
      const glyph = cmap.get(ch.codePointAt(0) ?? -1);
      if (glyph === undefined) throw new Error(`${family}: нет «${ch}»`);
      return hmtx.getUint16(Math.min(glyph, metrics - 1) * 4);
    },
  };
};

const RUSSIAN = 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя';
const LATIN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
// Знаки, которые игра печатает рядом со словами и числами: запятая и точка в числах, пробел
// перед суффиксом, процент, плюс и минус, «×», «№», тире, многоточие и средняя точка.
const SIGNS = ' ,.:;!?%+−-–—…·×№/()[]«»"\'';

const missing = (font: Font, text: string): string[] => [...text].filter((ch) => !font.has(ch));

describe('fonts live in the project (ADR-0009)', () => {
  it('declares both families from woff2 files inside the project', () => {
    expect(fontFaces.map((f) => f.family).sort()).toEqual(['Departure Mono', 'Nunito']);
    for (const face of fontFaces) {
      expect(face.url, `${face.family}: адрес должен быть относительным`).toMatch(/^\.\.?\//);
      const bytes = readFileSync(fromHere(face.url));
      expect(String.fromCharCode(...bytes.subarray(0, 4)), `${face.url} — не woff2`).toBe('wOF2');
    }
  });

  it('asks the network for neither a font nor a stylesheet', () => {
    expect(html).not.toMatch(/https?:\/\//);
    expect(stylesheet).not.toMatch(/https?:\/\//);
  });

  it('keeps the old pixel face out of the stylesheet', () => {
    expect(stylesheet).not.toMatch(/Pixelify/i);
  });

  // Кнопка без своего класса берёт шрифт браузера (Arial) — третье начертание на экране, которого
  // таблица стилей не называет. «ещё N» в хвосте очереди тостов была именно такой кнопкой.
  it('makes every control inherit the body face instead of the browser own', () => {
    const rule = [...stylesheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, selector]) =>
      /^:where\(\s*button\b/.test(selector.trim()),
    );
    expect(rule, 'нет правила :where(button, …) { font-family: inherit }').toBeDefined();
    const [, selector, body] = rule!;
    for (const control of ['button', 'input', 'select', 'textarea']) {
      expect(selector, `${control} не покрыт`).toContain(control);
    }
    expect(body).toMatch(/font-family:\s*inherit/);
  });
});

describe('pixel text sits on three steps only (ADR-0009)', () => {
  const rules = [...stripFontFaces(stylesheet).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selector: selector.trim(),
    body,
  }));
  const tokens = new Map(
    rules
      .filter((r) => r.selector === ':root')
      .flatMap((r) => [...r.body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()] as const)),
  );

  it('defines the steps as 22, 33 and 44 px, the grid of the font', () => {
    expect([tokens.get('pixel-22'), tokens.get('pixel-33'), tokens.get('pixel-44')]).toEqual([
      '22px',
      '33px',
      '44px',
    ]);
  });

  it('puts Departure Mono only on rules that also set a step size', () => {
    const pixelRules = rules.filter(
      (r) => r.selector !== ':root' && /var\(--font-pixel\)|Departure Mono/.test(r.body),
    );
    // Три ступени — три правила; тест, которому нечего проверять, — это удалённый инвариант.
    expect(pixelRules.map((r) => r.selector)).toEqual(
      expect.arrayContaining(['.pixel-22', '.pixel-33', '.pixel-44']),
    );
    for (const { selector, body } of pixelRules) {
      expect(body, `${selector}: пиксельный шрифт без ступени 22/33/44`).toMatch(
        /font-size:\s*var\(--pixel-(22|33|44)\)/,
      );
    }
  });

  it('keeps the pixel stack on the body face, never on a system font', () => {
    // ADR-0003: подмену букв делает фолбэк, и если он системный, на каждой машине он свой.
    expect(tokens.get('font-pixel')).toMatch(/^'Departure Mono',\s*'Nunito',\s*sans-serif$/);
  });
});

describe('Departure Mono covers what the game sets in it', () => {
  let pixel: Font;
  beforeAll(() => {
    pixel = openFont('Departure Mono');
  });

  it('reads the font the way a browser would', () => {
    // «О» и «П» — буквы, которых нет в Pixelify Sans (ADR-0003); эмодзи нет ни в одном шрифте
    // проекта. Без пары «есть / нет» калькулятор, отвечающий «есть» на всё, прошёл бы тест.
    expect(pixel.has('О')).toBe(true);
    expect(pixel.has('П')).toBe(true);
    expect(pixel.has('\u{1F600}')).toBe(false);
  });

  it('has the whole Russian alphabet, Ё, the Latin alphabet and the digits', () => {
    expect(missing(pixel, RUSSIAN)).toEqual([]);
    expect(missing(pixel, LATIN)).toEqual([]);
    expect(missing(pixel, DIGITS)).toEqual([]);
  });

  it('has the signs that stand next to words and numbers', () => {
    expect(missing(pixel, SIGNS)).toEqual([]);
  });

  it('gives every digit, sign and letter one advance width, so a growing number does not shake', () => {
    const widths = new Set([...DIGITS, ...SIGNS, ...LATIN, ...RUSSIAN].map((ch) => pixel.advance(ch)));
    expect([...widths]).toHaveLength(1);
  });
});

describe('Nunito covers the long text', () => {
  let body: Font;
  beforeAll(() => {
    body = openFont('Nunito');
  });

  it('has the whole Russian alphabet, the Latin alphabet, the digits and the signs', () => {
    expect(missing(body, RUSSIAN)).toEqual([]);
    expect(missing(body, LATIN)).toEqual([]);
    expect(missing(body, DIGITS)).toEqual([]);
    expect(missing(body, SIGNS)).toEqual([]);
  });

  it('keeps every digit on one advance width', () => {
    expect(new Set([...DIGITS].map((ch) => body.advance(ch))).size).toBe(1);
  });
});
