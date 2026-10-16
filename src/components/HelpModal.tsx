import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { HOTKEY_HELP } from '../hotkeys';
import { ModalFrame, useModalExit } from './Modals';

/** id заголовка: на него ссылается окно, и по нему слушатель клавиш узнаёт, что окно открыто им. */
export const HELP_TITLE_ID = 'help-title';

/** Одна клавиша кнопкой: рамка, а не заливка, как у остальных пиксельных рамок (ADR-0008). */
const KEYCAP: React.CSSProperties = {
  display: 'inline-block',
  padding: 'var(--space-0) var(--space-2)',
  border: 'var(--frame-w) solid var(--border-strong)',
  backgroundColor: 'var(--bg-card)',
  color: 'var(--text-main)',
  fontSize: 'var(--text-sm)',
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
};

/**
 * Карточка «?»: все горячие клавиши и что они делают. Окно, как остальные: ловушка фокуса, Esc и
 * скрим закрывают его. Открывает клавиша «?» (и закрывает её же): `helpOpen` живёт в сторе, чтобы
 * слушатель клавиш, а не оболочка, решал, когда окну быть.
 */
export const HelpModal: React.FC = () => {
  const isOpen = useGameStore((s) => s.helpOpen);
  const setHelpOpen = useGameStore((s) => s.setHelpOpen);
  const { closing, requestClose } = useModalExit(isOpen, () => setHelpOpen(false));
  return (
    <ModalFrame
      isOpen={isOpen}
      closing={closing}
      requestClose={requestClose}
      titleId={HELP_TITLE_ID}
      title="Горячие клавиши"
    >
      <ul style={{ margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {HOTKEY_HELP.map((row) => (
          <li
            key={row.what}
            style={{
              listStyle: 'none',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'baseline',
              columnGap: 'var(--space-3)',
              rowGap: 'var(--space-1)',
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 'var(--space-1)',
                flexShrink: 0,
              }}
            >
              {row.keys.map((k, i) => (
                <React.Fragment key={k}>
                  {i > 0 && (
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>{row.sep}</span>
                  )}
                  <kbd style={{ ...KEYCAP, fontFamily: 'inherit' }}>{k}</kbd>
                </React.Fragment>
              ))}
            </span>
            <span style={{ flex: '1 1 12rem', minWidth: 0, fontSize: '0.9rem' }}>{row.what}</span>
          </li>
        ))}
      </ul>
      <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
        В поле ввода и при открытом окне клавиши не перехватываются.
      </p>
    </ModalFrame>
  );
};
