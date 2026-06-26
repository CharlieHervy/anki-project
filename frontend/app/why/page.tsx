import Link from 'next/link'
import Navbar from '../components/Navbar'
import styles from './page.module.css'

// /why — standalone marketing essay. Server component by design: no state, no
// Clerk hooks (Navbar owns auth), so the whole argument ships in the SSR HTML
// and is readable without JS. The only motion is one restrained hero fade-up,
// defined in CSS and disabled under prefers-reduced-motion.
//
// Narrative arc: problem → principle → how the principle is applied (three
// capabilities) → the deliberate limit of automation → payoff → /demo.
// /why argues; /demo demonstrates. The page ends by handing the reader to /demo.
export default function Why() {
  return (
    <div className={styles.root}>
      <Navbar />

      <main className={styles.container}>

        {/* ── Hero — the thesis is the heading (1A) ── */}
        <header className={styles.hero}>
          <p className={styles.eyebrow}>Why Dimindo?</p>
          <h1 className={styles.heading}>
            Making Anki cards is easy. Making Anki cards worth reviewing for the
            next two years <em>isn&apos;t.</em>
          </h1>
        </header>

        {/* ── The problem ── */}
        <section className={styles.movement}>
          <br></br>
          <p className={styles.body}>
            The problem isn&apos;t the few minutes you spend creating a bad card.
            It&apos;s that you&apos;ll review it hundreds of times. A card that
            hints at its own answer teaches pattern recognition, not recall. A
            card that relies on context you no longer have teaches guesswork.
            Over months of repetition, you become fluent in your deck — not your
            subject.
          </p>

          <blockquote className={styles.pullQuote}>
            The card did its job. It just taught you the wrong thing.
          </blockquote>

          <p className={styles.body}>
            Strict, objective card design is harder than it looks. The same
            subtle flaw, copied across a hundred cards, compounds across ten
            thousand reviews.
          </p>

          <p className={styles.bridge}>That&apos;s what Dimindo is for.</p>
        </section>

        {/* ── The principle — the signature moment (monument, flanked by rules) ── */}
        <section className={styles.movement}>
          <div className={styles.principle}>
            <p className={styles.principleText}>
              Every card is built around one design principle: the answer must
              require <span className={styles.principleKey}>knowledge</span> to
              retrieve, not pattern recognition.
            </p>
          </div>
        </section>

        {/* ── One fact, one answer ── */}
        <section className={styles.movement}>
          <h2 className={styles.h2}>One fact, one answer</h2>
          <p className={styles.body}>
            Every card tests exactly one thing — phrased so that the only way to
            answer correctly is to actually know it. No pattern recognition, no
            guessing from context.
          </p>
          <p className={styles.body}>
            That principle governs how every card is structured. Three
            capabilities complete what your source material can&apos;t do on its
            own.
          </p>
        </section>

        {/* ── Three capabilities — enumerated closed set (the copy announces three) ── */}
        <section className={styles.movement}>
          <ol className={styles.capabilities}>
            <li className={styles.capability}>
              <span className={styles.capabilityIndex}>01</span>
              <div className={styles.capabilityContent}>
                <h3 className={styles.h3}>Context</h3>
                <p className={styles.capabilityBody}>
                  Every card includes an explanation note — one sentence on why
                  the fact matters, not just what it is. Facts stick when they
                  connect to something. Context gives them something to connect
                  to.
                </p>
              </div>
            </li>

            <li className={styles.capability}>
              <span className={styles.capabilityIndex}>02</span>
              <div className={styles.capabilityContent}>
                <h3 className={styles.h3}>Fact-checking</h3>
                <p className={styles.capabilityBody}>
                  Your source material isn&apos;t always right. When Dimindo
                  detects a factual error, it corrects it and leaves a
                  transparent note explaining what changed and why. You build
                  your deck on accurate information — not on whatever your
                  textbook got wrong.
                </p>
              </div>
            </li>

            <li className={styles.capability}>
              <span className={styles.capabilityIndex}>03</span>
              <div className={styles.capabilityContent}>
                <h3 className={styles.h3}>What the source leaves out</h3>
                <p className={styles.capabilityBody}>
                  No source material is complete. Dimindo identifies the gaps and
                  fills them — adding the context and connections that
                  aren&apos;t stated but are necessary for a complete
                  understanding of the subject.
                </p>
              </div>
            </li>
          </ol>

          <p className={styles.body}>
            Every card Dimindo generates is held to that principle and those
            three capabilities. But there&apos;s one thing the system can&apos;t
            do for you.
          </p>
        </section>

        {/* ── Understand before you memorize — the honest turn (cream band) ── */}
        <section className={`${styles.movement} ${styles.band}`}>
          <h2 className={styles.bandHeading}>Understand before you memorize</h2>
          <p className={styles.bandBody}>
            Anki is a tool for long-term retention, not initial comprehension.
            Before you export, Dimindo is available to answer questions, explain
            mechanisms, and help you build the mental model that makes the cards
            meaningful.
          </p>
        </section>

        {/* ── Payoff ── */}
        <section className={styles.movement}>
          <p className={styles.body}>
            Dimindo doesn&apos;t do the learning for you. It reallocates your
            hours — from phrasing, formatting, and fact-checking to actually
            understanding what you&apos;re studying.
          </p>
          <p className={styles.closing}>
            That&apos;s the difference between preparing to memorize and
            preparing to <em>know</em>.
          </p>
        </section>

        {/* ── Exit to /demo — subtle, narratively motivated, not a button ── */}
        <div className={styles.exit}>
          <Link href="/demo" className={styles.exitLink}>
            <span className={styles.exitText}>
              Watch Dimindo read a text and build the cards
            </span>
            <span className={styles.exitArrow} aria-hidden="true">
              →
            </span>
          </Link>
        </div>

      </main>
    </div>
  )
}