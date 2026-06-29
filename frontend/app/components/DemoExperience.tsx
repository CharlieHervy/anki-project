'use client'

import { useState, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Shared interactive demo. Extracted from /demo so both /demo and /welcome
// render the exact same engine — one source of truth for all demo logic and
// state. The two hosts differ only at the edges, expressed as props:
//
//   • onStartedChange(started) — fires whenever the demo enters/leaves the
//     subject picker, so a host can react. /welcome uses it to reveal a navbar
//     CTA once a subject is chosen; /demo passes nothing.
//   • endSlot — the ending rendered in the review state, after the card list.
//     /demo passes its /faq exit link; /welcome passes its "Ready to go
//     further?" CTA. Each host owns its own ending markup (styled with
//     .demo-exit* or .demo-cta*, both defined in the stylesheet below).
//
// The cookie that marks a first-time visitor as "seen" is NOT set here anymore —
// /welcome sets it on load. The navbar and the page root (.demo-root) live on
// the host pages; this component renders only the <style> and the demo content.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Subject = 'biology' | 'history' | 'chemistry' | 'medicine'
type DemoState = 'pick' | 'animating' | 'review'

interface DemoCard {
  id: string
  text: string
  extra: string
  highlightPhrase: string
  approved: boolean
}

// Shape returned by GET /api/demo/cards?subject={subject}
interface ApiDemoCard {
  id: string
  text: string
  extra: string
  highlight_phrase: string   // snake_case from Supabase
  approved: boolean
}

// ---------------------------------------------------------------------------
// API + static subject metadata (source texts live here; cards are fetched)
// ---------------------------------------------------------------------------
const API = 'https://anki-project-production.up.railway.app'

const SUBJECT_META: Record<Subject, { label: string; sourceText: string }> = {
  biology: {
    label: 'Biology · Protein Synthesis',
    sourceText: `Protein synthesis is the cellular process of building proteins from genetic instructions. It occurs in two stages: transcription and translation.

During transcription, a segment of DNA is copied into messenger RNA (mRNA) by the enzyme RNA polymerase. The mRNA carries the genetic code from the nucleus to the ribosome.

During translation, ribosomes read the mRNA sequence in units of three nucleotides called codons. Each codon specifies a particular amino acid. Transfer RNA (tRNA) molecules deliver the correct amino acids to the ribosome, where they are joined by peptide bonds to form a polypeptide chain.`,
  },
  history: {
    label: 'History · World War II',
    sourceText: `World War II lasted from 1939 to 1945 and involved most of the world's nations. The war began when Germany invaded Poland on September 1, 1939, prompting Britain and France to declare war on Germany.

The conflict divided the world into two opposing alliances: the Allies and the Axis powers. A decisive turning point on the Eastern Front was the Battle of Stalingrad (1942–1943), in which German forces suffered a catastrophic defeat.

In the Pacific, the United States entered the war after Japan's attack on Pearl Harbor on December 7, 1941. The war ended in Europe with Germany's unconditional surrender on May 8, 1945, known as V-E Day. The war ended globally when Japan surrendered on September 2, 1945, following the atomic bombings of Hiroshima and Nagasaki.`,
  },
  chemistry: {
    label: 'Chemistry · Atomic Structure',
    sourceText: `An atom consists of a nucleus surrounded by electrons. The nucleus contains protons and neutrons. Protons carry a positive electrical charge, while neutrons carry no charge.

The number of protons in an atom's nucleus is called the atomic number and determines which element the atom belongs to. In a neutral atom, the number of electrons equals the number of protons.

Electrons carry a negative charge and occupy regions of space called orbitals, arranged in energy levels called electron shells. Isotopes are atoms of the same element with the same atomic number but different numbers of neutrons, giving them different mass numbers.`,
  },
  medicine: {
    label: 'Medicine · The Heart',
    sourceText: `The heart is a muscular organ that pumps blood through the body via the circulatory system. It is divided into four chambers: the right atrium, the right ventricle, the left atrium, and the left ventricle.

Oxygen-depleted blood enters the right atrium, passes into the right ventricle, and is pumped to the lungs. Oxygen-rich blood returns to the left atrium, passes into the left ventricle, and is pumped out through the aorta to the rest of the body.

The contraction phase of the cardiac cycle is called systole; the relaxation phase is called diastole. Four valves — the tricuspid, pulmonary, mitral, and aortic — prevent backflow of blood between chambers and vessels. The heart's rhythm is initiated by the sinoatrial node, located in the right atrium, which functions as the heart's natural pacemaker.`,
  },
}

const SUBJECTS: { key: Subject; emoji: string; title: string; sub: string }[] = [
  { key: 'biology',   emoji: '🧬', title: 'Biology',   sub: 'Protein Synthesis' },
  { key: 'history',   emoji: '⚔️', title: 'History',   sub: 'World War II' },
  { key: 'chemistry', emoji: '⚗️', title: 'Chemistry', sub: 'Atomic Structure' },
  { key: 'medicine',  emoji: '🫀', title: 'Medicine',  sub: 'The Heart' },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderCloze(text: string): string {
  return text.replace(/\{\{c1::(.*?)\}\}/g, '<strong>$1</strong>')
}

// Accumulating highlights — applies every phrase in the array to the source
function highlightSource(source: string, phrases: string[]): string {
  let result = source
  for (const phrase of phrases) {
    if (!phrase) continue
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(
      new RegExp(`(${escaped})`, 'gi'),
      '<mark class="demo-highlight">$1</mark>'
    )
  }
  return result
}

// Maps API snake_case response to camelCase DemoCard
function mapApiCard(raw: ApiDemoCard): DemoCard {
  return {
    id: raw.id,
    text: raw.text,
    extra: raw.extra,
    highlightPhrase: raw.highlight_phrase,
    approved: raw.approved,
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
interface DemoExperienceProps {
  onStartedChange?: (started: boolean) => void
  endSlot?: ReactNode
}

export default function DemoExperience({ onStartedChange, endSlot }: DemoExperienceProps) {
  const [demoState, setDemoState]               = useState<DemoState>('pick')
  const [subject, setSubject]                   = useState<Subject | null>(null)
  const [visibleCards, setVisibleCards]         = useState<DemoCard[]>([])
  const [highlightedPhrases, setHighlightedPhrases] = useState<string[]>([])
  const [fetchedCards, setFetchedCards]         = useState<DemoCard[]>([])
  const [isLoading, setIsLoading]               = useState(false)
  const [fetchError, setFetchError]             = useState<string | null>(null)
  const timerRefs = useRef<ReturnType<typeof setTimeout>[]>([])

  // Cleanup all pending timeouts on unmount
  useEffect(() => () => {
    timerRefs.current.forEach(t => clearTimeout(t))
  }, [])

  // Report started-state to the host whenever it changes. "Started" is simply
  // "not on the picker", so it covers every transition (pick → animating →
  // review, the error path back to pick, and reset) without per-call wiring.
  // onStartedChange is a stable setState reference from the host, so this only
  // re-runs on demoState changes.
  useEffect(() => {
    onStartedChange?.(demoState !== 'pick')
  }, [demoState, onStartedChange])

  async function startDemo(s: Subject) {
    timerRefs.current.forEach(t => clearTimeout(t))
    timerRefs.current = []

    // Cookie is no longer set here — /welcome sets dimindo_demo_seen on load,
    // and /demo no longer marks first-time visitors at all.
    setSubject(s)
    setVisibleCards([])
    setHighlightedPhrases([])
    setFetchedCards([])
    setFetchError(null)
    setIsLoading(true)
    setDemoState('animating')   // enter two-column layout immediately; source text is static

    try {
      const res = await fetch(`${API}/api/demo/cards?subject=${s}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const raw: ApiDemoCard[] = await res.json()
      const cards = raw.map(mapApiCard)
      setFetchedCards(cards)
      setIsLoading(false)
      animateCards(cards)
    } catch {
      setIsLoading(false)
      setFetchError('Failed to load demo cards. Please try again.')
      setDemoState('pick')
    }
  }

  function animateCards(cards: DemoCard[]) {
    // Each card: highlight fires at i × 2200 ms, card appears 700 ms later
    cards.forEach((card, i) => {
      const t1 = setTimeout(() => {
        setHighlightedPhrases(prev => [...prev, card.highlightPhrase])
      }, i * 2200)

      const t2 = setTimeout(() => {
        setVisibleCards(prev => [...prev, card])
        if (i === cards.length - 1) {
          const t3 = setTimeout(() => setDemoState('review'), 900)
          timerRefs.current.push(t3)
        }
      }, i * 2200 + 700)

      timerRefs.current.push(t1, t2)
    })
  }

  function skipToReview() {
    timerRefs.current.forEach(t => clearTimeout(t))
    timerRefs.current = []
    setVisibleCards(fetchedCards)
    setHighlightedPhrases(fetchedCards.map(c => c.highlightPhrase))
    setDemoState('review')
  }

  function resetToPick() {
    timerRefs.current.forEach(t => clearTimeout(t))
    timerRefs.current = []
    setDemoState('pick')
    setSubject(null)
    setVisibleCards([])
    setHighlightedPhrases([])
    setFetchedCards([])
    setFetchError(null)
  }

  const meta = subject ? SUBJECT_META[subject] : null

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Mono:wght@400;500&family=DM+Sans:wght@300;400;500&display=swap');

        :root {
          --ink:    #0d0d0d;
          --paper:  #f7f5f0;
          --cream:  #ede9e1;
          --rule:   #d8d3c8;
          --muted:  #8a8478;
          --gold:   #c9a84c;
          --scan:   #e8e200;
        }

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .demo-root {
          min-height: 100vh;
          background: var(--paper);
          font-family: 'DM Sans', sans-serif;
          color: var(--ink);
        }

        /* ---- Top bar moved to the shared <Navbar /> component ----
           /demo now renders the same navbar as every other page (with a
           "Live demo" badge passed via the badge prop), so the nav links and
           the account slot live in one source of truth. The styles below that
           positioned the old self-contained bar are gone with it; only the
           68px height it occupies survives, in the stage calc() values. */

        /* ---- Pick screen ---- */
        .demo-pick {
          max-width: 680px;
          margin: 0 auto;
          padding: 80px 24px 60px;
        }
        .demo-eyebrow {
          font-family: 'DM Mono', monospace;
          font-size: 0.7rem;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--gold);
          margin-bottom: 16px;
        }
        .demo-heading {
          font-family: 'DM Serif Display', serif;
          font-size: clamp(2rem, 5vw, 3.2rem);
          line-height: 1.1;
          letter-spacing: -0.02em;
          color: var(--ink);
          margin-bottom: 12px;
        }
        .demo-heading em { font-style: italic; color: var(--muted); }
        .demo-sub {
          font-size: 0.95rem;
          font-weight: 300;
          color: var(--muted);
          line-height: 1.6;
          margin-bottom: 48px;
          max-width: 460px;
        }
        .demo-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          margin-bottom: 0;
        }
        @media (max-width: 520px) { .demo-grid { grid-template-columns: 1fr; } }

        .demo-subject-btn {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 22px 20px;
          background: white;
          border: 1px solid var(--rule);
          border-radius: 4px;
          cursor: pointer;
          text-align: left;
          transition: border-color 0.15s, box-shadow 0.15s, transform 0.12s;
          position: relative;
          overflow: hidden;
        }
        .demo-subject-btn::before {
          content: '';
          position: absolute;
          bottom: 0; left: 0; right: 0;
          height: 2px;
          background: var(--gold);
          transform: scaleX(0);
          transform-origin: left;
          transition: transform 0.2s;
        }
        .demo-subject-btn:hover {
          border-color: var(--ink);
          box-shadow: 0 4px 20px rgba(0,0,0,0.07);
          transform: translateY(-1px);
        }
        .demo-subject-btn:hover::before { transform: scaleX(1); }
        .demo-subject-emoji { font-size: 1.4rem; margin-bottom: 4px; }
        .demo-subject-title {
          font-family: 'DM Serif Display', serif;
          font-size: 1.1rem;
          color: var(--ink);
        }
        .demo-subject-sub {
          font-size: 0.78rem;
          color: var(--muted);
          font-family: 'DM Mono', monospace;
        }

        /* Fetch error in pick screen */
        .demo-fetch-error {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.82rem;
          color: #b04a2a;
          background: #fdf0ec;
          border: 1px solid #f5c8bb;
          border-radius: 4px;
          padding: 10px 14px;
          margin-bottom: 24px;
        }

        /* ---- Two-column stage (animating + review) ---- */
        .demo-stage {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0;
          height: calc(100vh - 68px);
          overflow: hidden;
        }
        /* In review: stage expands; source panel sticks; right panel scrolls with page */
        .demo-stage--review {
          height: auto;
          overflow: visible;
          align-items: start;
        }

        @media (max-width: 700px) {
          .demo-stage,
          .demo-stage--review { grid-template-columns: 1fr; height: auto; }
          .demo-stage--review .demo-source-panel {
            position: static;
            height: auto;
            overflow: visible;
          }
        }

        /* ---- Source panel ---- */
        .demo-source-panel {
          padding: 40px 36px;
          border-right: 1px solid var(--rule);
          overflow-y: auto;
          background: white;
        }
        /* Sticky two-column behaviour belongs to DESKTOP ONLY. This rule used to
           live unguarded, after the max-width:700px block, so on mobile it won
           the cascade (identical specificity, later in source order) and forced
           the source panel to position:sticky + height:calc(100vh - 68px) —
           a full-viewport scroll box that hid the cards beneath it. Gating it
           behind min-width:701px makes the two breakpoints mutually exclusive,
           so source order no longer matters and the mobile reset above wins on
           phones. Do NOT remove the media wrapper. */
        @media (min-width: 701px) {
          .demo-stage--review .demo-source-panel {
            position: sticky;
            top: 68px;
            height: calc(100vh - 68px);
            overflow-y: auto;
          }
        }

        .demo-panel-label {
          font-family: 'DM Mono', monospace;
          font-size: 0.65rem;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--muted);
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .demo-panel-label::after {
          content: '';
          flex: 1;
          height: 1px;
          background: var(--rule);
        }

        /* Source text — paragraph-based */
        .demo-source-para {
          font-size: 0.875rem;
          line-height: 1.8;
          color: #3a3730;
          font-weight: 300;
          margin-bottom: 1.25em;
        }
        .demo-source-para:last-child { margin-bottom: 0; }

        /* Accumulating highlight */
        .demo-highlight {
          background: var(--scan);
          color: var(--ink);
          border-radius: 2px;
          padding: 1px 2px;
          animation: highlightIn 0.35s ease both;
        }
        @keyframes highlightIn {
          from { background: transparent; }
          to   { background: var(--scan); }
        }

        /* ---- Cards panel ---- */
        .demo-cards-panel {
          padding: 40px 36px;
          overflow-y: auto;
          background: var(--paper);
          display: flex;
          flex-direction: column;
        }
        .demo-stage--review .demo-cards-panel {
          overflow-y: visible;
          height: auto;
          padding-bottom: 80px;
        }

        /* Scanning indicator */
        .demo-scanning {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 24px;
          font-family: 'DM Mono', monospace;
          font-size: 0.7rem;
          color: var(--muted);
          letter-spacing: 0.06em;
        }
        .demo-scan-dot {
          width: 6px; height: 6px;
          border-radius: 50%;
          background: var(--gold);
          animation: dotPulse 1s ease-in-out infinite;
          flex-shrink: 0;
        }
        @keyframes dotPulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50%       { opacity: 1;   transform: scale(1.1); }
        }

        /* Card — shared between animating + review */
        .demo-card-wrap {
          animation: cardEnter 0.45s cubic-bezier(0.16, 1, 0.3, 1) both;
          margin-bottom: 12px;
        }
        @keyframes cardEnter {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .demo-card {
          background: white;
          border: 1px solid var(--rule);
          border-radius: 4px;
          padding: 18px 20px;
        }
        .demo-card-text {
          font-size: 0.9rem;
          line-height: 1.65;
          color: var(--ink);
          margin-bottom: 10px;
        }
        .demo-card-text strong {
          background: var(--cream);
          padding: 1px 4px;
          border-radius: 2px;
          font-weight: 500;
        }
        .demo-card-extra {
          font-size: 0.78rem;
          color: var(--muted);
          line-height: 1.55;
          border-top: 1px solid var(--cream);
          padding-top: 8px;
          margin-top: 6px;
        }

        /* Skip during animation */
        .demo-skip-anim {
          margin-top: auto;
          padding-top: 20px;
          font-size: 0.78rem;
          color: var(--rule);
          cursor: pointer;
          background: none;
          border: none;
          font-family: 'DM Sans', sans-serif;
          text-align: left;
          transition: color 0.15s;
        }
        .demo-skip-anim:hover { color: var(--muted); }

        /* ---- Review — inside cards panel ---- */
        .demo-review-header {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          margin-bottom: 24px;
          flex-wrap: wrap;
          gap: 12px;
        }
        .demo-review-title {
          font-family: 'DM Serif Display', serif;
          font-size: 1.6rem;
          letter-spacing: -0.02em;
        }
        .demo-review-meta {
          font-family: 'DM Mono', monospace;
          font-size: 0.65rem;
          color: var(--muted);
          letter-spacing: 0.08em;
          text-transform: uppercase;
          border: 1px solid var(--rule);
          padding: 4px 10px;
          border-radius: 2px;
          white-space: nowrap;
        }
        .demo-cards-list { display: flex; flex-direction: column; gap: 10px; }

        .demo-review-card {
          background: white;
          border: 1px solid var(--rule);
          border-radius: 4px;
          padding: 20px 22px;
        }

        /* Back to pick button */
        .demo-back-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 0.78rem;
          color: var(--muted);
          background: none;
          border: none;
          cursor: pointer;
          font-family: 'DM Sans', sans-serif;
          padding: 0;
          margin-bottom: 20px;
          transition: color 0.15s;
        }
        .demo-back-btn:hover { color: var(--ink); }

        /* ════════════════════════════════════════════
           Endings — rendered via the endSlot prop in the review state.
           Two hosts, two endings; both styled here so the component owns all
           demo CSS, while each host owns only the markup it passes in.
           ════════════════════════════════════════════ */

        /* ---- /demo ending: subtle exit link to /faq ----
           Narratively motivated text link — identical in style and behaviour to
           the exits on /why and /faq, so the hand-off between the three
           standalone marketing pages reads as one system. */
        .demo-exit {
          margin-top: 48px;
          border-top: 1px solid var(--rule);
          padding-top: 48px;
        }
        .demo-exit-link {
          display: inline-flex;
          align-items: baseline;
          gap: 10px;
          text-decoration: none;
        }
        .demo-exit-text {
          font-family: 'DM Sans', sans-serif;
          font-size: 1rem;
          color: var(--muted);
          border-bottom: 1px solid var(--rule);
          padding-bottom: 2px;
          transition: color 0.15s, border-color 0.15s;
        }
        .demo-exit-link:hover .demo-exit-text {
          color: var(--ink);
          border-color: var(--ink);
        }
        .demo-exit-arrow {
          font-family: 'DM Mono', monospace;
          font-size: 1rem;
          color: var(--gold);
          transition: transform 0.15s;
        }
        .demo-exit-link:hover .demo-exit-arrow {
          transform: translateX(3px);
        }
        .demo-exit-link:focus-visible {
          outline: 2px solid var(--ink);
          outline-offset: 4px;
          border-radius: 2px;
        }

        /* ---- /welcome ending: "Ready to go further?" product CTA ----
           The flow's terminal call to action. Here — and only here — a solid
           ink button is right: converting is the entire purpose of /welcome. */
        .demo-cta {
          margin-top: 48px;
          border-top: 1px solid var(--rule);
          padding-top: 36px;
        }
        .demo-cta-eyebrow {
          font-family: 'DM Mono', monospace;
          font-size: 0.65rem;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--muted);
          margin-bottom: 12px;
        }
        .demo-cta-heading {
          font-family: 'DM Serif Display', serif;
          font-size: 1.4rem;
          line-height: 1.25;
          letter-spacing: -0.01em;
          margin-bottom: 8px;
        }
        .demo-cta-body {
          font-size: 0.875rem;
          font-weight: 300;
          color: var(--muted);
          line-height: 1.65;
          margin-bottom: 24px;
        }
        .demo-cta-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 13px 28px;
          background: var(--ink);
          color: white;
          font-size: 0.875rem;
          font-family: 'DM Sans', sans-serif;
          font-weight: 500;
          border-radius: 3px;
          text-decoration: none;
          cursor: pointer;
          transition: background 0.15s, transform 0.1s;
          border: none;
        }
        .demo-cta-btn:hover { background: #333; transform: translateY(-1px); }
        .demo-cta-note {
          display: block;
          margin-top: 12px;
          font-size: 0.75rem;
          color: var(--muted);
        }

        @media (prefers-reduced-motion: reduce) {
          .demo-exit-text,
          .demo-exit-arrow { transition: none; }
          .demo-exit-link:hover .demo-exit-arrow { transform: none; }
          .demo-cta-btn:hover { transform: none; }
        }
      `}</style>

      {/* ══════════════════════════════════════════
          STEP 1 — Subject picker
      ══════════════════════════════════════════ */}
      {demoState === 'pick' && (
          <section className="demo-pick">
            <p className="demo-eyebrow">Interactive demo</p>
            <h1 className="demo-heading">
              Watch Dimindo<br />
              <em>read and think.</em>
            </h1>
            <p className="demo-sub">
              Choose a subject below. Dimindo will scan a sample text and build
              study cards in real time — no account required.
            </p>

            {fetchError && (
              <div className="demo-fetch-error">
                <span>⚠</span> {fetchError}
              </div>
            )}

            <div className="demo-grid">
              {SUBJECTS.map(s => (
                <button
                  key={s.key}
                  className="demo-subject-btn"
                  onClick={() => startDemo(s.key)}
                >
                  <span className="demo-subject-emoji">{s.emoji}</span>
                  <span className="demo-subject-title">{s.title}</span>
                  <span className="demo-subject-sub">{s.sub}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ══════════════════════════════════════════
            STEPS 2 & 3 — Two-column layout
            Persists from animating through review.
            Source panel sticks in review mode.
        ══════════════════════════════════════════ */}
        {(demoState === 'animating' || demoState === 'review') && meta && subject && (
          <div className={`demo-stage${demoState === 'review' ? ' demo-stage--review' : ''}`}>

            {/* ── Left: source text with accumulating highlights ── */}
            <div className="demo-source-panel">
              <p className="demo-panel-label">Source text</p>
              {meta.sourceText.split('\n\n').map((para, i) => (
                <p
                  key={i}
                  className="demo-source-para"
                  dangerouslySetInnerHTML={{
                    __html: highlightSource(para, highlightedPhrases),
                  }}
                />
              ))}
            </div>

            {/* ── Right: animating cards OR review ── */}
            <div className="demo-cards-panel">

              {/* ANIMATING */}
              {demoState === 'animating' && (
                <>
                  <p className="demo-panel-label">Generated cards</p>

                  <div className="demo-scanning">
                    <span className="demo-scan-dot" />
                    {isLoading
                      ? 'Loading cards…'
                      : visibleCards.length < fetchedCards.length
                        ? 'Identifying key concept…'
                        : 'Finalising…'}
                  </div>

                  {!isLoading && visibleCards.map(card => (
                    <div key={card.id} className="demo-card-wrap">
                      <div className="demo-card">
                        <p
                          className="demo-card-text"
                          dangerouslySetInnerHTML={{ __html: renderCloze(card.text) }}
                        />
                        {card.extra && (
                          <p className="demo-card-extra">{card.extra}</p>
                        )}
                      </div>
                    </div>
                  ))}

                  {!isLoading && (
                    <button className="demo-skip-anim" onClick={skipToReview}>
                      Skip animation →
                    </button>
                  )}
                </>
              )}

              {/* REVIEW */}
              {demoState === 'review' && (
                <>
                  <button className="demo-back-btn" onClick={resetToPick}>
                    ← Try another subject
                  </button>

                  <div className="demo-review-header">
                    <h2 className="demo-review-title">Review cards</h2>
                    <span className="demo-review-meta">
                      Demo · {SUBJECT_META[subject].label}
                    </span>
                  </div>

                  <div className="demo-cards-list">
                    {fetchedCards.map(card => (
                      <div key={card.id} className="demo-review-card">
                        <p
                          className="demo-card-text"
                          dangerouslySetInnerHTML={{ __html: renderCloze(card.text) }}
                        />
                        {card.extra && (
                          <p className="demo-card-extra">{card.extra}</p>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Ending — host-provided (/demo: /faq exit · /welcome: Ready CTA) */}
                  {endSlot}
                </>
              )}

            </div>
          </div>
        )}
    </>
  )
}