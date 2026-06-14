'use client'

import { useState, useRef, useEffect } from 'react'
import { UserButton, useUser, useClerk } from '@clerk/nextjs'
import styles from './page.module.css'

const API = 'https://anki-project-production.up.railway.app'

type Card = {
  id: string
  text: string
  extra: string
  tags: string
  deck: string
  logg: string
  approved: boolean
}

type AppState = 'upload' | 'generating' | 'review' | 'exporting' | 'done'

export default function Home() {
  const { user, isLoaded } = useUser()
  const { openSignIn } = useClerk()

  const authHeaders = {
    'x-user-id': user?.id || 'anonymous_user',
  }

  const [state, setState] = useState<AppState>('upload')
  const [sourceText, setSourceText] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [cards, setCards] = useState<Card[]>([])
  const [streamCards, setStreamCards] = useState<Card[]>([])
  const [streamDone, setStreamDone] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [editExtra, setEditExtra] = useState('')
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [language, setLanguage] = useState('English')
  const [quota, setQuota] = useState<{
    daily_remaining: number
    quick_refill_remaining: number
    plan: string
  } | null>(null)
  const [quotaExceeded, setQuotaExceeded] = useState(false)
  const [paymentSuccess, setPaymentSuccess] = useState(false)
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  // Restore source text after sign-in redirect
  useEffect(() => {
    if (!isLoaded || !user) return
    const saved = sessionStorage.getItem('dimindo_source_text')
    if (saved) {
      setSourceText(saved)
      sessionStorage.removeItem('dimindo_source_text')
    }
  }, [user, isLoaded])

  // Handle return from Stripe Checkout
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('payment') === 'success') {
      window.history.replaceState({}, '', '/')
      setPaymentSuccess(true)
      // Quota refreshes automatically via quota-fetch useEffect when state === 'upload'
    }
  }, [])

  // Fetch quota when user lands on or returns to upload view
  useEffect(() => {
    if (!user || !isLoaded) return
    if (state !== 'upload') return
    fetch(`${API}/api/quota?timezone=${encodeURIComponent(timezone)}`, {
      headers: { 'x-user-id': user.id },
    })
      .then(r => r.json())
      .then(data => setQuota(data))
      .catch(() => {}) // non-critical — silently ignore
  }, [user, isLoaded, state, timezone])

  // --- File Upload ---
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch(`${API}/api/upload`, {
      method: 'POST',
      headers: authHeaders,
      body: formData,
    })
    const data = await res.json()
    if (data.text) setSourceText(data.text)
  }

  // --- Card Generation with SSE Streaming ---
  async function handleGenerate() {
    if (!sourceText.trim()) return
    if (!user) {
      sessionStorage.setItem('dimindo_source_text', sourceText)
      openSignIn()
      return
    }
    setState('generating')
    setStreamCards([])
    setStreamDone(false)
    setQuotaExceeded(false)
    setError('')
    startTimer()

    const formData = new FormData()
    formData.append('source_material', sourceText)
    formData.append('language', language)
    formData.append('timezone', timezone)

    try {
      const res = await fetch(`${API}/api/generate`, {
        method: 'POST',
        headers: authHeaders,
        body: formData,
      })

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let currentSessionId = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const text = decoder.decode(value)
        const lines = text.split('\n')

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))

            if (event.type === 'session_id') {
              currentSessionId = event.session_id
              setSessionId(currentSessionId)
            } else if (event.type === 'card') {
              setStreamCards(prev => [...prev, { ...event.data, approved: true, tags: '', deck: '' }])
            } else if (event.type === 'done') {
              stopTimer()
              setStreamDone(true)
              const cardsRes = await fetch(`${API}/api/cards/${currentSessionId}`, {
                headers: authHeaders,
              })
              const cardsData = await cardsRes.json()
              setCards(cardsData.cards)
              setTimeout(() => setState('review'), 800)
            } else if (event.type === 'error') {
              stopTimer()
              if (event.message === 'quota_exceeded') {
                setQuotaExceeded(true)
              } else {
                setError(event.message)
              }
              setState('upload')
            }
          } catch (err) {
            console.error(err)
          }
        }
      }
    } catch (err) {
      stopTimer()
      setError('Something went wrong. Make sure the backend is running.')
      setState('upload')
      console.error(err)
    }
  }

  // --- Approve/Reject Cards ---
  async function toggleCard(index: number) {
    const updated = [...cards]
    updated[index].approved = !updated[index].approved
    setCards(updated)
    const card = updated[index]
    await fetch(`${API}/api/cards/${sessionId}/${card.id}`, {
      method: 'PATCH',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: card.approved }),
    })
  }

  function startEditing(index: number) {
    setEditingIndex(index)
    setEditText(cards[index].text)
    setEditExtra(cards[index].extra)
  }

  async function saveEdit(index: number) {
    const updated = [...cards]
    updated[index].text = editText
    updated[index].extra = editExtra
    setCards(updated)
    setEditingIndex(null)

    await fetch(`${API}/api/cards/${sessionId}/${cards[index].id}/content`, {
      method: 'PATCH',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: editText,
        extra: editExtra,
      }),
    })
  }

  function cancelEdit() {
    setEditingIndex(null)
  }

  function startTimer() {
    setElapsedSeconds(0)
    timerRef.current = setInterval(() => {
      setElapsedSeconds(prev => prev + 1)
    }, 1000)
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  // --- Export to .apkg ---
  async function handleExport() {
    setState('exporting')
    const res = await fetch(`${API}/api/export/${sessionId}`, {
      method: 'POST',
      headers: authHeaders,
    })
    if (!res.ok) {
      setError('Export failed.')
      setState('review')
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'dimindo_export.apkg'
    a.click()
    URL.revokeObjectURL(url)
    setState('done')
  }

  // Stripe Checkout
  async function handleCheckout(productType: 'pro' | 'quick_refill') {
    if (sourceText.trim()) {
      sessionStorage.setItem('dimindo_source_text', sourceText)
    }
    const formData = new FormData()
    formData.append('product_type', productType)
    const res = await fetch(`${API}/api/stripe/create-checkout`, {
      method: 'POST',
      headers: authHeaders,
      body: formData,
    })
    const data = await res.json()
    if (data.url) {
      window.location.href = data.url
    }
  }

  // Reset to blank upload state
  function handleNewDeck() {
    setState('upload')
    setSourceText('')
    setCards([])
    setStreamCards([])
    setQuotaExceeded(false)
    setSessionId('')
  }

  // Word count helpers
  const wordCount = sourceText.trim() === ''
    ? 0
    : sourceText.trim().split(/\s+/).filter(Boolean).length
  const wordLimit = quota?.plan === 'pro' ? 9000 : 1000
  const wordLimitExceeded = !!user && !!quota && wordCount > wordLimit

  function wordCountColor(): string {
    const pct = wordCount / wordLimit
    if (pct > 1) return '#b04a2a'
    if (pct >= 0.9) return 'var(--gold)'
    return 'var(--muted)'
  }

  function wordCountDisplay(): string | null {
    if (!user || !quota || wordCount === 0) return null
    if (quota.plan !== 'pro') {
      return `${wordCount.toLocaleString()} / 1,000 words`
    }
    if (wordCount <= 3000) {
      return `${wordCount.toLocaleString()} / 3,000 words · 1 generation`
    }
    if (wordCount <= 6000) {
      return `${wordCount.toLocaleString()} words · 2 generations`
    }
    return `${wordCount.toLocaleString()} words · 3 generations`
  }

  const approvedCount = cards.filter(c => c.approved).length

  // --- Rendering ---
  return (
    <main className={styles.root}>

      {/* ── Topbar ── */}
      <header className={styles.topbar}>
        <span className={styles.wordmark}>Dimindo</span>
        <UserButton />
      </header>

      <div className={styles.content}>

        {/* ══════════════════════════════════
            STEP 1 — Upload / Generating
        ══════════════════════════════════ */}
        {(state === 'upload' || state === 'generating') && (
          <>
            {/* Payment success confirmation */}
            {paymentSuccess && (
              <p className={styles.paymentSuccess}>
                ✓ Payment successful. Your plan has been updated.
              </p>
            )}

            {/* Quota exceeded — inline block, separate from generic errors */}
            {quotaExceeded && (
              <div className={styles.quotaError}>
                <p className={styles.quotaErrorTitle}>
                  You've used all your generations for today.
                </p>
                <p className={styles.quotaErrorSub}>
                  Next reset: tonight at midnight.
                </p>
                <div className={styles.quotaErrorActions}>
                  <button onClick={() => handleCheckout('pro')} className={styles.btnPrimary}>
                    Upgrade to Pro →
                  </button>
                  <button onClick={() => handleCheckout('quick_refill')} className={styles.btnSecondary}>
                    Buy a Quick Refill →
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div className={styles.error}>
                <span className={styles.errorIcon}>⚠</span>
                <div className={styles.errorBody}>
                  <p className={styles.errorTitle}>Something went wrong</p>
                  <p className={styles.errorMsg}>{error}</p>
                </div>
                <button onClick={() => setError('')} className={styles.errorClose}>
                  ×
                </button>
              </div>
            )}

            <p className={styles.eyebrow}>New deck</p>

            {user && quota && state === 'upload' && (
              <p className={styles.quotaIndicator}>
                {quota.daily_remaining} generation{quota.daily_remaining !== 1 ? 's' : ''} remaining today · {quota.quick_refill_remaining} Quick Refill
              </p>
            )}

            <h1 className={styles.heading}>Upload your source material</h1>

            <textarea
              className={styles.textarea}
              placeholder="Paste your source material here…"
              value={sourceText}
              onChange={e => setSourceText(e.target.value)}
              disabled={state === 'generating'}
              autoFocus
            />

            {state === 'upload' && user && quota && wordCountDisplay() && (
              <p
                className={styles.wordCounter}
                style={{ color: wordCountColor() }}
              >
                {wordCountDisplay()}
              </p>
            )}

            {state === 'upload' && (
              <div className={styles.settingsRow}>
                <select
                  className={styles.langSelect}
                  value={language}
                  onChange={e => setLanguage(e.target.value)}
                >
                  <option value="English">🇬🇧 English</option>
                  <option value="Swedish">🇸🇪 Swedish</option>
                  <option value="German">🇩🇪 German</option>
                  <option value="French">🇫🇷 French</option>
                  <option value="Spanish">🇪🇸 Spanish</option>
                </select>
              </div>
            )}

            <div className={styles.buttonRow}>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={state === 'generating'}
                className={styles.btnSecondary}
              >
                Upload file (.txt / .pdf)
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.pdf"
                className={styles.fileInput}
                onChange={handleFileUpload}
              />
              <button
                onClick={handleGenerate}
                disabled={!sourceText.trim() || state === 'generating' || wordLimitExceeded}
                className={styles.btnPrimary}
              >
                {state === 'generating' ? 'Generating…' : 'Generate cards →'}
              </button>
            </div>

            {/* Process view — replaces text streaming */}
            {state === 'generating' && (
              <div className={styles.processView}>
                <div className={styles.streamHeader}>
                  <p className={styles.streamLabel}>
                    <span className={streamDone ? styles.scanDotDone : styles.scanDot} />
                    {streamDone
                      ? `DONE — ${streamCards.length} CARDS GENERATED`
                      : 'ANALYSING SOURCE MATERIAL…'}
                  </p>
                  <span className={styles.timer}>
                    {Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, '0')}
                  </span>
                </div>
                <div className={styles.streamCardsList}>
                  {streamCards.map((card, i) => (
                    <div key={card.id || i} className={styles.streamCard}>
                      <div className={styles.card}>
                        <p
                          className={styles.cardTextContent}
                          dangerouslySetInnerHTML={{
                            __html: card.text.replace(/\{\{c1::(.*?)\}\}/g, '<strong>$1</strong>'),
                          }}
                        />
                        {card.extra && (
                          <p className={styles.cardExtra}>{card.extra}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ══════════════════════════════════
            STEP 2 — Review
        ══════════════════════════════════ */}
        {state === 'review' && (
          <>
            <button className={styles.reviewBack} onClick={handleNewDeck}>
              ← New deck
            </button>

            <div className={styles.reviewHeader}>
              <div>
                <h2 className={styles.reviewTitle}>Review cards</h2>
                <p className={styles.reviewCount}>
                  {approvedCount} of {cards.length} cards approved
                </p>
              </div>
              <button
                onClick={handleExport}
                disabled={approvedCount === 0}
                className={styles.exportBtn}
              >
                Export {approvedCount} cards as .apkg →
              </button>
            </div>

            <div className={styles.cardsList}>
              {cards.map((card, i) => (
                <div
                  key={i}
                  className={`${styles.card}${!card.approved ? ` ${styles.cardRejected}` : ''}`}
                >
                  {editingIndex === i ? (
                    <div className={styles.editForm}>
                      <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>Text</label>
                        <textarea
                          className={styles.fieldTextarea}
                          rows={3}
                          value={editText}
                          onChange={e => setEditText(e.target.value)}
                          autoFocus
                        />
                      </div>
                      <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>Extra</label>
                        <textarea
                          className={styles.fieldTextarea}
                          rows={2}
                          value={editExtra}
                          onChange={e => setEditExtra(e.target.value)}
                        />
                      </div>
                      <div className={styles.editActions}>
                        <button onClick={cancelEdit} className={styles.btnSmallGhost}>
                          Cancel
                        </button>
                        <button onClick={() => saveEdit(i)} className={styles.btnSmallDark}>
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className={styles.cardContent}>
                      <div className={styles.cardFront} onClick={() => startEditing(i)}>
                        <p
                          className={styles.cardTextContent}
                          dangerouslySetInnerHTML={{
                            __html: card.text.replace(
                              /\{\{c1::(.*?)\}\}/g,
                              '<strong>$1</strong>'
                            ),
                          }}
                        />
                        {card.extra && (
                          <p className={styles.cardExtra}>{card.extra}</p>
                        )}
                        {card.logg && (
                          <p className={styles.cardLogg}>
                            {card.logg.startsWith('Korrigerat')
                              ? '⚠ Corrected: ' + card.logg.replace(/^Korrigerat från källans uppgift om /, '')
                              : '+ Additional fact'}
                          </p>
                        )}
                        <p className={styles.cardHint}>Click to edit</p>
                      </div>
                      <button
                        onClick={() => toggleCard(i)}
                        className={`${styles.approveBtn}${card.approved ? ` ${styles.approveBtnOn}` : ''}`}
                      >
                        {card.approved ? '✓' : ''}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className={styles.exportActions}>
              <button
                onClick={handleExport}
                disabled={approvedCount === 0}
                className={styles.exportBtn}
              >
                Export {approvedCount} cards as .apkg →
              </button>
            </div>
          </>
        )}

        {/* ══════════════════════════════════
            STEP 3 — Exporting
        ══════════════════════════════════ */}
        {state === 'exporting' && (
          <p className={styles.exportingMsg}>
            Building .apkg file…
          </p>
        )}

        {/* ══════════════════════════════════
            STEP 4 — Done
        ══════════════════════════════════ */}
        {state === 'done' && (
          <>
            <div className={styles.doneBox}>
              <h2 className={styles.doneTitle}>File downloaded</h2>
              <p className={styles.doneMsg}>
                Open dimindo_export.apkg to import into Anki.
              </p>
            </div>
            <button onClick={handleNewDeck} className={styles.resetBtn}>
              Generate new cards →
            </button>
          </>
        )}

      </div>
    </main>
  )
}