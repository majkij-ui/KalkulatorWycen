/**
 * Call sheet dnia (T5b): podpowiedzi z huba, poprawki, które zawsze wygrywają,
 * harmonogram z miękkim usuwaniem, tagi, szablon, kopia z innego dnia i import
 * dni z CallSheetWiz.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  addCategory,
  addContact,
  addExtraCrew,
  addGearExtra,
  addSubItem,
  applyDayTemplate,
  callSheetForDay,
  copyScheduleFrom,
  createCallSheet,
  importSavedDay,
  liveSchedule,
  moveScheduleItem,
  moveSubItem,
  nextStartMinutes,
  parseSavedDaysFile,
  patchClient,
  patchCrew,
  resolveCallSheet,
  restoreSheetItems,
  softDeleteCategory,
  softDeleteCrewEntry,
  softDeleteScheduleItem,
  softDeleteScheduleItems,
  addedScheduleIds,
  upsertScheduleItem,
  type CallSheetContext,
} from './call-sheet'
import { callSheetSchema, type CallSheet } from './call-sheet-types'
import { paletteKeyForHex, tagStyle, type PlannerEvent } from './schedule-types'
import type { CrewMember } from './crew-types'
import type { EquipmentItem, ProjectCost } from './project-types'

const NOW = new Date('2026-10-10T10:00:00.000Z')

function person(id: string, name: string, extra: Partial<CrewMember> = {}): CrewMember {
  return { id, name, roleIds: [], contact: {}, createdAt: '2026-01-01', updatedAt: '', ...extra }
}

function crew(id: string, extra: Partial<ProjectCost> = {}): ProjectCost {
  return { id, category: 'ekipa', unitCost: 800, quantity: 1, dayId: 'd1', ...extra }
}

function item(id: string, name: string, category = 'kamery'): EquipmentItem {
  return { id, name, category, purchasePrice: 0, rentalDayRate: 0, notes: '' } as EquipmentItem
}

const people = [
  person('cm-ola', 'Ola Nowak', { contact: { phone: '600 100 200', email: 'ola@example.com' } }),
  person('cm-piotr', 'Piotr Wiśniewski', { contact: { phone: '700 300 400' } }),
  person('cm-gone', 'Ex Osoba', { contact: { phone: '111' }, deletedAt: '2026-09-01' }),
]

const costs: ProjectCost[] = [
  crew('c-ola', { person: 'Ola Nowak', personId: 'cm-ola', role: 'Operator B' }),
  crew('c-piotr', { person: 'piotr wisniewski', role: 'Gafer' }), // bez personId: dopasowanie po imieniu
  crew('c-slot', { person: '', role: 'Dźwiękowiec' }), // do obsadzenia
  crew('c-gone', { person: 'Ex Osoba', personId: 'cm-gone', role: 'MUA' }),
  crew('c-deleted', { person: 'Usunięty', deletedAt: '2026-10-01' }),
  crew('c-other-day', { person: 'Inny dzień', dayId: 'd2' }),
  { id: 'c-catering', category: 'catering', unitCost: 300, dayId: 'd1' },
]

function context(extra: Partial<CallSheetContext> = {}): CallSheetContext {
  return {
    project: {
      id: 'p1',
      name: 'Tchibo — spot jesień',
      client: 'Tchibo',
      contact: { name: 'Anna Kowalska', email: 'anna@tchibo.example', phone: '500 000 000' },
      costs,
    },
    day: {
      id: 'd1',
      lines: [
        { itemId: 'fx3', qty: 2 },
        { itemId: 'lamp', qty: 1 },
        { itemId: 'gone', qty: 1 },
      ],
    },
    date: '2026-10-28',
    dayLabel: 'Dzień 1',
    event: { data: { location: 'Studio Poznań' } },
    people,
    catalog: [item('fx3', 'Sony FX3'), item('lamp', 'Aputure 600d', 'swiatlo')],
    ...extra,
  }
}

function plannerEvent(id: string, start: number, end: number, extra: Partial<PlannerEvent> = {}): PlannerEvent {
  return { id, title: id, startMinutes: start, endMinutes: end, categoryId: '', ...extra }
}

const blank = () => createCallSheet({ projectId: 'p1', dayId: 'd1' }, NOW)

test('nowy call sheet: domyślne tagi, pusty harmonogram, przechodzi przez schemat bez zmian', () => {
  const sheet = blank()
  assert.equal(sheet.schedule.length, 0)
  assert.deepEqual(
    sheet.categories.map((c) => c.id),
    ['camera', 'talent', 'art', 'logistics', 'meals']
  )
  assert.deepEqual(callSheetSchema.parse(sheet), sheet)
})

test('podpowiedzi z huba: data, miejsce z kalendarza, ekipa z telefonami, klient, lista pakowania', () => {
  const resolved = resolveCallSheet(blank(), context())
  assert.equal(resolved.title, 'Tchibo — spot jesień')
  assert.equal(resolved.date, '2026-10-28')
  assert.deepEqual(resolved.location, { value: 'Studio Poznań', base: 'Studio Poznań', own: false })

  assert.deepEqual(
    resolved.crew.map((r) => [r.key, r.value.name, r.value.role, r.value.phone, r.value.email]),
    [
      ['c-ola', 'Ola Nowak', 'Operator B', '600 100 200', 'ola@example.com'],
      ['c-piotr', 'piotr wisniewski', 'Gafer', '700 300 400', ''],
      ['c-slot', '', 'Dźwiękowiec', '', ''],
      ['c-gone', 'Ex Osoba', 'MUA', '', ''],
    ],
    'tylko żywa ekipa tego dnia; osoba usunięta z bazy zostaje z imieniem, bez kontaktu'
  )
  assert.equal(resolved.crew[1].personId, 'cm-piotr')

  assert.deepEqual(resolved.client.value, { name: 'Anna Kowalska', phone: '500 000 000', email: 'anna@tchibo.example' })
  assert.equal(resolved.client.client, 'Tchibo')

  assert.deepEqual(
    resolved.packing.map((g) => [g.category, g.items.map((i) => `${i.qty}× ${i.item.name}`)]),
    [
      ['kamery', ['2× Sony FX3']],
      ['swiatlo', ['1× Aputure 600d']],
    ]
  )
})

test('poprawki z call sheetu wygrywają, wyczyszczone pole wraca do wartości z huba', () => {
  let sheet = blank()
  sheet = patchCrew(sheet, { costId: 'c-ola' }, { phone: '+48 999 888 777', callTime: 6 * 60 })
  sheet = patchCrew(sheet, { costId: 'c-slot' }, { name: 'Kuba (zastępstwo)' })
  sheet = { ...sheet, location: 'Hala 3, ul. Fabryczna 1', callTime: 7 * 60 }
  sheet = patchClient(sheet, { phone: '501 501 501' })

  let resolved = resolveCallSheet(sheet, context())
  const ola = resolved.crew[0]
  assert.equal(ola.value.phone, '+48 999 888 777')
  assert.equal(ola.base.phone, '600 100 200', 'podpowiedź z bazy zostaje widoczna')
  assert.deepEqual([ola.own.phone, ola.own.name], [true, false])
  assert.deepEqual([ola.callTime, ola.ownCallTime], [360, true])
  assert.deepEqual([resolved.crew[1].callTime, resolved.crew[1].ownCallTime], [420, false], 'reszta: ogólna zbiórka')
  assert.equal(resolved.crew[2].value.name, 'Kuba (zastępstwo)')
  assert.deepEqual(resolved.location, { value: 'Hala 3, ul. Fabryczna 1', base: 'Studio Poznań', own: true })
  assert.equal(resolved.client.value.phone, '501 501 501')

  // Zmiana w hubie (nowy telefon w bazie) nie nadpisuje poprawki; czyszczenie ją zdejmuje.
  const changed = context({
    people: people.map((p) => (p.id === 'cm-ola' ? { ...p, contact: { phone: '600 000 001' } } : p)),
  })
  assert.equal(resolveCallSheet(sheet, changed).crew[0].value.phone, '+48 999 888 777')
  sheet = patchCrew(sheet, { costId: 'c-ola' }, { phone: '' })
  resolved = resolveCallSheet(sheet, changed)
  assert.equal(resolved.crew[0].value.phone, '600 000 001')
  assert.equal(sheet.crew.filter((e) => e.costId === 'c-ola').length, 1, 'jeden wpis poprawek na wiersz')
  assert.equal('phone' in sheet.crew[0], false)
  sheet = patchClient(sheet, { phone: '' })
  assert.equal(sheet.client, undefined)
})

test('osoby tylko na call sheecie, ukrywanie i miękkie usuwanie; poprawka po zniknięciu wiersza zostaje w pliku', () => {
  let sheet = blank()
  const added = addExtraCrew(sheet, { name: 'Marta (agencja)', role: 'Klient na planie', phone: '502' })
  sheet = added.sheet
  sheet = patchCrew(sheet, { costId: 'c-piotr' }, { hidden: true })
  sheet = patchCrew(sheet, { costId: 'c-deleted' }, { note: 'osierocona' })

  let resolved = resolveCallSheet(sheet, context())
  assert.deepEqual(
    resolved.crew.map((r) => [r.key, r.hidden, r.extra]),
    [
      ['c-ola', false, false],
      ['c-piotr', true, false],
      ['c-slot', false, false],
      ['c-gone', false, false],
      [added.id, false, true],
    ]
  )
  assert.equal(sheet.crew.length, 3, 'poprawka do usuniętego kosztu nie zniknęła z pliku')

  sheet = patchCrew(sheet, { costId: 'c-piotr' }, { hidden: false })
  assert.equal(resolveCallSheet(sheet, context()).crew[1].hidden, false)

  const at = '2026-10-10T12:00:00.000Z'
  sheet = softDeleteCrewEntry(sheet, added.id, at)
  resolved = resolveCallSheet(sheet, context())
  assert.equal(resolved.crew.some((r) => r.extra), false)
  assert.equal(resolveCallSheet(restoreSheetItems(sheet, at), context()).crew.some((r) => r.extra), true)
})

test('zbiórka: własna, inaczej początek pierwszego wpisu; koniec dnia = koniec ostatniego', () => {
  let sheet = blank()
  assert.equal(resolveCallSheet(sheet, context()).callTime, null)
  sheet = upsertScheduleItem(sheet, plannerEvent('b', 540, 600))
  sheet = upsertScheduleItem(sheet, plannerEvent('a', 450, 480))
  let resolved = resolveCallSheet(sheet, context())
  assert.deepEqual([resolved.callTime, resolved.ownCallTime, resolved.wrapTime], [450, false, 600])
  assert.deepEqual(
    resolved.schedule.map((e) => e.id),
    ['a', 'b']
  )
  sheet = { ...sheet, callTime: 420 }
  resolved = resolveCallSheet(sheet, context())
  assert.deepEqual([resolved.callTime, resolved.ownCallTime], [420, true])
})

test('harmonogram: przeciąganie, miękkie usuwanie z „Cofnij", początek nowego wpisu', () => {
  let sheet = blank()
  assert.equal(nextStartMinutes(sheet), 360)
  sheet = upsertScheduleItem(sheet, plannerEvent('a', 420, 480, { notes: 'x', extra: 1 } as Partial<PlannerEvent>))
  sheet = upsertScheduleItem(sheet, plannerEvent('b', 480, 600))
  assert.equal(nextStartMinutes(sheet), 600)

  sheet = moveScheduleItem(sheet, 'a', { startMinutes: 700 })
  assert.deepEqual([sheet.schedule[0].startMinutes, sheet.schedule[0].endMinutes], [700, 760])
  assert.equal((sheet.schedule[0] as Record<string, unknown>).extra, 1)
  sheet = moveScheduleItem(sheet, 'a', { endMinutes: 730 })
  assert.equal(sheet.schedule[0].endMinutes, 730)

  const at = '2026-10-10T12:00:00.000Z'
  sheet = softDeleteScheduleItem(sheet, 'b', at)
  assert.deepEqual(
    liveSchedule(sheet).map((e) => e.id),
    ['a']
  )
  assert.equal(sheet.schedule.length, 2, 'wpis zostaje w pliku')
  assert.equal(nextStartMinutes(sheet), 730)
  sheet = softDeleteScheduleItem(sheet, 'a', 'later')
  sheet = restoreSheetItems(sheet, at)
  assert.deepEqual(
    liveSchedule(sheet).map((e) => e.id),
    ['b'],
    '„Cofnij" przywraca tylko to, co usunięto z tym znacznikiem'
  )
  sheet = restoreSheetItems(sheet, 'later')
  assert.deepEqual(
    liveSchedule(sheet).map((e) => e.id),
    ['b', 'a']
  )
  assert.equal('deletedAt' in sheet.schedule[1], false)
})

test('cofnięcie szablonu: dopisane wpisy znikają miękko, wcześniejsze zostają', () => {
  const before = upsertScheduleItem(blank(), plannerEvent('own', 400, 420))
  const after = applyDayTemplate(before, 420)
  const ids = addedScheduleIds(before, after)
  assert.equal(ids.length, 6)
  assert.ok(!ids.includes('own'))
  const undone = softDeleteScheduleItems(after, ids, 'x')
  assert.deepEqual(
    liveSchedule(undone).map((e) => e.id),
    ['own']
  )
  assert.equal(undone.schedule.length, 7, 'wpisy szablonu zostają w pliku')
})

test('punkty pod wpisem: dodawanie bez pustych, przesuwanie w granicach listy', () => {
  let event = plannerEvent('a', 420, 480)
  event = addSubItem(event, '  ')
  assert.equal(event.subItems, undefined)
  event = addSubItem(addSubItem(addSubItem(event, 'Packshot'), 'Wywiad'), 'B-roll')
  const ids = event.subItems!.map((s) => s.id)
  assert.deepEqual(
    moveSubItem(event, ids[2], -1).subItems!.map((s) => s.text),
    ['Packshot', 'B-roll', 'Wywiad']
  )
  assert.equal(moveSubItem(event, ids[0], -1), event)
  assert.equal(moveSubItem(event, ids[2], 1), event)
})

test('tagi: bez duplikatów nazw; usunięty tag zostaje w pliku, a wpis pokazuje się jako „bez tagu"', () => {
  let sheet = blank()
  assert.equal(addCategory(sheet, 'kamera', 'blue'), sheet, 'ta sama nazwa (bez wielkości liter)')
  assert.equal(addCategory(sheet, '   ', 'blue'), sheet)
  sheet = addCategory(sheet, 'Dron', 'blue')
  const drone = sheet.categories[sheet.categories.length - 1]
  assert.deepEqual([drone.label, drone.color], ['Dron', 'blue'])

  sheet = upsertScheduleItem(sheet, plannerEvent('a', 420, 480, { categoryId: 'camera' }))
  const at = '2026-10-10T12:00:00.000Z'
  sheet = softDeleteCategory(sheet, 'camera', at)
  const resolved = resolveCallSheet(sheet, context())
  assert.equal(resolved.categories.some((c) => c.id === 'camera'), false)
  assert.equal(resolved.schedule[0].categoryId, 'camera', 'wpis nie traci tagu')
  assert.equal(tagStyle(sheet.categories.find((c) => c.id === 'camera')).label, 'Bez tagu')
  assert.equal(tagStyle(restoreSheetItems(sheet, at).categories.find((c) => c.id === 'camera')).label, 'Kamera')
  assert.equal(addCategory(sheet, 'Kamera', 'cyan').categories.length, sheet.categories.length + 1)
})

test('szablon dnia od zbiórki; brakujące domyślne tagi wracają, usunięte zostają usunięte', () => {
  let sheet: CallSheet = { ...blank(), categories: blank().categories.filter((c) => c.id !== 'meals') }
  sheet = softDeleteCategory(sheet, 'logistics', '2026-10-10T12:00:00.000Z')
  sheet = applyDayTemplate(sheet, 8 * 60)
  const schedule = liveSchedule(sheet)
  assert.equal(schedule[0].startMinutes, 480)
  assert.equal(schedule[schedule.length - 1].endMinutes, 480 + 30 + 60 + 210 + 60 + 180 + 60)
  for (let i = 1; i < schedule.length; i += 1) assert.equal(schedule[i].startMinutes, schedule[i - 1].endMinutes)
  assert.ok(sheet.categories.some((c) => c.id === 'meals' && !c.deletedAt), 'brakujący tag dochodzi')
  assert.equal(schedule.find((e) => e.title === 'Obiad')!.categoryId, 'meals')
  assert.equal(schedule[0].categoryId, '', 'tag usunięty przez użytkownika nie wraca')
})

test('kopia harmonogramu z innego dnia: nowe id, punkty bez odhaczeń, tagi po id albo nazwie, nic nie nadpisuje', () => {
  let source: CallSheet = { ...blank(), id: 'src', callTime: 360, locationNotes: 'Parking od podwórza' }
  source = addCategory(source, 'Dron', 'blue')
  const droneId = source.categories[source.categories.length - 1].id
  source = upsertScheduleItem(
    source,
    plannerEvent('s1', 420, 480, {
      categoryId: droneId,
      subItems: [{ id: 'x', text: 'Ujęcie z góry', isCompleted: true }],
    })
  )
  source = upsertScheduleItem(source, plannerEvent('s2', 480, 540, { categoryId: 'camera' }))
  source = softDeleteScheduleItem(upsertScheduleItem(source, plannerEvent('s3', 600, 660)), 's3', 'x')

  let target: CallSheet = { ...blank(), callTime: 450 }
  target = addCategory(target, 'dron', 'lime') // ta sama nazwa, inny kolor
  const { sheet, added } = copyScheduleFrom(target, source)
  assert.equal(added, 2)
  const copied = liveSchedule(sheet)
  assert.ok(copied.every((e) => !['s1', 's2'].includes(e.id)))
  assert.equal(copied[0].categoryId, target.categories[target.categories.length - 1].id, 'tag celu o tej nazwie')
  assert.equal(copied[1].categoryId, 'camera')
  assert.equal(copied[0].subItems![0].isCompleted, false)
  assert.equal(sheet.categories.length, target.categories.length, 'nic się nie zdublowało')
  assert.equal(sheet.callTime, 450, 'zbiórka celu zostaje')
  assert.equal(sheet.locationNotes, 'Parking od podwórza', 'puste pole celu dostaje wartość')
})

test('call sheet dnia: jeden na dzień, starszy wygrywa, usunięte się nie liczą', () => {
  const a = { ...blank(), id: 'a', createdAt: '2026-10-02' }
  const b = { ...blank(), id: 'b', createdAt: '2026-10-01' }
  const gone = { ...blank(), id: 'gone', createdAt: '2026-09-01', deletedAt: '2026-10-03' }
  const other = { ...blank(), id: 'other', dayId: 'd2', createdAt: '2026-01-01' }
  assert.equal(callSheetForDay([a, b, gone, other], 'p1', 'd1')?.id, 'b')
  assert.equal(callSheetForDay([a, b], 'p2', 'd1'), null)
  assert.equal(callSheetForDay([gone], 'p1', 'd1'), null)
})

test('rzeczy spoza katalogu i kontakty dnia: puste się nie dodają, usuwanie miękkie', () => {
  let sheet = addGearExtra(addGearExtra(blank(), '  '), 'Baterie AA × 12')
  const contact = addContact(sheet, { label: 'Lokacja', name: 'Pan Zenon', phone: '601' })
  sheet = contact.sheet
  const resolved = resolveCallSheet(sheet, context())
  assert.deepEqual(
    resolved.gearExtra.map((g) => g.text),
    ['Baterie AA × 12']
  )
  assert.deepEqual(
    resolved.contacts.map((c) => [c.label, c.name, c.phone]),
    [['Lokacja', 'Pan Zenon', '601']]
  )
  assert.deepEqual(callSheetSchema.parse(sheet), sheet)
})

// ── Import z CallSheetWiz ────────────────────────────────────────────────────

const exportFile = JSON.stringify([
  {
    id: 'cw-day-1',
    dayTitle: 'Day 1 - Studio Shoot',
    date: '2026-07-19T10:00:00.000Z',
    events: [
      {
        id: '1',
        title: 'Crew Call & Safety Briefing',
        startMinutes: 360,
        endMinutes: 390,
        categoryId: 'camera',
        notes: 'All departments report to base camp',
        subItems: [{ id: 's1', text: 'Walkie check', isCompleted: true }],
      },
      { id: '2', title: 'Drone', startMinutes: 400, endMinutes: 460, categoryId: 'uuid-drone' },
      { id: '3', title: 'Bez tagu', startMinutes: 460, endMinutes: 470, categoryId: 'missing' },
      { id: '4', title: 'Przerwa', startMinutes: 470, endMinutes: 500, categoryId: 'uuid-breaks' },
      { id: 'broken', title: 'Bez czasu', categoryId: 'camera' },
    ],
    categories: [
      { id: 'camera', label: 'Camera', color: '#00f3ff' },
      { id: 'uuid-drone', label: 'Drone', color: '#ff6700' },
      { id: 'uuid-gray', label: 'Misc', color: '#94a3b8' },
      { id: 'uuid-breaks', label: 'przerwy', color: '#39ff14' },
    ],
  },
  { id: 'not-a-day' },
])

test('plik CallSheetWiz: lista dni albo jeden dzień, uszkodzone wpisy znikają, obce pliki → null', () => {
  const days = parseSavedDaysFile(exportFile)
  assert.equal(days?.length, 1)
  assert.deepEqual(
    days![0].events.map((e) => e.id),
    ['1', '2', '3', '4']
  )
  assert.equal(parseSavedDaysFile(JSON.stringify(JSON.parse(exportFile)[0]))?.length, 1)
  assert.deepEqual(parseSavedDaysFile('[]'), [])
  assert.equal(parseSavedDaysFile('{"items": []}'), null)
  assert.equal(parseSavedDaysFile('to nie JSON'), null)
})

test('import dnia z CallSheetWiz: stary harmonogram miękko usunięty, tagi bez duplikatów, kolory na palecie', () => {
  let target = blank()
  target = upsertScheduleItem(target, plannerEvent('1', 600, 660, { title: 'Stary wpis' }))
  const [day] = parseSavedDaysFile(exportFile)!
  const result = importSavedDay(target, day, NOW)
  const sheet = result.sheet
  assert.deepEqual([result.added, result.replaced], [4, 1])

  const schedule = liveSchedule(sheet)
  assert.deepEqual(
    schedule.map((e) => e.title),
    ['Crew Call & Safety Briefing', 'Drone', 'Bez tagu', 'Przerwa']
  )
  assert.notEqual(schedule[0].id, '1', 'kolizja id z wpisem w pliku → nowe id')
  assert.equal(schedule[1].id, '2')
  assert.equal(schedule[0].categoryId, 'camera', 'tag o tym samym id już był — „Kamera" zostaje')
  assert.equal(schedule[0].subItems![0].text, 'Walkie check')
  assert.equal(schedule[2].categoryId, '')
  assert.equal(schedule[3].categoryId, 'meals', 'tag o tej samej nazwie (bez wielkości liter) zamiast nowego')
  assert.equal(sheet.categories.some((c) => c.id === 'uuid-breaks'), false)

  const drone = sheet.categories.find((c) => c.id === 'uuid-drone')!
  assert.deepEqual([drone.label, drone.color, drone.importedColor], ['Drone', 'orange', '#ff6700'])
  const gray = sheet.categories.find((c) => c.id === 'uuid-gray')!
  assert.equal(gray.color, '', 'szary bez odcienia → neutralny')
  assert.equal(sheet.categories.filter((c) => c.id === 'camera').length, 1)
  assert.equal(sheet.categories.find((c) => c.id === 'camera')!.label, 'Kamera')

  assert.equal(sheet.title, 'Day 1 - Studio Shoot')
  assert.deepEqual(sheet.importedFrom, {
    type: 'callsheetwiz',
    id: 'cw-day-1',
    title: 'Day 1 - Studio Shoot',
    date: '2026-07-19T10:00:00.000Z',
    at: NOW.toISOString(),
  })
  assert.equal(liveSchedule(restoreSheetItems(sheet, result.deletedAt)).length, 5, '„Cofnij" przywraca stary wpis')
  assert.deepEqual(callSheetSchema.parse(sheet), sheet)

  const titled = importSavedDay({ ...blank(), title: 'Mój tytuł' }, day, NOW).sheet
  assert.equal(titled.title, 'Mój tytuł', 'własny tytuł zostaje')
  const untitled = importSavedDay(blank(), { ...day, dayTitle: 'Untitled Shoot' }, NOW).sheet
  assert.equal(untitled.title, undefined)
})

test('kolory z CallSheetWiz → najbliższy slot palety; szary i śmieci → neutralny', () => {
  assert.deepEqual(
    ['#00f3ff', '#39ff14', '#ff00ff', '#ff6700', '#ff003c', '#9d00ff', '#f3ff00', '#0078ff'].map(paletteKeyForHex),
    ['cyan', 'lime', 'magenta', 'orange', 'coral', 'violet', 'lemon', 'blue']
  )
  assert.equal(paletteKeyForHex('#ff0078'), 'rose', 'odcień 5° jest bliżej 355° (rose) niż 25° (coral) — koło barw się zamyka')
  assert.equal(paletteKeyForHex('#94a3b8'), null)
  assert.equal(paletteKeyForHex('nope'), null)
})

test('schemat: pola z nowszej wersji przeżywają, uszkodzony wpis listy znika, reszta zostaje', () => {
  const raw = {
    ...blank(),
    future: { a: 1 },
    schedule: [plannerEvent('ok', 420, 480, { future: true } as Partial<PlannerEvent>), { id: 'bad', title: 'x' }],
    crew: [{ id: 'c', costId: 'c-ola', phone: '1', callTime: 'rano' }],
  }
  const parsed = callSheetSchema.parse(raw) as CallSheet & Record<string, unknown>
  assert.deepEqual(parsed.future, { a: 1 })
  assert.deepEqual(
    parsed.schedule.map((e) => e.id),
    ['ok']
  )
  assert.equal((parsed.schedule[0] as Record<string, unknown>).future, true)
  assert.equal(parsed.crew[0].callTime, undefined, 'zła godzina nie psuje wpisu')
  assert.equal(callSheetSchema.safeParse({ id: 'x', projectId: 'p1' }).success, false, 'bez dnia nie ma call sheetu')
})

test('osoba scalona w Ekipie (S2): wiersz z id duplikatu bierze kontakt osoby, która została', () => {
  const merged = [
    ...people,
    person('cm-ola2', 'Ola N.', { deletedAt: '2026-10-13', mergedInto: 'cm-ola' }),
  ]
  const ctx = context({
    people: merged,
    project: { ...context().project, costs: [crew('c-x', { person: 'Ola N.', personId: 'cm-ola2', role: 'Operator' })] },
  })
  const [row] = resolveCallSheet(blank(), ctx).crew
  assert.equal(row.personId, 'cm-ola')
  assert.equal(row.value.name, 'Ola N.', 'imię z wiersza zostaje')
  assert.equal(row.value.phone, '600 100 200')
})
