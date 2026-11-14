# Eksport leadów do Google Ads: gdzie jesteśmy

Stan na **14.11.2026**. Szczegóły i decyzje: [PLAN-GOOGLE-ADS-EXPORT.md](PLAN-GOOGLE-ADS-EXPORT.md) (§5 etapy, §9 etap A, §10 etap B).

## W skrócie

Część po stronie hubu (etapy A i B) jest zbudowana od 1.11.2026. Jeszcze nic nie wysłano do Google Ads. Brakuje dwóch rzeczy: konfiguracji po stronie Google (etap 0) i pierwszego leada z identyfikatorem kliknięcia, od którego zacznie się pierwszy prawdziwy import (etap C).

## Co działa w hubie

**Dane leada (etap A).** Lead może mieć przy sobie dane z reklamy (`data.ads`):
- identyfikator kliknięcia: gclid, gbraid albo wbraid;
- zgody;
- e-mail i telefon.

Dane biorą się z bloku „Źródło” w mailu ze strony. Trafiają do hubu na dwa sposoby: przez przegląd poczty (skill `przejrzyj-poczte`) albo przez pole „wklej Źródło” w formularzu leada. Przełącznik „z reklamy” ustawia to ręcznie.

**Eksport (etap B).** Marketing → Leady → przycisk „Eksport do Google Ads”:
1. Podgląd pokazuje, które leady przejdą, jaką wartość wyślą i dlaczego reszta odpada (fałszywy, bez zgody, poza oknem, już wysłany).
2. „Zapisz plik” zapisuje CSV na dysku.
3. CSV wgrywasz ręcznie w Google Ads (Data Manager). Hub sam niczego nie wysyła, nie ma połączenia przez API.
4. Potem „Potwierdź import” albo „Cofnij”. Hub zapisuje w `ads-exports.json`, co już poszło, więc ten sam lead nie wyjdzie dwa razy.

**Wartości konwersji:**

| Zdarzenie | Wartość |
|---|---|
| Lead dobry | 300 zł |
| Lead bardzo dobry | 600 zł |
| Zlecenie wygrane | przychód projektu zamrożony w chwili eksportu |

E-mail i telefon idą tylko jako skrót SHA-256. Okna czasowe: 90 dni dla kliknięć gclid, 63 dni dla danych do enhanced conversions. Śledzenie liczy się od 1.11.2026.

## Dane na 14.11.2026

- 41 leadów w hubie. Żaden nie ma danych z reklamy ani identyfikatora kliknięcia: wszystkie są sprzed 1.11, a od tej daty do hubu nie trafił żaden nowy lead.
- Pliku `ads-exports.json` nie ma, czyli jeszcze niczego nie eksportowano.

## Co zostało

**Etap 0, po stronie Google (robi M.J.). Sprawdź, ile już jest:**
- [ ] Dwie akcje konwersji: „Lead realny (offline)” i „Zlecenie wygrane (offline)”, okno 90 dni.
- [ ] Włączone enhanced conversions for leads.
- [ ] W GTM: `user_data` (e-mail, telefon) i `transaction_id`.
- [ ] Baner cookies poprawnie przekazuje zgody (decyzja 3 ustawiona na akcjach).

**Etap C, pierwszy prawdziwy import (razem, gdy przyjdzie lead z gclid):**
- [ ] Przegląd poczty wciąga nowe leady razem z blokiem „Źródło”.
- [ ] Eksport w zbudowanej aplikacji. Okno „Zapisz jako…” i zapis pliku nie były jeszcze sprawdzone poza podglądem.
- [ ] Mapowanie kolumn w Data Manager przy pierwszym wgraniu.
- [ ] Diagnostyka w Google Ads po około 3 godzinach.
- [ ] Sprawdzenie, czy `ads-exports.json` zostaje po restarcie hubu.
- [ ] Krótka instrukcja na co tydzień.

**Etap D, później (po kilku cyklach):** wysyłka do arkusza zamiast pliku, korekty wstecz, zmiana strategii stawek.

## Jak wrócić do tematu

Napisz w czacie np. „wracamy do eksportu Google Ads”. Najpierw sprawdzimy, czy w hubie jest lead z identyfikatorem kliknięcia, a jeśli nie ma, zaczniemy od przeglądu poczty.
