'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useUser, useClerk } from '@clerk/nextjs'
import ReactMarkdown from 'react-markdown'
import Navbar from './components/Navbar'
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

type AiMessage = { role: 'user' | 'assistant'; content: string }

type Session = {
  session_id: string
  title: string | null
  created_at: string
  card_count: number
}

type AppState = 'upload' | 'generating' | 'review' | 'exporting' | 'done'

type Quota =
  | {
      plan: 'free'
      lifetime_used: number
      lifetime_limit: number
      lifetime_remaining: number
      quick_refill_remaining: number
    }
  | {
      plan: 'pro'
      monthly_used: number
      monthly_limit: number
      monthly_remaining: number
      monthly_reset_at: string
      quick_refill_remaining: number
    }

// Preset Study-Assistant questions, keyed by the same output-language values the
// language <select> emits ('English' | 'Swedish' | 'German' | 'French' |
// 'Spanish'). These are the empty-state entry points into the AI chat; clicking
// one sends it verbatim as the first message. The backend system prompt mirrors
// the student's language automatically, so the only requirement here is that the
// suggestion text itself matches the language the cards were generated in.
//
// Lookups fall back to English when the key is missing — which is exactly the
// desired behaviour for historical sessions loaded via ?session_id= (those load
// on a fresh page where `language` holds its default 'English'; the output
// language is not persisted in the DB, and English fallback is the accepted
// behaviour per spec).
const AI_SUGGESTIONS: Record<string, [string, string, string]> = {
  English: [
    'Explain card 1',
    'Give me a memory trick for this topic',
    "What's the broader context here?",
  ],
  Swedish: [
    'Förklara kort 1',
    'Ge mig ett minnesknep för det här ämnet',
    'Vad är det större sammanhanget här?',
  ],
  German: [
    'Erkläre Karte 1',
    'Gib mir einen Merktrick für dieses Thema',
    'Was ist der größere Kontext hier?',
  ],
  French: [
    'Explique la carte 1',
    'Donne-moi un moyen mnémotechnique pour ce sujet',
    'Quel est le contexte plus large ici ?',
  ],
  Spanish: [
    'Explica la tarjeta 1',
    'Dame un truco mnemónico para este tema',
    '¿Cuál es el contexto más amplio aquí?',
  ],
}

function SidebarIcon() {
  return (
    <svg width="15" height="14" viewBox="0 0 15 14" fill="currentColor" aria-hidden="true">
      <rect x="0" y="0" width="4.5" height="14" rx="1.5" />
      <rect x="6.5" y="0" width="8.5" height="5.5" rx="1" />
      <rect x="6.5" y="8.5" width="8.5" height="5.5" rx="1" />
    </svg>
  )
}

// O5 — auto-grow helper for the edit textareas. DOM-only (no state/props), so
// it is defined at module scope and stays referentially stable: as a ref
// callback it sizes the field to its content on mount, and is called again
// from onChange so the field grows as the user types.
function autoResize(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

// Pencil icon used as the persistent edit affordance in the card header strip.
function PencilIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17z" />
      <path d="M13.5 6.5l3 3" />
    </svg>
  )
}

// Zone 3 (log) — formats the non-editable CORRECTED / EXTERNAL marking, or
// returns null so the zone is omitted entirely when there is no marking.
function loggDisplay(logg?: string): string | null {
  if (!logg) return null
  if (logg.startsWith('CORRECTED:')) return 'ⓘ ' + logg.replace(/^CORRECTED: /, '')
  if (logg.startsWith('EXTERNAL:')) return '+ ' + logg.replace(/^EXTERNAL: /, '')
  return null
}

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
  const [deckName, setDeckName] = useState('')
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [language, setLanguage] = useState('English')
  const [quota, setQuota] = useState<Quota | null>(null)
  const [quotaExceeded, setQuotaExceeded] = useState(false)
  const [quotaExceededReason, setQuotaExceededReason] = useState<
    'lifetime_quota_exceeded' | 'monthly_quota_exceeded' | null
  >(null)
  const [paymentSuccess, setPaymentSuccess] = useState(false)
  const [sourceMaterial, setSourceMaterial] = useState<string | null>(null)
  const [showSource, setShowSource] = useState(false)

  // One-time educational modal: shown the first time a Pro user generates with
  // text over 3,000 words (a 2–3 pool-generation upload). Gated by localStorage.
  const [showMultiGenModal, setShowMultiGenModal] = useState(false)

  // ── AI Chat state ──────────────────────────────────────
  const [aiOpen, setAiOpen] = useState(false)
  const [aiMessages, setAiMessages] = useState<AiMessage[]>([])
  const [aiInput, setAiInput] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const aiMessagesEndRef = useRef<HTMLDivElement>(null)
  // ──────────────────────────────────────────────────────

  // ── Sidebar state ──────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarSessions, setSidebarSessions] = useState<Session[]>([])
  const [sidebarLoading, setSidebarLoading] = useState(false)
  // ──────────────────────────────────────────────────────

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  // Auto-scroll AI messages to bottom
  useEffect(() => {
    aiMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [aiMessages, aiLoading])

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
    }
  }, [])

  // Load a previous session from ?session_id= URL param (e.g. from /history)
  useEffect(() => {
    if (!isLoaded || !user) return
    const params = new URLSearchParams(window.location.search)
    const sid = params.get('session_id')
    if (!sid) return
    window.history.replaceState({}, '', '/')
    fetch(`${API}/api/cards/${sid}`, {
      headers: { 'x-user-id': user.id },
    })
      .then(r => r.json())
      .then(data => {
        const loaded = data.cards ?? []
        setCards(loaded)
        // Pre-fill the deck name from the loaded session so the field reflects
        // the stored name (avoids an empty field overwriting it on blur).
        const storedDeck = loaded[0]?.deck ?? ''
        setDeckName(storedDeck === 'Huvudmeny' ? '' : storedDeck)
        setSessionId(sid)
        setState('review')
        fetch(`${API}/api/sessions/${sid}/source`, {
          headers: { 'x-user-id': user.id },
        })
          .then(r => r.json())
          .then(src => setSourceMaterial(src.source_material ?? null))
          .catch(() => {})
      })
      .catch(() => {})
  }, [user, isLoaded])

  // Fetch quota when user lands on or returns to upload view
  useEffect(() => {
    if (!user || !isLoaded) return
    if (state !== 'upload') return
    fetch(`${API}/api/quota?timezone=${encodeURIComponent(timezone)}`, {
      headers: { 'x-user-id': user.id },
    })
      .then(r => r.json())
      .then(data => setQuota(data))
      .catch(() => {})
  }, [user, isLoaded, state, timezone])

  // Fetch session history for sidebar (eager — no loading flash on open)
  useEffect(() => {
    if (!user || !isLoaded) return
    setSidebarLoading(true)
    fetch(`${API}/api/sessions`, {
      headers: { 'x-user-id': user.id },
    })
      .then(r => r.json())
      .then(data => setSidebarSessions(Array.isArray(data) ? data : (data.sessions ?? [])))
      .catch(() => {})
      .finally(() => setSidebarLoading(false))
  }, [user, isLoaded])

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
  // handleGenerate runs the guards (auth, then the one-time multi-generation
  // education gate for Pro). runGeneration holds the actual streaming flow, so
  // the modal's "Confirm & Generate" can re-enter it directly without re-running
  // the guards.
  async function handleGenerate() {
    if (!sourceText.trim()) return
    if (!user) {
      sessionStorage.setItem('dimindo_source_text', sourceText)
      openSignIn()
      return
    }

    // One-time educational modal — first time a Pro user generates with text
    // over 3,000 words (i.e. an upload that costs 2 or 3 pool generations).
    // Once seen, the localStorage flag suppresses it for good, on any device
    // this browser keeps.
    if (quota?.plan === 'pro' && wordCount > 3000) {
      let seen = false
      try {
        seen = !!localStorage.getItem('dimindo_multi_gen_educated')
      } catch {
        seen = false
      }
      if (!seen) {
        setShowMultiGenModal(true)
        return
      }
    }

    await runGeneration()
  }

  // The actual generation + SSE streaming flow. Entered from handleGenerate
  // (gate cleared) or from the modal's Confirm button.
  async function runGeneration() {
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
              fetch(`${API}/api/sessions/${currentSessionId}/source`, {
                headers: authHeaders,
              })
                .then(r => r.json())
                .then(data => setSourceMaterial(data.source_material ?? null))
                .catch(() => {})
              setTimeout(() => setState('review'), 800)
            } else if (event.type === 'error') {
              stopTimer()
              if (event.message === 'quota_exceeded') {
                setQuotaExceeded(true)
                setQuotaExceededReason(
                  event.reason === 'monthly_quota_exceeded'
                    ? 'monthly_quota_exceeded'
                    : 'lifetime_quota_exceeded'
                )
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

  // Multi-generation education modal — both buttons mark it as "seen" so it
  // never appears again, regardless of which one the user picks (per spec).
  function confirmMultiGen() {
    try {
      localStorage.setItem('dimindo_multi_gen_educated', '1')
    } catch {
      // storage unavailable (private mode, disabled) — proceed anyway
    }
    setShowMultiGenModal(false)
    runGeneration()
  }

  function dismissMultiGen() {
    try {
      localStorage.setItem('dimindo_multi_gen_educated', '1')
    } catch {
      // ignore — flag is best-effort
    }
    setShowMultiGenModal(false)
  }

  // --- AI Chat ---
  // Accepts an optional preset question (from the empty-state suggestions).
  // The `typeof preset === 'string'` guard means an accidental click event
  // passed as the argument falls back to the textarea value.
  async function handleAiSend(preset?: string) {
    const text = typeof preset === 'string' ? preset : aiInput
    if (!text.trim() || aiLoading) return
    const userMsg: AiMessage = { role: 'user', content: text.trim() }
    const newMessages = [...aiMessages, userMsg]
    setAiMessages(newMessages)
    setAiInput('')
    setAiLoading(true)
    try {
      const res = await fetch(`${API}/api/explain`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_material: sourceMaterial,
          cards,
          messages: newMessages,
        }),
      })
      const data = await res.json()
      setAiMessages(prev => [
        ...prev,
        { role: 'assistant', content: data.response ?? 'No response received.' },
      ])
    } catch {
      setAiMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Something went wrong. Please try again.' },
      ])
    } finally {
      setAiLoading(false)
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

  // Apply the deck name to every card in the session. The value is persisted
  // through the existing content-PATCH (the backend accepts a `deck` field), so
  // the export contract stays untouched — export reads card.deck server-side.
  // An empty name writes '' to all cards, so export then carries no deck name
  // (no fallback, no blocking), exactly as specified.
  async function applyDeckName(name: string) {
    if (!sessionId || cards.length === 0) return
    const updated = cards.map(c => ({ ...c, deck: name }))
    setCards(updated)
    await Promise.all(
      updated.map(card =>
        fetch(`${API}/api/cards/${sessionId}/${card.id}/content`, {
          method: 'PATCH',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: card.text, extra: card.extra, deck: name }),
        })
      )
    )
  }

  // --- Export to .apkg ---
  async function handleExport() {
    // Persist the latest deck name first — covers the case where the field
    // still has focus and its onBlur write hasn't fired yet.
    await applyDeckName(deckName)
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

  // Reset to blank upload state — clears AI chat too
  function handleNewDeck() {
    setState('upload')
    setSourceText('')
    setCards([])
    setStreamCards([])
    setQuotaExceeded(false)
    setQuotaExceededReason(null)
    setSourceMaterial(null)
    setShowSource(false)
    setSessionId('')
    setDeckName('')
    setShowMultiGenModal(false)
    setAiOpen(false)
    setAiMessages([])
    setAiInput('')
    setAiLoading(false)
  }

  // ── Word count + quota-aware limit ─────────────────────
  const wordCount = sourceText.trim() === ''
    ? 0
    : sourceText.trim().split(/\s+/).filter(Boolean).length

  // Effective per-upload word ceiling, derived from the live quota:
  //   Free, no Quick Refill      → 2,000
  //   Free + Quick Refill        → 3,000  (QR allows 3,000 on any plan)
  //   Pro, monthly pool left     → 9,000
  //   Pro, pool empty + QR       → 3,000  (QR upload, capped at 3,000)
  //   Pro, pool empty + no QR    → 9,000  (nominal — the quota wall takes over)
  // Returns null while quota is still loading, so the counter degrades to a
  // neutral placeholder rather than flashing a wrong limit.
  function effectiveWordLimit(): number | null {
    if (!quota) return null
    if (quota.plan === 'pro') {
      if (quota.monthly_remaining > 0) return 9000
      return quota.quick_refill_remaining > 0 ? 3000 : 9000
    }
    return quota.quick_refill_remaining > 0 ? 3000 : 2000
  }

  // Pro-only: monthly-pool generations an upload of this size consumes. QR
  // uploads always cost exactly 1 credit, but they are capped at 3,000 words,
  // so this never mis-reports in QR mode (≤3,000 → 1).
  function generationCost(words: number): 1 | 2 | 3 {
    if (words <= 3000) return 1
    if (words <= 6000) return 2
    return 3
  }

  const wordLimit = effectiveWordLimit()
  const wordLimitExceeded = !!user && wordLimit !== null && wordCount > wordLimit
  const wordLimitOver = wordLimit !== null ? wordCount - wordLimit : 0

  // P1b — idle "awaiting input" styling applies only when the textarea is
  // empty (not while generating, not when over the word limit).
  const generateIdle = state === 'upload' && sourceText.trim() === ''

  function wordCountColor(): string {
    if (wordLimit === null) return 'var(--muted)'
    const pct = wordCount / wordLimit
    if (pct > 1) return '#b04a2a'
    if (pct >= 0.9) return 'var(--gold)'
    return 'var(--muted)'
  }

  // Word counter — count / effective limit. Generation cost has moved to its
  // own line (generationCostDisplay), so this stays a pure "words" metric.
  // en-US locale forces comma grouping regardless of the browser locale, so it
  // always reads "1,847 / 2,000" in the English product.
  function wordCountDisplay(): string | null {
    if (!user || !quota || wordLimit === null || wordCount === 0) return null
    return `${wordCount.toLocaleString('en-US')} / ${wordLimit.toLocaleString('en-US')} words`
  }

  // Muted sub-line under the counter: when/that Quick Refill applies.
  function quotaSuffix(): string | null {
    if (!quota) return null
    if (quota.plan === 'free' && quota.lifetime_remaining > 0 && quota.quick_refill_remaining > 0) {
      return 'Quick Refill activates after 2,000'
    }
    if (
      quota.plan === 'pro' &&
      quota.monthly_remaining === 0 &&
      quota.quick_refill_remaining > 0
    ) {
      return 'Quick Refill active'
    }
    return null
  }

  // Pro-only real-time generation-cost line, shown above the word counter.
  function generationCostDisplay(): string | null {
    if (!quota || quota.plan !== 'pro' || wordCount === 0) return null
    const cost = generationCost(wordCount)
    if (cost === 1) return '1 generation'
    if (cost === 2) return '2 generations · longer text'
    return '3 generations · full analysis'
  }

  // Quota indicator helpers
  function formatResetDate(isoString: string): string {
    return new Date(isoString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })
  }

  function quotaIndicatorText(): string | null {
    if (!user || !quota) return null
    const refill = quota.quick_refill_remaining
    const refillSuffix = `${refill} Quick Refill generation${refill !== 1 ? 's' : ''} remaining`

    if (quota.plan === 'free') {
      const base = `${quota.lifetime_remaining} free generation${quota.lifetime_remaining !== 1 ? 's' : ''} remaining`
      return refill > 0 ? `${base} · ${refillSuffix}` : base
    }

    // pro plan
    const resetLabel = `Resets ${formatResetDate(quota.monthly_reset_at)}`
    if (quota.monthly_remaining === 0) {
      const base = `No generations remaining · ${resetLabel}`
      return refill > 0 ? `${base} · ${refillSuffix}` : base
    }
    const base = `${quota.monthly_remaining} generation${quota.monthly_remaining !== 1 ? 's' : ''} remaining this month · ${resetLabel}`
    return refill > 0 ? `${base} · ${refillSuffix}` : base
  }

  const approvedCount = cards.filter(c => c.approved).length

  // Free plan genuinely near the wall: 0-1 lifetime generations left AND no
  // Quick Refill credits to fall back on. Only then do we surface the proactive
  // upgrade link in the quota indicator. Never on Pro, never while QR credits
  // remain (the user still has generations via the QR pool), never at >= 2
  // lifetime generations left.
  const showPlansLink =
    !!quota &&
    quota.plan === 'free' &&
    quota.lifetime_remaining <= 1 &&
    quota.quick_refill_remaining === 0

  function formatDate(iso: string): string {
    const d = new Date(iso)
    const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    return `${date} at ${time}`
  }

  // --- Rendering ---
  return (
    <main className={[
      styles.root,
      sidebarOpen ? styles.rootSidebarOpen : '',
    ].filter(Boolean).join(' ')}>

      {/* ── Topbar (shared) ── */}
      <Navbar />

      <div className={styles.content}>

        {/* ══════════════════════════════════
            STEP 1 — Upload / Generating
        ══════════════════════════════════ */}
        {(state === 'upload' || state === 'generating') && (
          <>
            {paymentSuccess && (
              <p className={styles.paymentSuccess}>
                ✓ Payment successful. Your plan has been updated.
              </p>
            )}

            {quotaExceeded && (
              <div className={styles.quotaError}>
                {quotaExceededReason === 'monthly_quota_exceeded' ? (
                  <>
                    <p className={styles.quotaErrorTitle}>
                      You&apos;ve used all generations for this month.
                    </p>
                    <p className={styles.quotaErrorSub}>
                      Buy a Quick Refill to continue.
                    </p>
                    <div className={styles.quotaErrorActions}>
                      <div className={styles.quotaOption}>
                        <button onClick={() => handleCheckout('quick_refill')} className={styles.btnPrimary}>
                          Buy a Quick Refill →
                        </button>
                        <p className={styles.quotaOptionDesc}>
                          One-time purchase · 5 generations · never expires
                        </p>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <p className={styles.quotaErrorTitle}>
                      You&apos;ve used all 3 lifetime generations.
                    </p>
                    <p className={styles.quotaErrorSub}>
                      See your options on the pricing page.
                    </p>
                    <div className={styles.quotaErrorActions}>
                      <div className={styles.quotaOption}>
                        <Link href="/pricing" className={styles.btnPrimary}>
                          View plans →
                        </Link>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            <p className={styles.eyebrow}>New deck</p>

            {user && quota && state === 'upload' && quotaIndicatorText() && (
              <p className={styles.quotaIndicator}>
                {quotaIndicatorText()}
                {showPlansLink && (
                  <>
                    {' · '}
                    <Link href="/pricing" className={styles.quotaIndicatorLink}>
                      View plans →
                    </Link>
                  </>
                )}
              </p>
            )}

            <h1 className={styles.heading}>Upload your source material</h1>

            {/* P3 — error banner anchored directly above the textarea that caused it */}
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

            <textarea
              className={styles.textarea}
              placeholder="Paste your source material here…"
              value={sourceText}
              onChange={e => setSourceText(e.target.value)}
              disabled={state === 'generating'}
              autoFocus
            />

            {/* Counter stack — generation cost (Pro, top) · count/limit · QR
                suffix (bottom). While quota is still loading we show a neutral
                placeholder so a wrong limit never flashes in. */}
            {state === 'upload' && user && wordCount > 0 && (
              <div className={styles.counterStack}>
                {generationCostDisplay() && (
                  <p className={styles.counterMeta}>{generationCostDisplay()}</p>
                )}
                {quota ? (
                  <>
                    <p
                      className={styles.wordCounter}
                      style={{ color: wordCountColor() }}
                    >
                      {wordCountDisplay()}
                    </p>
                    {quotaSuffix() && (
                      <p className={styles.counterMeta}>{quotaSuffix()}</p>
                    )}
                  </>
                ) : (
                  <p className={styles.counterPlaceholder}>— / — words</p>
                )}
              </div>
            )}

            {state === 'upload' && (
              <div className={styles.settingsRow}>
                <label htmlFor="lang-select" className={styles.settingsLabel}>
                  Output language:
                </label>
                <select
                  id="lang-select"
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
                className={[styles.btnPrimary, generateIdle ? styles.btnPrimaryIdle : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                {state === 'generating' ? 'Generating…' : 'Generate cards →'}
              </button>
            </div>

            {/* P2 — explicit reason the Generate button is disabled when over the limit */}
            {state === 'upload' && wordLimitExceeded && (
              <p className={styles.limitNotice}>
                {wordLimitOver.toLocaleString('en-US')} word
                {wordLimitOver !== 1 ? 's' : ''} over the limit — shorten your text to continue.
              </p>
            )}

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
                  {streamCards.map((card, i) => {
                    const logg = loggDisplay(card.logg)
                    const showPanel = !!(card.text?.trim() || card.extra?.trim())
                    return (
                      <div key={card.id || i} className={styles.streamCard}>
                        {/* Card shell — same zone structure as the review cards,
                            with a number-only header (pencil/approve are review
                            interactions and would be inert mid-stream). */}
                        <div className={styles.card}>
                          <div className={styles.cardHeader}>
                            <span className={styles.cardNumber}>
                              {String(i + 1).padStart(2, '0')}
                            </span>
                          </div>

                          {showPanel && (
                            <div className={styles.cardPanel}>
                              <div className={styles.clozeZone}>
                                <p
                                  className={styles.cardTextContent}
                                  dangerouslySetInnerHTML={{
                                    __html: (card.text || '').replace(
                                      /\{\{c1::(.*?)\}\}/g,
                                      '<strong>$1</strong>'
                                    ),
                                  }}
                                />
                              </div>
                              {card.extra?.trim() && (
                                <div className={styles.extraZone}>
                                  <p className={styles.cardExtra}>{card.extra}</p>
                                </div>
                              )}
                            </div>
                          )}

                          {logg && <div className={styles.loggZone}>{logg}</div>}
                        </div>
                      </div>
                    )
                  })}
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

            {sourceMaterial && (
              <button
                className={styles.sourceToggle}
                onClick={() => setShowSource(prev => !prev)}
              >
                {showSource ? 'Hide source material ↑' : 'Show source material ↓'}
              </button>
            )}

            {sourceMaterial && showSource && (
              <div className={styles.sourcePanel}>
                <p className={styles.sourceText}>{sourceMaterial}</p>
              </div>
            )}

            <div className={styles.cardsList}>
              {cards.map((card, i) => {
                const logg = loggDisplay(card.logg)
                // Zone 1 stays visible whenever either field has content — so an
                // emptied cloze with surviving extra keeps both zones (the cloze
                // zone simply renders as an empty band). Hidden only when both
                // fields are empty.
                const showPanel = !!(card.text.trim() || card.extra.trim())
                return (
                  <div
                    key={i}
                    className={`${styles.card}${!card.approved ? ` ${styles.cardRejected}` : ''}`}
                  >
                    {editingIndex === i ? (
                      <div className={styles.editForm}>
                        <div className={styles.fieldGroup}>
                          <label className={styles.fieldLabel}>Cloze text</label>
                          <textarea
                            className={styles.fieldTextarea}
                            rows={3}
                            ref={autoResize}
                            value={editText}
                            onChange={e => { setEditText(e.target.value); autoResize(e.target) }}
                            autoFocus
                          />
                        </div>
                        <div className={styles.fieldGroup}>
                          <label className={styles.fieldLabel}>Back extra</label>
                          <textarea
                            className={styles.fieldTextarea}
                            rows={2}
                            ref={autoResize}
                            value={editExtra}
                            onChange={e => { setEditExtra(e.target.value); autoResize(e.target) }}
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
                      <>
                        {/* Header strip — always visible: number, persistent
                            edit pencil, approve toggle (Fork 2b, right-aligned). */}
                        <div className={styles.cardHeader}>
                          <span className={styles.cardNumber}>
                            {String(i + 1).padStart(2, '0')}
                          </span>
                          <button
                            className={styles.cardEditBtn}
                            onClick={() => startEditing(i)}
                            aria-label="Edit card"
                          >
                            <PencilIcon />
                          </button>
                          <button
                            onClick={() => toggleCard(i)}
                            className={`${styles.approveBtn}${card.approved ? ` ${styles.approveBtnOn}` : ''}`}
                            aria-label={card.approved ? 'Approved, click to reject' : 'Rejected, click to approve'}
                          >
                            {card.approved ? '✓' : ''}
                          </button>
                        </div>

                        {/* Zone 1 + Zone 2 — shared white panel, hairline between */}
                        {showPanel && (
                          <div
                            className={`${styles.cardPanel} ${styles.cardPanelEditable}`}
                            onClick={() => startEditing(i)}
                          >
                            <div className={styles.clozeZone}>
                              <p
                                className={styles.cardTextContent}
                                dangerouslySetInnerHTML={{
                                  __html: (card.text || '').replace(
                                    /\{\{c1::(.*?)\}\}/g,
                                    '<strong>$1</strong>'
                                  ),
                                }}
                              />
                            </div>
                            {card.extra.trim() && (
                              <div className={styles.extraZone}>
                                <p className={styles.cardExtra}>{card.extra}</p>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Zone 3 — log: separate block, never editable */}
                        {logg && <div className={styles.loggZone}>{logg}</div>}
                      </>
                    )}
                  </div>
                )
              })}
            </div>

            <div className={styles.exportActions}>
              <div className={styles.deckField}>
                <label htmlFor="deck-name" className={styles.deckFieldLabel}>
                  Anki deck name
                </label>
                <textarea
                  id="deck-name"
                  className={styles.deckInput}
                  rows={1}
                  ref={autoResize}
                  value={deckName}
                  onChange={e => {
                    // A deck name is logically one line — strip any newlines
                    // (e.g. from a paste) so the field can wrap visually but
                    // never carry a literal line break.
                    const cleaned = e.target.value.replace(/[\r\n]+/g, '')
                    setDeckName(cleaned)
                    autoResize(e.target)
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') e.preventDefault()
                  }}
                  onBlur={() => applyDeckName(deckName)}
                  placeholder="e.g. History — World War II"
                />
              </div>
              <button
                onClick={handleExport}
                disabled={approvedCount === 0}
                className={styles.exportBtn}
              >
                Export {approvedCount} cards as .apkg →
              </button>
            </div>

            {/* ── AI Float Button ── */}
            {!aiOpen && (
              <button
                className={styles.aiFloatBtn}
                onClick={() => setAiOpen(true)}
                aria-label="Open Study Assistant"
              >
                AI
              </button>
            )}

            {/* ── AI Chat Panel ── */}
            {aiOpen && (
              <div className={styles.aiPanel}>
                <div className={styles.aiPanelHeader}>
                  <span className={styles.aiPanelTitle}>Study Assistant</span>
                  <button
                    className={styles.aiPanelClose}
                    onClick={() => setAiOpen(false)}
                    aria-label="Close Study Assistant"
                  >
                    ×
                  </button>
                </div>

                <div className={styles.aiMessages}>
                  {aiMessages.length === 0 && !aiLoading && (
                    <div className={styles.aiEmpty}>
                      <p className={styles.aiEmptyState}>
                        Ask about any card or concept in your source material.
                      </p>
                      <div className={styles.aiSuggestions}>
                        {/* Preset questions in the output language chosen at
                            generation time. Falls back to English for historical
                            sessions (?session_id=), where `language` is its
                            default 'English' because the output language is not
                            persisted in the DB. */}
                        {(AI_SUGGESTIONS[language] ?? AI_SUGGESTIONS.English).map(q => (
                          <button
                            key={q}
                            className={styles.aiSuggestion}
                            onClick={() => handleAiSend(q)}
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {aiMessages.map((msg, i) => (
                    <div
                      key={i}
                      className={msg.role === 'user' ? styles.aiMsgUser : styles.aiMsgAssistant}
                    >
                      {msg.role === 'user' ? (
                        <p className={styles.aiMsgContentUser}>{msg.content}</p>
                      ) : (
                        <div className={styles.aiMsgContentAssistant}>
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  ))}
                  {aiLoading && (
                    <div className={styles.aiMsgAssistant}>
                      <p className={styles.aiMsgContentLoading}>···</p>
                    </div>
                  )}
                  <div ref={aiMessagesEndRef} />
                </div>

                <div className={styles.aiInputArea}>
                  <textarea
                    className={styles.aiTextarea}
                    value={aiInput}
                    onChange={e => setAiInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleAiSend()
                      }
                    }}
                    placeholder="Ask a question…"
                    rows={2}
                    disabled={aiLoading}
                  />
                  <button
                    onClick={() => handleAiSend()}
                    disabled={!aiInput.trim() || aiLoading}
                    className={styles.aiSendBtn}
                  >
                    Send
                  </button>
                </div>
              </div>
            )}
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
                dimindo_export.apkg is ready to import into Anki.
              </p>
              <ol className={styles.doneSteps}>
                <li>Open Anki and choose <strong>File → Import</strong>.</li>
                <li>Select <strong>dimindo_export.apkg</strong>.</li>
              </ol>
              <a
                href="https://apps.ankiweb.net/"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.doneSecondary}
              >
                New to Anki? Download it →
              </a>
            </div>
            <button onClick={handleNewDeck} className={styles.resetBtn}>
              Generate new cards →
            </button>
          </>
        )}

      </div>

      {/* ══════════════════════════════════
          Multi-generation education modal (Pro · >3,000 words · once)
      ══════════════════════════════════ */}
      {showMultiGenModal && quota?.plan === 'pro' && (
        <div className={styles.modalOverlay} role="presentation">
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="multigen-title"
          >
            <h2 id="multigen-title" className={styles.modalTitle}>
              Advanced analysis
            </h2>
            <p className={styles.modalBody}>
              Your text is {wordCount.toLocaleString('en-US')} words. To thoroughly
              analyze all your material and generate high-quality flashcards, this
              will use {generationCost(wordCount)} of your monthly generations. You
              have {quota.monthly_remaining} generation
              {quota.monthly_remaining !== 1 ? 's' : ''} remaining this period.
            </p>
            <div className={styles.modalActions}>
              <button onClick={dismissMultiGen} className={styles.modalBtnGhost}>
                Shorten text
              </button>
              <button onClick={confirmMultiGen} className={styles.modalBtnSolid}>
                Confirm &amp; Generate →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sidebar Drawer ── */}
      {user && (
        <>
          <aside className={`${styles.sidebar}${sidebarOpen ? ` ${styles.sidebarOpen}` : ''}`}>
            <div className={styles.sidebarHeader}>
              <span className={styles.sidebarTitle}>Recents</span>
              <button
                className={styles.sidebarIconBtn}
                onClick={() => setSidebarOpen(false)}
                aria-label="Close sidebar"
              >
                <SidebarIcon />
              </button>
            </div>
            <div className={styles.sidebarList}>
              {sidebarLoading && (
                <p className={styles.sidebarEmpty}>Loading…</p>
              )}
              {!sidebarLoading && sidebarSessions.length === 0 && (
                <p className={styles.sidebarEmpty}>No sessions yet.</p>
              )}
              {sidebarSessions.map(session => (
                <a
                  key={session.session_id}
                  href={`/?session_id=${session.session_id}`}
                  className={styles.sidebarItem}
                >
                  <p className={styles.sidebarItemTitle}>
                    {session.title || 'Untitled session'}
                  </p>
                  <p className={styles.sidebarItemMeta}>
                    {formatDate(session.created_at)} · {session.card_count} card{session.card_count !== 1 ? 's' : ''}
                  </p>
                </a>
              ))}
            </div>
          </aside>

          {!sidebarOpen && (
            <button
              className={styles.sidebarToggle}
              onClick={() => setSidebarOpen(true)}
              aria-label="Open recent sessions"
              data-tooltip="Recent sessions"
            >
              <SidebarIcon />
            </button>
          )}
        </>
      )}

    </main>
  )
}