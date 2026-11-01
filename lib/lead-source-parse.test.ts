import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseLeadSource, parseSourceTime } from './lead-source-parse'

const GCLID = 'Cj0KCQjwxNmfBhDBARIsAHxDqqAcPz1Q-7a9XkLm2_Zt'

// Tak wygląda wklejony mail z formularza: treść wiadomości, potem sekcja „Źródło".
const FULL_MAIL = `Nowa wiadomość z formularza

Imię: Anna Kowalska
Firma: Interprint Polska
E-MAIL: tresc@tylko-w-tresci.pl
Telefon: 111 111 111

Chcemy zamówić dwa filmy korporacyjne. Proszę o kontakt, mój e-mail jest powyżej.

ŹRÓDŁO
LEAD ID\tK7Q2M9XA
Z REKLAMY\ttak
GCLID\t${GCLID}
E-MAIL\tanna@interprint.pl
TELEFON\t+48600100200
KLIKNIĘCIE\t2026-10-31 14:02:11 Europe/Warsaw
WYSŁANO\t2026-10-31 14:22:19 Europe/Warsaw
UTM_SOURCE\tgoogle
UTM_MEDIUM\tcpc
UTM_CAMPAIGN\tfilmy-korporacyjne
UTM_TERM\tfilm reklamowy warszawa
STRONA WEJŚCIA\t/oferta/filmy-korporacyjne
ZGODA AD_STORAGE\tgranted
`

test('pełny mail: wszystkie pola, treść wiadomości przed nagłówkiem nie jest czytana', () => {
  const parsed = parseLeadSource(FULL_MAIL)
  assert.deepEqual(parsed, {
    leadId: 'K7Q2M9XA',
    fromAds: true,
    gclid: GCLID,
    email: 'anna@interprint.pl',
    phone: '+48600100200',
    clickedAt: '2026-10-31T14:02:11',
    submittedAt: '2026-10-31T14:22:19',
    utmSource: 'google',
    utmMedium: 'cpc',
    utmCampaign: 'filmy-korporacyjne',
    utmTerm: 'film reklamowy warszawa',
    landingPath: '/oferta/filmy-korporacyjne',
    consent: 'granted',
    problems: [],
  })
})

test('tylko niektóre wiersze (strona pomija puste): czytamy po etykiecie, nie po pozycji', () => {
  const parsed = parseLeadSource(`ŹRÓDŁO
Lead ID\tAB12CD34
Z reklamy\tnie
Telefon\t+48501502503
Wysłano\t2026-11-01 09:05:00 Europe/Warsaw
Zgoda ad_storage\tunknown`)
  assert.deepEqual(parsed, {
    leadId: 'AB12CD34',
    fromAds: false,
    phone: '+48501502503',
    submittedAt: '2026-11-01T09:05:00',
    consent: 'unknown',
    problems: [],
  })
})

test('etykieta i wartość w osobnych liniach (także z pustymi liniami między nimi)', () => {
  const parsed = parseLeadSource(`Źródło

Lead ID
K7Q2M9XA
Z reklamy
tak

gbraid
${GCLID}
E-mail
anna@interprint.pl
Kliknięcie
2026-10-31 14:02:11 Europe/Warsaw
Strona wejścia
/kontakt
utm_term
telefon kamera
Zgoda ad_storage
denied`)
  assert.equal(parsed?.leadId, 'K7Q2M9XA')
  assert.equal(parsed?.fromAds, true)
  assert.equal(parsed?.gbraid, GCLID)
  assert.equal(parsed?.email, 'anna@interprint.pl')
  assert.equal(parsed?.clickedAt, '2026-10-31T14:02:11')
  assert.equal(parsed?.landingPath, '/kontakt')
  assert.equal(parsed?.consent, 'denied')
  // wartość, która wygląda jak etykieta, jest wartością (etykieta ją wcześniej „zjadła")
  assert.equal(parsed?.utmTerm, 'telefon kamera')
  assert.equal(parsed?.phone, undefined)
})

test('kształty z dwukropkiem i spacjami', () => {
  const parsed = parseLeadSource(`ŹRÓDŁO:
Lead ID: K7Q2M9XA
gclid = ${GCLID}
Telefon   +48 600 100 200
utm_source:google`)
  assert.equal(parsed?.leadId, 'K7Q2M9XA')
  assert.equal(parsed?.gclid, GCLID)
  assert.equal(parsed?.phone, '+48 600 100 200')
  assert.equal(parsed?.utmSource, 'google')
})

test('treść z „E-MAIL" przed nagłówkiem: ostatnie wystąpienie nagłówka wyznacza początek', () => {
  const text = `E-MAIL: z-tresci@x.pl
Źródło danych: ankieta
ŹRÓDŁO
Źródło
Z reklamy\ttak
E-mail\tz-sekcji@x.pl`
  assert.equal(parseLeadSource(text)?.email, 'z-sekcji@x.pl')
  // nagłówek bez wierszy po sobie to brak sekcji, mimo „E-MAIL" wyżej
  assert.equal(parseLeadSource('E-MAIL: z-tresci@x.pl\nŹRÓDŁO\n'), null)
})

test('bez nagłówka czytamy całość', () => {
  const parsed = parseLeadSource('Lead ID\tK7Q2M9XA\nE-mail\ta@b.pl')
  assert.equal(parsed?.leadId, 'K7Q2M9XA')
  assert.equal(parsed?.email, 'a@b.pl')
})

test('brak sekcji zwraca null i nie rzuca', () => {
  assert.equal(parseLeadSource(''), null)
  assert.equal(parseLeadSource('   \n\n'), null)
  assert.equal(parseLeadSource('Dzień dobry,\nproszę o wycenę filmu.\nPozdrawiam'), null)
  assert.equal(parseLeadSource('ŹRÓDŁO\nnic tu nie ma'), null)
  assert.equal(parseLeadSource(undefined as unknown as string), null)
  assert.equal(parseLeadSource(null as unknown as string), null)
})

test('nieprawidłowy gclid: raportowany, niezapisany; „z reklamy" nadal prawda', () => {
  const parsed = parseLeadSource(`ŹRÓDŁO
Lead ID\tK7Q2M9XA
GCLID\tCj0KCQ jw x/Nm==
GBRAID\tkrótki
WBRAID\t${GCLID}`)
  assert.equal(parsed?.gclid, undefined)
  assert.equal(parsed?.gbraid, undefined)
  assert.equal(parsed?.wbraid, GCLID)
  assert.equal(parsed?.fromAds, true)
  assert.equal(parsed?.problems.length, 2)
  assert.match(parsed?.problems[0] ?? '', /gclid/)
  assert.match(parsed?.problems[1] ?? '', /gbraid/)
})

test('granice click id: 10 i 512 znaków', () => {
  const ok10 = 'a'.repeat(10)
  const ok512 = 'B'.repeat(512)
  assert.equal(parseLeadSource(`Źródło\ngclid ${ok10}`)?.gclid, ok10)
  assert.equal(parseLeadSource(`Źródło\ngclid ${ok512}`)?.gclid, ok512)
  assert.equal(parseLeadSource(`Źródło\ngclid ${'a'.repeat(9)}`)?.gclid, undefined)
  assert.equal(parseLeadSource(`Źródło\ngclid ${'a'.repeat(513)}`)?.gclid, undefined)
})

test('czas: format strony, zapis awaryjny ISO (UTC) i nieczytelny', () => {
  assert.equal(parseSourceTime('2026-10-31 14:22:19 Europe/Warsaw'), '2026-10-31T14:22:19')
  // po zmianie czasu (25.10.2026) Warszawa to UTC+1, latem UTC+2
  assert.equal(parseSourceTime('2026-10-31T13:22:19.123Z'), '2026-10-31T14:22:19')
  assert.equal(parseSourceTime('2026-07-15T10:00:00Z'), '2026-07-15T12:00:00')
  assert.equal(parseSourceTime('2026-10-31T23:30:00Z'), '2026-11-01T00:30:00')
  assert.equal(parseSourceTime('2026-07-15T12:00:00+02:00'), '2026-07-15T12:00:00')
  assert.equal(parseSourceTime('2026-10-31 14:22 Europe/Warsaw'), '2026-10-31T14:22:00')
  assert.equal(parseSourceTime('wczoraj'), null)
  assert.equal(parseSourceTime('2026-13-40 25:61:00 Europe/Warsaw'), null)

  const parsed = parseLeadSource(`ŹRÓDŁO
Kliknięcie\t2026-10-31T13:02:11.000Z
Wysłano\tkiedyś tam`)
  assert.equal(parsed?.clickedAt, '2026-10-31T14:02:11')
  assert.equal(parsed?.submittedAt, undefined, 'nieczytelny czas jest pomijany')
  assert.equal(parsed?.problems.length, 1)
  assert.match(parsed?.problems[0] ?? '', /Wysłano/)
})

test('polskie znaki i wielkość liter w etykietach: wielkie, małe, rozłożone (NFD), bez ogonków', () => {
  const variants = ['KLIKNIĘCIE', 'Kliknięcie', 'kliknięcie', 'klikniecie', 'Kliknięcie'.normalize('NFD')]
  variants.forEach((label) => {
    const parsed = parseLeadSource(`ŹRÓDŁO\n${label}\t2026-10-31 14:02:11 Europe/Warsaw`)
    assert.equal(parsed?.clickedAt, '2026-10-31T14:02:11', label)
  })
  ;['STRONA WEJŚCIA', 'Strona wejścia', 'strona wejscia', 'Strona wejścia'].forEach((label) => {
    assert.equal(parseLeadSource(`Źródło\n${label}\t/oferta`)?.landingPath, '/oferta', label)
  })
  ;['WYSŁANO', 'wyslano'].forEach((label) => {
    assert.equal(parseLeadSource(`Zrodlo\n${label}\t2026-10-31 14:22:19 Europe/Warsaw`)?.submittedAt, '2026-10-31T14:22:19', label)
  })
  assert.equal(parseLeadSource('ŹRÓDŁO\nzgoda AD_STORAGE\tGRANTED')?.consent, 'granted')
  assert.equal(parseLeadSource('ŹRÓDŁO\nUTM_SOURCE\tgoogle')?.utmSource, 'google')
})

test('zgoda: granted / denied, wszystko inne to unknown', () => {
  const consent = (value: string) => parseLeadSource(`ŹRÓDŁO\nZgoda ad_storage\t${value}`)?.consent
  assert.equal(consent('granted'), 'granted')
  assert.equal(consent('denied'), 'denied')
  assert.equal(consent('unknown'), 'unknown')
  assert.equal(consent('tak'), 'unknown')
  assert.equal(consent('GRANTED '), 'granted')
})

test('z reklamy: „tak" albo jakiekolwiek click id', () => {
  assert.equal(parseLeadSource('ŹRÓDŁO\nZ reklamy\ttak')?.fromAds, true)
  assert.equal(parseLeadSource('ŹRÓDŁO\nZ reklamy\tnie')?.fromAds, false)
  assert.equal(parseLeadSource(`ŹRÓDŁO\nwbraid\t${GCLID}`)?.fromAds, true)
  assert.equal(parseLeadSource('ŹRÓDŁO\nLead ID\tK7Q2M9XA')?.fromAds, undefined)
  assert.equal(parseLeadSource(`ŹRÓDŁO\nZ reklamy\tnie\ngclid\t${GCLID}`)?.fromAds, true)
})

test('etykieta nie łapie dłuższych słów (gclid vs gclidx) i końce linii Windows', () => {
  assert.equal(parseLeadSource('ŹRÓDŁO\ngclidx\tabcdefghijkl'), null)
  const parsed = parseLeadSource('ŹRÓDŁO\r\nLead ID\tK7Q2M9XA\r\nE-mail\ta@b.pl\r\n')
  assert.equal(parsed?.leadId, 'K7Q2M9XA')
  assert.equal(parsed?.email, 'a@b.pl')
})
