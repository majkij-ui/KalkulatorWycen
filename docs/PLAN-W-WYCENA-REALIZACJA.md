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
