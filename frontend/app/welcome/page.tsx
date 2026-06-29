'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import DemoExperience from '../components/DemoExperience'

// /welcome — the first-time visitor flow. Near-identical to /demo, differing in
// four places, all at the edges of the shared DemoExperience:
//   1. a bespoke onboarding navbar (not the shared <Navbar />)
//   2. the first-time cookie is set on load, not on subject pick
//   3. a navbar CTA appears once the demo has started (onStartedChange)
//   4. the ending is the "Ready to go further?" CTA, not the /faq exit
// All interactive logic and state lives in DemoExperience; this page only wires
// the edges. The .demo-root / .demo-cta* classes come from that component's
// stylesheet; the .welcome-nav* classes are defined here.
export default function WelcomePage() {
  const [started, setStarted] = useState(false)

  // Mark the first-time visitor as "seen" on load, so middleware's "/" → /welcome
  // redirect fires only once. (Previously this was set on subject pick.)
  useEffect(() => {
    document.cookie = 'dimindo_demo_seen=1; path=/; max-age=31536000'
  }, [])

  return (
    <div className="demo-root">
      <style>{`
        /* ── Onboarding navbar — bespoke to /welcome (no nav links, no account
           slot). Matches the shared navbar's 68px height so the demo's sticky
           source panel (top: 68px) aligns. ── */
        .welcome-nav {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 18px 32px;
          min-height: 68px;
          border-bottom: 1px solid var(--rule);
          background: var(--paper);
          position: sticky;
          top: 0;
          z-index: 100;
        }
        .welcome-nav-left {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .welcome-nav-wordmark {
          font-family: 'DM Serif Display', serif;
          font-size: 1.25rem;
          letter-spacing: -0.01em;
          color: var(--ink);
          text-decoration: none;
        }
/* Dynamic CTA — revealed once a subject is chosen. A muted text link with
           a gold arrow, not a solid button: a navbar button would shout and
           compete with the demo itself, which is the real selling moment. Fades
           in on appearance (reduced-motion disables it). */
        .welcome-nav-cta {
          display: inline-flex;
          align-items: baseline;
          gap: 8px;
          font-family: 'DM Sans', sans-serif;
          font-size: 0.82rem;
          color: var(--muted);
          text-decoration: none;
          white-space: nowrap;
          transition: color 0.15s;
          animation: welcomeCtaIn 0.3s ease both;
        }
        .welcome-nav-cta:hover { color: var(--ink); }
        .welcome-nav-cta-arrow { color: var(--gold); }
        .welcome-nav-cta-short { display: none; }

        @keyframes welcomeCtaIn {
          from { opacity: 0; transform: translateY(-2px); }
          to   { opacity: 1; transform: none; }
        }

        /* Narrow viewport: shorten the CTA, then hide it, so the bar never breaks. */
        @media (max-width: 600px) {
          .welcome-nav { padding: 14px 20px; }
          .welcome-nav-cta-full { display: none; }
          .welcome-nav-cta-short { display: inline; }
        }
        @media (max-width: 420px) {
          .welcome-nav-cta { display: none; }
        }

        @media (prefers-reduced-motion: reduce) {
          .welcome-nav-cta { animation: none; }
        }
      `}</style>

      {/* ── Onboarding navbar ── */}
      <header className="welcome-nav">
        <div className="welcome-nav-left">
          <Link href="/" className="welcome-nav-wordmark">Dimindo</Link>
        </div>

        {started && (
          <Link href="/" className="welcome-nav-cta">
            <span className="welcome-nav-cta-full">
              Ready? Upload your own material and try it now
            </span>
            <span className="welcome-nav-cta-short">Try it now</span>
            <span className="welcome-nav-cta-arrow" aria-hidden="true">→</span>
          </Link>
        )}
      </header>

      {/* ── Shared interactive demo, with the "Ready to go further?" ending ── */}
      <DemoExperience
        onStartedChange={setStarted}
        endSlot={
          <div className="demo-cta">
            <p className="demo-cta-eyebrow">Ready to go further?</p>
            <h3 className="demo-cta-heading">
              These cards were generated from a sample text.
            </h3>
            <p className="demo-cta-body">
              Upload your own lecture notes, textbook chapters, or research
              papers and get a full deck — tailored to exactly what you need
              to learn.
            </p>
            <Link href="/" className="demo-cta-btn">
              Upload your own material →
            </Link>
            <span className="demo-cta-note">
              Sign in only required when you generate your deck.
            </span>
          </div>
        }
      />
    </div>
  )
}