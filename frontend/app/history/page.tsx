'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { UserButton, useUser } from '@clerk/nextjs'
import Link from 'next/link'
import styles from './page.module.css'

const API = 'https://anki-project-production.up.railway.app'

type Session = {
  session_id: string
  title: string | null
  created_at: string
  card_count: number
}

export default function HistoryPage() {
  const { user, isLoaded } = useUser()
  const router = useRouter()
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  // Require login — redirect oinloggade to /sign-in
  useEffect(() => {
    if (!isLoaded) return
    if (!user) router.push('/sign-in')
  }, [user, isLoaded, router])

  // Fetch sessions once user is ready
  useEffect(() => {
    if (!isLoaded || !user) return
    fetch(`${API}/api/sessions`, {
      headers: { 'x-user-id': user.id },
    })
      .then(r => r.json())
      .then(data => {
        setSessions(Array.isArray(data) ? data : (data.sessions ?? []))
        setLoading(false)
      })
      .catch(() => {
        setFetchError('Failed to load sessions. Please try again.')
        setLoading(false)
      })
  }, [user, isLoaded])

  function formatDate(iso: string): string {
    const d = new Date(iso)
    const date = d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
    const time = d.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    })
    return `${date} at ${time}`
  }

  // Don't render before Clerk resolves to avoid flash
  if (!isLoaded || !user) return null

  return (
    <main className={styles.root}>

      {/* ── Topbar ── */}
      <header className={styles.topbar}>
        <Link href="/" className={styles.wordmark}>Dimindo</Link>
        <UserButton />
      </header>

      <div className={styles.content}>
        <p className={styles.eyebrow}>Your account</p>
        <h1 className={styles.heading}>Previous generations</h1>

        {loading && (
          <p className={styles.statusMsg}>Loading your sessions…</p>
        )}

        {fetchError && (
          <p className={styles.errorMsg}>{fetchError}</p>
        )}

        {!loading && !fetchError && sessions.length === 0 && (
          <p className={styles.statusMsg}>
            No previous generations yet. Generate your first deck to see it here.
          </p>
        )}

        {!loading && !fetchError && sessions.length > 0 && (
          <div className={styles.sessionList}>
            {sessions.map(session => (
              <a
                key={session.session_id}
                href={`/?session_id=${session.session_id}`}
                className={styles.sessionCard}
              >
                <p className={styles.sessionTitle}>
                  {session.title || 'Untitled session'}
                </p>
                <p className={styles.sessionMeta}>
                  <span>{formatDate(session.created_at)}</span>
                  <span className={styles.metaDot}>·</span>
                  <span>
                    {session.card_count} card{session.card_count !== 1 ? 's' : ''}
                  </span>
                </p>
              </a>
            ))}
          </div>
        )}
      </div>

    </main>
  )
}