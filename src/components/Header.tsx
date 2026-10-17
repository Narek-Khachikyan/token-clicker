import React, { useEffect, useRef } from 'react';
import { motionAllowed, useGameStore, useStateSlice } from '../store/useGameStore';
import { CATALOG } from '../economy/catalog';
import { ACHIEVEMENTS, nonShadowCount } from '../economy/achievements';
import { formatNumber } from '../economy/format';
import { computeBonus } from '../economy/engine';
import { Num } from './Num';
import { Icon } from './Icon';
import { Hint } from './Hint';

interface HeaderProps {
  onOpenAchievements: () => void;
  onOpenStats: () => void;
  onOpenSettings: () => void;
}

const HeaderView: React.FC<HeaderProps> = ({
  onOpenAchievements,
  onOpenStats,
  onOpenSettings,
}) => {
  // Шапка читает пять чисел, а не состояние: тик двигает Токены и часы, и подписка на
  // `s.state` перерисовывала бы её двадцать раз в секунду ради тех же самых цифр.
  const generation = useGameStore((s) => s.state.generation);
  // Бонус к Доходу даёт свободный Compute (ADR-0010): начисленное минус потраченное на Перки.
  // Два числа, а не состояние: свободный Compute меняется покупкой, а не тиком.
  const compute = useGameStore((s) => s.state.compute - s.state.computeSpent);
  const isMuted = useGameStore((s) => s.state.settings.muted);
  // Бейдж Compute печатается нотацией игрока, а не значением по умолчанию: иначе в научном
  // режиме вся игра показывала «1.00e4», а шапка — «10,00 K», то есть два разных числа на
  // одном экране для одной и той же величины.
  const notation = useGameStore((s) => s.state.settings.notation);
  // Числитель — nonShadowCount, а не achievements.length: тени лежат в том же списке, и
  // прямой длиной счётчик шапал бы выше знаменателя. Знаменатель остаётся только обычный.
  const unlockedAchCount = useStateSlice(nonShadowCount);
  const toggleMute = useGameStore((s) => s.toggleMute);
  const burst = useGameStore((s) => s.burst);
  const badgeRef = useRef<HTMLButtonElement>(null);

  const gen = CATALOG[generation];
  const totalAchCount = ACHIEVEMENTS.length;

  // Значок — единственное место на экране, где Достижение остаётся видимым после того, как
  // тост уйдёт, поэтому пульсирует он, а не тост: вспышка тоста длится полсекунды.
  useEffect(() => {
    if (burst?.kind !== 'achievement' || !motionAllowed()) return;
    const node = badgeRef.current;
    if (!node) return;
    node.classList.remove('ach-badge--pulse');
    void node.offsetWidth;
    node.classList.add('ach-badge--pulse');
    const done = () => node.classList.remove('ach-badge--pulse');
    node.addEventListener('animationend', done);
    return () => node.removeEventListener('animationend', done);
  }, [burst?.nonce]);

  return (
    // Полоса описана классами целиком (index.css): инлайн-отступ в компоненте победил бы правило
    // узкого режима, и шапка на телефоне осталась бы с широким полем и вырезом экрана под ней.
    <header className="header-bar">
      <div className="header-left">
        {/* Логотип набран Departure Mono на ступени 22 px, как и остальные заголовки (ADR-0009).
            «TOKEN CLICKER» — 13 знаков по 14 px, 182 px: рядом с четырьмя кнопками по 44 px и
            бейджем Поколения на 320 px он не помещается, поэтому на телефоне невидим. Из
            дерева доступности он не уходит (`header-full`): h1 остаётся единственным заголовком
            страницы с именем игры. */}
        <h1 className="pixel-22 header-logo header-full">TOKEN CLICKER</h1>
        {/* Бейджи Поколения и Compute. Ряд на широкой шапке, столбик на узкой: в 320 px рядом они
            не встают. */}
        <div className={`header-badges${compute > 0 ? ' header-badges--stack' : ''}`}>
          {/* Бейдж Поколения: key пересоздаёт узел на смене Поколения, появление — только
              opacity через toast-fade, а пульс — классом tab-badge--pulse (scale при движении,
              мигание при reducedMotion), перезапуск тем же перемонтированием.

              nowrap плюс многоточие: период Поколения — это данные, и его длина ничем не
              ограничена, а шапка от него не должна зависеть. Без nowrap бейдж «Поколение 5:
              Reasoning (конец 2024 — начало 2025)» занимал четыре строки и выдавливал
              остальную шапку вниз; теперь он всегда одна строка, а не поместившийся хвост
              обрезается многоточием — имя Поколения, ради которого бейдж и нужен, остаётся.
              На телефоне виден только «Поколение N»: имя и период остались в дереве доступности. */}
          <span key={generation} className="header-gen">
            <span className="tab-badge--pulse" style={{ display: 'inline-block' }}>
              {/* Номер Поколения — пиксельным шрифтом, а название и период — Nunito мельче 22 px:
                  период — данные и длиной не ограничен, в пиксельный кегль он не вмещается. */}
              <span className="pixel-22 header-gen__num">Поколение {gen.id}</span>
              <span className="header-full" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                {' '}
                {gen.name} · {gen.period}
              </span>
            </span>
          </span>
          {/* Подсказка — Hint, а не title: title не открывается на телефоне и не стилизуется под игру. Класс
              уходит на сам Hint, чтобы бейдж остался одним узлом в столбике узкой шапки. */}
          {compute > 0 && (
            <Hint
              as="span"
              variant="text"
              className="pixel-22 header-compute"
              content="Бонус к Доходу даёт только свободный Compute: потраченный на Перки в него не входит"
            >
              <Num>{formatNumber(compute, notation)}</Num> Compute (+
              <Num>{formatNumber(computeBonus(compute) * 100, notation)}</Num>%)
            </Hint>
          )}
        </div>
      </div>

      <div className="header-right">
        {/* Иконочные кнопки получают имя из aria-label: картинка помечена декоративной, и
            без подписи озвучка прочитала бы пустую кнопку. */}
        <button
          className="pixel-btn header-btn"
          onClick={toggleMute}
          title={isMuted ? 'Включить звук' : 'Выключить звук'}
          aria-label={isMuted ? 'Включить звук' : 'Выключить звук'}
        >
          <Icon name={isMuted ? 'sound-off' : 'sound-on'} />
        </button>

        <button
          ref={badgeRef}
          className="pixel-btn pixel-22 header-btn header-btn--count ach-badge"
          onClick={onOpenAchievements}
          title="Достижения"
          // Без aria-label доступное имя кнопки — это «14 / 21», то есть два числа без
          // единого слова; озвучка читала бы их вслух и не называла, что открывается.
          aria-label={`Достижения: ${unlockedAchCount} из ${totalAchCount}`}
        >
          <Icon name="trophy" />
          <span>
            <Num>{unlockedAchCount}</Num>/<Num>{totalAchCount}</Num>
          </span>
        </button>

        {/* Слово «Инфо» на телефоне уходит в невидимые: кнопка остаётся 44 px значком, а имя ей
            даёт само слово в дереве доступности. */}
        <button className="pixel-btn pixel-22 header-btn" onClick={onOpenStats} title="Инфо">
          <Icon name="info" />
          <span className="header-full">Инфо</span>
        </button>

        <button
          className="pixel-btn header-btn"
          onClick={onOpenSettings}
          title="Настройки"
          aria-label="Настройки"
        >
          <Icon name="settings" />
        </button>
      </div>
    </header>
  );
};

export const Header = React.memo(HeaderView);
