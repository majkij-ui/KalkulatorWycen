import type { Metadata, Viewport } from 'next'
import { Inter, Archivo, JetBrains_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/react'
import './globals.css'

const inter = Inter({ subsets: ['latin', 'latin-ext'], variable: '--font-inter' })
// Brand typefaces (Nonoise Media brand book): Archivo for headings/text, JetBrains Mono
// for tables, metrics, labels and timecodes. Loaded app-wide as CSS variables but
// currently only consumed by the printable PDF (components/pdf/printable-quote.tsx).
const archivo = Archivo({ subsets: ['latin', 'latin-ext'], variable: '--font-archivo' })
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin', 'latin-ext'], variable: '--font-jetbrains-mono' })

export const metadata: Metadata = {
  title: 'Kalkulator Wyceny Wideo | Studio Produkcji',
  description: 'Profesjonalny kalkulator wyceny produkcji wideo. Oblicz koszt swojego projektu filmowego.',
}

export const viewport: Viewport = {
  themeColor: '#0a0a1a',
  userScalable: true,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="pl" className="dark">
      <body className={`${inter.variable} ${archivo.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
