import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import { Analytics } from '@vercel/analytics/next'
import Script from 'next/script'
import { TelegramProvider } from '@/lib/TelegramProvider'
import { MaterialSymbolsFont } from '@/components/material-symbols-font'
import { ErrorBoundary } from '@/components/error-boundary'
import './globals.css'

const plusJakarta = localFont({
  src: '../public/fonts/PlusJakartaSans.woff2',
  weight: '400 800',
  variable: "--font-plus-jakarta",
  display: "swap",
})

export const metadata: Metadata = {
  title: 'themcq - Learn Smarter',
  description: 'Upload lectures and get AI-generated MCQs, summaries, and key concepts. Turn your study materials into mastery.',
  icons: {
    icon: '/favicon.ico',
  },
}

export const viewport: Viewport = {
  themeColor: '#0d0f1c',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`dark ${plusJakarta.variable}`} suppressHydrationWarning>

      <body className="font-sans antialiased bg-background min-h-screen">
        <MaterialSymbolsFont />
        <ErrorBoundary>
          <TelegramProvider>
            {children}
          </TelegramProvider>
        </ErrorBoundary>
        {process.env.NODE_ENV === 'production' && <Analytics />}
        {/* Must be in body, not head — afterInteractive requires body context */}
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="afterInteractive"
        />
      </body>
    </html>
  )
}
