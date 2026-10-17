# Как устроены долгие слои в idle-играх

Ответ на research-тикет «Как устроены долгие слои в idle-играх» (#126) карты «Игра на 50+ часов — слой «После Финала»» (#124). Исследование сделал сабагент Haiku 5.5 с effort high по первичным источникам. Ветка одноразовая и не мержится.

**Ограничения.**
- Вики на Fandom для Antimatter Dimensions, Realm Grinder и NGU Idle отдают 402 или 404.
- Официальных чисел «сколько часов до слоя» нет ни у одной игры.
- Числа из форумов помечены как оценки сообщества.

## 1. Antimatter Dimensions (код под MIT)

Источники: [reality.js](https://raw.githubusercontent.com/IvarK/AntimatterDimensionsSource/master/src/core/reality.js), [eternity.js](https://raw.githubusercontent.com/IvarK/AntimatterDimensionsSource/master/src/core/eternity.js), [player.js](https://raw.githubusercontent.com/IvarK/AntimatterDimensionsSource/master/src/core/player.js), [big-crunch.js](https://raw.githubusercontent.com/IvarK/AntimatterDimensionsSource/master/src/core/big-crunch.js).

- **Infinity.**
  - Сбрасывает антиматерию, измерения, галактики, репликанти и Time Shards.
  - Даёт Infinities и IP.
  - Открывается, когда `thisInfinity.maxAM >= goal`, по умолчанию `Decimal.NUMBER_MAX_VALUE`.
- **Eternity.**
  - Открывается, когда `maxIP >= requiredIPForEP(1)`.
  - Сбрасывает валюты и улучшения Infinity, оставляет Eternity Points.
  - Вехи `EternityMilestone` сохраняют часть прогресса Infinity, то есть каждый повтор становится легче.
- **Reality.**
  - Открывается при `maxEP.exponent >= 4000` и купленном `TimeStudy.reality`. Проверок времени нет.
  - Сбрасывает почти всё.
  - Даёт Reality Machines, Perk Points и Glyphs. Glyph — это выбор из набора, то есть новое решение.
- **Время до слоёв.** Достоверных чисел не нашлось.
- **Тупик в поздней игре.** Это один случай, а не типичный. После Effarig's Reality RM упали с ~1e28 до ~1e21 из-за выключенного автобая ([Steam, 2023](https://steamcommunity.com/app/1399720/discussions/0/3829790038720386731)). Вывод: поздний прирост сильно зависит от правильной автоматизации.
- **Что после последнего контента.** Celestials и Pelle ([wiki.gg](https://antimatterdimensions.wiki.gg/wiki/Celestials)) не изучены, страница не открылась.

## 2. Realm Grinder (код закрыт)

- **Слои:** Abdication, Reincarnation, Ascension.
- **Abdication.** Сбрасывает здания, улучшения и золото, оставляет самоцветы: каждый даёт +3% к производству золота ([Soft Resets](https://realm-grinder.fandom.com/wiki/Soft_Resets), видно только в сниппете).
- **Условие Reincarnation.** Источники расходятся. [PC Gamer](https://www.pcgamer.com/realm-grinder-guide/) называет 1 Oc самоцветов, но статья обрезана. Не проверено.
- **Время.** Оценки сообщества: около 6 ч полуактивной игры до возврата к 1 Oc ([Steam](https://steamcommunity.com/app/610080/discussions/0/1474222595305024895)) и 1–2 недели до следующего R на поздней стадии ([Steam](https://steamcommunity.com/app/610080/discussions/0/1700542332339423336)).
- **Решения.** Например, брать ли наёмников в этом R: без них открывается Достижение «No Recruiting» при 1e90 самоцветов ([Steam](https://steamcommunity.com/app/610080/discussions/0/1473095331485015405)).

## 3. NGU Idle (код закрыт, вики недоступны)

- **Длина Rebirth.** 30 мин, затем 60 мин: Titan появляется раз в час ([Steam, 2019](https://steamcommunity.com/app/1147690/discussions/0/3166519278508035266)). В середине игры около 24 ч, по оценке сообщества.
- **Жалобы.** Rebirth длиной 24 ч на Itopod 30 «мучительно медленные» ([Steam](https://steamcommunity.com/app/1147690/discussions/0/3419934180314275606), видно только в сниппете).
- **Испытания.** Сбрасывают счётчик Rebirth.
- **Общее время.** Встречаются числа 6000–10 000 ч. Это анекдоты, не проверено.

## 4. Revolution Idle ([Promote](https://revolutionidle.wiki.gg/wiki/Promote), [Infinity](https://revolutionidle.wiki.gg/wiki/Infinity))

- **Prestige.** Открывается при 1e10, даёт P.Mult и P.Exponent.
- **Promotion.**
  - Открывается при P.Mult > ×1000.
  - Даёт уровень одного из четырёх бустов на выбор, то есть решение при каждом сбросе.
  - Опыт: `floor((P.Mult/1000)^0.75)`.
- **Infinity.**
  - Открывается при 1.79e308.
  - Даёт девять испытаний: большинство идёт меньше часа, 4-е и 9-е — несколько часов.
- **Время.** Один игрок потратил на испытание 9 около 12 ч, второй Eternity у него вышел примерно в 6 раз быстрее первого ([Steam, 2024](https://steamcommunity.com/app/2763740/discussions/0/4695658043402154751)).
- **Боль.** Первый Eternity без предупреждения сбросил автоматизацию.

## 5. Cookie Clicker ([main.js](https://orteil.dashnet.org/cookieclicker/main.js), [Ascension](https://cookieclicker.wiki.gg/wiki/Ascension), [Sugar Lumps](https://cookieclicker.wiki.gg/wiki/Sugar_Lumps), [Milk](https://cookieclicker.wiki.gg/wiki/Milk))

- **Ascension.**
  - Prestige = `(cookies/1e12)^(1/3)` при `HCfactor=3`, считается от всего заработанного.
  - Каждый уровень даёт +1% CpS.
  - Heavenly Chips выдаются 1:1 и не сгорают.
  - Для первого Ascension вики советует 365 chips. Это ≈ 4,9e19 печенья, расчёт по формуле.
- **Сахарные кусочки.**
  - `lumpMatureAge` 20 ч, `lumpRipeAge` 23 ч, полный цикл 24 ч.
  - Тратятся на уровни построек и Sugar Frenzy (×3 на 1 ч, один раз за Ascension).
- **Молоко.**
  - `milkProgress = AchievementsOwned / 25`.
  - Каждое обычное Достижение даёт +4% к множителю от молока, максимум 2488% на 622 Достижения.
- **Жалобы.** Игроки ждут первый Ascension 11–20 дней ([Steam](https://steamcommunity.com/app/1454400/discussions/0/3476233614742626376)). Какие цитаты к каким ссылкам относятся, точно не установлено.

## 6. Выводы для Token Clicker

1. **Второй слой должен менять правила, а не только масштаб.** И Eternity в AD, и Promotion в RI дают выбор: что сохранить, какой буст поднять. У нас это мог бы быть выбор, что переживёт сброс второго слоя, а не голый множитель.
2. **Гейт реального времени работает как «созревание плюс короткий выбор».** Кристаллы по 20 ч устроены как сахарные кусочки. Но если других гейтов реального времени нет, на 50 ч этого не хватит: внутри одного захода в игру нужны ещё раздачи.
3. **Повтор Поколений не надоедает, если со временем сохраняется всё больше.** Вехи Eternity, автоматизация RI со второго прохода, вечные Heavenly Chips — каждый повтор чуть проще и другой.
4. **Жалобы собираются в трёх местах:**
   - слишком долгий первый цикл;
   - сброс-сюрприз без предупреждения;
   - провал прироста из-за автоматизации.

   Отсюда: до сброса показывать, что потеряется, и сколько осталось до следующего гейта.
5. **Ритм «новое раз в 60–90 мин» источниками не подтверждён.** Это по-прежнему гипотеза.

## 7. Что не проверено

- **AD.** Вики Infinity, Eternity, Reality и Celestials недоступны. Значение `requiredIPForEP(1)` не получено. Pelle и Celestials не изучены.
- **Realm Grinder.** Условие Reincarnation и механика Ascension не установлены.
- **NGU Idle.** Все числа взяты из пересказов на форумах.
- **Revolution Idle.** Время прохождения опирается на один пост. Сброс автоматизации при Eternity виден только в поисковой выдаче.
- **Cookie Clicker.** main.js читался выдержками. Сад, Grandmapocalypse и другие побочные системы не изучались.
