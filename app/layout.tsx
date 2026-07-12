import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Cormorant_Garamond, Manrope } from 'next/font/google'
import './globals.css'

const serif = Cormorant_Garamond({ subsets: ['latin'], variable: '--font-editorial', weight: ['400', '500', '600'], display: 'swap' })
const sans = Manrope({ subsets: ['latin'], variable: '--font-interface', display: 'swap' })

export const metadata: Metadata = {
  title: 'Atlas — Autonomous Travel Intelligence',
  description: 'A thoughtful AI travel planner that researches live weather, culture, places and costs to compose journeys worth remembering.',
  generator: 'v0.app',
}

export const viewport: Viewport = {
  colorScheme: 'dark light',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f2eee5' },
    { media: '(prefers-color-scheme: dark)', color: '#11130f' },
  ],
  userScalable: true,
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`bg-background ${serif.variable} ${sans.variable}`}><body className="font-sans antialiased">{children}{process.env.NODE_ENV === 'production' && <Analytics />}</body></html>
}
