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
