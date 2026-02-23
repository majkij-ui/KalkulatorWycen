'use client'

import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
} from '@react-pdf/renderer'
import type { PhaseBreakdown } from '@/lib/quote-calc'
import { formatCurrency } from '@/lib/quote-calc'

const styles = StyleSheet.create({
  page: {
    padding: 48,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: '#1a1a1a',
  },
  header: {
    marginBottom: 32,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 10,
    color: '#666',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 9,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    color: '#444',
    marginBottom: 12,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: '#f0f0f0',
  },
  rowLabel: {
    flex: 1,
  },
  rowValue: {
    fontSize: 9,
    color: '#666',
    marginRight: 16,
  },
  rowAmount: {
    fontWeight: 'bold',
    minWidth: 80,
    textAlign: 'right',
  },
  totals: {
    marginTop: 32,
    paddingTop: 24,
    borderTopWidth: 2,
    borderTopColor: '#1a1a1a',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  totalLabel: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  totalAmount: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  grandTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 12,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#ccc',
  },
  grandLabel: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  grandAmount: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  footer: {
    position: 'absolute',
    bottom: 32,
    left: 48,
    right: 48,
    fontSize: 8,
    color: '#999',
    textAlign: 'center',
  },
})

interface QuotePdfDocumentProps {
  projectName: string
  validUntil: string
  breakdown: PhaseBreakdown[]
  sumaNetto: number
  vat: number
  sumaBrutto: number
}

export function QuotePdfDocument({
  projectName,
  validUntil,
  breakdown,
  sumaNetto,
  vat,
  sumaBrutto,
}: QuotePdfDocumentProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Wycena produkcji wideo</Text>
          <Text style={styles.subtitle}>
            {projectName ? `Projekt: ${projectName}` : 'Projekt — do uzupełnienia'}
          </Text>
          <Text style={styles.subtitle}>
            Data ważności oferty: {validUntil || '—'}
          </Text>
        </View>

        {(breakdown ?? []).map((phase) => (
          <View key={phase.category} style={styles.section}>
            <Text style={styles.sectionTitle}>{phase.category}</Text>
            {(phase.items ?? []).map((item, i) => (
              <View key={i} style={styles.row}>
                <Text style={styles.rowLabel}>{item.label}</Text>
                <Text style={styles.rowValue}>{item.value}</Text>
                <Text style={styles.rowAmount}>{formatCurrency(item.lineNetto)}</Text>
              </View>
            ))}
          </View>
        ))}

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Suma netto</Text>
            <Text style={styles.totalAmount}>{formatCurrency(sumaNetto)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>VAT (23%)</Text>
            <Text style={styles.totalAmount}>{formatCurrency(vat)}</Text>
          </View>
          <View style={styles.grandTotal}>
            <Text style={styles.grandLabel}>Suma brutto</Text>
            <Text style={styles.grandAmount}>{formatCurrency(sumaBrutto)}</Text>
          </View>
        </View>

        <Text style={styles.footer}>
          Wycena ma charakter szacunkowy. Ostateczna oferta może ulec zmianie po ustaleniu szczegółów.
        </Text>
      </Page>
    </Document>
  )
}
