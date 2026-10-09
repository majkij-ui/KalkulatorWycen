import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  decisionRecord,
  defaultTarget,
  draftFromProposal,
  proposalWithDraft,
  eventFromProposal,
  groupProposals,
  newProjectFieldsFor,
  pendingProposals,
  projectPatchFromFields,
  proposalProblems,
  similarEvents,
  statusAfter,
  suggestProjects,
  acceptedNewProjectId,
  type PendingProposal,
} from './inbox'
import {
  INBOX_FORMAT,
  INBOX_VERSION,
  inboxDecisionSchema,
  parseInboxFile,
  proposalSchema,
  refMessageId,
  type InboxDecision,
  type ParsedInboxFile,
  type Proposal,
} from './inbox-types'
import { validateInboxDraft, type StrictContext } from './inbox-validate'
import { eventSchema, type TimelineEvent } from './event-types'
import { projectSchema, type Project } from './project-types'

const NOW = new Date('2026-10-09T12:00:00Z')

const ev = (extra: Record<string, unknown> = {}): TimelineEvent =>
  eventSchema.parse({
    id: 'ev-1',
    kind: 'lead_in',
    projectId: null,
    start: '2026-09-29',
    title: '',
    source: { type: 'manual' },
    ...extra,
  })

const project = (extra: Record<string, unknown> = {}): Project =>
  projectSchema.parse({
    id: 'p-1',
    name: 'Projekt',
    client: '',
    status: 'quote',
    date: '2026-09-01',
    createdAt: '',
    updatedAt: '',
    quote: null,
    financials: null,
    equipment: [],
    notes: '',
    ...extra,
  })

const proposal = (extra: Record<string, unknown> = {}): Proposal =>
  proposalSchema.parse({
    type: 'event',
    id: 'pr-1',
    ref: 'gmail:aaa',
    event: { kind: 'reply_sent', start: '2026-10-02T11:25', title: 'Odpowiedź' },
    ...extra,
  })

const file = (name: string, proposals: unknown[], extra: Record<string, unknown> = {}): ParsedInboxFile =>
  parseInboxFile(name, { format: INBOX_FORMAT, version: INBOX_VERSION, note: '', proposals, ...extra })

const pending = (p: Proposal, fileName = 'a.json'): PendingProposal => ({ key: p.ref, file: fileName, proposal: p })

const decision = (ref: string, value: string, extra: Record<string, unknown> = {}): InboxDecision =>
  inboxDecisionSchema.parse({ id: ref, ref, decision: value, at: '2026-10-09T10:00:00Z', ...extra })

// ── Format pliku ─────────────────────────────────────────────────────────────

test('plik skrzynki: zła propozycja odpada i jest liczona, reszta zostaje z nieznanymi polami', () => {
  const parsed = file('2026-10-09-a.json', [
    { type: 'event', id: 'a', ref: 'gmail:1', event: { kind: 'lead_in', start: '2026-09-29' }, futureKey: 7 },
    { type: 'event', id: 'b', ref: 'gmail:2', event: { kind: 'lead_in', start: 'wczoraj' } },
    { type: 'teleport', id: 'c', ref: 'gmail:3' },
  ])
  assert.equal(parsed.status, 'ok')
  if (parsed.status !== 'ok') return
  assert.equal(parsed.proposals.length, 1)
  assert.equal(parsed.unreadable, 2)
  assert.equal((parsed.proposals[0] as Record<string, unknown>).futureKey, 7)
})

test('plik w nowszej wersji nie jest przetwarzany, obcy plik to błąd', () => {
  assert.deepEqual(file('n.json', [], { version: INBOX_VERSION + 1 }), {
    name: 'n.json',
    status: 'newer',
    version: INBOX_VERSION + 1,
  })
  assert.equal(parseInboxFile('x.json', { items: [] }).status, 'error')
  assert.equal(parseInboxFile('x.json', null).status, 'error')
})

test('refMessageId zdejmuje źródło i przyrostek faktu', () => {
  assert.equal(refMessageId('gmail:1a0ed32e9dbdccf1#reply'), '1a0ed32e9dbdccf1')
  assert.equal(refMessageId('gmail:abc'), 'abc')
})

// ── Co czeka ─────────────────────────────────────────────────────────────────

test('propozycja nie wraca: wydarzenie z tym ref (także usunięte) albo decyzja', () => {
  const files = [
    file('a.json', [
      { type: 'event', id: '1', ref: 'gmail:live', event: { kind: 'lead_in', start: '2026-09-29' } },
      { type: 'event', id: '2', ref: 'gmail:deleted', event: { kind: 'lead_in', start: '2026-09-29' } },
      { type: 'event', id: '3', ref: 'gmail:rejected', event: { kind: 'lead_in', start: '2026-09-29' } },
      { type: 'event', id: '4', ref: 'gmail:reopened', event: { kind: 'lead_in', start: '2026-09-29' } },
      { type: 'event', id: '5', ref: 'gmail:new', event: { kind: 'lead_in', start: '2026-09-29' } },
    ]),
  ]
  const events = [
    ev({ id: 'e1', source: { type: 'gmail', ref: 'gmail:live' } }),
    ev({ id: 'e2', source: { type: 'gmail', ref: 'gmail:deleted' }, deletedAt: '2026-10-01T00:00:00Z' }),
  ]
  const result = pendingProposals(files, events, [decision('gmail:rejected', 'rejected'), decision('gmail:reopened', 'reopened')])
  assert.deepEqual(
    result.pending.map((p) => p.key),
    ['gmail:reopened', 'gmail:new']
  )
  assert.equal(result.handled, 3)
})

test('ten sam ref w dwóch plikach: liczy się wcześniejszy plik', () => {
  const p = { type: 'event', id: '1', ref: 'gmail:x', event: { kind: 'lead_in', start: '2026-09-29' } }
  const result = pendingProposals([file('b.json', [p]), file('a.json', [p])], [], [])
  assert.equal(result.pending.length, 1)
  assert.equal(result.pending[0].file, 'a.json')
  assert.equal(result.duplicates, 1)
})

// ── Grupy ────────────────────────────────────────────────────────────────────

test('grupy po wątku; propozycja z newProject trafia do grupy nowego projektu', () => {
  const a = proposal({ id: 'n', ref: 'gmail:t1#project', type: 'project_new', threadId: 't1', project: { name: 'Tchibo' } })
  const b = proposal({ id: 'l', ref: 'gmail:t1', threadId: 't1', event: { kind: 'lead_in', start: '2026-09-29T14:45' } })
  const c = proposal({ id: 'r', ref: 'gmail:r2', newProject: 'n', event: { kind: 'reply_sent', start: '2026-10-02T11:25' } })
  const d = proposal({ id: 'x', ref: 'gmail:other', client: 'XL', event: { kind: 'lead_in', start: '2026-09-01' } })
  const u = proposal({ id: 'u', ref: 'gmail:t1#contact', threadId: 't1', type: 'project_update', set: { leadSource: 'google_ads' } })
  const groups = groupProposals([pending(c), pending(u), pending(b), pending(d), pending(a)])
  assert.equal(groups.length, 2)
  assert.deepEqual(
    groups[0].items.map((i) => i.proposal.id),
    ['n', 'l', 'r', 'u']
  )
  assert.equal(groups[0].threadId, 't1')
  assert.equal(groups[1].client, 'XL')
})

// ── Dopasowanie ──────────────────────────────────────────────────────────────

test('podpowiedzi projektu: wątek > e-mail > domena > klient; skrzynki ogólne się nie liczą', () => {
  const projects = [
    project({ id: 'p-thread', client: 'Inny' }),
    project({ id: 'p-mail', client: 'Inny', contact: { name: '', email: 'Lea@Tchibo.de', phone: '' } }),
    project({ id: 'p-domain', client: 'Inny', contact: { name: '', email: 'boss@tchibo.de', phone: '' } }),
    project({ id: 'p-client', client: 'TCHIBO ' }),
    project({ id: 'p-gmail', client: 'Inny', contact: { name: '', email: 'kto@gmail.com', phone: '' } }),
  ]
  const events = [
    ev({ id: 'e', projectId: 'p-thread', source: { type: 'import', ref: 'gmail:t1#reply' } }),
    ev({ id: 'gone', projectId: 'p-gmail', source: { type: 'gmail', ref: 'gmail:t1' }, deletedAt: 'x' }),
  ]
  const [group] = groupProposals([
    pending(proposal({ ref: 'gmail:m9', threadId: 't1', client: 'Tchibo', email: 'lea@tchibo.de' })),
    pending(proposal({ id: 'pr-2', ref: 'gmail:m10', threadId: 't1', email: 'ktos@gmail.com' })),
  ])
  assert.deepEqual(suggestProjects(group, projects, events), [
    { projectId: 'p-thread', reason: 'thread' },
    { projectId: 'p-mail', reason: 'email' },
    { projectId: 'p-domain', reason: 'domain' },
    { projectId: 'p-client', reason: 'client' },
  ])
})

test('projekt wskazany przez Claude’a wygrywa, nieistniejący jest pomijany', () => {
  const [group] = groupProposals([pending(proposal({ projectId: 'p-1' })), pending(proposal({ id: 'b', ref: 'gmail:b', projectId: 'p-x' }))])
  assert.deepEqual(suggestProjects(group, [project()], []), [{ projectId: 'p-1', reason: 'claude' }])
})

test('domyślny cel grupy', () => {
  const lead = proposal({ event: { kind: 'lead_in', start: '2026-09-29' } })
  const [g] = groupProposals([pending(lead)])
  assert.deepEqual(defaultTarget(g, [], 'p-new'), { type: 'existing', projectId: 'p-new' })
  assert.deepEqual(defaultTarget(g, [{ projectId: 'p-1', reason: 'claude' }], null), { type: 'existing', projectId: 'p-1' })
  assert.deepEqual(defaultTarget(g, [{ projectId: 'p-1', reason: 'thread' }], null), { type: 'existing', projectId: 'p-1' })
  // Dwa projekty z tym samym e-mailem (stały klient) — wybór należy do użytkownika.
  assert.deepEqual(
    defaultTarget(g, [{ projectId: 'p-1', reason: 'email' }, { projectId: 'p-2', reason: 'email' }], null),
    { type: 'unset' }
  )
  // Sama domena / klient tylko podpowiada.
  assert.deepEqual(defaultTarget(g, [{ projectId: 'p-1', reason: 'client' }], null), { type: 'unset' })

  const fake = proposal({ projectId: null, event: { kind: 'lead_in', start: '2026-09-29' } })
  assert.deepEqual(defaultTarget(groupProposals([pending(fake)])[0], [], null), { type: 'none' })

  const withNew = groupProposals([
    pending(proposal({ id: 'n', ref: 'gmail:t#project', type: 'project_new', threadId: 't', project: { name: 'Tchibo Event', client: 'Tchibo' } })),
    pending(proposal({ ref: 'gmail:t', threadId: 't', event: { kind: 'lead_in', start: '2026-09-29' } })),
  ])[0]
  const target = defaultTarget(withNew, [], null)
  assert.equal(target.type, 'new')
  if (target.type === 'new') {
    assert.equal(target.fields.name, 'Tchibo Event')
    assert.equal(target.fromRef, 'gmail:t#project')
  }
})

test('nowy projekt przyjęty wcześniej przejmuje resztę wątku', () => {
  const files = [
    file('a.json', [
      { type: 'project_new', id: 'n', ref: 'gmail:t#project', project: { name: 'X' } },
      { type: 'event', id: 'r', ref: 'gmail:r', newProject: 'n', event: { kind: 'reply_sent', start: '2026-10-02' } },
    ]),
  ]
  const { pending: waiting } = pendingProposals(files, [], [decision('gmail:t#project', 'accepted', { projectId: 'p-made' })])
  const [group] = groupProposals(waiting)
  assert.equal(acceptedNewProjectId(group, files, [decision('gmail:t#project', 'accepted', { projectId: 'p-made' })]), 'p-made')
  assert.equal(acceptedNewProjectId(group, files, [decision('gmail:t#project', 'rejected')]), null)

  // Ten sam wątek bez jawnego `newProject` też trafia do założonego projektu.
  const threaded = [
    file('b.json', [
      { type: 'project_new', id: 'n', ref: 'gmail:t2#project', threadId: 't2', project: { name: 'Y' } },
      { type: 'event', id: 'l', ref: 'gmail:t2', threadId: 't2', event: { kind: 'lead_in', start: '2026-10-02' } },
    ]),
  ]
  const done = [decision('gmail:t2#project', 'accepted', { projectId: 'p-y' })]
  const [lead] = groupProposals(pendingProposals(threaded, [], done).pending)
  assert.equal(acceptedNewProjectId(lead, threaded, done), 'p-y')
})

test('pola nowego projektu z leada: klient, data, kontakt, pochodzenie z kampanii', () => {
  const [group] = groupProposals([
    pending(
      proposal({
        client: 'S&A jewellery design',
        event: {
          kind: 'lead_in',
          start: '2026-10-06T11:44',
          title: 'S&A',
          data: { campaignId: 'cmp-1', contactName: 'Martyna', email: 'm@sa.pl' },
        },
      })
    ),
  ])
  assert.deepEqual(newProjectFieldsFor(group, [{ id: 'cmp-1', platform: 'google_ads' }]).fields, {
    name: 'S&A jewellery design',
    client: 'S&A jewellery design',
    date: '2026-10-06',
    leadSource: 'google_ads',
    contact: { name: 'Martyna', email: 'm@sa.pl', phone: '' },
  })
})

// ── Akceptacja ───────────────────────────────────────────────────────────────

test('problemy przed akceptacją', () => {
  const none = { type: 'none' } as const
  const existing = { type: 'existing', projectId: 'p-1' } as const
  assert.deepEqual(proposalProblems(proposal(), none), ['project'])
  assert.deepEqual(proposalProblems(proposal(), existing), [])
  assert.deepEqual(proposalProblems(proposal({ event: { kind: 'lead_in', start: '2026-09-29' } }), none), [])
  assert.deepEqual(proposalProblems(proposal({ event: { kind: 'gear_purchase', start: '2026-09-29' } }), none), ['kind'])
  assert.deepEqual(
    proposalProblems(proposal({ event: { kind: 'shoot_day', start: '2026-10-28', end: '2026-10-27' } }), existing),
    ['end']
  )
  assert.deepEqual(proposalProblems(proposal(), { type: 'new', fields: { name: ' ', client: '' } }), ['projectName'])
  assert.deepEqual(
    proposalProblems(proposal({ type: 'project_update', set: { leadSource: 'google_ads' } }), { type: 'unset' }),
    ['project']
  )
})

test('wydarzenie z propozycji: źródło z ref i wątkiem, kopia danych, koniec tylko dla zakresów', () => {
  const p = proposal({
    threadId: 't1',
    event: { kind: 'invoice_sent', start: '2026-10-01', end: '2026-10-03', title: ' FV 3/10 ', data: { number: '3/10/2026', amountNetto: 2000 } },
  })
  if (p.type !== 'event') throw new Error('typ')
  const event = eventFromProposal(p, 'p-1', '2026-10-09-gmail.json', NOW)
  assert.equal(event.projectId, 'p-1')
  assert.equal(event.end, undefined)
  assert.equal(event.title, 'FV 3/10')
  assert.deepEqual(event.source, { type: 'gmail', ref: 'gmail:aaa', threadId: 't1', inboxFile: '2026-10-09-gmail.json' })
  assert.notEqual(event.data, p.event.data)
  assert.equal(event.createdAt, NOW.toISOString())
  assert.ok(eventSchema.safeParse(event).success)

  const range = proposal({ event: { kind: 'shoot_day', start: '2026-10-27', end: '2026-10-28' } })
  if (range.type !== 'event') throw new Error('typ')
  assert.equal(eventFromProposal(range, 'p-1', 'f', NOW).end, '2026-10-28')
})

test('uzupełnienie projektu: tylko puste pola, kontakt pole po polu; status ignorowany', () => {
  const current = { client: 'Tchibo', leadSource: 'polecenie', contact: { name: 'Lea', email: '', phone: '' } }
  assert.deepEqual(
    projectPatchFromFields(current, {
      client: 'Tchibo GmbH',
      leadSource: 'google_ads',
      contact: { name: 'Lea Petz', email: 'lea@tchibo.de', phone: '' },
      status: 'won',
    } as never),
    { contact: { name: 'Lea', email: 'lea@tchibo.de', phone: '' } }
  )
  assert.deepEqual(projectPatchFromFields(current, { leadSource: 'google_ads' }, false), { leadSource: 'google_ads' })
  assert.deepEqual(projectPatchFromFields({ client: '', leadSource: undefined, contact: undefined }, { leadSource: 'google_ads' }), {
    leadSource: 'google_ads',
  })
  assert.deepEqual(projectPatchFromFields(current, { client: 'Tchibo' }, false), {})
})

test('status po kilku wydarzeniach: najdalszy krok naprzód, nigdy wstecz', () => {
  assert.equal(statusAfter('quote', ['reply_sent', 'won', 'invoice_paid']), 'done')
  assert.equal(statusAfter('won', ['quote_sent']), null)
  assert.equal(statusAfter('quote', ['lost', 'won']), 'won')
  assert.equal(statusAfter('quote', ['quote_sent']), null)
})

test('edycja propozycji: formularz kalendarza, nieznane klucze data zostają', () => {
  const p = proposal({
    event: {
      kind: 'lead_in',
      start: '2026-10-06T11:44',
      title: 'S&A',
      data: { channel: 'formularz', quality: 'very_good', campaignId: 'cmp-1' },
      futureKey: 1,
    },
  })
  if (p.type !== 'event') throw new Error('typ')
  const draft = draftFromProposal(p)
  assert.equal(draft.time, '11:44')
  assert.equal(draft.fields.channel, 'formularz')

  const edited = proposalWithDraft(p, { ...draft, title: 'S&A jewellery', fields: { ...draft.fields, channel: '' } })
  assert.equal(edited.type, 'event')
  if (edited.type !== 'event') return
  assert.equal(edited.event.title, 'S&A jewellery')
  assert.deepEqual(edited.event.data, { quality: 'very_good', campaignId: 'cmp-1' })
  assert.equal((edited.event as Record<string, unknown>).futureKey, 1)
  assert.equal(edited.ref, p.ref)

  // Zmiana typu na jednodniowy bez godziny gubi godzinę i koniec.
  const asInvoice = proposalWithDraft(p, { ...draft, kind: 'invoice_sent', endDate: '2026-10-09' })
  if (asInvoice.type !== 'event') return
  assert.equal(asInvoice.event.start, '2026-10-06')
  assert.equal(asInvoice.event.end, undefined)
})

test('decyzja: id = ref, opis do listy rozpatrzonych', () => {
  const record = decisionRecord(pending(proposal()), 'rejected', {}, NOW)
  assert.equal(record.id, 'gmail:aaa')
  assert.equal(record.ref, 'gmail:aaa')
  assert.equal(record.title, 'Odpowiedź')
  assert.equal(record.at, NOW.toISOString())
  assert.ok(inboxDecisionSchema.safeParse(record).success)
})

test('możliwe duplikaty: ten sam dzień w projekcie, numer faktury, mail leada w ciągu tygodnia', () => {
  const events = [
    ev({ id: 'same-day', kind: 'reply_sent', projectId: 'p-1', start: '2026-10-02T09:00' }),
    ev({ id: 'invoice', kind: 'invoice_sent', projectId: 'p-9', start: '2026-09-16', data: { number: '3/09/2026' } }),
    ev({ id: 'lead', kind: 'lead_in', start: '2026-09-25', data: { email: 'A@x.pl' } }),
    ev({ id: 'deleted', kind: 'reply_sent', projectId: 'p-1', start: '2026-10-02', deletedAt: 'x' }),
  ]
  const ids = (e: TimelineEvent[]) => e.map((x) => x.id)
  assert.deepEqual(ids(similarEvents({ kind: 'reply_sent', start: '2026-10-02T11:25', data: {} }, 'p-1', events)), ['same-day'])
  assert.deepEqual(ids(similarEvents({ kind: 'reply_sent', start: '2026-10-02T11:25', data: {} }, 'p-2', events)), [])
  assert.deepEqual(
    ids(similarEvents({ kind: 'invoice_sent', start: '2026-09-20', data: { number: '3 /09/2026' } }, null, events)),
    ['invoice']
  )
  assert.deepEqual(ids(similarEvents({ kind: 'lead_in', start: '2026-09-29', data: { email: 'a@x.pl' } }, null, events)), ['lead'])
  assert.deepEqual(ids(similarEvents({ kind: 'lead_in', start: '2026-10-09', data: { email: 'a@x.pl' } }, null, events)), [])
})

// ── Walidacja przed zapisem (npm run data -- inbox) ──────────────────────────

const ctx = (extra: Partial<StrictContext> = {}): StrictContext => ({
  projects: [{ id: 'p-1', name: 'Tchibo Event' }, { id: 'p-gone', name: 'Stary', deletedAt: '2026-10-01' }],
  events: [],
  campaigns: [{ id: 'cmp-1' }],
  decisions: [],
  pendingRefs: new Map(),
  today: '2026-10-09',
  ...extra,
})

const draft = (proposals: unknown[]) => ({ format: INBOX_FORMAT, version: INBOX_VERSION, note: 'Gmail', proposals })

const lead = (extra: Record<string, unknown> = {}) => ({
  type: 'event',
  id: 'l1',
  ref: 'gmail:abc',
  threadId: 'abc',
  client: 'S&A',
  event: { kind: 'lead_in', start: '2026-10-06T11:44', title: 'S&A', data: { campaignId: 'cmp-1', quality: 'very_good' } },
  ...extra,
})

test('walidacja: poprawny plik przechodzi bez zmian', () => {
  const result = validateInboxDraft(
    draft([
      lead(),
      { type: 'project_new', id: 'n1', ref: 'gmail:abc#project', threadId: 'abc', project: { name: 'S&A film', client: 'S&A' } },
      { type: 'project_update', id: 'u1', ref: 'gmail:abc#contact', projectId: 'p-1', set: { leadSource: 'google_ads' } },
      { type: 'event', id: 'r1', ref: 'gmail:def', newProject: 'n1', event: { kind: 'reply_sent', start: '2026-10-07T09:00' } },
    ]),
    ctx()
  )
  assert.deepEqual(result.errors, [])
  assert.equal(result.proposals.length, 4)
  assert.equal(result.note, 'Gmail')
})

test('walidacja: błędy zatrzymują cały zapis', () => {
  const cases: [unknown, RegExp][] = [
    [lead({ event: { kind: 'teleport', start: '2026-10-06' } }), /nieznany typ/],
    [lead({ event: { kind: 'invoice_sent', start: '2026-10-06', data: { amountNetto: '2000' } } }), /amountNetto/],
    [lead({ event: { kind: 'lead_in', start: '2026-10-06', data: { campaignId: 'cmp-x' } } }), /nie ma kampanii/],
    [lead({ event: { kind: 'invoice_sent', start: '2026-10-06T10:00' } }), /nie ma godziny/],
    [lead({ event: { kind: 'reply_sent', start: '2026-10-06T10:00', end: '2026-10-07' } }), /jednodniowy/],
    [lead({ projectId: 'p-x' }), /nie ma projektu/],
    [lead({ projectId: 'p-gone' }), /usunięty/],
    [lead({ projectId: null, event: { kind: 'won', start: '2026-10-06' } }), /wymaga projektu/],
    [lead({ newProject: 'brak' }), /newProject/],
    [lead({ ref: 'abc' }), /ref/],
    [lead({ reason: 5 }), /poprawiłby pole „reason"/],
    [{ type: 'project_update', id: 'u', ref: 'gmail:u', projectId: 'p-1', set: { status: 'won' } }, /status/],
    [{ type: 'project_update', id: 'u', ref: 'gmail:u', projectId: 'p-1', set: {} }, /pusty/],
    [{ type: 'project_new', id: 'n', ref: 'gmail:n', project: { name: 'X', status: 'won' } }, /status/],
    [lead({ event: { kind: 'gear_purchase', start: '2026-10-06' } }), /katalogu/],
  ]
  cases.forEach(([entry, pattern]) => {
    const result = validateInboxDraft(draft([entry]), ctx())
    assert.ok(result.errors.some((e) => pattern.test(e)), `${pattern}: ${result.errors.join(' | ')}`)
    assert.equal(result.proposals.length, 0)
  })
  assert.match(validateInboxDraft({ ...draft([]), version: 2 }, ctx()).errors.join(), /version/)
  assert.match(validateInboxDraft(draft([lead(), lead()]), ctx()).errors.join(), /powtarza się/)
})

test('walidacja: znany ref jest pomijany (usunięte wydarzenie, decyzja, inny plik skrzynki)', () => {
  const known = (c: Partial<StrictContext>) => validateInboxDraft(draft([lead()]), ctx(c))
  const deleted = known({ events: [ev({ source: { type: 'gmail', ref: 'gmail:abc' }, deletedAt: '2026-10-01' })] })
  assert.deepEqual(deleted.errors, [])
  assert.equal(deleted.proposals.length, 0)
  assert.match(deleted.skipped[0].why, /usunięte/)
  assert.match(known({ decisions: [decision('gmail:abc', 'rejected')] }).skipped[0].why, /odrzucona/)
  assert.equal(known({ decisions: [decision('gmail:abc', 'reopened')] }).proposals.length, 1)
  assert.match(known({ pendingRefs: new Map([['gmail:abc', 'stary.json']]) }).skipped[0].why, /stary\.json/)
})

test('walidacja: ostrzeżenia nie blokują (duplikat, przyszła data, brak podpowiedzi)', () => {
  const result = validateInboxDraft(
    draft([
      lead({ event: { kind: 'lead_in', start: '2026-10-20', data: { email: 'm@sa.pl' } } }),
      { type: 'event', id: 'r', ref: 'gmail:r', event: { kind: 'reply_sent', start: '2026-10-02' } },
    ]),
    ctx({ events: [ev({ id: 'old', start: '2026-10-15', data: { email: 'M@sa.pl' } })] })
  )
  assert.deepEqual(result.errors, [])
  assert.equal(result.proposals.length, 2)
  assert.ok(result.warnings.some((w) => /przyszłości/.test(w)))
  assert.ok(result.warnings.some((w) => /podobne wydarzenie/.test(w)))
  assert.ok(result.warnings.some((w) => /wybierzesz w aplikacji/.test(w)))
})
