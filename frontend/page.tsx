'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { UserButton, useUser, SignInButton } from '@clerk/nextjs'

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
  const router = useRouter()

  const authHeaders = {
    'x-user-id': user?.id || 'anonymous_user',
  }

  const [state, setState] = useState<AppState>('upload')
  const [sourceText, setSourceText] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [cards, setCards] = useState<Card[]>([])
  const [streamText, setStreamText] = useState('')
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [editExtra, setEditExtra] = useState('')
  const [editDeck, setEditDeck] = useState('')
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [showSignInPrompt, setShowSignInPrompt] = useState(false)

  // Redirect first-time visitors to /demo
  // Runs only after Clerk has resolved (isLoaded) to avoid redirecting logged-in users
  useEffect(() => {
    if (!isLoaded) return
    if (user) return
    if (localStorage.getItem('dimindo_demo_seen')) return
    router.push('/demo')
  }, [user, isLoaded, router])

  // Restore session after sign-in
  useEffect(() => {
    if (user && isLoaded) {
      const savedSessionId = sessionStorage.getItem('dimindo_session_id')
      const savedCards = sessionStorage.getItem('dimindo_cards')
      if (savedSessionId && savedCards) {
        setSessionId(savedSessionId)
        setCards(JSON.parse(savedCards))
        setState('review')
        sessionStorage.removeItem('dimindo_session_id')
        sessionStorage.removeItem('dimindo_cards')
      }
    }
  }, [user, isLoaded])

  // --- File upload ---
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

  // --- Card generation with SSE streaming ---
  async function handleGenerate() {
    if (!sourceText.trim()) return
    setState('generating')
    setStreamText('')
    setError('')
    startTimer()

    const formData = new FormData()
    formData.append('source_material', sourceText)

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
            } else if (event.type === 'chunk') {
              setStreamText(prev => prev + event.text)
            } else if (event.type === 'done') {
              stopTimer()
              const cardsRes = await fetch(`${API}/api/cards/${currentSessionId}`, {
                headers: authHeaders,
              })
              const cardsData = await cardsRes.json()
              setCards(cardsData.cards)
              setState('review')
            } else if (event.type === 'error') {
              stopTimer()
              setError(event.message)
              setState('upload')
            }
          } catch {}
        }
      }
    } catch (err) {
      stopTimer()
      setError('Something went wrong. Please try again.')
      setState('upload')
    }
  }

  // --- Approve/reject card ---
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
    setEditDeck(cards[index].deck)
  }

  async function saveEdit(index: number) {
    const updated = [...cards]
    updated[index].text = editText
    updated[index].extra = editExtra
    updated[index].deck = editDeck
    setCards(updated)
    setEditingIndex(null)

    await fetch(`${API}/api/cards/${sessionId}/${cards[index].id}/content`, {
      method: 'PATCH',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: editText,
        extra: editExtra,
        deck: editDeck,
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
    // If not logged in, save session and show sign-in prompt
    if (!user) {
      sessionStorage.setItem('dimindo_session_id', sessionId)
      sessionStorage.setItem('dimindo_cards', JSON.stringify(cards))
      setShowSignInPrompt(true)
      return
    }

    setState('exporting')
    const res = await fetch(`${API}/api/export/${sessionId}`, {
      method: 'POST',
      headers: authHeaders,
    })
    if (!res.ok) {
      setError('Export failed. Please try again.')
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

  const approvedCount = cards.filter(c => c.approved).length

  // --- Rendering ---
  return (
    <main className="min-h-screen flex flex-col items-center justify-start py-16 px-4">

      {/* Sign-in prompt overlay */}
      {showSignInPrompt && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl px-8 py-8 max-w-sm w-full text-center shadow-xl">
            <p className="text-xl mb-1">✓</p>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              Your cards are ready
            </h2>
            <p className="text-sm text-gray-500 mb-6">
              Create a free account to export your {approvedCount} cards as an Anki deck.
            </p>
            <SignInButton mode="redirect" forceRedirectUrl="/">
              <button className="w-full px-6 py-2.5 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-700 transition mb-3">
                Sign up — it's free →
              </button>
            </SignInButton>
            <button
              onClick={() => setShowSignInPrompt(false)}
              className="text-sm text-gray-400 hover:text-gray-600 transition"
            >
              Back to review
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-12 text-center relative w-full max-w-2xl">
        <div className="absolute right-0 top-0">
          {user ? (
            <UserButton />
          ) : (
            <SignInButton mode="redirect" forceRedirectUrl="/">
              <button className="px-4 py-1.5 text-sm rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition">
                Sign in
              </button>
            </SignInButton>
          )}
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-gray-900">Dimindo</h1>
        <p className="mt-2 text-gray-500 text-sm">Paste or upload your source material</p>
      </div>

      {/* STEP 1: Upload */}
      {(state === 'upload' || state === 'generating') && (
        <div className="w-full max-w-2xl flex flex-col gap-4">

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-start gap-3">
              <span className="text-red-400 mt-0.5 flex-shrink-0">⚠</span>
              <div>
                <p className="text-sm font-medium text-red-700">Something went wrong</p>
                <p className="text-xs text-red-500 mt-0.5">{error}</p>
              </div>
              <button
                onClick={() => setError('')}
                className="ml-auto text-red-300 hover:text-red-500 text-lg leading-none flex-shrink-0"
              >
                ×
              </button>
            </div>
          )}

          <textarea
            className="w-full h-64 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-300"
            placeholder="Paste your source material here..."
            value={sourceText}
            onChange={e => setSourceText(e.target.value)}
            disabled={state === 'generating'}
          />

          <div className="flex gap-3 items-center">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={state === 'generating'}
              className="px-4 py-2 text-sm rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 transition"
            >
              Upload file (.txt / .pdf)
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.pdf"
              className="hidden"
              onChange={handleFileUpload}
            />
            <button
              onClick={handleGenerate}
              disabled={!sourceText.trim() || state === 'generating'}
              className="ml-auto px-6 py-2 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40 transition"
            >
              {state === 'generating' ? 'Generating...' : 'Generate cards →'}
            </button>
          </div>

          {/* Streaming view */}
          {state === 'generating' && (
            <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">
                  Generating cards...
                </p>
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-xs text-gray-400 font-mono">
                    {Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, '0')}
                  </span>
                </div>
              </div>
              <div className="h-48 overflow-y-auto">
                <pre className="text-xs text-gray-600 whitespace-pre-wrap font-mono">
                  {streamText || 'Waiting for Claude...'}
                </pre>
              </div>
              <p className="text-xs text-gray-300 mt-2">
                Card generation usually takes 1–3 minutes depending on the length of your source material.
              </p>
            </div>
          )}
        </div>
      )}

      {/* STEP 2: Review */}
      {state === 'review' && (
        <div className="w-full max-w-2xl flex flex-col gap-4">

          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Review cards</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {approvedCount} of {cards.length} cards approved
              </p>
            </div>
            <button
              onClick={handleExport}
              disabled={approvedCount === 0}
              className="px-6 py-2 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40 transition"
            >
              Export {approvedCount} cards as .apkg →
            </button>
          </div>

          <div className="flex flex-col gap-3">
            {cards.map((card, i) => (
              <div
                key={i}
                className={`rounded-xl border px-4 py-4 bg-white transition ${
                  card.approved
                    ? 'border-gray-200'
                    : 'border-gray-100 opacity-40'
                }`}
              >
                {editingIndex === i ? (
                  <div className="flex flex-col gap-3">
                    <div>
                      <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">
                        Text
                      </label>
                      <textarea
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-300"
                        rows={3}
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">
                        Extra
                      </label>
                      <textarea
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-300"
                        rows={2}
                        value={editExtra}
                        onChange={e => setEditExtra(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">
                        Deck
                      </label>
                      <input
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 font-mono"
                        value={editDeck}
                        onChange={e => setEditDeck(e.target.value)}
                      />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={cancelEdit}
                        className="px-4 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 transition"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => saveEdit(i)}
                        className="px-4 py-1.5 text-sm rounded-lg bg-gray-900 text-white hover:bg-gray-700 transition"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-4">
                    <div
                      className="flex-1 min-w-0 cursor-pointer group"
                      onClick={() => startEditing(i)}
                    >
                      <p
                        className="text-sm text-gray-900 leading-relaxed group-hover:text-gray-600 transition"
                        dangerouslySetInnerHTML={{
                          __html: card.text.replace(
                            /\{\{c1::(.*?)\}\}/g,
                            '<strong>$1</strong>'
                          ),
                        }}
                      />
                      {card.extra && (
                        <p className="text-xs text-gray-400 mt-2 leading-relaxed">
                          {card.extra}
                        </p>
                      )}
                      <p className="text-xs text-gray-300 mt-2 font-mono truncate">
                        {card.deck}
                      </p>
                      {card.logg && (
                        <p className="text-xs text-amber-500 mt-1 flex items-center gap-1">
                          <span>⚑</span>
                          <span>{card.logg}</span>
                        </p>
                      )}
                      <p className="text-xs text-gray-300 mt-0.5 opacity-0 group-hover:opacity-100 transition">
                        Click to edit
                      </p>
                    </div>
                    <button
                      onClick={() => toggleCard(i)}
                      className={`flex-shrink-0 w-8 h-8 rounded-full border flex items-center justify-center text-sm transition ${
                        card.approved
                          ? 'border-gray-900 bg-gray-900 text-white'
                          : 'border-gray-200 bg-white text-gray-300'
                      }`}
                    >
                      {card.approved ? '✓' : ''}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex justify-end mt-2">
            <button
              onClick={handleExport}
              disabled={approvedCount === 0}
              className="px-6 py-2 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40 transition"
            >
              Export {approvedCount} cards as .apkg →
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: Exporting */}
      {state === 'exporting' && (
        <div className="text-center text-gray-500 text-sm">
          Building .apkg file...
        </div>
      )}

      {/* STEP 4: Done */}
      {state === 'done' && (
        <div className="w-full max-w-2xl text-center flex flex-col gap-4">
          <div className="rounded-xl border border-gray-200 bg-white px-6 py-8">
            <p className="text-2xl mb-2">✓</p>
            <h2 className="text-lg font-semibold text-gray-900">File downloaded</h2>
            <p className="text-sm text-gray-500 mt-1">
              Open dimindo_export.apkg to import into Anki.
            </p>
          </div>
          <button
            onClick={() => {
              setState('upload')
              setSourceText('')
              setCards([])
              setStreamText('')
              setSessionId('')
            }}
            className="text-sm text-gray-400 hover:text-gray-600 transition"
          >
            Generate new cards →
          </button>
        </div>
      )}

    </main>
  )
}