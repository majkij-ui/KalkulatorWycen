/**
 * READ-ONLY real-data check for a release (skill „wydanie").
 *
 * Computes, with the code of ONE source tree, every saved quote's financials
 * and the Finance totals per year, and prints them as JSON. Run it once with
 * the old tree (a scratch worktree of the previous release) and once with the
 * new one, then diff the two outputs. It only reads the data folder.
 *
 *   node --import <tree>/scripts/register-ts.mjs real-data-check.mts <tree> [dataDir] > out.json
 *
 * A module or function missing in an older tree prints `null` for that part
 * instead of failing. `today` is fixed so both runs agree.
 *
 * U1 adds per project what the project LIST shows (`list`: the money loop since
 * U1, the frozen `financials` before), the approved price (`price`: frozen /
 * typed / live PDF) and extra sales with category and phase; per year EBBT in
 * both gear views (`ledger`) and the extra-sale stats.
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const tree = resolve(process.argv[2] ?? '.')
const dir = process.argv[3] ?? join(homedir(), 'Library', 'Application Support', 'com.michal.nonoisehub')
const TODAY = process.env.CHECK_TODAY ?? new Date().toISOString().slice(0, 10)
const NOW = new Date(`${TODAY}T12:00:00`)

type Rec = Record<string, unknown> & { id: string; deletedAt?: string }

function items(file: string): Rec[] {
  const path = join(dir, file)
  if (!existsSync(path)) return []
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { items?: Rec[] }
  return Array.isArray(raw.items) ? raw.items : []
}

async function load(module: string): Promise<Record<string, any> | null> {
  const path = join(tree, 'lib', `${module}.ts`)
  if (!existsSync(path)) return null
  return import(pathToFileURL(path).href)
}

function parseAll(schema: any, list: Rec[]): Rec[] {
  if (!schema) return list
  return list.flatMap((item) => {
    const parsed = schema.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })
}

const round = (n: unknown) => (typeof n === 'number' ? Math.round(n * 100) / 100 : n)
const roundAll = (obj: unknown): unknown =>
  obj && typeof obj === 'object'
    ? Object.fromEntries(Object.entries(obj as object).map(([k, v]) => [k, Array.isArray(v) ? v.length : roundAll(v)]))
    : round(obj)

const types = await load('project-types')
const projects = parseAll(types?.projectSchema, items('projects.json')).filter((p) => !p.deletedAt)
const fixedCosts = parseAll(types?.fixedCostSchema, items('finances.json')).filter((c) => !c.deletedAt)
const events = parseAll((await load('event-types'))?.eventSchema, items('events.json')).filter((e) => !e.deletedAt)
const subscriptions = parseAll((await load('subscription-types'))?.subscriptionSchema, items('subscriptions.json')).filter(
  (s) => !s.deletedAt
)

const qf = await load('quote-financials')
const quotes: Record<string, unknown> = {}
for (const p of projects) {
  if (!p.quote) continue
  let computed: unknown = null
  try {
    computed = qf?.computeSnapshotFinancials ? roundAll(qf.computeSnapshotFinancials(p.quote, NOW)) : null
  } catch (error) {
    computed = { error: String(error) }
  }
  quotes[`${p.id} ${String(p.name)}`] = { computed, stored: roundAll(p.financials) }
}

const money = await load('money-loop')
const subs = await load('subscriptions')
const finance = await load('finance-calc')
const listModule = await load('project-list')
const ledgerModule = await load('margin-ledger')
const gearModule = await load('gear-costs')
const extraModule = await load('extra-sales')
const equipment = parseAll(types?.equipmentItemSchema, items('equipment.json')).filter((e) => !e.deletedAt)
const company = items('company.json')[0] ?? null
const years: Record<string, unknown> = {}
// Best-known money per project (R2 adds ownWork / producerMargin; an older tree prints null for them).
const perProject: Record<string, unknown> = {}
// R2: quote crew lines of the „Ja" card without the `ownWork` flag (made by a build before R2) —
// their Koszt still counts as a plan cost until „zaktualizuj stawki" or a re-pick flags them.
const unflaggedJaLines: string[] = []
const selfIds = new Set(items('crew.json').filter((m) => m.self === true && !m.deletedAt).map((m) => m.id))
for (const p of projects) {
  const snaps = [p.quote, ...((p.quoteVariants as { snapshot?: unknown }[] | undefined) ?? []).map((v) => v.snapshot)]
  snaps.forEach((snap, i) => {
    const days = ((snap as { data?: { detailedShootingDays?: { crew?: Rec[] }[] } } | null)?.data?.detailedShootingDays ?? [])
    days.forEach((d, n) =>
      (d.crew ?? []).forEach((line) => {
        if (selfIds.has(String(line.personId)) && line.ownWork !== true) {
          unflaggedJaLines.push(`${p.id} ${String(p.name)} ${i === 0 ? 'chosen' : `variant ${i}`} day ${n + 1}`)
        }
      })
    )
  })
}
try {
  if (money?.moneyLedger && money.summarizeMoney) {
    const ledger = money.moneyLedger(projects, events, TODAY)
    for (const m of ledger) {
      const p = projects.find((x) => x.id === m.id)
      // What the project list shows: U1 reads the loop (`listMoney`), before U1 the frozen plan.
      const listed = listModule?.listMoney
        ? listModule.listMoney(p, m)
        : { revenue: (p?.financials as { sumaNetto?: number } | null)?.sumaNetto ?? null, profit: (p?.financials as { zysk?: number } | null)?.zysk ?? null }
      const revenueOfPlan = qf?.snapshotPlanRevenue ? qf.snapshotPlanRevenue(p?.quote) : null
      perProject[`${m.id} ${String(p?.name)}`] = {
        ...(roundAll({
          counts: m.counts,
          revenue: m.revenue,
          revenueBasis: m.revenueBasis,
          costs: m.costs,
          costsBasis: m.costsBasis,
          profit: m.profit,
          ownWork: m.ownWork ?? null,
          producerMargin: m.producerMargin ?? null,
          extrasTotal: m.extrasTotal,
        }) as object),
        list: roundAll({ revenue: listed.revenue, profit: listed.profit }),
        price: revenueOfPlan
          ? roundAll({ approved: revenueOfPlan.approvedPln, frozen: revenueOfPlan.frozen?.source ?? null, live: revenueOfPlan.live.pln, planSource: revenueOfPlan.source })
          : null,
        extras: (m.extras ?? []).map((x: { day: string; amount: number | null; category?: string; phase?: string }) => `${x.day} ${round(x.amount)} ${x.category ?? '-'} / ${x.phase ?? '-'}`),
      }
    }
    const list: number[] = money.moneyYears ? money.moneyYears(ledger) : [Number(TODAY.slice(0, 4))]
    for (const year of list) {
      const yearCosts = subs?.fixedCostsInYear ? subs.fixedCostsInYear(fixedCosts, subscriptions, year) : fixedCosts
      const s = money.summarizeMoney(ledger, yearCosts, { kind: 'year', year })
      const fixed = finance?.summarizeFixedCosts ? finance.summarizeFixedCosts(yearCosts, { kind: 'year', year }) : null
      // Margin ledger in both gear views: EBBT (U1) must be the same in both; result differs by gear.
      const layers: Record<string, unknown> = {}
      if (ledgerModule?.marginSummary && gearModule?.gearSpreadSettings) {
        for (const spread of [true, false]) {
          const m = ledgerModule.marginSummary(
            { ledger, fixedCosts: yearCosts, equipment, spread, settings: gearModule.gearSpreadSettings(company), today: TODAY, scope: null },
            { kind: 'year', year }
          )
          layers[spread ? 'spread' : 'cash'] = roundAll({
            margin: m.totals.margin,
            producerMargin: m.totals.producerMargin ?? null,
            result: m.totals.result,
            ebbt: m.totals.ebbt ?? null,
          })
          if (spread && extraModule?.extraSaleStats) {
            const x = extraModule.extraSaleStats(m.projects)
            layers.extraSales = roundAll({ projects: x.projects, withExtras: x.withExtras, total: x.total, averagePerProject: x.averagePerProject })
          }
        }
      }
      years[year] = {
        ...(roundAll({
          revenue: s.revenue,
          tax: s.tax,
          costs: s.costs,
          profit: s.profit,
          invoicedRevenue: s.invoicedRevenue,
          plan: s.plan,
          projects: s.projects,
          fixedTotal: fixed?.total ?? null,
        }) as object),
        ledger: layers,
      }
    }
  }
} catch (error) {
  years.error = String(error)
}

// U2: gear „Zarobił" per catalogue item (moves by design), rental totals per project and per year
// (new — must equal existing wynajem lines), Realizacja totals (must not move). Older trees print null.
const roiModule = await load('equipment-roi')
let gear: unknown = null
try {
  if (roiModule?.computeGearReport) {
    const report = roiModule.computeGearReport(equipment, projects, { events, now: NOW })
    gear = {
      clientPaid: Object.fromEntries(report.items.map((r: any) => [r.item.name, round(r.clientPaid)])),
      rentValue: Object.fromEntries(report.items.map((r: any) => [r.item.name, round(r.rentValue)])),
      clientPaidPct: Object.fromEntries(report.items.map((r: any) => [r.item.name, round(r.clientPaidPct)])),
      totals: roundAll(report.totals),
    }
  }
} catch (error) {
  gear = { error: String(error) }
}
const rentalsModule = await load('rentals')
const summaryModule = await load('realization-summary')
const rentalsPerProject: Record<string, unknown> = {}
const realizationTotalsPerProject: Record<string, unknown> = {}
const rentalsPerYear: Record<string, unknown> = {}
try {
  for (const p of projects) {
    const key = `${p.id} ${String(p.name)}`
    if (rentalsModule?.projectRentalTotal) {
      const total = rentalsModule.projectRentalTotal(p)
      if (total) rentalsPerProject[key] = round(total)
    }
    if (summaryModule?.realizationTotals && rentalsModule?.realizationLines) {
      const t = summaryModule.realizationTotals(rentalsModule.realizationLines(p))
      if (t.total) realizationTotalsPerProject[key] = roundAll(t)
    }
  }
  if (rentalsModule?.periodRentals && money?.moneyLedger) {
    const ledger = money.moneyLedger(projects, events, TODAY)
    const byId = new Map(projects.map((p) => [p.id, p]))
    for (const year of new Set(ledger.map((m: any) => Number(String(m.anchor).slice(0, 4))))) {
      const rows = ledger
        .filter((m: any) => Number(String(m.anchor).slice(0, 4)) === year)
        .map((m: any) => ({ money: m, anchored: true }))
      rentalsPerYear[String(year)] = round(rentalsModule.periodRentals(rows, byId).total)
    }
  }
} catch (error) {
  rentalsPerYear.error = String(error)
}

console.log(
  JSON.stringify(
    {
      tree,
      dir,
      today: TODAY,
      counts: { projects: projects.length, quotes: Object.keys(quotes).length },
      quotes,
      years,
      perProject,
      unflaggedJaLines,
      gear,
      rentalsPerProject: rentalsModule ? rentalsPerProject : null,
      rentalsPerYear: rentalsModule ? rentalsPerYear : null,
      realizationTotals: summaryModule ? realizationTotalsPerProject : null,
    },
    null,
    2
  )
)
