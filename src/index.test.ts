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

  // Переключатель «меньше анимации» сильнее системной настройки: всё, что двигает или растягивает,
  // обязано гаситься и им. Раньше ручка шкалы Температуры выезжала под пальцем при включённом
  // переключателе, потому что переход жил только под системным гейтом. Тест читает таблицу
  // стилей, а не поведение браузера: поведение проверяется в браузере, а здесь — что у каждого
  // перехода положения или размера в гейте движения есть пара под data-motion.
  describe('player motion switch', () => {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const MOVES = /\b(width|height|left|right|top|bottom|margin[\w-]*|padding[\w-]*|inset|transform|translate|scale|rotate|all)\b/;
    const rules = (text: string): Array<{ selectors: string[]; body: string }> =>
      [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
        selectors: m[1].split(',').map((x) => x.trim().replace(/\s+/g, ' ')),
        body: m[2],
      }));
    // Переход с нулевой длительностью («transform 0s» на нажатой кнопке) ничего не двигает.
    const moves = (value: string): boolean =>
      value.split(/,(?![^(]*\))/).some((part) => MOVES.test(part) && !/\s0m?s\b/.test(part));
    const transitionOf = (body: string): string | undefined => /(?<![\w-])transition\s*:\s*([^;]+)/.exec(body)?.[1];

    // Тело блока `@media (prefers-reduced-motion: no-preference)` по балансу скобок.
    const gated: string[] = [];
    for (const m of code.matchAll(/@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*\{/g)) {
      let depth = 1;
      let i = m.index + m[0].length;
      const start = i;
      for (; i < code.length && depth > 0; i++) depth += code[i] === '{' ? 1 : code[i] === '}' ? -1 : 0;
      gated.push(code.slice(start, i - 1));
    }
    const switchRules = rules(code).filter((r) => r.selectors.every((x) => /\[data-motion=.reduced.\]/.test(x)));

    it('reads at least one motion gate', () => {
      expect(gated.length).toBeGreaterThan(0);
    });

    it('lets the player switch turn off every transition that moves or resizes something', () => {
      const unpaired: string[] = [];
      for (const block of gated) {
        for (const rule of rules(block)) {
          const value = transitionOf(rule.body);
          if (!value || !moves(value)) continue;
          for (const selector of rule.selectors) {
            const pair = switchRules.find(
              (r) =>
                r.selectors.some((x) => x.replace(/^\.app-root/, '').trim() === `[data-motion='reduced'] ${selector}`) &&
                (() => {
                  const kept = transitionOf(r.body);
                  return kept !== undefined && (kept.trim() === 'none' || !moves(kept));
                })(),
            );
            if (!pair) unpaired.push(`${selector}: transition ${value.trim()}`);
          }
        }
      }
      expect(unpaired, 'переход положения или размера без пары под [data-motion=\'reduced\']').toEqual([]);
    });

    it('keeps the Temperature scale, its handle and its heat line still under the switch', () => {
      for (const part of ['fill', 'handle', 'heat']) {
        const selector = `[data-motion='reduced'] .thermal-dial__${part}`;
        const rule = switchRules.find((r) => r.selectors.includes(selector));
        expect(rule, `нет правила ${selector}`).toBeDefined();
        expect(transitionOf(rule?.body ?? '')?.trim()).toBe('none');
      }
    });
  });

  // Закреплённая полоса телефона: её высоту и размеры строк знает layout.ts, а стек тостов встаёт
  // под неё по той же сумме. Литерал в пикселях в правилах полосы — это ещё один ответ на вопрос
  // «сколько она занимает», и он разошёлся бы с модулем при первой правке (ступени `--space-*` и
  // `--frame-w` — шкала отступов, не размер полосы).
  describe('status strip of the phone layout', () => {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const stripRules = [...code.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map((m) => ({ selector: m[1].trim(), body: m[2] }))
      .filter((r) => r.selector.split(',').some((x) => x.trim().startsWith('.status-strip')));

    it('has rules to read', () => {
      expect(stripRules.length).toBeGreaterThanOrEqual(5);
    });

    it('takes every size from the layout variables, not from a literal', () => {
      const literals = stripRules.flatMap((r) =>
        [...r.body.matchAll(/(?<![\w-])(height|width|min-height|min-width|grid-template-rows|grid-template-columns|bottom|top)\s*:\s*([^;]+)/g)]
          .filter((m) => /\b\d+(\.\d+)?px\b/.test(m[2]))
          .map((m) => `${r.selector}: ${m[1]}: ${m[2].trim()}`),
      );
      expect(literals, 'размер полосы литералом в px вместо переменной из layout.ts').toEqual([]);
    });

    it('keeps the strip at the height layout.ts promises', () => {
      const rule = stripRules.find((r) => r.selector === '.status-strip');
      expect(rule?.body).toMatch(/height:\s*var\(--status-strip-h\)/);
      expect(rule?.body).toMatch(/box-sizing:\s*border-box/);
    });
  });

  // Оболочка на телефоне: высота окна, вырез и полоса жестов. Ни то ни другое не видно ни TypeScript,
  // ни тестам логики — телефон без выреза и с адресной строкой, которой нет у десктопа, ведёт себя
  // так же, как и сломанный CSS, пока кто-нибудь не откроет игру на iPhone. Тест читает таблицу
  // стилей и index.html: поведение браузера проверяется в браузере, а здесь — что обязательные
  // объявления на месте и порядок у запасного значения верный.
  describe('shell on a phone: visible height and the notch', () => {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const html = readFileSync(new URL('../index.html', import.meta.url).pathname, 'utf8');
    // Все правила с этим селектором подряд: у `.app-root` их несколько, по одному на заботу.
    const rule = (selector: string): string =>
      [...code.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].trim() === selector).map((m) => m[2]).join('\n');

    it('sizes the app by the visible window (dvh) with vh only as the fallback before it', () => {
      const body = rule('.app-root');
      const heights = [...body.matchAll(/(?<![\w-])height\s*:\s*([^;]+)/g)].map((m) => m[1].trim());
      expect(heights, 'высота корня: сначала запасная vh, потом dvh').toEqual(['100vh', '100dvh']);
      // body — тот же вопрос: min-height в `vh` оставлял бы страницу выше видимой области.
      expect(rule('body')).toMatch(/min-height:\s*100vh;\s*min-height:\s*100dvh/);
    });

    it('lets the page reach under the notch and keeps the bars out of it', () => {
      expect(html).toMatch(/<meta name="viewport"[^>]*viewport-fit=cover/);
      const root = rule('.app-root');
      for (const side of ['top', 'right', 'bottom', 'left']) {
        expect(root, `--safe-${side} не берёт env(safe-area-inset-${side})`).toMatch(
          new RegExp(`--safe-${side}\\s*:\\s*env\\(safe-area-inset-${side}`),
        );
      }
      // Корень держит бока, шапка — верх, подвал — низ: иначе одна из полос осталась бы под вырезом.
      expect(root).toMatch(/padding-left:\s*var\(--safe-left\)/);
      expect(root).toMatch(/padding-right:\s*var\(--safe-right\)/);
      expect(rule('.header-bar')).toMatch(/padding-top:\s*calc\([^;]*var\(--safe-top\)/);
      expect(rule('.footer-bar')).toMatch(/padding-bottom:\s*calc\([^;]*var\(--safe-bottom\)/);
    });

    it('keeps the header one row: no wrapping at any width', () => {
      expect(rule('.header-bar')).toMatch(/flex-wrap:\s*nowrap/);
    });
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
  });
});

/**
 * В игре нет текста мельче 12 px (ADR-0009). Инлайновые размеры проверяет обход computed style в
 * браузере, а эта граница держит таблицу стилей: ступень шкалы и каждый `font-size` с литералом.
 */
describe('minimum text size in index.css', () => {
  const rem = (v: string): number | null => {
    const m = /^([0-9.]+)(rem|px)$/.exec(v.trim());
    return m ? (m[2] === 'rem' ? Number(m[1]) * 16 : Number(m[1])) : null;
  };
  const scale = new Map<string, number>();
  for (const m of css.matchAll(/(--(?:text|pixel)-[a-z0-9]+):\s*([0-9.]+(?:rem|px))/g)) scale.set(m[1], rem(m[2]) ?? 0);

  it('keeps every step of the type scale at 12 px or more', () => {
    expect(scale.size).toBeGreaterThanOrEqual(5);
    for (const [name, px] of scale) expect(px, name).toBeGreaterThanOrEqual(12);
  });

  it('resolves every font-size declaration to 12 px or more', () => {
    let seen = 0;
    for (const m of css.matchAll(/font-size:\s*([^;]+);/g)) {
      const v = m[1].trim();
      const variable = /^var\((--[a-z0-9-]+)\)$/.exec(v);
      const px = variable ? scale.get(variable[1]) : rem(v);
      // Наследуемые значения (`inherit`, `100%`) размера не задают.
      if (px === undefined || px === null) continue;
      seen++;
      expect(px, m[0]).toBeGreaterThanOrEqual(12);
    }
    expect(seen).toBeGreaterThan(5);
  });
});
