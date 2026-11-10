# W1 + W2: prawa i surowy materiał w wycenie, pełna kontrola w Realizacji

Decyzje: M.J., 5.11.2026. Dwie niezależne sesje: W1 (kalkulator + PDF), W2 (Realizacja).

## W1. Przekazanie praw i surowego materiału

Dwie pozycje obok siebie w zakładce Dodatkowe, z takimi samymi kontrolkami:

| Kontrolka | Wartości |
|---|---|
| Kwota | % od ceny albo własna kwota (przełącznik); kwota w walucie wyceny |
| Tryb | **W cenie** · **Jako opcja** · **Nie pokazuj** |

Tryby:

- **W cenie:** linia w fazie Dodatkowe, dolicza się do sumy i wpada do wiersza PDF
  „Inne koszty", którego opis wymienia tę pozycję.
- **Jako opcja:** suma bez zmian. W PDF w „Opcjach dodatkowych" pojawia się automatyczna
  linijka (PL/EN, kwota w walucie PDF, np. „Przekazanie surowego materiału: +2 000 zł netto").
  Stoi nad ręcznym tekstem i go nie zmienia, jak automatyczne punkty „Uwag" obok ręcznych.
- **Nie pokazuj:** pozycji nie ma nigdzie.

Reguły:

- **Podstawa %:** cena bez tych dwóch pozycji, z marżą. Obie pozycje liczą się od tej samej
  podstawy i nigdy jedna od drugiej, tak samo w trybie „Jako opcja".
- **Cennik:** prawa 30% (jak dziś), surowy materiał 20%, tryb startowy „Jako opcja".
  Każda wycena może to zmienić.
- **Realizacja:** obie pozycje to przychód, nie koszt, więc nie tworzą wierszy kosztów.
  Honorarium aktorów za prawa zostaje kosztem, bez zmian.
- **Stare wyceny bez nowych pól:**
  - `copyrightType: 'przekazanie'`: prawa „W cenie" z dotychczasowym procentem;
  - `licencja`: prawa „Nie pokazuj";
  - surowy materiał: „Nie pokazuj".
  Cena i PDF starych wycen nie zmieniają się. Nowe wyceny dostają ustawienia z Cennika.
- Działa w każdym wariancie wyceny osobno (dane wariantu).

Przykład: cena bazowa 10 000 zł, prawa 30%, surowy 20%.

| Prawa | Surowy | Suma PDF | Opcje dodatkowe |
|---|---|---|---|
| w cenie | jako opcja | 13 000 | „…surowego materiału: +2 000 zł netto" |
| jako opcja | jako opcja | 10 000 | obie linijki (+3 000, +2 000) |
| w cenie | w cenie | 15 000 | — |
| nie pokazuj | nie pokazuj | 10 000 | — |

### W1 as built

- Logika w `lib/quote-extras.ts`; pola `rightsMode`, `rawMode`, `*AmountKind`, `*FixedAmount` są opcjonalne w `QuoteData` (bez nich: reguła ze starych wycen). Procenty (30 / 20) leżą w `pricing.dodatkowe` wyceny (`surowyMaterialProcent` nowe, edytowalne w Cenniku i w zakładce Dodatkowe).
- Nowe wyceny dostają tryb „Jako opcja" przez `blankQuoteSnapshot` i `clearedDoc` (jak `marginAsLine`); tryb startowy jest stałą w kodzie, nie polem Cennika. Własna kwota jest w `TYPED_AMOUNT_FIELDS` (przelicza się raz przy zmianie waluty).
- Linijki „Opcji dodatkowych" liczą się przy wydruku i w podglądzie (nad polem ręcznym), nie są zapisane w szkicu. „W cenie" wpada do „Inne koszty" i jest wymienione w opisie wiersza. Prawa „W cenie" w Uwagach PDF dają te same warunki co `przekazanie`.
- Sprawdzone na prawdziwych danych (tylko odczyt): `sumaNetto`, koszty i zysk bez zmian.

## W2. Realizacja: pełna kontrola

1. **Ilość edytowalna w każdym wierszu kosztu.** Liczba ≥ 0, także ułamkowa (0,5 dnia).
   Obok widać wartość wiersza. Zmiana liczy się jako edycja wiersza.
2. **„Rozdziel"** przy wierszu z ilością > 1. Rozbija go na pojedyncze wiersze, a suma się nie
   zmienia. Przykłady: 10 × 1 000 zł (ekipa z szybkiej wyceny) daje 10 wierszy po 1 000 zł;
   „Dopłata Reż-Op" 5 × 500 zł daje 5 wierszy. Ilość ułamkowa: reszta zostaje w ostatnim
   wierszu.
3. **„Przenieś do dnia" przy pojedynczym wierszu,** obok dzisiejszego przenoszenia całej grupy.
4. **Osoba albo rola na start:** przy dodawaniu wiersza ekipy są dwie równoległe listy, „Rola…"
   i „Osoba…". Wybór osoby od razu daje jej pierwszą rolę i stawkę, tak jak dziś przy wyborze
   osoby w wierszu bez roli (`costRowPersonPatch`). Wybór „Ja" ustawia „Moja praca".
   Rola na start działa jak dziś.
5. **Baner „Wycena zmieniła się":** wiersze rozdzielone i przeniesione to edycje M.J., więc
   „Uwzględnij" nie może dołożyć drugi raz zbiorczej linii z wyceny.

Dane: projekty z ekipą z szybkiej wyceny, np. Filmy 5 lokacji OmniOffice („2 os. × 2 dni"
× 4 i „Dopłata Reż-Op" × 2), Tchibo Event, S-AI, M&L Pakiet. Istniejące wiersze nie zmieniają się
same.

### W2 as built

- Logika w `lib/realization-control.ts` (`splitCost`, `canSplit`, `crewRowFromRole`, `crewRowFromPerson`, `quantityValue`), testy w `lib/realization-control.test.ts`. UI: `QuantityInput` i `RowTools` w `cost-rows.tsx`, `CrewAdder` w `day-cards.tsx`, `splitRow`/`moveRow` w `project-realization.tsx`; wszystko idzie przez `targetOf`/`ensureStarted` (pierwsza zmiana szkicu zapisuje cały szkic).
- Ilość: pole „N ×" w każdym wierszu ekipy, kosztu i wynajmu, obok „= wartość". Wiersz „Dojazd" zostaje jedną kwotą (bez pola ilości); stary km × zł/km pokazuje kwotę jak dotąd.
- „Rozdziel": pierwszy wiersz to ten sam rekord (ilość 1), reszta to kopie tuż za nim; ułamek w ostatnim. Wiersz z planu: kopie dostają klucz `<klucz>#n` (kolejny wolny numer) i `edited`, oryginał zostaje z kluczem i `edited`, więc „Uwzględnij" niczego nie dokłada ani nie nadpisuje. Cofnięcie w komunikacie przywraca listę sprzed rozdzielenia.
- „Przenieś do dnia…" przy wierszu: zwykła zmiana `dayId` (`edited`), także w kartach dni; grupowe przenoszenie bez zmian.
- Dodawanie ekipy: „Wiersz ekipy" (pusty, ręczny), „Rola…" (nazwa roli i jej koszt) i „Osoba…" (pierwsza rola i stawka w niej, inaczej stawka ogólna; „Ja" = moja praca).

## Cena końcowa (5.11.2026)

Decyzja M.J.: pieniądze mają cztery warstwy — kalkulator → PDF (cena) → Realizacja (koszty) → Finanse (ostatnie słowo, faktury wygrywają). M.J. uzupełnia wyceny projektów, które już mają faktury, żeby Realizacja mogła ruszyć od wyceny. Stąd **cena końcowa** (`lib/final-price.ts`, jedna maszyneria z U1: `approvedPrice` / `planRevenue`).

Projekt ma cenę końcową, gdy:
- (a) jest „Zrealizowany" i ma co najmniej jedną żywą fakturę wysłaną z kwotą — cena = suma faktur, ta sama co `projectMoney().invoiced` (EUR: kwota w zł, którą liczy pętla; usunięte faktury nie liczą się). Liczone przy odczycie, bez migracji. Zaliczka w trwającym projekcie NIE blokuje ceny;
- (b) w chwili pierwszego zapisu wyceny miał finanse z importu (`!quote && financials`) — cena = `financials.sumaNetto`, zapisana jako `approvedPrice` ze źródłem `import`;
- (c) M.J. ustawił ją ręcznie po ostrzeżeniu — `approvedPrice` ze źródłem `override` (wygrywa z fakturami i importem).

| Przypadek | Zachowanie |
|---|---|
| Edycja wyceny projektu z ceną końcową | Zapis od razu, bez pytania; cena się nie zmienia; Realizacja może ruszyć od wyceny |
| W trakcie edycji | Pasek nad wyceną (zakładki Wycena i PDF), przeliczany przy każdej zmianie: „Wycena X · Cena końcowa (faktura … / import) Y · różnica Z" |
| „Ustaw cenę z wyceny" (pasek) albo „Zmień" ceny w Finansach | Okno z ostrzeżeniem (źródło, kwota, numery faktur); dopiero „Zmień cenę" zapisuje ręczne nadpisanie; „Anuluj" nic nie zmienia |
| Realizacja | Główna cena = cena końcowa, „PDF: X" obok |
| Finanse projektu | Cena końcowa; brak luki płatności i „dosprzedaży" wywołanych samą różnicą PDF ↔ faktury; „Ustaw cenę z wyceny" zamiast „Odśwież" |
| Zmiana wariantu | Cena końcowa zostaje (nowa migawka przejmuje rekord), bez pytania o finanse z importu; potwierdzenie mówi, że cena zostaje |
| Projekt bez ceny końcowej (normalny 2026, zaliczka) | Bez zmian: PDF, zatwierdzona cena, „Odśwież", dotychczasowe pytanie przy wariancie |

Usunięte: blokujące pytanie „Zastąpić finanse z importu…" w nagłówku projektu (`needs-confirmation`, `confirmReplace`, `discard`) i ścieżka „zmiany czekają w pamięci". Zmiany zapisują się od razu jak w każdej wycenie.

Wyceny sprzed zmiany (YoPro, Misty Cliffs for WOO, Z natury gościnni): Realizacja i Finanse projektu pokazują już cenę z faktur (reguła a). Ekrany czytające `financials.sumaNetto` wprost (rozbicie płatności, Klienci bez pętli) wymagają patcha `imports/2026-11-05-cena-koncowa.json` (generator: `scripts/final-price-patch.mts`; ręcznie tylko `--dry-run`, zastosowanie przy zamkniętym hubie). Finanse firmy 2021–2026 (przychód, koszty, zysk) bez zmian — pętla pieniędzy nietknięta.

## Koszty idą za fakturami (5.11.2026)

Decyzja M.J.: koszty projektu nie leżą już w całości w miesiącu kotwicy (pierwsza faktura), tylko idą za fakturami.

**Reguła** (jeden helper: `periodCostShare(money, period)` w `lib/money-loop.ts`): gdy przychód projektu jest znany (> 0) i ma kawałki przychodu, okres dostaje koszty × (kawałki w okresie / suma wszystkich kawałków). Tak samo moja praca (`ownWork`), a z nią marża producencka. W przeciwnym razie — jak dotąd, całość w kotwicy. Udziały jednego projektu sumują się do 1. Używają go `summarizeMoney`, `marginSummary` (`costShare` na wierszu) i `periodRentals` (wynajem jako część kosztów). `anchored` zostaje tam, gdzie znaczy kotwicę (liczniki, dni zdjęciowe, ekipa i sprzęt na planie, dosprzedaż).

| Przypadek | Wynik |
|---|---|
| „Z natury gościnni", czerwiec 2025 | przychód 7 431, koszty 4 884 (25 %), marża ≈ 2 547 |
| „Z natury gościnni", sierpień 2025 | koszty ≈ 14 651 |
| Cała firma, czerwiec 2025 (sprzęt rozłożony) | marża −6 604 → ≈ 8 047; wynik −11 508 → ≈ 3 143 |
| Cała firma, sierpień 2025 | marża 22 293 → ≈ 7 642; wynik 17 251 → ≈ 2 600 |
| Rok 2025, pozostałe miesiące | bez zmian (suma marży roku 59 939 przed i po) |
| Jedna faktura albo wszystkie w jednym miesiącu | bez zmian |
| Brak faktur (plan przy dacie projektu) / przychód nieznany | bez zmian (kotwica) |
| Faktury w dwóch latach | koszty dzielą się także między lata |

Zmienione testy (dotąd „koszty zostają w kotwicy"): dodatek na późniejszej fakturze w `money-loop`, `margin-ledger`, `r2-money` i `period-report`.

## Sprzęt retro 2021–2024 (10.11.2026)

Uzupełnienie użycia własnego sprzętu w projektach 2021–2024 (dotąd bez sprzętu) z wyboru zrobionego w jednorazowym narzędziu. Finanse (przychód, koszty, wynik) się nie zmieniają.

- Nowe pole `dayRate` w pozycji dnia sprzętu (`gearLineSchema`): stawka dnia pozycji w tym projekcie (za sztukę); brak = stawka z katalogu. Czytają je „Odpracował" (`equipment-roi.ts`) i podział „Zarobił" (`gear-earnings.ts`); zmiana liczby sztuk w siatce zostawia `dayRate`.
- Generator: `node --import ./scripts/register-ts.mjs scripts/gear-retro-patch.mts <wybor.json> [folder] > imports/<nazwa>.json`, potem `npm run data -- apply imports/<nazwa>.json --dry-run` (tylko odczyt danych; zapis dopiero przy zamkniętym hubie). Logika: `lib/gear-retro.ts`.

| Przypadek | Zachowanie |
|---|---|
| Zestaw + N dni | N dni sprzętu, w każdym każda pozycja zestawu (1 szt.); `dayRate` = cena zestawu × stawka pozycji / suma stawek z katalogu CAŁEGO zestawu (np. Kite 500: 200/150/50 → 250 / 187,5 / 62,5) |
| Pozycja kupiona po dacie projektu (`purchaseDate` po zastosowaniu `equipmentDates`) | pozycja pominięta w tym projekcie, jej udział znika (cena zestawu spada razem z nią), wymieniona na stderr |
| `gearEarnedOverride` | zaokrąglone do 2 miejsc: procent × przychód netto projektu w zł z `moneyLedger` (dziś); brak przychodu = bez kwoty + ostrzeżenie. Np. 3 dni, 6 354 zł, 25% → Odpracował 1 500, kwota 1 588,50 |
| postOnly | bez sprzętu i kwoty; miękko usuwane (`deletedAt`) tylko importowe dni zdjęciowe („Data umowna (import)") |
| Zestaw `null`, nie postOnly | projekt nietknięty |
| Projekt ma już `gearDays` (albo stary `equipment`) lub `gearEarnedOverride` | nietknięty, wymieniony na stderr |
| Kalendarz | każdy dzień sprzętu wskazuje dzień zdjęciowy (`eventId` + `eventDay`), po datach; brakujące dni: ostatni importowy placeholder wydłużamy (`end`), a gdy ostatnie wydarzenie jest „prawdziwe" lub nie ma żadnego — nowe jednodniowe wydarzenia `ev-retro-sprzet-<projekt>-<n>` w kolejnych dniach (bez wydarzeń: od daty projektu); gdy dni zdjęciowych jest więcej niż N, łączymy pierwsze N, resztę zostawiamy |
| `equipmentDates` | `purchaseDate` w katalogu zaktualizowany |

Podsumowanie na stderr: zmienione / pominięte projekty oraz per pozycja dni, Odpracował i Zarobił.

## Sprzęt: przejrzane, na plusie, sprzedaż (10.11.2026)

Decyzje M.J. Trzy zmiany w sekcji Sprzęt; Finanse bez zmian (sprzedaż to nie przychód, rozkładanie kosztów sprzętu nietknięte).

**„Bez sprzętu"** — pole `noGear` w projekcie („przejrzany: projekt bez mojego sprzętu", np. postprodukcja). Ostrzeżenie „projekt nie ma wpisanego sprzętu" ma przycisk „Bez sprzętu" przy każdym wierszu, „Wszystkie przejrzane — bez sprzętu" (jeden zapis) i zwijaną listę „Przejrzane bez sprzętu (N)" z „Cofnij".

| Przypadek | Zachowanie |
|---|---|
| oznaczony | nie ma go w ostrzeżeniu |
| nowy zrealizowany projekt bez sprzętu i bez flagi | jest w ostrzeżeniu |
| oznaczony, który później dostał sprzęt | liczy się normalnie, flaga bez znaczenia |

**„Na plusie"** = Zarobił − zainwestowane (`gearBalance`; zainwestowane = sztuki × cena zakupu). Zielone „+X zł" albo „Do spłaty X zł"; w panelu pozycji i jako kolumna na liście. Bez ceny zakupu — brak.

| Pozycja | Saldo (dane z 10.11.2026) |
|---|---|
| Sony FE 100-400 GM | +6 548 |
| Sony A7 III | +3 371 |
| Sony A7S III | +3 231 |
| Manfrotto | +1 764 |
| 28-135 | −1 487 |
| RED Komodo X | −50 267 |

**Sprzedaż** — `soldDate` + `soldPrice` w pozycji (blok „Sprzedaż" w panelu; puste = nie sprzedany). Po sprzedaży „Wynik końcowy" = Zarobił + cena sprzedaży − zainwestowane, plakietka „Sprzedany <data>" na liście. Odpracował/Zarobił liczą przeszłość dalej. Listy wyboru (siatka Realizacji, wybór sprzętu w wycenie, zestawy) nie oferują pozycji sprzedanej PRZED datą dnia (bez daty — dziś); istniejące linie projektów zostają.

| Przypadek | Wynik |
|---|---|
| A7 III: zarobił 11 871, sprzedany za 3 000, zainwestowane 8 500 | końcowy +6 371 |
| RED: zarobił 6 733, sprzedany za 30 000, zainwestowane 57 000 | końcowy −20 267 |
| sprzedaż wyczyszczona | wraca „Na plusie" |
| 2 szt. | zainwestowane = 2 × cena |

## Sprzedaż sprzętu w Finansach (10.11.2026)

Decyzja M.J. „wariant C": sprzedaż sprzętu liczy się w kosztach sprzętu w Finansach — netto, bez podatku, nie jest przychodem zleceń. W miesiącu sprzedaży osobny wiersz „Sprzedaż sprzętu: <nazwa>" (w panelu kosztów sprzętu i w raporcie okresu), ujemny = zysk, zmniejsza koszt sprzętu i „Zysk po wszystkich kosztach" przez istniejącą sumę sprzętu. Miesiąc z ujemną sumą jest dozwolony. Kod: `lib/gear-costs.ts` (`sales`, `soldMonth`).

| Przypadek | Zachowanie |
|---|---|
| Sprzedany, widok rozłożony | rozkładanie kończy się w miesiącu sprzedaży (włącznie, jak wycofanie); w tym miesiącu wiersz = nierozłożona reszta − cena sprzedaży |
| Sprzedany, „w miesiącu zakupu" albo poniżej progu | wiersz −cena sprzedaży w miesiącu sprzedaży |
| Całe życie | widok rozłożony = widok jednorazowy = cena zakupu − cena sprzedaży |
| Miesiąc sprzedaży po `through` (trwający okres) | jeszcze się nie liczy, jak przyszłe koszty |
| Samo `retiredAt` | bez zmian (reszta pokazana, nie liczona) |
| `soldDate` bez `soldPrice` | jak wycofanie, bez wiersza sprzedaży |
| Sprzedaż za 0 zł (wpisane 0) | reszta zakupu zdjęta w miesiącu sprzedaży |

Przykład (test): RED 57 000 kupiony 2024-04-01, 36 mies. (1 583,33 / mies.), sprzedany 2027-01-15 za 30 000. Rozłożony: kwiecień 2024–styczeń 2027 = 34 raty; styczeń 2027 ma też sprzedaż 3 166,67 − 30 000 = −26 833,33, razem −25 250. Jednorazowy: 57 000 w 2024-04, −30 000 w 2027-01. Oba widoki w sumie 27 000.

**Sprzęt.** Kafelek „Kapitał w sprzęcie" (pod kafelkami podsumowania, bieżący rok): zakupy (cena × sztuki wg daty zakupu) − sprzedaże (`soldPrice` wg `soldDate`) od początku i w roku (`lib/gear-capital.ts`). Opcjonalne `fundedBySale` (id sprzedanych pozycji) w arkuszu pozycji: „Sfinansowano sprzedażą: RED 30 000 zł → realny koszt 10 000 zł" (nadwyżka: „realny koszt 0 zł, nadwyżka X zł"). Tylko informacja — ROI, „Na plusie" i spłata liczą pełną cenę. Arkusz zapisuje `soldPrice` tylko przy wpisanej cenie (puste = wycofanie).

Dane rzeczywiste nie mają sprzedanych pozycji: liczby Finansów identyczne (real-data-check, `CHECK_TODAY=2026-11-10`, różni się tylko ścieżka drzewa).
