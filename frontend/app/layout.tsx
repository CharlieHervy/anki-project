import type { Metadata } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import './globals.css'

export const metadata: Metadata = {
  title: 'Dimindo',
  description: 'AI-generated Anki flashcards from your study material',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ClerkProvider
      localization={{
        signIn: {
          start: {
            subtitle: "Create an account or sign in to continue"
          }
        }
      }}
    >
      <html lang="sv">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  )
}