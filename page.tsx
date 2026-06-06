'use client'

import { useState, useRef } from 'react'
import { UserButton, useUser } from '@clerk/nextjs'
import styles from './page.module.css'
import Link from 'next/dist/client/link'

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

  const approvedCount = cards.filter(c => c.approved).length

  // --- Rendering ---
  return (
    <main className={styles.main}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.userButtonContainer}>
          <UserButton />
        </div>
        <h1 className={styles.title}><Link href="/">Dimindo</Link></h1>
        <p className={styles.subtitle}>
          {state === 'review' ? 'Review and approve your cards' : 'Paste or upload your source material'}
        </p>
      </div>

      {/* STEP 1: Upload */}
      {(state === 'upload' || state === 'generating') && (
        <div className={styles.contentContainer}>
          {error && (
            <div className={styles.errorAlert}>
              <span className={styles.errorIcon}>⚠</span>
              <div className={styles.errorContent}>
                <p className={styles.errorTitle}>Something went wrong</p>
                <p className={styles.errorMessage}>{error}</p>
              </div>
              <button
                onClick={() => setError('')}
                className={styles.errorClose}
              >
                ×
              </button>
            </div>
          )}

          <textarea
            className={styles.textarea}
            value={sourceText}
            onChange={e => setSourceText(e.target.value)}
            disabled={state === 'generating'}
            autoFocus
          />

          <div className={styles.buttonGroup}>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={state === 'generating'}
              className="buttonSecondary"
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
              disabled={!sourceText.trim() || state === 'generating'}
              className="buttonPrimary"
            >
              {state === 'generating' ? 'Generating...' : 'Generate cards →'}
            </button>
          </div>

          {/* Streaming view */}
          {state === 'generating' && (
            <div className={styles.streamingContainer}>
              <div className={styles.streamingHeader}>
                <p className={styles.streamingLabel}>Generating cards...</p>
                <div className={styles.streamingStatus}>
                  <div className={styles.statusDot} />
                  <span className={styles.timer}>
                    {Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, '0')}
                  </span>
                </div>
              </div>
              <div className={styles.streamingContent}>
                <pre className={styles.streamingText}>
                  {streamText || 'Generating cards...'}
                </pre>
              </div>
              <p className={styles.streamingNote}>
                Card generation usually takes 1–3 minutes depending on the length of the source material.
              </p>
            </div>
          )}
        </div>
      )}

      {/* STEP 2: Review */}
      {state === 'review' && (
        <div className={styles.contentContainer}>
          <div className={styles.reviewHeader}>
            <div>
              <h2 className={styles.reviewTitle}>Review Cards</h2>
              <p className={styles.reviewInfo}>
                {approvedCount} of {cards.length} cards approved
              </p>
            </div>
            <button
              onClick={handleExport}
              disabled={approvedCount === 0}
              className="exportButton"
            >
              Export {approvedCount} cards as .apkg →
            </button>
          </div>

          <div className={styles.cardsList}>
            {cards.map((card, i) => (
              <div
                key={i}
                className={`${styles.card} ${
                  card.approved ? styles.cardApproved : styles.cardRejected
                }`}
              >
                {editingIndex === i ? (
                  <div className={styles.editForm}>
                    <div className={styles.editFormGroup}>
                      <label className={styles.editLabel}>Text</label>
                      <textarea
                        className={styles.editTextarea}
                        rows={3}
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div className={styles.editFormGroup}>
                      <label className={styles.editLabel}>Extra</label>
                      <textarea
                        className={styles.editTextarea}
                        rows={2}
                        value={editExtra}
                        onChange={e => setEditExtra(e.target.value)}
                      />
                    </div>
                    <div className={styles.editFormGroup}>
                      <label className={styles.editLabel}>Deck</label>
                      <input
                        className={styles.editInput}
                        value={editDeck}
                        onChange={e => setEditDeck(e.target.value)}
                      />
                    </div>
                    <div className={styles.editActions}>
                      <button
                        onClick={cancelEdit}
                        className="buttonSmallSecondary"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => saveEdit(i)}
                        className="buttonSmallPrimary"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.cardContent}>
                    <div
                      className={styles.cardText}
                      onClick={() => startEditing(i)}
                    >
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
                          {card.logg.startsWith('Korrigerat') ? '⚠ Corrected: ' + card.logg.replace(/^Korrigerat från källans uppgift om /, '') : '+ Additional fact'}
                        </p>
                      )}
                      <p className={styles.cardDeck}>{card.deck}</p>
                      <p className={styles.cardEditHint}>Click to edit</p>
                    </div>
                    <button
                      onClick={() => toggleCard(i)}
                      className={`${styles.approvalButton} ${
                        card.approved
                          ? styles.approvalButtonApproved
                          : styles.approvalButtonRejected
                      }`}
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
              className="exportButton"
            >
              Export {approvedCount} cards as .apkg →
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: Exporting */}
      {state === 'exporting' && (
        <div className={styles.exportContainer}>
          <p className={styles.exportMessage}>
            <span className={styles.exportEmoji}>📦</span>
            Exporting cards...
          </p>
        </div>
      )}

      {/* STEP 4: Done */}
      {state === 'done' && (
        <div className={styles.doneContainer}>
          <h2 className={styles.doneTitle}>Done!</h2>
          <p className={styles.doneMessage}>
            Your Anki cards have been exported and are ready to be imported.
          </p>
          <button
            onClick={() => {
              setState('upload')
              setSourceText('')
              setCards([])
            }}
            className="doneButton"
          >
            Create new cards →
          </button>
        </div>
      )}
    </main>
  )
}
