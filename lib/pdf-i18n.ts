/**
 * Static label dictionary for the PDF flow.
 *
 * Two languages: 'pl' (default) and 'en'. Switching is per-PDF (LocalPdfState.pdfLanguage)
 * and ONLY affects the printable document + the in-page preview that mirrors it.
 * The calculator UI, editor labels, buttons, settings sheet etc. always stay Polish.
 *
 * For user-editable terms (termLicencja, termPrzekazanie, etc.) and company info,
 * see lib/pdf-texts-config.ts — those have their own PL/EN twins and live in the
 * settings modal so the user can refine the wording.
 */

export type PdfLang = 'pl' | 'en'

interface PdfLabelSet {
  // Header / metadata
  contractor: string
  producer: string
  email: string
  client: string
  project: string
  issueDate: string
  validityNote: string
  shootingDate: string

  // Table headers
  tableCategory: string
  tableEstimateNetto: string
  tableDescription: string

  // Totals row
  sumNetto: string
  vatRow: string
  sumBrutto: string
  totalProject: string

  // Section headers below table
  finalMaterials: string
  additionalOptions: string
  portfolio: string
  notes: string

  // Row category titles
  rowPreprodukcja: string
  rowEkipa: string
  rowObsada: string
  rowSprzet: string
  rowLogistyka: string
  rowPostprodukcja: string
  rowInne: string

  // Fallbacks
  emptyDash: string
  tbd: string

  // Disclaimer swap
  nettoDisclaimer: string
  nettoDisclaimerSwap: string

  // Boolean / enum values used inside opis text
  yes: string
  no: string
  scenarioNone: string
  scenarioBasic: string
  scenarioExtended: string
  copyrightTransfer: string
  copyrightLicense: string
  unitDays: string
  unitHours: string
  equipmentMinimal: string
  equipmentStandard: string
  equipmentCinematic: string

  // Opis template prefixes / connectors
  opisDocumentation: string
  opisScenario: string
  opisLocationVisit: string
  opisProductionMgr: string
  opisQuickQuoteMode: string
  opisRezOpSurcharge: string
  opisDays: string
  opisCrewSize: string
  opisDetailedCrew: string
  opisShootingDays: string
  opisEquipmentClass: string
  opisDroneSurcharge: string
  opisDetailedEquipment: string
  opisTravel: string
  opisCatering: string
  opisLodging: string
  opisEditingQuickMode: string
  opisDetailedPostpro: string
  opisItems: string
  opisVoiceover: string
  opisMusicLicense: string
  opisCopyright: string

  // Cast row (Obsada)
  opisCastQuickModeNote: string
  opisDetailedCast: string
  opisActor: string
  opisModel: string
  opisExtra: string
  /** Person-day unit, e.g. "os.-dni" / "person-days". */
  opisPersonDays: string

  /** "Honorarium aktorów (przekazanie praw)" / "Actor copyright transfer" */
  opisActorRightsTransfer: string
  /** Singular actor unit, e.g. "aktor" / "actor". */
  opisActorUnit: string
}

export const PDF_LABELS: Record<PdfLang, PdfLabelSet> = {
  pl: {
    contractor: 'Wykonawca',
    producer: 'Producent',
    email: 'email',
    client: 'Klient',
    project: 'Projekt',
    issueDate: 'Data sporządzenia',
    validityNote: 'Termin ważności: 30 dni',
    shootingDate: 'Termin zdjęć',

    tableCategory: 'KATEGORIA',
    tableEstimateNetto: 'SZACUNKOWO (NETTO)',
    tableDescription: 'OPIS',

    sumNetto: 'Suma Netto',
    vatRow: 'VAT (23%)',
    sumBrutto: 'SUMA BRUTTO',
    totalProject: 'CAŁKOWITY KOSZT PROJEKTU',

    finalMaterials: 'Materiały Końcowe',
    additionalOptions: 'Opcje Dodatkowe',
    portfolio: 'Przykładowe realizacje',
    notes: 'Uwagi',

    rowPreprodukcja: 'Preprodukcja',
    rowEkipa: 'Ekipa filmowa',
    rowObsada: 'Obsada',
    rowSprzet: 'Sprzęt filmowy',
    rowLogistyka: 'Logistyka',
    rowPostprodukcja: 'Postprodukcja',
    rowInne: 'Inne koszty',

    emptyDash: '—',
    tbd: 'Do ustalenia',

    nettoDisclaimer: 'Podane kwoty są kwotami netto.',
    nettoDisclaimerSwap: 'Sprzedaż na fakturze bez VAT, kwoty netto są równe kwotom brutto.',

    yes: 'Tak',
    no: 'Nie',
    scenarioNone: 'Brak',
    scenarioBasic: 'Podstawowy',
    scenarioExtended: 'Rozbudowany',
    copyrightTransfer: 'pełne przekazanie praw',
    copyrightLicense: 'niewyłączna licencja',
    unitDays: 'dni',
    unitHours: 'godz.',
    equipmentMinimal: 'minimalistyczny',
    equipmentStandard: 'standard',
    equipmentCinematic: 'kinowy',

    opisDocumentation: 'Dokumentacja',
    opisScenario: 'Scenariusz',
    opisLocationVisit: 'Wizja lokalna',
    opisProductionMgr: 'Kierownik produkcji',
    opisQuickQuoteMode: 'Tryb szybkiej wyceny',
    opisRezOpSurcharge: 'Dopłata Reż-Op',
    opisDays: 'dni',
    opisCrewSize: 'os.',
    opisDetailedCrew: 'Szczegółowa wycena ekipy filmowej dla',
    opisShootingDays: 'dni zdjęciowych',
    opisEquipmentClass: 'Klasa sprzętu',
    opisDroneSurcharge: 'Dopłata Dron',
    opisDetailedEquipment:
      'Szczegółowa wycena sprzętu (kamery, obiektywy, stabilizacja, podgląd, światło, dron) dla',
    opisTravel: 'Dojazd',
    opisCatering: 'Catering',
    opisLodging: 'Noclegi',
    opisEditingQuickMode: 'Montaż w trybie szybkiej wyceny',
    opisDetailedPostpro: 'Szczegółowa wycena postprodukcji',
    opisItems: 'pozycji (formaty i dostawy)',
    opisVoiceover: 'Lektor',
    opisMusicLicense: 'Licencja muzyczna',
    opisCopyright: 'Prawa autorskie',

    opisCastQuickModeNote: 'Brak wyceny obsady — tryb szybkiej wyceny.',
    opisDetailedCast: 'Szczegółowa wycena obsady dla',
    opisActor: 'Aktor',
    opisModel: 'Model',
    opisExtra: 'Statysta',
    opisPersonDays: 'os.-dni',
    opisActorRightsTransfer: 'Honorarium za przekazanie praw',
    opisActorUnit: 'aktor',
  },
  en: {
    contractor: 'Contractor',
    producer: 'Producer',
    email: 'email',
    client: 'Client',
    project: 'Project',
    issueDate: 'Issue date',
    validityNote: 'Valid for: 30 days',
    shootingDate: 'Shooting date',

    tableCategory: 'CATEGORY',
    tableEstimateNetto: 'ESTIMATE (NET)',
    tableDescription: 'DESCRIPTION',

    sumNetto: 'Subtotal Net',
    vatRow: 'VAT (23%)',
    sumBrutto: 'TOTAL GROSS',
    totalProject: 'TOTAL PROJECT COST',

    finalMaterials: 'Final Deliverables',
    additionalOptions: 'Additional Options',
    portfolio: 'Sample work',
    notes: 'Notes',

    rowPreprodukcja: 'Pre-production',
    rowEkipa: 'Film crew',
    rowObsada: 'Cast',
    rowSprzet: 'Equipment',
    rowLogistyka: 'Logistics',
    rowPostprodukcja: 'Post-production',
    rowInne: 'Other costs',

    emptyDash: '—',
    tbd: 'TBD',

    nettoDisclaimer: 'Amounts are stated net of VAT.',
    nettoDisclaimerSwap: 'Sale invoiced without VAT; net amounts equal gross amounts.',

    yes: 'Yes',
    no: 'No',
    scenarioNone: 'None',
    scenarioBasic: 'Basic',
    scenarioExtended: 'Extended',
    copyrightTransfer: 'full copyright transfer',
    copyrightLicense: 'non-exclusive licence',
    unitDays: 'days',
    unitHours: 'hrs',
    equipmentMinimal: 'minimal',
    equipmentStandard: 'standard',
    equipmentCinematic: 'cinematic',

    opisDocumentation: 'Documentation',
    opisScenario: 'Script',
    opisLocationVisit: 'Location scout',
    opisProductionMgr: 'Production manager',
    opisQuickQuoteMode: 'Quick quote mode',
    opisRezOpSurcharge: 'Director-Operator surcharge',
    opisDays: 'days',
    opisCrewSize: 'pers.',
    opisDetailedCrew: 'Detailed film crew pricing for',
    opisShootingDays: 'shooting days',
    opisEquipmentClass: 'Equipment class',
    opisDroneSurcharge: 'Drone surcharge',
    opisDetailedEquipment:
      'Detailed equipment pricing (cameras, lenses, stabilisation, monitoring, lighting, drone) for',
    opisTravel: 'Travel',
    opisCatering: 'Catering',
    opisLodging: 'Lodging',
    opisEditingQuickMode: 'Editing in quick quote mode',
    opisDetailedPostpro: 'Detailed post-production pricing',
    opisItems: 'items (formats and deliverables)',
    opisVoiceover: 'Voiceover',
    opisMusicLicense: 'Music licence',
    opisCopyright: 'Copyright',

    opisCastQuickModeNote: 'Cast not itemised — quick quote mode.',
    opisDetailedCast: 'Detailed cast pricing for',
    opisActor: 'Actor',
    opisModel: 'Model',
    opisExtra: 'Extra',
    opisPersonDays: 'person-days',
    opisActorRightsTransfer: 'Copyright transfer fee',
    opisActorUnit: 'actor',
  },
}

export function t(lang: PdfLang, key: keyof PdfLabelSet): string {
  return PDF_LABELS[lang][key]
}
