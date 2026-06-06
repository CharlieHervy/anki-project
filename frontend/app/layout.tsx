import type { Metadata } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import './globals.css'

export const metadata: Metadata = {
  title: 'Dimindo',
  description: 'AI-genererade Anki-kort från ditt källmaterial',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ClerkProvider>
      <html lang="sv">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  )
}