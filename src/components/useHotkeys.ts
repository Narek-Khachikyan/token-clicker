import { useEffect } from 'react';
import { useGameStore } from '../store/useGameStore';
import { hotkeyCommand } from '../hotkeys';
import { hotkeyAllowed, readKeyTarget } from './holdClickKeys';
import { HELP_TITLE_ID } from './HelpModal';

/**
 * Слушатель горячих клавиш на окне: 1/2/3 и «?». Что значит клавиша — `hotkeyCommand`, что с ней
 * делать — `runHotkey` в сторе; здесь только охранник, общий с Кликом (`holdClickKeys`), чтобы
 * два слушателя не расходились в том, где клавиши молчат. Карточка «?» — единственное окно,
 * которое клавиша может закрыть сама, поэтому оно из охранника исключено.
 */
export function useHotkeys(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const command = hotkeyCommand(e);
      if (!command) return;
      if (!hotkeyAllowed(readKeyTarget(e, null, command.kind === 'help' ? HELP_TITLE_ID : undefined))) return;
      e.preventDefault();
      useGameStore.getState().runHotkey(command);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
