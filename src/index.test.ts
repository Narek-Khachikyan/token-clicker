import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Именно node:fs, а не `?raw`: vitest отдаёт по `?raw` уже сжатый css, а баланс скобок
// нужен в исходнике — его и ест минификатор.
const css = readFileSync(new URL('./index.css', import.meta.url).pathname, 'utf8');
const lines = css.split('\n');
const braces = (line: string) => (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;

/**
 * index.css не проверяет ни TypeScript, ни dev-сервер: лишняя скобка ломает только
 * production-сборку, где всё после неё выпадает из-под гейта `prefers-reduced-motion`.
 */
describe('index.css', () => {
  it('has balanced braces', () => {
    let depth = 0;
    for (const [i, line] of lines.entries()) {
      depth += braces(line);
      expect(depth, `лишняя закрывающая скобка на строке ${i + 1}: ${line}`).toBeGreaterThanOrEqual(0);
    }
    expect(depth, 'файл закрыт не на нулевой глубине').toBe(0);
  });

  it('declares no keyframes inside a media block', () => {
    let depth = 0;
    let mediaDepth: number | null = null;
    for (const [i, line] of lines.entries()) {
      if (mediaDepth === null && line.trim().startsWith('@media')) mediaDepth = depth;
      expect(
        mediaDepth !== null && line.trim().startsWith('@keyframes'),
        `@keyframes внутри @media на строке ${i + 1}`,
      ).toBe(false);
      depth += braces(line);
      if (mediaDepth !== null && depth <= mediaDepth) mediaDepth = null;
    }
  });

  // Пиксельный интерфейс (ADR-0008): скруглений и размытых теней у кнопок, вкладок, карточек и
  // панелей нет. Тест читает таблицу стилей без комментариев, чтобы пояснение «скруглений нет» в
  // комментарии не считалось нарушением.
  describe('pixel frames (ADR-0008)', () => {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const declarations = (property: string): string[] =>
      [...code.matchAll(new RegExp(`(?<![\\w-])${property}\\s*:\\s*([^;}]+)`, 'g'))].map((m) => m[1].trim());

    it('has no rounded corners', () => {
      const rounded = declarations('border-radius').filter((v) => !/^(0|0px|none)$/.test(v));
      expect(rounded, 'border-radius в таблице стилей: углы ступенчатые, не скруглённые').toEqual([]);
    });

    it('has no blurred box shadows', () => {
      // Слой тени: смещение по x и y, затем размытие. Размытие должно быть нулевым, а слой — жёстким.
      const blurred: string[] = [];
      for (const value of declarations('box-shadow')) {
        let depth = 0;
        let layer = '';
        const layers: string[] = [];
        for (const ch of value) {
          if (ch === '(') depth++;
          if (ch === ')') depth--;
          if (ch === ',' && depth === 0) {
            layers.push(layer);
            layer = '';
          } else layer += ch;
        }
        layers.push(layer);
        for (const l of layers) {
          // calc() сворачивается в один токен, а длины берутся до цвета: смещение x, y, затем размытие.
          const flat = l.replace(/calc\((?:[^()]|\([^()]*\))*\)/g, 'C');
          const lengths = /^\s*(?:inset\s+)?((?:-?[\d.]+(?:px|rem)?|C)(?:\s+(?:-?[\d.]+(?:px|rem)?|C))*)/.exec(flat)?.[1].split(/\s+/) ?? [];
          const blur = lengths[2];
          if (blur !== undefined && !/^0(px)?$/.test(blur)) blurred.push(l.trim());
        }
      }
      expect(blurred, 'размытая тень: тень — смещённый прямоугольник').toEqual([]);
    });

    it('keeps the spacing ladder on whole art pixels', () => {
      const root = /:root\s*\{([\s\S]*?)\n\}/.exec(code)?.[1] ?? '';
      const px = (name: string): number => {
        const m = new RegExp(`--${name}\\s*:\\s*([\\d.]+)(rem|px)`).exec(root);
        if (!m) throw new Error(`--${name} не объявлена в :root`);
        return Number(m[1]) * (m[2] === 'rem' ? 16 : 1);
      };
      const art = px('px');
      expect(art).toBe(2);
      const ladder = [0, 1, 2, 3, 4, 5, 6].map((i) => px(`space-${i}`));
      expect(ladder).toEqual([2, 4, 8, 12, 16, 24, 32]);
      for (const step of ladder) expect(step % art, `ступень ${step}px не кратна пикселю арта`).toBe(0);
      expect([...ladder].sort((a, b) => a - b)).toEqual(ladder);
    });
  });
});
