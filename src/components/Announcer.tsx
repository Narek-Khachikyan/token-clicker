import React, { useEffect, useRef, useState } from 'react';
import { freshToasts, prestigeReadyAnnouncement, toastAnnouncement, uprisingAnnouncement } from '../a11y';
import { canPrestige, isContentFinale } from '../economy/engine';
import { useGameStore, useStateSlice } from '../store/useGameStore';

/**
 * Живая область для скринридера: единственное место, откуда игра сама что-то произносит.
 *
 * Озвучивается ровно то, что случается редко и важно, — тост о Достижении, «Престиж готов» и
 * начало Восстания моделей (его тоста нет, а Откуп лежит во вкладке, которую никто не открывал). Счётчик
 * Токенов и Доход живой областью не бывают: они меняются двадцать раз в секунду, и скринридер
 * зачитывал бы их без остановки; их читают по запросу, как обычный текст.
 *
 * Область стоит в DOM всегда (пустая) — скринридер подписывается на неё до первой реплики, а
 * реплику, добавленную вместе с самой областью, пропустил бы. Каждая реплика — новый узел с новым
 * ключом: так одинаковый текст дважды подряд тоже читается, чего не вышло бы при замене строки.
 * `polite`, а не `assertive`: Достижение не должно перебивать то, что игрок слушает сейчас.
 */
export const Announcer: React.FC = () => {
  const toasts = useGameStore((s) => s.toasts);
  const ready = useStateSlice(canPrestige);
  const finale = useStateSlice(isContentFinale);
  const uprising = useGameStore((s) => s.state.uprising);
  const [lines, setLines] = useState<{ key: number; text: string }[]>([]);
  const seen = useRef<Set<string> | null>(null);
  const wasReady = useRef<boolean | null>(null);
  const wasUprising = useRef<number | null>(null);
  const nextKey = useRef(0);

  // Тосты, уже стоявшие на экране при монтировании, и «готов» из загруженного сохранения не
  // озвучиваются: это не событие, которое игрок только что совершил.
  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(toasts.map((t) => t.id));
      return;
    }
    const fresh = freshToasts(seen.current, toasts);
    // Помним только стоящее на экране: id тоста не повторяется, а уехавший из стека уже не вернётся.
    seen.current = new Set(toasts.map((t) => t.id));
    if (fresh.length === 0) return;
    setLines((prev) => [...prev, ...fresh.map((t) => ({ key: nextKey.current++, text: toastAnnouncement(t) }))].slice(-3));
  }, [toasts]);

  useEffect(() => {
    const prev = wasReady.current;
    wasReady.current = ready;
    if (prev === null) return;
    const text = prestigeReadyAnnouncement(prev, ready, finale);
    if (text) setLines((l) => [...l, { key: nextKey.current++, text }].slice(-3));
  }, [ready, finale]);

  useEffect(() => {
    const prev = wasUprising.current;
    wasUprising.current = uprising;
    if (prev === null) return;
    const text = uprisingAnnouncement(prev, uprising);
    if (text) setLines((l) => [...l, { key: nextKey.current++, text }].slice(-3));
  }, [uprising]);

  return (
    <div className="visually-hidden" role="status" aria-live="polite" aria-relevant="additions">
      {lines.map((l) => (
        <p key={l.key}>{l.text}</p>
      ))}
    </div>
  );
};
