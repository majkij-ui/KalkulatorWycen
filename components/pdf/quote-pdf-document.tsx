'use client'

import React from 'react'
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import type { PhaseBreakdown, Totals } from '@/lib/quote-calc'
import { formatCurrency } from '@/lib/quote-calc'
import { safeNum } from '@/lib/safe-numbers'

const PRIMARY_ORANGE = '#f97316' // brand accent (Primary Orange)
const TEXT_DARK = '#0f172a'
const MUTED = '#64748b'
const BORDER = '#e2e8f0'

const styles = StyleSheet.create({
  page: {
    padding: 48,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: TEXT_DARK,
    backgroundColor: '#ffffff',
  },
  header: {
    marginBottom: 28,
    flexDirection: 'row',
    gap: 18,
    alignItems: 'flex-start',
  },
  logoPlaceholder: {
    width: 120,
    height: 52,
    borderWidth: 1,
    borderColor: BORDER,
    borderStyle: 'solid',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  logoText: {
    fontSize: 11,
    fontWeight: 700,
    color: MUTED,
  },
  headerRight: {
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: 800,
    marginBottom: 6,
  },
  meta: {
    fontSize: 10,
    color: MUTED,
    marginBottom: 3,
  },
  section: {
    marginTop: 18,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    color: TEXT_DARK,
    marginBottom: 10,
  },
  table: {
    borderWidth: 1,
    borderColor: BORDER,
    borderStyle: 'solid',
    borderRadius: 8,
    overflow: 'hidden',
  },
  tableHeader: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#fff7ed',
    borderBottomWidth: 1,
    borderBottomColor: PRIMARY_ORANGE,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  thPhase: {
    fontSize: 10,
    fontWeight: 800,
    color: TEXT_DARK,
  },
  thAmount: {
    fontSize: 10,
    fontWeight: 800,
    color: TEXT_DARK,
    textAlign: 'right',
    width: 120,
  },
  row: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  tdPhase: {
    fontSize: 10,
    color: TEXT_DARK,
    flex: 1,
    paddingRight: 12,
  },
  tdAmount: {
    fontSize: 10,
    fontWeight: 700,
    color: TEXT_DARK,
    textAlign: 'right',
    width: 120,
  },
  totalsBlock: {
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  totalsLabel: {
    color: MUTED,
    fontSize: 10,
    fontWeight: 600,
  },
  totalsValue: {
    fontSize: 10,
    fontWeight: 800,
    textAlign: 'right',
  },
  grandTotalRow: {
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: 10,
  },
  grandTotalLabel: {
    color: TEXT_DARK,
    fontSize: 11,
    fontWeight: 900,
  },
  grandTotalValue: {
    color: TEXT_DARK,
    fontSize: 11,
    fontWeight: 900,
  },
  optionsBlock: {
    marginTop: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: BORDER,
    borderStyle: 'solid',
    borderRadius: 8,
  },
  optionsText: {
    color: TEXT_DARK,
    fontSize: 10,
    lineHeight: 1.35,
  },
  notesBlock: {
    position: 'relative',
    marginTop: 18,
  },
  noteLine: {
    fontSize: 9.2,
    color: MUTED,
    marginBottom: 4,
    lineHeight: 1.35,
  },
  emptyNotes: {
    fontSize: 9.2,
    color: MUTED,
  },
})

type PhaseTotal = Pick<PhaseBreakdown, 'category' | 'phaseNetto'>

type QuotePdfDocumentProps = {
  clientProjectName: string
  issueDateIso: string
  validUntilIso: string
  phaseTotals: PhaseTotal[]
  totals: Totals
  termsAndConditions: string[]
  opcjeDodatkowe: string
}

function formatPlDate(isoDate: string): string {
  const parts = isoDate.split('-')
  if (parts.length !== 3) return isoDate || '—'
  const [yyyy, mm, dd] = parts
  return `${dd}.${mm}.${yyyy}`
}

export function QuotePdfDocument({
  clientProjectName,
  issueDateIso,
  validUntilIso,
  phaseTotals,
  totals,
  termsAndConditions,
  opcjeDodatkowe,
}: QuotePdfDocumentProps) {
  const safePhaseTotals = phaseTotals ?? []

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.logoPlaceholder}>
            <Text style={styles.logoText}>LOGO</Text>
          </View>

          <View style={styles.headerRight}>
            <Text style={styles.title}>Oferta współpracy</Text>
            <Text style={styles.meta}>
              Data sporządzenia: {formatPlDate(issueDateIso)}
            </Text>
            <Text style={styles.meta}>
              Termin ważności: 30 dni (do {formatPlDate(validUntilIso)})
            </Text>
            <Text style={styles.meta}>
              Klient / Projekt: {clientProjectName?.trim() ? clientProjectName.trim() : '—'}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Wycena (netto) – podsumowanie faz</Text>

          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <View style={styles.tableHeaderRow}>
                <Text style={styles.thPhase}>Faza</Text>
                <Text style={styles.thAmount}>Suma netto</Text>
              </View>
            </View>

            {safePhaseTotals.map((p, idx) => {
              const isLast = idx === safePhaseTotals.length - 1
              return (
                <View key={`${p.category}-${idx}`} style={[styles.row, isLast ? styles.rowLast : undefined]}>
                  <Text style={styles.tdPhase}>{p.category}</Text>
                  <Text style={styles.tdAmount}>{formatCurrency(safeNum(p.phaseNetto, 0, 0))}</Text>
                </View>
              )
            })}
          </View>

          <View style={styles.totalsBlock}>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Suma netto</Text>
              <Text style={styles.totalsValue}>{formatCurrency(safeNum(totals?.sumaNetto, 0, 0))}</Text>
            </View>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>VAT (23%)</Text>
              <Text style={styles.totalsValue}>{formatCurrency(safeNum(totals?.vat, 0, 0))}</Text>
            </View>
            <View style={[styles.totalsRow, styles.grandTotalRow]}>
              <Text style={styles.grandTotalLabel}>Suma brutto</Text>
              <Text style={styles.grandTotalValue}>{formatCurrency(safeNum(totals?.sumaBrutto, 0, 0))}</Text>
            </View>
          </View>
        </View>

        {opcjeDodatkowe?.trim() ? (
          <View style={styles.optionsBlock}>
            <Text style={styles.sectionTitle}>Opcje Dodatkowe</Text>
            <Text style={styles.optionsText}>{opcjeDodatkowe}</Text>
          </View>
        ) : null}

        <View style={styles.notesBlock}>
          <Text style={styles.sectionTitle}>Uwagi</Text>
          {(termsAndConditions ?? []).length > 0 ? (
            (termsAndConditions ?? []).map((t, i) => (
              <Text key={`${i}-${t?.slice(0, 20)}`} style={styles.noteLine}>
                {i + 1}. {t}
              </Text>
            ))
          ) : (
            <Text style={styles.emptyNotes}>—</Text>
          )}
        </View>
      </Page>
    </Document>
  )
}

