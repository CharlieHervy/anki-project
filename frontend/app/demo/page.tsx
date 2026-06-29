import Link from 'next/link'
import Navbar from '../components/Navbar'
import DemoExperience from '../components/DemoExperience'

// /demo — permanent public marketing page, and a thin host around the shared
// DemoExperience. It renders the standard navbar (with a "Live demo" badge) and
// the interactive demo, ending in a subtle exit link to /faq. No state, no
// hooks — a server component. /demo no longer sets the first-time cookie; that
// belongs to /welcome now, so a visitor who only ever sees /demo is never
// marked "seen" (correct — /welcome is the only first-time flow).
//
// The .demo-root wrapper class is defined in DemoExperience's stylesheet, which
// the child injects on render; the navbar sits inside it so the page's
// min-height: 100vh accounts for the bar.
export default function DemoPage() {
  return (
    <div className="demo-root">
      <Navbar />

      <DemoExperience
        endSlot={
          <div className="demo-exit">
            <Link href="/faq" className="demo-exit-link">
              <span className="demo-exit-text">
                The practical questions, answered
              </span>
              <span className="demo-exit-arrow" aria-hidden="true">
                →
              </span>
            </Link>
          </div>
        }
      />
    </div>
  )
}