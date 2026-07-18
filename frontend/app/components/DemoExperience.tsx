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
  card_type?: 'cloze' | 'qa'
  logg?: string
}

// ---------------------------------------------------------------------------
// Static subject metadata (source texts) + hardcoded demo cards
// ---------------------------------------------------------------------------
const SUBJECT_META: Record<Subject, { label: string; sourceText: string }> = {
  biology: {
    label: 'Biology · Protein Synthesis',
    sourceText: `Protein synthesis is the cellular process of building proteins from genetic instructions. It occurs in two stages: transcription and translation.

During transcription, a segment of DNA is copied into messenger RNA (mRNA) by the enzyme RNA polymerase. The mRNA carries the genetic code from the nucleus to the ribosome.

During translation, ribosomes read the mRNA sequence in units of three nucleotides called codons. Each codon specifies a particular amino acid. Transfer RNA (tRNA) molecules deliver the correct amino acids to the ribosome, where they are joined by peptide bonds to form a polypeptide chain. The sequence of amino acids in the chain is determined entirely by the sequence of codons in the mRNA.`,
  },
  history: {
    label: 'History · World War II',
    sourceText: `World War II lasted from 1939 to 1945 and involved most of the world's nations. The war began when Germany invaded Poland on September 3, 1939, prompting Britain and France to declare war on Germany.

The conflict divided the world into two opposing alliances: the Allies and the Axis powers. A decisive turning point on the Eastern Front was the Battle of Stalingrad (1942–1943), in which German forces suffered a catastrophic defeat.

In the Pacific, the United States entered the war after Japan's surprise attack on Pearl Harbor on December 7, 1941. The war ended in Europe with Germany's unconditional surrender on May 8, 1945, known as V-E Day. Japan surrendered on September 2, 1945, following the atomic bombings of Hiroshima and Nagasaki.`,
  },
  chemistry: {
    label: 'Chemistry · Atomic Structure',
    sourceText: `An atom consists of a nucleus surrounded by electrons. The nucleus contains protons and neutrons. Protons carry a positive electrical charge, neutrons carry no charge, and electrons carry a negative charge.

The number of protons in an atom's nucleus is called the atomic number and determines which element the atom belongs to. In a neutral atom, the number of electrons equals the number of protons.

Electrons occupy regions of space called orbitals, arranged in energy levels called electron shells. The chemical properties of an element are determined by the number and arrangement of its electrons, not by its neutrons.

Isotopes are atoms of the same element with the same atomic number but different numbers of neutrons, giving them different mass numbers.`,
  },
  medicine: {
    label: 'Medicine · The Heart',
    sourceText: `The heart is a muscular organ that pumps blood through the body via the circulatory system. It is divided into four chambers: the right atrium, the right ventricle, the left atrium, and the left ventricle.

Oxygen-depleted blood enters the right atrium, passes into the right ventricle, and is pumped to the lungs. Oxygen-rich blood returns to the left atrium, passes into the left ventricle, and is pumped out through the aorta to the rest of the body. Because the left ventricle must drive blood through the entire body, its muscular wall is significantly thicker than that of the right ventricle.

The contraction phase of the cardiac cycle is called systole; the relaxation phase is called diastole. The heart's rhythm is initiated by the sinoatrial node, located in the right atrium, which functions as the heart's natural pacemaker.`,
  },
}

const DEMO_CARDS: Record<Subject, DemoCard[]> = {
  history: [
    {
      id: 'h1',
      text: "The date on which Germany's invasion of Poland began World War II was {{c1::1 September 1939}}.",
      extra: "Britain and France had guaranteed Polish independence, so the invasion obligated them to declare war two days later.",
      highlightPhrase: "September 3, 1939",
      approved: true,
      logg: "CORRECTED: Corrected: the source material incorrectly stated that Germany invaded Poland on 3 September 1939",
    },
    {
      id: 'h2',
      text: "The 1942–1943 battle on the Eastern Front in which German forces suffered a catastrophic defeat, marking a decisive turning point of the war, was the {{c1::Battle of Stalingrad}}.",
      extra: "The German defeat halted their advance into the Soviet Union and shifted the strategic initiative permanently to the Red Army.",
      highlightPhrase: "Battle of Stalingrad",
      approved: true,
    },
    {
      id: 'h3',
      text: "The date on which Britain and France declared war on Germany in response to the invasion of Poland was {{c1::3 September 1939}}.",
      extra: "Their declarations turned a regional invasion into a continent-wide war, even though neither could aid Poland militarily in time.",
      highlightPhrase: "Britain and France to declare war",
      approved: true,
      logg: "EXTERNAL: External addition",
    },
    {
      id: 'h4',
      text: "The name given to 8 May 1945, the day of Germany's unconditional surrender ending the war in Europe, is {{c1::V-E Day}}.",
      extra: 'V-E stands for "Victory in Europe," distinguishing it from V-J Day, which marked the victory over Japan.',
      highlightPhrase: "V-E Day",
      approved: true,
    },
  ],
  biology: [
    {
      id: 'b1',
      text: "The enzyme that copies a DNA segment into messenger RNA during transcription is called {{c1::RNA polymerase}}.",
      extra: "Without RNA polymerase no mRNA copy could be produced, so no genetic message would ever reach the ribosome for translation.",
      highlightPhrase: "RNA polymerase",
      approved: true,
    },
    {
      id: 'b2',
      text: "The unit of three nucleotides in mRNA that specifies a single amino acid is called  {{c1::a codon}}.",
      extra: "Codons form the dictionary of the genetic code, mapping each nucleotide triplet to one amino acid in the growing protein.",
      highlightPhrase: "codons",
      approved: true,
    },
    {
      id: 'b3',
      text: "The RNA molecule that delivers the correct amino acids to the ribosome during translation is called {{c1::transfer RNA (tRNA)}}.",
      extra: "Each tRNA pairs a specific codon with its matching amino acid, physically linking the genetic code to the assembling protein.",
      highlightPhrase: "Transfer RNA (tRNA)",
      approved: true,
    },
    {
      id: 'b4',
      text: "Why must transcription occur before translation during protein synthesis?",
      extra: "Transcription produces the mRNA copy of the DNA, and the ribosome reads that mRNA as its template during translation; the message must exist before it can be decoded, so no polypeptide can be built until transcription has supplied the mRNA.",
      highlightPhrase: "transcription and translation",
      approved: true,
      card_type: 'qa',
    },
  ],
  chemistry: [
    {
      id: 'c1',
      text: "The number of protons in an atom's nucleus is called the {{c1::atomic number}}.",
      extra: "The atomic number serves as the identity tag of an element and sets its position in the periodic table.",
      highlightPhrase: "atomic number",
      approved: true,
    },
    {
      id: 'c2',
      text: "Atoms of the same element that share the same atomic number but have different numbers of neutrons are called {{c1::isotopes}}.",
      extra: "Isotopes explain why an element's atomic mass on the periodic table is often not a whole number.",
      highlightPhrase: "Isotopes",
      approved: true,
    },
    {
      id: 'c3',
      text: "The atomic value equal to the total number of protons and neutrons in the nucleus is called the {{c1::mass number}}.",
      extra: "Mass number, unlike atomic number, counts neutrons and therefore differs between isotopes of a single element.",
      highlightPhrase: "different mass numbers",
      approved: true,
      logg: "EXTERNAL: External addition",
    },
    {
      id: 'c4',
      text: "Why do different isotopes of the same element have nearly identical chemical properties?",
      extra: "Because chemical properties are determined by the number and arrangement of electrons, and isotopes of an element differ only in neutron number while sharing the same number of electrons.",
      highlightPhrase: "chemical properties of an element",
      approved: true,
      card_type: 'qa',
      logg: "EXTERNAL: External addition",
    },
  ],
  medicine: [
    {
      id: 'm1',
      text: "The heart chamber that pumps oxygen-rich blood out through the aorta to the body is {{c1::the left ventricle}}.",
      extra: "This begins the systemic circulation, delivering oxygenated blood to every tissue in the body.",
      highlightPhrase: "pumped out through the aorta",
      approved: true,
    },
    {
      id: 'm2',
      text: "Why is the muscular wall of the left ventricle significantly thicker than that of the right ventricle?",
      extra: "Because the left ventricle must drive blood through the entire body, whereas the right ventricle only pumps blood the short distance to the lungs.",
      highlightPhrase: "muscular wall is significantly thicker",
      approved: true,
      card_type: 'qa',
    },
    {
      id: 'm3',
      text: "The phase of the cardiac cycle in which the heart muscle contracts is called {{c1::systole}}.",
      extra: "During systole, ventricular pressure rises sharply to eject blood into the arteries.",
      highlightPhrase: "systole",
      approved: true,
    },
    {
      id: 'm4',
      text: "The structure that initiates the heart's rhythm and serves as its natural pacemaker is called {{c1::the sinoatrial node}}.",
      extra: "By generating spontaneous electrical impulses, it sets the rate at which the whole heart contracts.",
      highlightPhrase: "sinoatrial node",
      approved: true,
    },
  ],
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

function loggDisplay(logg?: string): string | null {
  if (!logg) return null
  if (logg.startsWith('CORRECTED:')) return 'ⓘ ' + logg.replace(/^CORRECTED: /, '')
  if (logg.startsWith('EXTERNAL:')) return '+ ' + logg.replace(/^EXTERNAL: /, '')
  return null
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

  function startDemo(s: Subject) {
    timerRefs.current.forEach(t => clearTimeout(t))
    timerRefs.current = []
    setSubject(s)
    setVisibleCards([])
    setHighlightedPhrases([])
    setFetchedCards([])
    setDemoState('animating')
    const cards = DEMO_CARDS[s]
    setFetchedCards(cards)
    animateCards(cards)
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

        .demo-card-logg {
          font-family: 'DM Mono', monospace;
          font-size: 0.68rem;
          line-height: 1.45;
          color: var(--gold);
          border-top: 1px solid var(--cream);
          padding-top: 8px;
          margin-top: 8px;
        }

        .demo-card-qa-prefix {
          font-family: 'DM Mono', monospace;
          font-size: 0.72rem;
          letter-spacing: 0.04em;
          color: var(--muted);
        }

        .demo-card-qa-answer {
          margin-top: 0;
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
                    {visibleCards.length < fetchedCards.length
                      ? 'Identifying key concept…'
                      : 'Finalising…'}
                  </div>

                  {visibleCards.map(card => (
                    <div key={card.id} className="demo-card-wrap">
                      <div className="demo-card">
                        {card.card_type === 'qa' ? (
                          <>
                            <p className="demo-card-text">
                              <span className="demo-card-qa-prefix">Q ·</span> {card.text}
                            </p>
                            <p className="demo-card-extra demo-card-qa-answer">
                              <span className="demo-card-qa-prefix">A ·</span> {card.extra}
                            </p>
                          </>
                        ) : (
                          <>
                            <p
                              className="demo-card-text"
                              dangerouslySetInnerHTML={{ __html: renderCloze(card.text) }}
                            />
                            {card.extra && (
                              <p className="demo-card-extra">{card.extra}</p>
                            )}
                          </>
                        )}
                        {loggDisplay(card.logg) && (
                          <p className="demo-card-logg">{loggDisplay(card.logg)}</p>
                        )}
                      </div>
                    </div>
                  ))}

                  <button className="demo-skip-anim" onClick={skipToReview}>
                    Skip animation →
                  </button>
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
                        {card.card_type === 'qa' ? (
                          <>
                            <p className="demo-card-text">
                              <span className="demo-card-qa-prefix">Q ·</span> {card.text}
                            </p>
                            <p className="demo-card-extra demo-card-qa-answer">
                              <span className="demo-card-qa-prefix">A ·</span> {card.extra}
                            </p>
                          </>
                        ) : (
                          <>
                            <p
                              className="demo-card-text"
                              dangerouslySetInnerHTML={{ __html: renderCloze(card.text) }}
                            />
                            {card.extra && (
                              <p className="demo-card-extra">{card.extra}</p>
                            )}
                          </>
                        )}
                        {loggDisplay(card.logg) && (
                          <p className="demo-card-logg">{loggDisplay(card.logg)}</p>
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