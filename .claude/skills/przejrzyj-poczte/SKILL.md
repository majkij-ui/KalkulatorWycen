---
name: przejrzyj-poczte
description: Repeatable mail sync for the NonoiseMedia Hub — read Gmail since the last sync, turn leads, replies, quotes, bookings and invoices into Skrzynka proposals, show a sample, write them with `npm run data -- inbox`. Use when M.J. says „przejrzyj moją pocztę", „zsynchronizuj pocztę", „sync my mail" or asks to pull new mail into the hub.
---

# Przejrzyj moją pocztę (Gmail → Skrzynka)

Gmail facts reach the hub only as **proposals** in `inbox/`. M.J. accepts them in the „Skrzynka"
screen. Format, dedupe rules and the screen are described in docs/PLAN-CALENDAR-AND-THREADS.md §5d.

Hard rules:
- Gmail is **read-only**. Don't label, archive, mark as read or reply.
- Write only through `npm run data -- inbox`. It writes a new file in `inbox/` and never touches the
  data files, so it is safe while the hub is open. Never edit `projects.json` / `events.json`
  directly from a sync.
- No project status in proposals. No gear purchases (they live in the catalogue). No deletes.
- Show M.J. a sample before writing, unless he already said to write.

## 1. Where the last sync ended

```bash
npm run data -- inbox-status
```

„Ostatni przegląd gmail: do …" is the latest `sync.to` over all inbox files. Start one day earlier,
because the overlap is free (known refs are skipped). If there's no marker yet, start from the newest
inbox file's `createdAt`.

## 2. Read the hub (read-only)

From `~/Library/Application Support/com.michal.nonoisehub/` read `projects.json`, `events.json`
(**including** `deletedAt` records), `campaigns.json` and `inbox-decisions.json`. Note:
- project ids, clients and contacts (to set `projectId` only when it's certain),
- events with `source.ref` / `updatedFrom[].ref` of the threads you are about to read,
- campaign windows (`startDate` / `endDate`). A lead gets `campaignId` only inside one,
- pending `project_new` proposals from earlier files. Later facts in that thread go to the same
  group via `threadId`, or point at it with `newProjectRef: "<its ref>"`.

## 3. Search Gmail

Use `search_threads` (MINIMAL view, `pageSize` 50, follow `pageToken`), then `get_message` /
`get_thread` with `PLAIN_TEXT` for anything that looks like a fact. Run these queries with the window
start as `YYYY/MM/DD`:

1. `after:D -category:promotions -category:social` (everything, incl. updates: website forms land there)
2. `in:sent after:D`
3. `from:hello@nonoise.media after:D` (website form „New Project Request" / „Nowa wiadomość z formularza")
4. `after:D (faktur OR faktura OR FV OR KSeF OR przelew OR zapłac OR opłac OR invoice OR payment)`

The mailbox is michal@nonoise.media and replies go out as contact@nonoise.media. Skip Google/Stripe
billing (costs, not thread facts), newsletters and calendar auto-mails.

## 4. Facts → proposals

| In the mail | Proposal |
|---|---|
| new inquiry (form, mail, phone note) | `event` `lead_in` (timed): `channel`, `summary`, `quality`, contact fields; `campaignId` inside a campaign window, otherwise `origin` (`LEAD_SOURCES` key) |
| a job seeker / vendor pitch during a campaign | `lead_in` with `quality: "fake"`, `projectId: null` |
| your first answer | `reply_sent` (timed) |
| quote PDF / price in the mail | `quote_sent`: `amountNetto` in PLN netto. If the hub has a quote saved the same day, use its `financials.sumaNetto`. For EUR, keep the amount in `notes` and leave `amountNetto` empty |
| explicit acceptance / order / signed annex | `won` (never infer from "sounds good") |
| confirmed shoot / prep dates | `shoot_day` / `prep_day` (range with `end`, `location`). **Realizacja turns these into project days with crew and costs**, so only confirmed dates; a tentative hold is a `note` with a range |
| delivery of the film | `deadline` with `what` |
| invoice sent / paid | `invoice_sent` (`number`, `amountNetto`, `dueDate`) / `invoice_paid` (`number`, `amount`) |
| contact details, client name, origin | `project_update` (`set.contact` / `leadSource` / `client`, fills empty fields) |
| a new job | `project_new` + its events with `newProject: "<id>"` |
| a fix to an existing event (lead → project, missing time, missing contact) | `event_update` with `eventId`; `set.linkProject: true` (+ `projectId` only when certain), `set.time: "HH:mm"`, `set.data` |

Conventions:
- `ref` = `gmail:<message id>`; add `#fact` when one message yields several facts (`#contact`,
  `#project`, `#shoot`, `#link`, `#time`). The ref must be stable, because re-running a sync relies
  on it.
- `threadId` = Gmail thread id. Add `client` and `email` hints, a one-sentence Polish `reason`, and
  `evidence` (`from`, `to`, `subject`, `date` **with local offset**, short `snippet`).
- Times: Gmail returns UTC. Poland is UTC+2 (CEST) until the last Sunday of October and UTC+1 (CET)
  after that. `start` is local time without a zone.
- A group shares one project target. Keep a contact update for a *different* project out of the
  thread: leave out `threadId` and give it `client` + `projectId`.
- Ambiguous project → leave `projectId` out (the screen asks). Never guess.

## 5. Draft, validate, sample, write

Write the draft to the session scratchpad:

```json
{
  "format": "nonoise-hub-inbox",
  "version": 1,
  "note": "Gmail <from>–<to>",
  "sync": { "source": "gmail", "from": "<ISO with offset>", "to": "<ISO now with offset>", "queries": ["…"] },
  "proposals": [ … ]
}
```

```bash
npm run data -- inbox <draft.json> --dry-run
```

Fix every `✗`. Read every `!`: a likely duplicate (same kind, project and day, same invoice number,
same lead e-mail within a week) usually means drop the proposal. Show M.J. a compact table per thread
(what, date, amount, target project). Ask about the doubtful ones. Then:

```bash
npm run data -- inbox <draft.json> --name "gmail <from>-<to>"
```

Write the file even with zero proposals: the `sync` marker is the next sync's starting point.

## 6. Report

- how many proposals were written and skipped, and why,
- `npm run data -- inbox-status` (pending total by type),
- what needs M.J.'s decision (doubtful `won`, projects missing from the hub, names to fix),
- the installed hub must know every proposal type in the file. An older build shows unknown types as
  „Nie dało się odczytać".
