'use client'

import { useState, useRef } from 'react'
import { UserButton, useUser } from '@clerk/nextjs'

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
  const { user } = useUser()

  const authHeaders = {
    'x-user-id': user?.id || '',
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

  // --- Filuppladdning ---
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

  // --- Kortgenerering med SSE-streaming ---
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
      setError('Något gick fel. Kontrollera att backend körs.')
      setState('upload')
    }
  }

  // --- Godkänn/avvisa kort ---
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

  // --- Export till .apkg ---
  async function handleExport() {
    setState('exporting')
    const res = await fetch(`${API}/api/export/${sessionId}`, {
      method: 'POST',
      headers: authHeaders,
    })
    if (!res.ok) {
      setError('Export misslyckades.')
      setState('review')
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'techtona_export.apkg'
    a.click()
    URL.revokeObjectURL(url)
    setState('done')
  }

  const approvedCount = cards.filter(c => c.approved).length

  // --- Rendering ---
  return (
    <main className="min-h-screen flex flex-col items-center justify-start py-16 px-4">

      {/* Header */}
      <div className="mb-12 text-center relative w-full max-w-2xl">
        <div className="absolute right-0 top-0">
          <UserButton />
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-gray-900">Techtona</h1>
        <p className="mt-2 text-gray-500 text-sm">Klistra in eller ladda upp ditt källmaterial</p>
      </div>

      {/* STEG 1: Uppladdning */}
      {(state === 'upload' || state === 'generating') && (
        <div className="w-full max-w-2xl flex flex-col gap-4">

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-start gap-3">
              <span className="text-red-400 mt-0.5 flex-shrink-0">⚠</span>
              <div>
                <p className="text-sm font-medium text-red-700">Något gick fel</p>
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
            placeholder="Klistra in ditt källmaterial här..."
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
              Ladda upp fil (.txt / .pdf)
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
              {state === 'generating' ? 'Genererar...' : 'Generera kort →'}
            </button>
          </div>

          {/* Streamingvy */}
          {state === 'generating' && (
            <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">
                  Genererar kort...
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
                  {streamText || 'Väntar på svar från Claude...'}
                </pre>
              </div>
              <p className="text-xs text-gray-300 mt-2">
                Kortgenerering tar vanligtvis 1–3 minuter beroende på källmaterialets längd.
              </p>
            </div>
          )}
        </div>
      )}

      {/* STEG 2: Granskning */}
      {state === 'review' && (
        <div className="w-full max-w-2xl flex flex-col gap-4">

          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Granska kort</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {approvedCount} av {cards.length} kort godkända
              </p>
            </div>
            <button
              onClick={handleExport}
              disabled={approvedCount === 0}
              className="px-6 py-2 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40 transition"
            >
              Exportera .apkg →
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
                        Kortlek
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
                        Avbryt
                      </button>
                      <button
                        onClick={() => saveEdit(i)}
                        className="px-4 py-1.5 text-sm rounded-lg bg-gray-900 text-white hover:bg-gray-700 transition"
                      >
                        Spara
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
                      <p className="text-xs text-gray-300 mt-0.5 opacity-0 group-hover:opacity-100 transition">
                        Klicka för att redigera
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
              Exportera {approvedCount} kort som .apkg →
            </button>
          </div>
        </div>
      )}

      {/* STEG 3: Exporting */}
      {state === 'exporting' && (
        <div className="text-center text-gray-500 text-sm">
          Bygger .apkg-fil...
        </div>
      )}

      {/* STEG 4: Klar */}
      {state === 'done' && (
        <div className="w-full max-w-2xl text-center flex flex-col gap-4">
          <div className="rounded-xl border border-gray-200 bg-white px-6 py-8">
            <p className="text-2xl mb-2">✓</p>
            <h2 className="text-lg font-semibold text-gray-900">Filen är nedladdad</h2>
            <p className="text-sm text-gray-500 mt-1">
              Öppna techtona_export.apkg för att importera till Anki.
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
            Generera nya kort →
          </button>
        </div>
      )}

    </main>
  )
}