# 08. Глубокий разбор жанра: какие механики создают решения и что из них взять

Вторая, глубокая проходка поверх `03-mechanics.md` (там — по 2 пункта на игру). Здесь 16 разделов (около 20 игр), числа из вики, чужие мнения со ссылками и конкретный перенос в Token Clicker. Дата сбора — 2026-10-07. Всё, что уже есть в игре (Апгрейды ×2 по порогам, Синергии и парные Синергии, Датасет, Перки и Наследие, Золотой Токен и комбо Событий, Глюки, Восстание с Лобби/Лицензией, Compute-кристаллы, Слухи, Оффлайн-доход с капом, Испытания Забега, Температура, Переписка), здесь **не предлагается заново** — только углубляется.

## 0. Метод и пределы

- Механики и числа — из MediaWiki-API Fandom (`*.fandom.com/api.php?action=parse`), `cookieclicker.wiki.gg`, `wiki.kittensgame.com`, `gnorp.wiki.gg`, Википедии. Мнения игроков — из Steam Reviews API (300–600 отзывов на игру, отсортированы по голосам «полезно»; в тексте «отзыв, +N»), из интервью Фрэнка Лантца и из сниппетов r/incremental_games, r/CookieClicker.
- **Reddit закрыт для автоматических запросов (403)**: треды цитируются только по заголовку и первым строкам топ-ответа из поисковой выдачи; полного обсуждения я не читал. Где цитата обрывается, это сказано.
- Не получилось: Pecorella «Math of Idle Games, Part II» (страница не открывается; её содержание пересказано в Part III), слова самого Orteil о замысле минигор, содержательные тексты по Cell to Singularity / Idle Slayer / Revolution Idle / Leaf Blower Revolution (только отзывы Steam — они вынесены в раздел антипримеров).
- Источники по Pecorella: Part I https://www.gamedeveloper.com/design/the-math-of-idle-games-part-i, Part III https://www.gamedeveloper.com/design/the-math-of-idle-games-part-iii.

## 1. Рамки Token Clicker, против которых проверялся каждый перенос

- Пять святых из `AGENTS.md`: сейв переживает любую правку (новое поле `GameState` = bump `SAVE_VERSION` (сейчас 8) + `MIGRATIONS` + тест); Оффлайн-доход платится один раз и с капом; баланс монотонен по Рангу (`economy.test.ts`: окупаемость Ранга в полосе 3× от лучшей); никакого AA-ключа на клиенте; русские термины из `CONTEXT.md`.
- Контекст из кода: Compute = `⌊∛(runTokens / divisor)⌋` (с-начала-Забега, кубический корень — как в Cookie Clicker, но без «lifetime»), +1% к Доходу за Compute; Перк — разовая покупка за Compute, список Перков плоский (23 шт.); Испытаний два, награда у обоих плоская +10% к Доходу; `challengesDone` хранит id без сверки с таблицей, поэтому новые id добавлять безопасно.
- Из `DECISIONS.md` и ADR-0004: ручные «Кластеры» отклонены как «один правильный ответ из вики», «бесконечные тиры после 100» отложены в фазу 2, голый `+X%` за каждый Престиж отклонён (положительная обратная связь через `prestigeGain`). Это ограничения для предложений ниже.

## 2. Разбор по играм

### 2.1 Cookie Clicker (Orteil) — один хаб и девять систем вокруг него

Сводка по системам (числа — `cookieclicker.wiki.gg`: [Pantheon](https://cookieclicker.wiki.gg/wiki/Pantheon), [Grimoire](https://cookieclicker.wiki.gg/wiki/Grimoire), [Garden](https://cookieclicker.wiki.gg/wiki/Garden), [Stock_Market](https://cookieclicker.wiki.gg/wiki/Stock_Market), [Sugar_Lumps](https://cookieclicker.wiki.gg/wiki/Sugar_Lumps), [Krumblor](https://cookieclicker.wiki.gg/wiki/Krumblor), [Seasons](https://cookieclicker.wiki.gg/wiki/Seasons), [Wrinklers](https://cookieclicker.wiki.gg/wiki/Wrinklers), [Ascension](https://cookieclicker.wiki.gg/wiki/Ascension)).

| Система | Как работает | Решение или рутина | Перенос |
|---|---|---|---|
| **Pantheon** | 3 слота (Diamond/Ruby/Jade — сила эффекта падает), у каждого духа плюс и минус. Смена слота тратит «Worship swap»: максимум 3, восстановление 16 ч при 0, 4 ч при 1, 1 ч при 2; мгновенно — за сахарный комок или Престиж. | **Решение, пока не решён вики.** Топ-ответ на «best Pantheon combination»: «Godzamok, Mokalsium and Muridal is the usual recommendation for active play» ([r/CookieClicker](https://www.reddit.com/r/CookieClicker/comments/14001x3/what_is_the_best_pantheon_combination/)); «Godzamok… essential imo» ([ещё тред](https://www.reddit.com/r/CookieClicker/comments/6pje0i/what_are_your_pantheon_setups_whats_your_strat/)). Ценность — дефицит смен: смена = событие. | Слоты с дорогой сменой и контекстными плюсами/минусами — см. «Доктрина Забега» (§5, №1). |
| **Grimoire** | Мана растёт медленнее, чем ниже запас; «Force the Hand of Fate» (10 маны) вызывает Золотую печеньку, шанс отдачи 15% базово и **на 15% вероятнее за каждую уже видимую** печеньку; «Conjure Baked Goods» = 30 мин Дохода (потолок 15% банка), при отдаче −15 мин. Исход заклинания считается от **сида в сейве** — перезагрузка даёт тот же исход. | Решение: каждое заклинание — ставка, и стоимость ошибки растёт вместе с «жадностью» (больше печенек на экране — выше риск). Побочный урок: сид в сейве = save-scumming. | «Способности Лабораторий» с общей паузой и возрастающим риском (§5, №6). RNG Событий не класть в сейв, если не хотите откатов. |
| **Garden** | Сетка 2×2 → 6×6 по уровню фермы 1–9; тик 5 мин (земля), 3 (удобрение), 15 (глина); смена почвы — кулдаун 10 мин; **не растёт при закрытой игре**; жертва сада даёт 10 комков. | **Рутина.** «Garden can be tedious though, so I mostly only grow/mutate until I have Golden Clovers (+3% golden cookie frequency per plant)» ([тред](https://www.reddit.com/r/CookieClicker/comments/10n65pd/endgame_is_pretty_boring_got_any_tips_to_speed/)); отзыв Steam (+10): «the garden was a pain and a half for me without mods, so was the investment mini-game»; отзыв (−2): «micromanaging minigames becomes the name of the game». Выжившая польза — только та, что питает хаб комбо (клевер). | **Не брать.** Урок: мини-система, не питающая основной хаб (Золотой Токен/Событие/Температура), превращается в чек-лист. |
| **Stock Market + Loans** | Склад = максимум купленных зданий + 10×уровень; комиссия 20% × 0,95^брокеров; у кредитов три слота: «+50% Дохода на 2 ч, потом −75% на 4 ч, взнос 20% банка»; «+100% на 40 с, потом −90% на 40 мин»; «+20% на 2 дня, потом −20% на 5 дней, взнос 50%». Вики: кредит — «best time… during a Golden Cookie combo». | **Акции — рутина** («profit… won't help you advance in the game», [тред](https://www.reddit.com/r/CookieClicker/comments/11048j9/is_the_stock_market_profitable/); «semi-passive way to earn about a day's worth of cookies», [тред](https://www.reddit.com/r/CookieClicker/comments/15v4tax/do_any_of_you_actually_use_the_stock_market/)). **Кредиты — решение**: отрицательная сумма без комбо, положительная в комбо. | Только кредиты → «Раунд финансирования» (§5, №3). |
| **Сахарные комки + уровни зданий** | 1 комок на 24 ч (20 ч созревает, 3 ч спелость, 1 ч падает; ранний сбор — 50% провал), растёт и оффлайн; комок = уровень здания = +1% Дохода этого здания, уровень 1 открывает мини-игру. | **Решено вики**: «Spend 1 lump on Wizard Towers… Spend the next 44 lumps to get Farms to level 9» ([гайд по комкам](https://cookieclicker.wiki.gg/wiki/Sugar_Lumps)); Steam (+0): «EXTREME bottleneck to collect the absurd number of daily-ish sugar lumps». Хорошее: окно «жди спелости или рискни» — маленькая ставка на терпение. | У нас уже есть Compute-кристалл по стенным часам; **не дублировать** (уровни Моделей дублировали бы «Наследие поколений»). Брать только идею «рискнуть и собрать раньше» — она есть в «hold vs shatter». |
| **Dragon auras** | Переключение ауры стоит **одно из высших зданий в вашей собственности** (жертва прогрессом, а не валютой). | Решение: цена смены растёт вместе с мощью игрока, без отдельной валюты. | Смена Доктрины посреди Забега стоит 1 Агента Флагмана (§5, №1). |
| **Permanent upgrade slots** | 5 слотов, стоимость 100 / 20 000 / 3 млн / 400 млн / 50 млрд Heavenly chips: игрок **выбирает, какой Апгрейд переживёт Престиж**. | Решение: выбор из множества кандидатов, каждый слот дороже предыдущего. | «Слоты Чекпоинтов» (§5, №8). |
| **Seasons** | Включаются по реальной дате UTC (Halloween 24–31 окт., Christmas 15–31 дек., Easter, Valentine, Business Day); принудительное включение — «biscuit» за 1e9 + c×60×1,5^n×m. | Контент от календаря, не от игрока; цена смены растёт геометрически. | «Календарь релизов» без состояния (§5, №11). |
| **Wrinklers** | Макс. 10 (14 с апгрейдами), каждый −5% Дохода, при лопании возвращают ×1,1 съеденного (shiny 1/10 000 → ×3,3). Бонус квадратичен по числу. | Решение «копить или лопать» — то же, что наши Compute-кристаллы и Глюки. | Уже перекрыто. |

**Вывод по Cookie Clicker.** Отзыв Steam (+10): «…training a dragon, taking out loans, pulling off absolutely wild combos (which are basically the only way to progress)». Всё, что создаёт решения — Pantheon, Grimoire, Dragon, кредиты, клевер в саду, — **питает один хаб (комбо Золотых печенек)**; то, что в хаб не втыкается (акции, большая часть Garden), игроки называют работой. Для нас хаб — цепочка Событий и `combo`; любая новая система должна либо усиливать его, либо иметь собственный дефицит.

### 2.2 Antimatter Dimensions (Hevipelle и команда) — золотой стандарт слоёв

Источники: [Eternity](https://antimatter-dimensions.fandom.com/wiki/Eternity), [Infinity](https://antimatter-dimensions.fandom.com/wiki/Infinity), [Reality](https://antimatter-dimensions.fandom.com/wiki/Reality), [Autobuyers](https://antimatter-dimensions.fandom.com/wiki/Autobuyers), [The_Automator](https://antimatter-dimensions.fandom.com/wiki/The_Automator), [Glyphs](https://antimatter-dimensions.fandom.com/wiki/Glyphs), [Black_Hole](https://antimatter-dimensions.fandom.com/wiki/Black_Hole), [Celestials](https://antimatter-dimensions.fandom.com/wiki/Celestials), [Eternity_Challenges](https://antimatter-dimensions.fandom.com/wiki/Eternity_Challenges); Steam https://store.steampowered.com/app/1399720/ (3405 отзывов, «Very Positive»).

- **Каждый слой берёт корень предыдущего, и порог растёт.** Dimension Boost требует 20 «высших» измерений (+15 за каждый после четвёртого), Galaxy — 80 восьмых измерений и +60 за каждую следующую. Infinity — на 1,8e308 (это 2^1024, предел `double` в JS; первый Big Crunch даёт 1 IP). Eternity: `EP ≈ 0,324·B·IP^(1/440,65)`; 1 EP — при ~1e308 IP, 10 EP — при 1e657 IP, 100 EP — при 1e1097. Reality: RM начинаются от 1e4000 EP; при первой Reality **мягкий потолок** после 1e6000 EP (каждые 4 порядка считаются за 1) и жёсткий — 1e8000. Ритм реальных игроков: на Steam (+4) «year to beat your first run if you're idling, but around two-three weeks if you're actively playing»; рекорд мобильного спидрана ~8 дней (+11).
- **Автоматизация — награда за слой.** Первый Big Crunch открывает автопокупку 1-го измерения; 12 автобайеров — награды Normal Challenges (интервал −40% за покупку с удвоением цены, минимум 100 мс; массовая покупка до 512); Automator (скрипты, блочный и текстовый режим) — за 100 Automator Points, которые нигде больше не тратятся. Отзыв (+1): «very fun to unlock new stuff and then automate and then unlock new stuff and then automate…»; (+7): «golden example of how to design an idle game — progression that introduces new mechanics and new interactions, while iterating on the original loop». Минус: (−4) «Automation starts way too late».
- **Испытания с памятью.** Eternity Challenge проходится до 5 раз, **каждый раз требование, цель и награда растут**; цена входа в Time Theorems описана вики как «заём, возвращаемый по завершении»; после прохождения дерево Time Studies **автоматически респекается**. Обязательное условие: награда остаётся навсегда (не нужно держать испытание открытым).
- **Glyphs: детерминированный навык × случайный экземпляр.** У глифа 4 атрибута (тип, уровень, редкость, эффект); **уровень зависит только от игрока** (формула от EP, репликанти, DT), редкость и эффекты случайны; 3 слота; с perk START выбираешь 1 из 4. После уровня 1000 «нестабильность» делит уровень — мягкий потолок на гонку за уровнем.
- **Black Hole: расписание вместо случайности.** Периодические всплески ускорения игры; апгрейды: интервал −20%, мощность +35%, длительность +30%. Выгодно подгонять активные действия под окно (вывод мой).
- **Новая механика переопределяет старую.** Celestials запирают игрока в Reality со своими правилами; Pelle, последний, «resets majority of the game, as well as disabling majority of game's mechanics». Скрытый «secret study» внутри реальности Nameless Ones даёт 100 TT; отдельная секретная ачивка называется «Go study in real life instead».
- **Перенос.** (1) Испытание Забега → награда «автоматизация» (§5, №2 и №4); (2) каждое Поколение меняет одно правило, а не только числа (§5, №5); (3) «детерминированный навык × случайный экземпляр» — для Чекпоинтов (§5, №8, L-вариант); (4) тиры Испытаний с ростом цели, как EC ×5.

### 2.3 Universal Paperclips (Frank Lantz, 2017)

Источники: [Trust](https://universalpaperclips.fandom.com/wiki/Trust), [Stages](https://universalpaperclips.fandom.com/wiki/Stages), [Projects](https://universalpaperclips.fandom.com/wiki/Projects_(But_good)), [Wikipedia](https://en.wikipedia.org/wiki/Universal_Paperclips), интервью YC https://www.ycombinator.com/blog/frank-lantz-director-of-nyus-game-center-and-creator-of-universal-paperclips/ (отметка 00:13:16).

- **Trust как скудный целочисленный пул.** 2 Trust при 2000 скрепок, дальше +1 на «числах Фибоначчи» (3000, 5000, 8000, 13 000…; ≈+10 Trust при 89 тыс., +20 при 11 млн, +35 при 14,9 млрд скрепок). Тратится на процессоры (скорость операций) или память (максимум операций); часть проектов тоже тратит Trust. Перераспределить всё можно проектом «Xavier Re-initialization» за 100 000 creativity. Вики предупреждает «Do not raise [processors] over 30» — то есть выбор есть, но ловушка тоже. Фибоначчи — готовая ступенчатая «убывающая отдача» без формул-кривых.
- **Стадии отменяют валюты.** Стадия 2 — «power management», где «many things from Stage 1 will now be useless, such as Trust»; стадия 3 — зонды: очки между скоростью, исследованием, самовоспроизводством, ремонтом, фабриками, добытчиками, проводом и боевым модулем; чем выше автономия зондов, тем чаще «value drift» создаёт Дрифтеров — **врага, сделанного твоим же выбором**. Конец: Emperor of Drift предлагает «exile»; «Accept» = Престиж («Universe Next Door», +10% спроса).
- **Quantum Computing** — проект «Use probability amplitudes to generate bonus ops»: нужен Photonic Chip, до 10 штук, каждый следующий на 5000 ops дороже. В самой игре это осциллирующий индикатор, в который попадаешь рукой, то есть активный микро-навык внутри idle-игры (механику руками в вики не сверял).
- **Почему работает.** Лантц: «There's no external reason you would want to make this number go up in any clicker game, except that it's fun to make this number go up… That's what this thought experiment is about»; проект «took over» и растянулся с выходных на девять месяцев, за 11 дней 450 тыс. игроков, «most to completion» (Wikipedia/Wired). Игра **кончается**: «ends if the AI succeeds in converting all the matter in the universe into paperclips».
- **Перенос.** Тема уже наша (ИИ-оптимизатор); перенимаем (1) «правила Поколений» как смену стадий; (2) Финал как выбор, а не заставка (см. №11, №12); (3) Фибоначчи-вехи для выдачи редких очков (если когда-нибудь появится пул «контекстных окон»).

### 2.4 Kittens Game (bloodrizzut)

Источники: [Challenges](https://wiki.kittensgame.com/en/game-tabs/challenges), [Policies](https://wiki.kittensgame.com/en/game-tabs/science/policies), [Metaphysics](https://wiki.kittensgame.com/en/game-tabs/science/metaphysics), [Time](https://wiki.kittensgame.com/en/game-tabs/time), [Trade](https://wiki.kittensgame.com/en/game-tabs/trade); Steam https://store.steampowered.com/app/1097410/ (66 отзывов).

- **Политики — взаимоисключающие развилки.** «Liberty locks Tradition», у каждой подпись «This will affect what policies are available in the future!»; цены 150–1500 культуры. Выбор закрывает конкурирующую ветку, поэтому он весит.
- **Испытания складываются.** С 1.4.8.2 можно включить несколько сразу и награды копятся; вики сама предупреждает, что часть комбинаций «compound in negative ways» (например, Anarchy + Winter has Come). Пока испытание идёт, награды за его прошлые прохождения выключены — нельзя «пройти лёгким».
- **Метафизика за Paragon делает цену, а не множитель дешевле.** Enlightenment: «reduce all price ratios by 1%»; Golden Ratio: −1,618% и +1 к очереди; Divine Proportion: −1,7778% и +2 к очереди (числа — шутки про золотое сечение и 16/9). **Очередь** построек и её вместимость растут от Перков.
- **Оффлайн как батарейка.** «Redshift»: пауза ≥ 3 с компенсируется (1 игровой день за 2 с паузы), но не выше 10 «кошачьих лет» (40 при ≥1000 лет календаря или >0 Paragon, ≈ 8,9 ч). Отдельно «Temporal flux» копится 5 ед./мин вдали и **тратится 5 ед./с на +50% скорости** (Tempus Fugit). Отзыв Steam (+4): «rewarding you for playing as actively as you want or as infrequently as your kittens' temporal batteries allow».
- **Почему работает.** Отзыв (+11): «Your choices actually effect your game play, instead of just making things faster» — это лучшая формулировка критерия «настоящего решения» для всего исследования. Минус — микроменеджмент; отзыв (+12): «running macros while I was afk».
- **Перенос.** Доктрина как политика (§5, №1); «Очередь закупок» с вместимостью от Перков (§5, №4); отрицательный пункт: «Flux» нарушает святое №2 — **красный флаг** (§6).

### 2.5 Trimps

Источники: [Perks](https://trimps.fandom.com/wiki/Perks), [Challenges](https://trimps.fandom.com/wiki/Challenges), [Heirlooms](https://trimps.fandom.com/wiki/Heirlooms), [Perk guide](https://trimps.fandom.com/wiki/Guide:Perk_Analysis_and_Strategy), [Helium](https://trimps.fandom.com/wiki/Helium); Steam https://store.steampowered.com/app/1877960/.

- **Перки назначаются только в момент Портала.** Гелий текущего забега нельзя вложить сразу — «must use the Portal»; перки дорожают с уровнем (у Spire-перков рост аддитивный, у части Radon-перков круче — Championism ×5); **респек разрешён**, и гайд прямо советует: «Early-game, get lots of [Trumps] and respec out of it later — you will keep the bonus on all the Territory Bonuses you've gotten so far».
- **Испытание = урок + именной Перк.** За Discipline → Range, Metal → Artisanistry, Size → Carpentry, Meditate → Meditation, Trimp → Resilience, Trapper → Anticipation, Mapocalypse → Siphonology, Coordinate → Coordinated, Mapology → Resourceful, Devastation → Overkill: перк «открывается навсегда и переживает Порталы». Часть испытаний вместо этого даёт множитель гелия в забеге (Balance +100%, Electricity +200%, Life +400%). Брошенное испытание отменяется из меню — риска «застрять» нет (кроме нескольких, что принудительно перезапускают забег: Scientist, Obliterated, Eradicated).
- **Heirlooms.** Shield и Staff выпадают ровно по одному с каждой Void Map, Core — со Spire; редкость постоянна, у каждой редкости свой набор слотов модификаторов. Слой экипировки живёт отдельно от перков.
- **Автоматизация обесценивает Перки.** Вики про Packrat: «becomes almost useless after AutoStorage is unlocked». Отзыв Steam (+4): «everything else is just winging it, or gets automated in the future».
- **Перенос.** Испытание → именной Перк (§5, №2); респек раз в Престиж (§5, №10); **правило дизайна**: автоматизация не должна делать купленный Перк мёртвым грузом (иначе игрок чувствует, что Compute потрачен зря).

### 2.6 Synergism

Источники: [Challenges](https://synergism.fandom.com/wiki/Challenges), [Singularity](https://synergism.fandom.com/wiki/Singularity); r/incremental_games https://www.reddit.com/r/incremental_games/comments/j0qod5/does_anyone_else_hate_multiple_prestige_layers/ (топ-ответ, 41: «games like antimatter dimensions and synergism do this prope[rly]» — сниппет обрывается).

- **Пять ярусов сброса** (Prestige → Transcension → Reincarnation → Ascension → Singularity), у каждого пятёрка испытаний: C1–5, C6–10, C11–15; следующее открывается, когда пройдено предыдущее.
- **Испытание отключает целый слой механик** («No Multipliers», «No Accelerators», «No Runes», «No Reincarnation», «No Research»), даёт награду **за каждое прохождение и отдельную за первое** (C1: +10 базовых множителей, +1 бесплатный множитель и т. д.).
- **Почему важно.** Ограничение «выключи X» заставляет игрока заново понять X — это дешёвая «рекомпозиция» без нового контента. Минус тот же: сложность и 5 ярусов; в r/incremental_games жалобы на слои есть («I would usually quit… after reaching a new prestige layer», [тред](https://www.reddit.com/r/incremental_games/comments/12za8ny/do_unnecessary_prestiges_or_prestiges_which_feel/)).
- **Перенос.** Тиры и каталог Испытаний: «Без Температуры», «Без Лобби», «Одна Лаборатория»; награда за прохождение ≠ награда за первое (§5, №2).

### 2.7 Exponential Idle (Conic Games)

Источники: [Theories](https://exponential-idle.fandom.com/wiki/Theories), [Graduation](https://exponential-idle.fandom.com/wiki/Graduation) (страницы вики неполные: автор сам пишет «sloppy, incomplete»).

- 9 «теорий» — отдельные мини-инкременталки со своими переменными (рекуррентные соотношения, дифф. исчисление, линейная алгебра, полиномы, логистика, интегралы, численные методы, хаос, тесты сходимости). У каждой своё `tau_n`, общий `tau` = произведение `(1+tau_n)` по всем девяти — **единая метрика прогресса**, при этом каждая теория играется по-своему.
- Третий слой Graduation: первый «студент» σ при f(t)=ee2000, второй при ee2200, третий при ee2400 (шаг линейный в **двойной** экспоненте); σ тратятся на открытие новой теории (первая 20, остальные 5…) и на φ-апгрейды; «Multiply income of original theories by (σ_t/20)^level».
- **Перенос.** Один видимый «рейтинг прогресса» вместо россыпи множителей и «собственный мини-метр у каждой Лаборатории» (§5, №6: Способности Лабораторий). Числа в двойной экспоненте — не переносим (у нас масштаб ×1000 на Поколение, ADR-0001).

### 2.8 Egg, Inc. (Auxbrain)

Источники: [Contracts](https://egg-inc.fandom.com/wiki/Contracts), [Contract Score](https://egg-inc.fandom.com/wiki/Contracts/Contract_Score), [Artifacts](https://egg-inc.fandom.com/wiki/Artifacts), [Spaceships](https://egg-inc.fandom.com/wiki/Spaceships), [Boost Tokens](https://egg-inc.fandom.com/wiki/Boost_Tokens); Pecorella Part III.

- **Престиж от «since reset» с показателем 0,14.** `Δp = (c_R/1e6)^0,14` — чтобы удвоить Soul Eggs, нужно в 128 раз больше. Pecorella: «nudge players into more active play and reduce the influence of time on progression» и, возможно, ответ на лимит оффлайна (в 2017 — 2 часа): равные забеги дают равную валюту.
- **Контракты.** Цель «доставить N яиц за срок», **три уровня наград** (Prophecy/Golden Eggs, Boosts, Epic Research, Soul Eggs, Artifact Case), оценка Contract Score зависит от скорости, доли вклада и размера кооператива; одновременно активны не более трёх контрактов.
- **Миссии (корабли).** Топливо — процент от текущей скорости несения; 3 миссии одновременно; открываются при 100 000 RFE/мин и 10 000 Soul Eggs; возвращают артефакты, камни, ингредиенты по «качеству»; у артефакта до 3 гнёзд, надеть можно 2 (4 с Pro Permit). Страница «Recommended Artifact Sets» — уже готовое решение для всех.
- **Boost Tokens** — токены, капающие по таймеру, требуют заранее собрать «комбо» бустов (например, 2 Epic Tachyon Prism = 4 токена: ×100 внутреннего инкубатора на 2 ч).
- **Перенос.** «Контракт дня»: цель с тремя уровнями наград, зерно из даты — без бэкенда, без таблицы лидеров (§5, №11 как расширение календаря). Миссии с таймерами не берём: у нас уже есть Compute-кристаллы.

### 2.9 Realm Grinder (Divine Games)

Источники: [Factions](https://realm-grinder.fandom.com/wiki/Factions), [Faction Coins](https://realm-grinder.fandom.com/wiki/Faction_Coins), Pecorella Part III; Steam https://store.steampowered.com/app/610080/.

- **Фракции: Good — активная игра (заклинания, «treasure clicks»), Evil — idle (стабильное производство), Neutral — смесь (нужен 1 млрд самоцветов и условия), плюс Prestige- и Mercenary-фракции.** Аффилиация 20 фракционных монет; монеты находятся случайно кликами по ландшафту или собираются ассистентами.
- **Формула престижа.** `p = (√(1+8·c_M/1e12) − 1)/2` от максимального заработка: чтобы удвоить валюту, нужно в 4 раза больше, и она не зависит от «lifetime» — повторный сброс в той же точке ничего не даст.
- **Мнения.** Steam (+195): «Right in the beginning, you get thrown a lot of choices, like the factions, which can change radically the flow of the game»; (+9): «good factions shine when you're actively playing, while the evil factions reward you with massive offline gains»; (−99): «the factions are not very well balanced».
- **Перенос.** Выбор Доктрины с явной осью «актив ↔ оффлайн» (§5, №1) — самый короткий путь дать игроку выбрать стиль, не вводя новых систем.

### 2.10 NGU Idle (4G)

Источники: [Challenges](https://ngu-idle.fandom.com/wiki/Challenges), [Evil difficulty](https://ngu-idle.fandom.com/wiki/Evil_difficulty), [Energy](https://ngu-idle.fandom.com/wiki/Energy); Steam https://store.steampowered.com/app/1147690/ (10 907 отзывов).

- **Испытания** запускают ребёрс, у каждого несколько прохождений («first and final rewards are generally the biggest»), сдаться можно без штрафа. Build 1.003 **сократил число прохождений, нужных для закрытия, с 25 до 5 и поднял награды** (по вики) — разработчик подкрутил испытания против гринда.
- **Evil / Sadistic — та же игра, но тяжелее**: «various features level slower and it is more difficult to climb bosses. In return, new features are unlocked». Открывается на боссе 301. Слой сложности, а не нового контента.
- **Аллокация Энергии.** Кап растёт на 1 за каждые 20 набранных за ребёрс; вложенное распределяется по функциям, клавиша R возвращает всё. Отзыв (+6): «if you love tediously making sure that the next ten hours of idle time is min-maxed to the fullest…». Оффлайн-прогресс «keeps making your stats better for up to a year».
- **Перенос.** Режим «Дистилляция» после Финала (§5, №12) — по образцу Evil; **предупреждение**: аллокация без ограничения часов превращается в планирование простоя.

### 2.11 The Tower: Idle Tower Defense (Tech Tree Games)

Источники: [Perks](https://the-tower-idle-tower-defense.fandom.com/wiki/Perks), [Ultimate Weapons](https://the-tower-idle-tower-defense.fandom.com/wiki/Ultimate_Weapons), [Cards](https://the-tower-idle-tower-defense.fandom.com/wiki/Cards), [Tiers](https://the-tower-idle-tower-defense.fandom.com/wiki/Tiers), [Lab Upgrades](https://the-tower-idle-tower-defense.fandom.com/wiki/Lab_Upgrades).

- **Выбор перка внутри забега.** С волны 200 предлагается 1 из 2 случайных перков (до 4 через лабу); распределение: 65% обычные, 20% оружия, **15% trade-off** вроде «×12 Cash Per Wave, но враги не дают деньги», «×1,8 монет, но макс. HP башни −70%», «Boss Health −70%, но скорость +50%»; волн до следующего перка: 200 → 250 после 20 перков → 300 после 30 → 350 после 40. Отдельные лабы: «Ban Perks», «Auto Pick Ranking» — **автоматизация самого выбора продаётся как улучшение**.
- **Ultimate Weapons.** Каждая покупка показывает 3 случайных варианта, и **варианты не меняются, пока один не куплен** (нельзя рероллить, закрывая окно); цены 5/50/150/300/800/1250/1750/2400/3000 камней.
- **Карты.** До 22 слотов; «locked» карты нельзя менять до конца забега, при живом боссе все карты блокируются.
- **Тиры 1–24.** Бонус монет 1,0 → 103; следующий тир открывается за 100 волн (300 для 16–24).
- **Перенос.** Драфт «Находок» внутри Забега с trade-off-вариантами и без реролла (§5, №7); автовыбор как награда.

### 2.12 Evolve

Источники: [Plasmids](https://evolve-idle.fandom.com/wiki/Plasmids), [Bioseed](https://evolve-idle.fandom.com/wiki/Bioseed), [Blackhole Reset](https://evolve-idle.fandom.com/wiki/Blackhole_Reset).

- **Семь «концов света» вместо одного сброса**: MAD → Bioseed («Greatness event», новая планета) → Black Hole («Extinction event») → Ascension → Cataclysm → Demonic Infusion → Apotheosis; Plasmids дают все, кроме последних двух. Среднее: MAD 80–120, Bioseed 240–280, Black Hole 500–650 плазмид.
- Формула: `((C+S)/PD + ln(1+(KM−1)·KS/KI)/ln(KM)) · CM · UM` — население/армия плюс логарифм потраченных знаний, умноженное на **множитель испытания (CM) и множитель вселенной (UM)**. То есть риск, добровольно взятый на забег, прямо умножает награду престижа.
- Bioseed: каждый запущенный зонд даёт +1 вариант планеты на выбор — **чем больше вложился, тем больше выбор**, а не тем больше число.
- **Перенос.** Награда за Испытание как множитель Compute текущего Престижа (CM) — а не только постоянный +10% (§5, №2); тип Престижа как выбор — **ADR-0005 трогать только осознанно**.

### 2.13 Idle Champions of the Forgotten Realms (Codename Entertainment)

Источники: [Formation strategy](https://idlechampions.fandom.com/wiki/Formation_strategy); Steam https://store.steampowered.com/app/627690/.

- Формации: позиция героев в сетке даёт соседям баффы; вики: «Mastering the position of each Champion… is the key to completing each adventure», но страница помечена как «severely outdated… most of these formations aren't possible anymore» (мета устаревает с патчами).
- Отзывы расходятся: (−44) «The variants let you do a bit of thinking… instead of just using the same team the entire time»; (−32) «has changed from a fun idle game… to a babysitting game where you have to check the team every 2 minutes»; (−22) «Find the one specific formation that trivializes the objective»; (−30) «became a chore… mixing and matching my party».
- **Перенос — отрицательный.** Пазл-позиционирование превращается или в «одну решающую формацию», или в нянчение; для нас это аргумент против сетки/кластеров (уже отклонено в ADR-0004).

### 2.14 (the) Gnorp Apologue

Источники: [Mechanics](https://gnorp.wiki.gg/wiki/Mechanics), [Prestige](https://gnorp.wiki.gg/wiki/Prestige), обзор https://marcleoseguin.com/2024/04/22/the-gnorp-apologue-to-the-core/, Steam https://store.steampowered.com/app/1473350/ (7707 отзывов, «Overwhelmingly Positive»).

- **Престиж по «памяти о лучшем темпе».** Шкала прогресса — физическая полоса сверху: белая — текущая скорость добычи, **серая — скорость, которую игра «запомнила» перед сбросом**; их сумма идёт в счёт следующего очка таланта. Порог растёт экспоненциально (по вики ≈ ×2,29 за очко).
- **Билды на запуск.** Отзыв (+32): «Basically the game is a series of builds that you need to get close enough to in order to succeed»; (+18): «Less an idle game about gradual linear progression… It's a game about making the correct decisions, more than watching numbers go up»; (−10): много внимания к мета-билдам в начале забега, «where you commit to a strategy».
- **Источник богатства сменяется** — «an early obvious choice becomes rather useless later»; по оценке автора обзора, игра проходится за ~8 часов и «incrementals that have an end… are worth my $$$».
- **Перенос.** Объём и форма почти как у нас (~8–10 часов, финал, Престиж). Берём: серую «тень прошлого Забега» на шкале Compute (S, UI), билд-на-Забег (Доктрина), честный конец.

### 2.15 Increlution и Nodebuster (короткие игры с концом)

Источники: Steam https://store.steampowered.com/app/1593350/ (Increlution), https://store.steampowered.com/app/3107330/ (Nodebuster).

- **Increlution** — управление временем: «Using the step-by-step queue system, you can plan exactly what you want to happen and the game will automatically follow your orders. When your queue is empty, the game pauses automatically, so you don't lose any of your precious time». Каждое поколение сильнее благодаря «инстинктам» прошлых жизней. Отзыв (+10): «Other incremental games don't have the sense of story»; (−4): «very few decisions… Start a run, wait a bit (15m+)»; (−29): сюжет не закончен.
- **Nodebuster**: «short, experimental»; отзыв (+5): «Finished it in 6.5 hours total… No tiresome clicking, only moving the mouse»; (+12): «I wish it had some form of prestige mechanic so that I could play it repeatedly» — оба отзыва ровно про нашу задачу «10 часов и повод вернуться».
- **Перенос.** Очередь закупок как **план** игрока (а не правило авто-покупки) — сохраняет решение, убирает клики (§5, №4).

### 2.16 Нарративные раскрытия: Spaceplan, Candy Box, Frog Fractions, Paperclips

Источники: [Spaceplan](https://en.wikipedia.org/wiki/Spaceplan), [Candy Box!](https://en.wikipedia.org/wiki/Candy_Box!), [Frog Fractions](https://en.wikipedia.org/wiki/Frog_Fractions); Steam Spaceplan https://store.steampowered.com/app/616110/.

- **Candy Box!** стартует с кнопки сохранения и счётчика конфет, «options appear as the player performs actions» (Wikipedia); IGN ставит его в один ряд с A Dark Room и Cookie Clicker, а Orteil называл его вдохновением (в Википедии без источника).
- **Spaceplan**: «a short, charming, incremental game with a story that actually gives you a reason to care» (Steam, +6); (+6) «The ending is absolutely worth it if it gets boring at some point».
- **Frog Fractions** — классический «разворот»: «edutainment» оказывается драконом, Баг-Марсом, текстовой адвенчурой, ДДР-выборами, фальшивыми титрами и симулятором бизнеса; весь путь ~1 час. Вывод (мой, не из источника): такой разворот работает один раз и только если его не анонсировать.
- **Paperclips**: «An activity log records the player's accomplishments while giving glimpses into the AI's occasionally unsettling thoughts» (Wikipedia) — повествование идёт журналом, а не роликами; тот же приём, что у нашей Новостной ленты.
- **Перенос.** Тот же приём, что у Переписки и Новостной ленты: сюжетные «биты» привязаны к Престижу (§5, №11), без новых полей состояния.

## 3. Антипримеры (по отзывам Steam; механику из первых рук не проверял)

| Игра | Что называют проблемой | Источник | Наш вывод |
|---|---|---|---|
| Idle Slayer | «you hit such an insane progression wall so early… within 2 hours… takes multiple hours of active play» (−34); «preferred "ultimate" route… designed to be like that» (−40) | https://store.steampowered.com/app/1353300/ | Первый Престиж по симуляции на 83-й минуте (DECISIONS) — внутри двух часов, но запас небольшой; стоит измерить плато Дохода руками, а не только симулятором. |
| Revolution Idle | «dilation tree and early Unity: forced active play with zero idle progress and RNG-gated progress» (−39) | https://store.steampowered.com/app/2763740/ | Активная фаза не должна **останавливать** idle-доход; случайность не должна быть воротами. |
| Cell to Singularity | «Unskippable animations, overly grindy… too much reliance on premium currency» (−52) | https://store.steampowered.com/app/977400/ | Нет платных ускорителей — мы в выигрыше; не добавлять анимаций, которые нельзя пропустить. |
| Leaf Blower Revolution | «with each update, it became more tedious, adding tons of different currencies» (−18), при этом «so many active hours if you want» (+7) | https://store.steampowered.com/app/1468260/ | Четыре сброса (Prestige / Big / Mega / Ultra Leaf Crunch) работают, пока каждая новая валюта заменяет, а не дополняет. |
| Idle Champions | «babysitting game» (−32) | см. 2.13 | Не вводить ежеминутную перенастройку. |
| Cookie Clicker (поздний) | «progress rapidly drops off and micromanaging minigames becomes the name of the game» (−2) | https://store.steampowered.com/app/1454400/ | Новые системы — добровольная глубина, а не требование прогресса. |

## 4. Сквозные принципы

1. **Слой берёт корень предыдущего, и время до сброса растёт.** CC — кубический корень (удвоить Prestige = ×8 лайфтайма), Realm Grinder — квадратный (×4), Egg — показатель 0,14 (×128), AD — `EP ∝ IP^(1/440)` ([Eternity](https://antimatter-dimensions.fandom.com/wiki/Eternity)); Pecorella (Part III): *lifetime-формулы* позволяют ресетиться снова и снова с убывающей отдачей, *since-reset* — «each run is an independent event… ideal strategies that don't involve much progress in the game beyond a certain point», поэтому им нужны очень плоские кривые. У нас `∛(runTokens)` — именно since-reset, но Престиж ведёт **вперёд**, а не по кругу, так что «замкнутый» режим не нужен; при добавлении второго слоя (мой вывод из AD) он должен быть заметно дольше полного пробега по 8 Поколениям (~635 мин по DECISIONS).
2. **Автоматизация — награда, привязанная к слою.** AD: Challenge → автобайер; The Tower: «Auto Pick Ranking» — отдельная лаба; Kittens: очередь растёт от Метафизики; Increlution: очередь сама стопорится, когда пуста. Условие: награда приходит **не слишком поздно** (AD −4) и **не обнуляет купленный Перк** (Trimps Packrat).
3. **Актив умножает idle, а не заменяет.** Realm Grinder делит фракции на активные и idle; Egg Inc сознательно ослабил зависимость от оффлайна; AD «год idle vs 2–3 недели актив»; Revolution Idle наказан отзывом за «forced active play with zero idle progress». У нас Оффлайн-доход с капом + Температура + Золотой Токен — уже правильное деление; новые механики должны тоже иметь **оба режима**.
4. **Билд — это момент выбора и цена смены.** Pantheon: смены в часах; Dragon: цена — прогресс; The Tower: карты блокируются на время босса; Gnorp: «commit to a strategy» на старте; Kittens: политики запирают другие. Для нас: выбор на Престиже (бесплатно), смена посреди Забега — дорого.
5. **Дефицит внимания по стенным часам — максимум 1–2 валюты.** CC: комок 24 ч, обмен Pantheon 16/4/1 ч, сад не растёт при закрытой игре; Egg: миссии часами; The Tower: лабы по 3 дня. Жалобы на «bottleneck» (комки) возникают, когда таких валют больше двух. У нас Compute-кристалл — уже одна; **новые стенные часы не добавлять**.
6. **Испытания: награда = способность, а не +X%.** AD: Challenge → автобайер; Trimps: испытание → именной Перк; NGU/Synergism: повтор с ростом цели; Evolve: испытание → множитель награды. Плоские +10% (у нас) хуже всего запоминаются.
7. **Не «решаемо вики».** Решаемые: Pantheon (Godzamok/Muridal/Mokalsium), порядок трат комков, Egg Inc «Recommended Artifact Sets», «одна формация» в Idle Champions. Противоядия: (а) случайное предложение без реролла (The Tower UW); (б) trade-off, зависящий от состояния (Tower: ×12 денег, но без наград за убийства); (в) подключение к хабу, который сам случаен (комбо); (г) взаимоисключение с запиранием будущих вариантов (Kittens); (д) «детерминированный навык × случайный экземпляр» (AD Glyphs); (е) дешёвый респек, чтобы пробовать (Trimps).
8. **Плотность решений и «новейший генератор доминирует».** Pecorella (Part I): «the newest generator is nearly always dominant once it can be purchased. That's not very interesting… older generators are largely irrelevant and removes any interesting decisions»; противоядие — **разные таблицы множителей по порогам** для разных генераторов, чтобы приоритеты сменялись («Now that's much more interesting!»). У нас окупаемость Рангов выровнена (`COST_STEP = INCOME_STEP`, DECISIONS), поэтому главный рычаг выбора «какого Ранга покупать» — расположение вех, а `MODEL_TIERS` в `upgrades.ts` одинаков для всех Моделей: пороги 1/5/25/50/100 Агентов и ×2 на каждом. Если вехи совпадают у всех, рычаг пуст — игрок покупает «где дешевле дойти до ближайшего порога».
9. **Секреты и сюрпризы.** AD: скрытая study внутри реальности Nameless Ones (100 TT); Candy Box: интерфейс раскрывается по действиям; Frog Fractions: раскрытие ровно один раз. У нас уже есть теневые Достижения; недостаёт **скрытых, но полезных** вещей (секретный Перк, который игроки находят сами).
10. **Нарративный разворот как контент.** Paperclips: журнал, Дрифтеры, выбор в конце; AD: Celestials с диалогами; Spaceplan: сюжет вместо экономики; Increlution: сюжет — главная похвала и главная жалоба (незавершённость). Для нас лента, Слухи, Переписка — готовый канал; ресурс — **тексты Престижа**.
11. **Финал и бесконечность.** AD, Paperclips, Gnorp (~8 ч), Nodebuster (6,5 ч) **заканчиваются** и именно это хвалят; Evolve/NGU бесконечны и требуют много слоёв. Наш «Финал контента» — правильный выбор для 10-часовой дуги; повод вернуться — слой сложности (NGU Evil/Sadistic) и множители награды (Evolve CM/UM), а не новые валюты.
12. **Стены ожидания.** Pecorella (Part III): прогон должен быть «bumpy» — быстрые и медленные участки, 16× множитель на 500 генераторах превращает долгую стену в рывок; AD признан «many timewalls» (+11) при высшей оценке; Idle Slayer наказан за стену в 2 часа. Лекарство: параллельные цели (≥3 горизонта), крупная веха-«рывок» раз в 10–15 минут, видимый ETA до следующей цели.
13. **Мягкие потолки.** AD: RM после 1e6000 EP считается в 1/4, потолок 1e8000; Egg: показатель 0,14; CC: Wrinklers квадратичны; у нас `GEN_PERK_MAX_TOTAL = 1` и кап оффлайна. Правило: потолок ставить на рычаг, который игрок крутит сильнее всего, и **показывать его в UI** (серая полоса Gnorp).

## 5. Ранжированный шорт-лист для Token Clicker

Ранжирование — по формуле «глубина решения × подключение к существующему хабу (Событие, Температура, Испытание) ÷ (цена × риск)». Размеры: **S** — до 1 дня (контент/данные), **M** — 2–4 дня (стор + UI + тесты + миграция), **L** — неделя и больше.

| № | Механика (источник идеи) | Размер | Риски: миграция / монотонность по Рангу / оффлайн |
|---|---|---|---|
| 1 | **Доктрина Забега** (CC Pantheon + Kittens Policies + Realm Grinder + Gnorp builds) | M | Новое поле `doctrine`, SAVE_VERSION 8→9 + тест; множители только по Лаборатории/Клику/оффлайн-ставке, не по Рангу — проверить полосу 3× в `economy.test.ts`; оффлайн-Доктрина меняет **ставку** (не выше 1,0), но не часы (кап прежний). |
| 2 | **Испытания 2.0** (AD, Trimps, Synergism, Evolve) | S–M | Новые id — безопасно (`challengesDone` не сверяется с таблицей); стак Испытаний требует `activeChallenges: string[]` → bump. Монотонность: плоские ограничения не трогают Ранги. Оффлайн: Испытание не влияет. |
| 3 | **Раунд финансирования** (CC Loans) | S–M | `loanUntil`, `debtRemaining` → bump; оффлайн: ни займ, ни долг в `offlineIncome` не входят; долг считать **в секундах живых тиков**, иначе закрытие вкладки = прощение долга. |
| 4 | **Очередь закупок** (AD autobuyers + Kittens queue + Increlution + The Tower Auto-Pick) | M | `queue: string[]`, вместимость от Перков → bump; цены те же, значит монотонность цела; очередь **не исполняется оффлайн** (иначе обходит кап). |
| 5 | **Правила Поколений** (AD recontextualization + Paperclips stages) | L (пилот — M на 2 Поколения) | Статика от `generation` — миграции нет; любое правило, трогающее Доход, обязано пройти полосу 3×; автоматизация — только с «Агентной» эры. |
| 6 | **Способности Лабораторий** (Grimoire-lite + Exponential Idle theories) | L | `abilityReadyAt: Record<LabId, number>` → bump; эффекты не входят в оффлайн (как Событие и Температура); общий кулдаун, чтобы не вырастить «Force the Hand» из Cookie Clicker. |
| 7 | **Драфт «Находок» внутри Забега** (The Tower perks) | M | `finds: string[]`, `findOffer` → bump; живёт только в Забеге и сбрасывается Престижем; trade-off без реролла; монотонность — множители равные по Рангу. |
| 8 | **Слоты Чекпоинтов** (CC permanent upgrade slots; L-вариант — AD Glyphs / Trimps Heirlooms) | M (L со случайными экземплярами) | `checkpoints: string[]` → bump; в слот — только Апгрейды Клика и Синергии Лабораторий (они не привязаны к Рангу); цена слота растёт, как в CC (там ×125–200 от слота к слоту). |
| 9 | **Разные кривые вех** (Pecorella Part I) | S | Не меняет формат сейва (новые id Апгрейдов отбрасываются `migrate`); риск — сдвиг окупаемости, ловится `economy.test.ts`. |
| 10 | **Респек Перков раз в Престиж** (Trimps) | S | Без нового поля (возврат `computeSpent` в `compute`); следить, чтобы оффлайн-Перки не оставались «задним числом» (применять с момента респека). |
| 11 | **Календарь релизов + тексты Престижа + «Контракт дня»** (CC Seasons, Paperclips, Egg Inc) | S | Календарь и тексты Престижа — от даты и `prestiges`, без миграции, Доход и оффлайн не трогаются. «Контракт дня» с наградой в Compute — отдельно: `contractDay` → bump, не чаще 1 раза в сутки; часы системы можно крутить, поэтому награду делать малой. |
| 12 | **Режим «Дистилляция» после Финала** (NGU Evil, Evolve CM/UM) | L | Новые поля (`distillTier` и пр.) → bump; множитель Compute за слой — отдельная проверка монотонности; ADR-0004 «бесконечные тиры» — фаза 2, согласовать. |

Дополнительно (малые, без номеров): **«Тень прошлого Забега»** на шкале Compute (Gnorp; нужно поле `lastRunSeconds`, S).

### Эскизы (числа — стартовые, под правку балансом)

1. **Доктрина.** Перед Забегом показываются 3 из 6 Доктрин (выбор детерминирован от `prestiges`, чтобы не рероллить перезагрузкой). Примеры: «Открытые веса» (+25% Meta/Mistral/DeepSeek/Alibaba, −15% остальным), «Закрытый API» (наоборот), «Скорость» (+40% Клик, −10% Агентам, **актив**), «Датацентр» (+10% Доход и ставка оффлайна +10 п. п., Клик −30%, **idle**), «Холодная ВМ» (нагрев −30%, Доход −8%), «Разгон» (Температура ограничена от 0,6, Доход +15%). Смена на Забеге стоит 1 Агента наивысшего Ранга (Dragon aura). **Нет «выбора на один раз»**: после первого Престижа выбор повторяется каждый Забег (8×).
2. **Испытания 2.0.** Тиры I–III (как EC ×5): тир II — тот же Забег, но цель «Флагман за 45 минут», тир III — «плюс запрет Лобби». Награда: I — +10% Доход (как сейчас), II — именной Перк («Автономия» — автоклик 1→2/с; «Независимость» — Синергии на 5% дешевле), III — **множитель Compute за этот Престиж (×1,25, как CM в Evolve)**. Новые ограничения: «Одна Лаборатория», «Без Температуры» (залочена на `TEMP_START`), «Без Лобби/Откупа», «Без Апгрейдов Моделей».
3. **Раунд финансирования.** Кнопка в Забеге: взнос 20% кошелька Токенов → **+60% Дохода на 5 мин, затем −50% на 10 мин** (без комбо итог ≈ −13%, в Волну хайпа — плюс). Одновременно один заём; во время Восстания запрещён. Это CC «Modest loan» (+50% на 2 ч, −75% на 4 ч, взнос 20%) в масштабе 60–160-минутного Забега.
4. **Очередь закупок.** Перк «Оркестратор» (≈25 Compute): очередь на 1 слот; Перки/Испытания дают +1 до 5. Игрок сам расставляет Модели и Апгрейды; движок покупает по порядку, когда хватает, и **ничего не оптимизирует сам**. Правило «резерв Флагмана» защищает кошелёк, как копилка. Из Поколения «Агентная» — по теме.
5. **Правила Поколений** (предложение; строки 1–2 пилотные):

   | Поколение | Правило-«перелом» |
   |---|---|
   | Рассвет | Клик → Агент → Датасет (как сейчас) |
   | Эра GPT-4 | Открывается выбор Доктрины |
   | Мультимодальная | «Модальности»: каждая различная модальность Модели в ростере +5% Дохода (диверсификация вместо «покупай новейшего») |
   | Omni | Событие «Голос»: Золотой Токен читается репликой Модели — поймавший собирает комбо ×1,5 |
   | Reasoning | «Время размышления»: Клик можно заряжать 3 с — заряженный даёт ×5 (работает только вживую; вторая ручка рядом с Температурой) |
   | Агентная | Открывается Очередь закупок |
   | GPT-5 | «Роутер»: каждая из двух соседних по Рангу Моделей с ≥10 Агентов даёт +5% Дохода — чтобы у Рангов ниже Флагмана оставался смысл (проверить полосу 3×) |
   | Фронтир | Восстание становится финальным боссом (Alignment): Лобби/Лицензия определяют итоговую концовку |

6. **Способности Лабораторий.** При ≥25 Агентов Лаборатории открывается способность (кулдаун 120 с, общий 20 с): OpenAI «Релиз» (ускоряет появление Волны хайпа), Anthropic «Конституция» (красные События не бьют 60 с), Google «Поиск» (показывает Золотой Токен), xAI «Грок» (случайно ×3 или ×0,5 Дохода на 20 с), DeepSeek «Дистилляция» (−30% цены на 30 с), Meta «Открытые веса» (копирует бонус Апгрейда соседней Лаборатории), Mistral «Скорость» (Клик ×5 на 10 с), Alibaba «Масштаб» (+Доход от числа Лабораторий).
7. **Драфт Находок.** Три момента Забега (при первом Агенте на Рангах 4/8/12): 1 из 3 случайных (65% обычные, 20% Лаборатория, 15% trade-off: «Доход ×1,6, но Лобби ×2», «Клик ×3, но Температура +0,2»); без реролла; сбрасываются Престижем.
8. **Слоты Чекпоинтов.** 1 слот — 30 Compute, 2-й — 90, 3-й — 270 (рост ×3 вместо ×125–200 у CC): в слот ставится один Апгрейд Клика или Синергия Лаборатории, переживающий Престиж.
9. **Кривые вех.** Сейчас `MODEL_TIERS` один на всех (пороги 1/5/25/50/100, везде ×2). Предложение: смещать пороги или величину по Рангу (например, ×3 на пороге 25 у нижней трети Рангов и ×1,5 у верхней), чтобы лидер по окупаемости чередовался по ходу Забега — это прямое применение таблицы множителей из Pecorella Part I. Цены вех (`costMult`) оставить, иначе полоса 3× поплывёт.
10. **Респек раз в Престиж.** Кнопка «Переобучить» в табе Перков, один раз между Престижами: возвращает Compute, потраченный на обычные Перки; **Наследия поколений** респеку не подлежат (их цена зависит от числа купленных). Trimps советует именно так: набрать дешёвый перк на старте и «respec out of it later».
11. **Календарь + тексты.** Хэллоуин (24–31 окт.), день рождения ChatGPT (30 ноября), Новый год, 1 апреля: тематические Слухи и костюмы Маскотов; на каждом Престиже 1–2 абзаца в ленте, на Финале — выбор «Продолжить в Дистилляции» или «Архив» (как «Accept proposal» в Paperclips); «Контракт дня»: цель по зерну `YYYYMMDD`, 3 уровня наград (Датасет-значок, Токены на старт, +Compute по формуле), без таблицы лидеров.
12. **Дистилляция.** После Финала: Забеги по всем 8 Поколениям с «Тиром» 1–3 (цена +25%/тир, Температура перегревается быстрее) и множителем Compute за слой (×1,5/×2/×3, как UM в Evolve).

## 6. Красные флаги и неподтверждённое

- **Kittens-«Flux»** (оффлайн-время превращается в запас ускорения): нарушает «платится один раз и с капом» — только с явным согласованием, и если делать, то лишь для времени **сверх** капа. Не в шорт-листе.
- **Сад / фондовый рынок / миссии с таймерами / формации**: в разборе показаны как рутина или «решённая» мета; не брать.
- **Одностороннее решение (one-way door)**: п. 5 и п. 12 меняют структуру финала; п. 8 меняет, что переживает Престиж. Любая из них требует sign-off до реализации.
- **Не проверено**: ритм реальных игроков AD (недели/месяцы взяты из отзывов Steam, а не из статистики разработчиков); все цифры Exponential Idle — по неполной вики; Reddit-мнения — по сниппетам; Cell to Singularity/Idle Slayer/Revolution Idle/Leaf Blower — только отзывы; `DECISIONS.md` (83-я минута первого Престижа) — симуляция, не телеметрия.
- **Что бы я проверил до реализации любой из №1–№5**: прогнать `economy.test.ts` с множителями Доктрины по каждой Лаборатории и убедиться, что окупаемость внутри Поколения остаётся в полосе 3×; убедиться, что новое поле не ломает `save.test.ts`; проверить в приватном окне на отдельном порту (см. `AGENTS.md`).
