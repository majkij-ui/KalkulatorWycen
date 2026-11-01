# Eksport leadów do Google Ads: plan wdrożenia w hubie

Stan: **decyzje podjęte (sekcja 7), etap A gotowy (sekcja 9), etap B czeka.**
Wejście: `hub-lead-export-brief.md` z repo strony (część strony wdrożona 1.11.2026).
Ten plan zastępuje brief tam, gdzie się różnią (sekcja 2).

## 1. Jak to wpasowuje się w huba

| Brief zakłada | Hub ma dziś | Co z tego wynika |
|---|---|---|
| Rekord leada i tabele w bazie | Lead to wydarzenie `lead_in` w `events.json`; pliki JSON przez schematy Zod | Nowe pola w `data.ads`; formularz leada zachowuje nieznane klucze |
| Ocena fałszywy / dobry / bardzo dobry | `quality`: `fake` / `good` / `very_good` | Pasuje wprost |
| Lead powiązany ze zleceniem | `lead_in.projectId` (21 z 41 leadów) | Pasuje; żaden projekt nie ma dziś dwóch leadów, ale eksport musi się przed tym bronić |
| HUB czyta skrzynkę albo wpis ręczny | Claude czyta Gmaila (skill `przejrzyj-poczte`), propozycje idą do Skrzynki, Michał je akceptuje | Parser to czysta funkcja w `lib/`, używana przez walidację propozycji i pole „wklej Źródło" |
| Data akceptacji wyceny | Wydarzenie `won`, sama data, tylko 4 w całych danych | Brak `won` = wiersz odpada z widocznym powodem, nigdy nie zgadujemy daty |
| Przychód netto | Pętla pieniędzy (`money.revenue`: faktury, potem zatwierdzona cena) | Czytamy pętlę, zapisujemy kwotę z chwili eksportu |
| Tabela wysyłek | Brak | Nowy plik `ads-exports.json`, dopisywany, usuwanie miękkie, w kopiach zapasowych |
| Pobranie CSV | `lib/export-report.ts`: dialog „Zapisz jako" w Tauri | Ten sam wzorzec; sprawdzić na buildzie produkcyjnym |

Eksport to fakty pochodne z leada i projektu, więc nie wchodzi na oś czasu projektu.

## 2. Co zmieniamy względem briefu

1. **Okno 90 dni liczymy do dnia wysyłki, nie do `conversion_time`.** Google odrzuca
   wiersze wysłane ponad 90 dni po ostatnim kliknięciu, a dopasowane po samym kontakcie
   ponad 63 dni. Brief mierzy nie ten odcinek i nie zna limitu 63 dni.
2. **Zgoda.** Przykład z briefu wysyła telefon osoby ze zgodą `Denied`. Kontakt jedzie
   tylko przy `granted`. Przy `unknown` i `denied` wiersz może jechać wyłącznie po
   click id, bez e-maila i telefonu (`denied`: decyzja 1).
3. **Format czasu.** `2026-11-04 10:12:00 Europe/Warsaw` nie ma na liście przykładów
   Data Managera. Używamy formatu z listy: `2026-11-04T10:12:00 Europe/Warsaw`.
   Potwierdzamy pierwszym importem.
4. **Hash.** Data Manager przyjmuje dane jawne i zahaszowane. Plik zawiera SHA-256, żeby
   na dysku, a później w arkuszu, nie leżały dane klientów. Normalizacja obejmuje też
   usunięcie kropek przed domeną w `gmail.com` / `googlemail.com`, czego brief nie ma.
5. **`conversion_time` i `value` zamrożone przy pierwszym eksporcie.** Google rozpoznaje
   duplikat po identyfikatorze, nazwie i czasie, więc edycja daty `won` nie może
   wyprodukować drugiej konwersji.
6. **Bez wstecznego uzupełniania.** Leady sprzed 1.11.2026 nie mają click id ani
   `user_data` z kliknięcia. Nie są błędem; preview liczy je jako „sprzed śledzenia".
7. **Wartość leada zależna od oceny** (decyzja 2), bo inaczej gubimy różnicę między
   „dobry" a „bardzo dobry", czyli najcenniejszy sygnał Michała.

## 3. Model danych

`lead_in.data.ads` (wszystko opcjonalne, stare leady działają bez zmian):
`leadId`, `gclid`, `gbraid`, `wbraid`, `fromAds`, `clickedAt`, `submittedAt`, `consent`,
`utmSource`, `utmMedium`, `utmCampaign`, `utmTerm`, `landingPath`.
E-mail i telefon zostają w istniejących `data.email` / `data.phone`.

- `leadId` dla leada wpisanego ręcznie generuje hub, w tym samym alfabecie.
- `fromAds` to osobny fakt: `campaignId` mówi tylko, że lead przyszedł w oknie kampanii.

`ads-exports.json`, klucz `(leadEventId, conversionKey)`:
`leadId`, `conversionKey` (`lead` / `won`), `conversionName`, `conversionTime`, `value`,
`status` (`pending` / `confirmed` / `cancelled`), `exportedAt`, `confirmedAt`.

Konfiguracja w jednym miejscu (`lib/ads-export-config.ts` albo ustawienia): dokładne nazwy
akcji i wartości leada.

## 4. Reguły: przypadek → zachowanie

| Przypadek | Zachowanie |
|---|---|
| Lead `fake` | Nigdy nie jedzie |
| Lead `good` / `very_good`, click id, `fromAds` | Wiersz „Lead realny", czas = `submittedAt` |
| Sam kontakt, zgoda `granted` | Wiersz po kontakcie, limit 63 dni |
| Sam kontakt, zgoda `unknown` lub `denied` | Odpada: „brak zgody na kontakt" |
| Click id i kontakt, zgoda `unknown` | Wiersz bez kontaktu, zgoda pusta |
| Lead z telefonu bez click id | Odpada do czasu zgody (decyzja 1) |
| Lead bez sekcji „Źródło" | Zapisuje się normalnie; w eksporcie „sprzed śledzenia" albo „brak danych" |
| Ponad 90 dni od kliknięcia (63 po kontakcie) | Odpada: „poza oknem" |
| Do końca okna zostało mniej niż 14 dni | Wiersz jedzie, preview ostrzega |
| Brak `clickedAt` | Liczymy od `submittedAt` |
| Projekt wygrany, jest `won` i kwota | Wiersz „Zlecenie wygrane", czas = `won` (12:00 przy samej dacie), wartość = `money.revenue` |
| Projekt `won` / `done` bez wydarzenia `won` | Odpada: „brak daty wygranej", z linkiem do projektu |
| Brak kwoty lub 0 zł | Odpada: „brak kwoty" |
| Dwa leady na jeden projekt | Wygrana tylko z najwcześniejszego leada |
| Para ma wpis `pending` lub `confirmed` | Odpada: „już wysłane" |
| Cofnięcie (`cancelled`) | Wiersz wraca do następnego eksportu |
| Po wysłaniu: lead `fake`, projekt `lost` albo inna kwota | Lista „Do ręcznej korekty"; bez automatycznych korekt w tej wersji |

**Na Twoich danych:**

| Lead | Lead → `won` | Wynik |
|---|---|---|
| JHJ, 26 340 zł | 15.06 → 28.09, 105 dni | Wygrana poza oknem nawet przy gclid; ten cykl sprzedaży się nie zmieści |
| Tchibo Event, 6 375 zł | 29.09 → 13.10, 14 dni | Mieści się |
| CIONET II, 9 400 zł | 29.09 → 29.09 | Mieści się |
| S-AI, 80 440 zł | Telefon, brak `won` | Nie pojechałby wcale |
| M&L rolki, 11 980 zł | Brak `won` | „Brak daty wygranej" |

## 5. Etapy

**0. Google Ads, po stronie Michała, przed importem**
- Dwie akcje: `Lead realny (offline)`, `Zlecenie wygrane (offline)`, okno 90 dni.
- Ustawienie enhanced conversions włączone.
- `user_data` i `transaction_id` w GTM (`google-ads-offline-plan.md` 6.1).
- Decyzja 3 ustawiona na akcjach.

**A. Dane leada (jedna sesja Sonnet)**
- `lib/lead-source-parse.ts`: parsowanie po etykietach, test na próbce z `lib/lead-source.ts`
  strony i jednym prawdziwym mailu.
- Schemat `data.ads`, walidacja propozycji w `inbox-validate`.
- Format click id sprawdzany w walidacji, bo Claude przepisuje go z maila ręcznie.
- Formularz leada: pole „wklej Źródło", przełącznik „z reklamy", podgląd pól.
- Skill `przejrzyj-poczte`: co kopiować dosłownie, `leadId` jako klucz duplikatów.

**B. Logika i przycisk (jedna sesja Sonnet, po A)**
- `lib/ads-export.ts`: czyste funkcje, kwalifikacja z powodem, wiersze, CSV, hash; test na
  każdy wiersz sekcji 4.
- Store `ads-exports.json`, dopisany do kopii zapasowych.
- Marketing → Leady: „Eksport do Google Ads". Podgląd: wiersze, leady, suma, powody odpadnięcia,
  ostrzeżenia, lista korekt. Potem „Zapisz plik", wpisy `pending`, „Potwierdź import" albo „Cofnij".
- Sprawdzenie zapisu pliku na buildzie produkcyjnym.

**C. Pierwszy import (Michał + główna sesja)**
- Pierwsze prawdziwe leady z gclid, 1–3 wiersze.
- Mapowanie kolumn w Data Managerze, odczyt diagnostyki po około 3 godzinach.
- Poprawki formatu, krótka instrukcja tygodniowa w tym pliku.

**D. Później, po kilku cyklach**
- Dopisywanie do arkusza zamiast pliku (podmiana zapisu; `pending` trzeba wtedy przemyśleć).
- Korekty wstecz.
- Zmiana strategii stawek.

## 6. Ryzyka

- **Mało danych:** około 10 realnych leadów miesięcznie i 4 wygrane z kampanii od kwietnia.
  Sygnał „wygrane" sam nie wystarczy do nauki.
- **Czas:** synchronizacja poczty jest ręczna; bez tygodniowego rytmu okno 63 dni zacznie
  odcinać leady.
- **Niepotwierdzone w dokumentacji:** jak Google traktuje puste kolumny zgody w EOG.
  Sprawdzić przy pierwszym imporcie i w polityce zgód UE.

## 7. Decyzje (M.J., 1.11.2026)

1. **Zgoda:** reguła czyta zgodę każdego leada, więc baner (wkrótce gotowy) nie wymaga zmian w
   kodzie: `granted` = click id i kontakt, `unknown` = sam click id, `denied` = nic. Lead
   telefoniczny nie przechodzi przez baner, więc ma `unknown` i bez click id nie jedzie.
2. **Wartość leada:** `good` 300 zł, `very_good` 600 zł (założenie do korekty).
3. **Rola akcji w Google:** „Lead realny" główna, „Zlecenie wygrane" dodatkowa, żeby wartości się
   nie sumowały (300 + 18 500) i przy tej liczbie wygranych nie sterowały stawkami.
4. **Kwota wygranej:** `money.revenue` z chwili eksportu, bez późniejszych korekt.

## 8. Źródła

- [Guidelines for importing offline conversions](https://support.google.com/google-ads/answer/15081888?hl=en)
- [Prepare your data for import, Data Manager](https://support.google.com/google-ads-data-manager/answer/14184381?hl=en)

## 9. Etap A as built (1.11.2026)

Gotowe: dane leada, bez eksportu (etap B).

- `lib/lead-source-parse.ts` + test: `parseLeadSource(text)` czyta sekcję „Źródło" po etykietach (wielkość
  liter i ogonki bez znaczenia; `LABEL<tab/spacje/:>wartość` oraz etykieta i wartość w osobnych liniach).
  Czyta tylko po ostatnim nagłówku „ŹRÓDŁO"; bez nagłówka całość; brak sekcji = `null`. Czas
  `2026-10-31 14:22:19 Europe/Warsaw` → `2026-10-31T14:22:19`, awaryjny ISO UTC jest przeliczany na czas
  warszawski, nieczytelny jest pomijany z wpisem w `problems`. Click id musi pasować do
  `^[A-Za-z0-9_-]{10,512}$`, inaczej trafia do `problems` i nie jest zapisywany. `fromAds` = „tak" albo
  jakikolwiek click id w mailu (także zły).
- `lead_in.data.ads`: `leadAdsSchema` w `marketing-types.ts`, tolerancyjny (`.catch`, `passthrough`).
  `leadEventFromDraft` startuje od oryginalnego `ads`, więc nieznane klucze przeżywają zapis z formularza;
  wartości, których formularz nie umie pokazać (np. `ads` jako tekst), zostają.
- `inbox-validate.ts`: `lead_in` (także `set.data` w `event_update`) z `ads` spoza obiektu albo z click id
  w złym formacie = błąd z czytelnym komunikatem; stare propozycje bez `ads` bez zmian.
- Formularz leada: zwijany blok „Źródło z reklamy" (otwarty tylko, gdy lead ma `ads`): przełącznik „Z reklamy"
  (generuje `leadId`, 8 znaków `0-9A-Z`, jeśli go brak), pole „Wklej sekcję Źródło" z przyciskiem „Wczytaj"
  (uzupełnia puste e-mail, telefon, godzinę, a datę nowego leada dopóki nie wpisano jej ręcznie; nigdy nie
  nadpisuje wpisanego) i podgląd pól. Na liście leadów znacznik „Ads" przy leadach z `fromAds`.
- Skill `przejrzyj-poczte`: pola `ads` w propozycji, click id przepisywany dosłownie i sprawdzany, `leadId`
  jako klucz duplikatów, prefiks `[Ads]` = z reklamy.

Różnice względem strony (`lib/lead-source.ts`): etykiety w tekście maila mają zwykłą wielkość liter
(`gclid`, `Lead ID`, `Zgoda ad_storage`), wielkie są dopiero przez CSS; „Z reklamy" to `tak` / `nie`; zgoda to
`granted` / `denied` / `unknown`; e-mail i telefon są znormalizowane przez stronę (małe litery, E.164);
strona zapisuje czas przez `Intl` (`sv-SE`), a ISO UTC tylko gdy `Intl` zawiedzie.
