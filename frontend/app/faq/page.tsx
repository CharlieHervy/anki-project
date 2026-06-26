import Link from 'next/link'
import type { ReactNode } from 'react'
import Navbar from '../components/Navbar'
import styles from './page.module.css'

// /faq — standalone marketing reference page. Server component by design: the
// accordion is native <details>/<summary>, so it needs zero JavaScript — open/
// close, keyboard operation, and expanded-state announcement are all browser-
// native, and every answer ships in the SSR HTML (indexable even while closed).
// This holds the same no-JS discipline as /why. The page ends by handing the
// reader to /why ("the thinking behind every card").
//
// Where /why was a linear essay read top to bottom, /faq is reference: a visitor
// arrives with one question and wants it fast. So the design optimises for
// scanning — a dense list of questions, answers on demand — not narrative rhythm.

type Faq = { q: string; a: ReactNode }
type Cluster = { label: string; items: Faq[] }

// ankiweb.net — external; the copy already points here, so the word becomes the
// link. Words are unchanged; only the rendering adds the anchor.
const ankiweb = (
  <a
    href="https://ankiweb.net"
    target="_blank"
    rel="noopener noreferrer"
    className={styles.answerLink}
  >
    ankiweb.net
  </a>
)

const clusters: Cluster[] = [
  {
    label: 'Anki',
    items: [
      {
        q: 'Do I need Anki to use Dimindo?',
        a: (
          <>
            Not to generate cards. The upload, generation, and review flow works
            entirely inside Dimindo. You only need Anki when you want to review your cards:
            Dimindo exports a ready-to-import .apkg file. Anki is free and
            available at {ankiweb}.
          </>
        ),
      },
      {
        q: 'Does Dimindo replace Anki?',
        a: (
          <>
            No. Dimindo handles the work that comes before studying — reading
            your source material, building well-structured cards, and letting you
            review and edit them before export. The actual spaced repetition,
            scheduling and long-term retention, happens in Anki. The two tools
            are designed to work together.
          </>
        ),
      },
      {
        q: 'How do I get started with Anki?',
        a: (
          <>
            Download Anki for free at {ankiweb}. It&apos;s available for Windows,
            Mac, Linux, iOS, and Android. Once installed, you can import any
            .apkg file from Dimindo via File → Import.
          </>
        ),
      },
      {
        q: 'How do I get my cards into Anki?',
        a: (
          <>
            After reviewing your cards in Dimindo, click &ldquo;Export as
            .apkg&rdquo;. Open Anki, go to File → Import, and select the
            downloaded file. Your cards appear immediately, ready to study.
          </>
        ),
      },
    ],
  },
  {
    label: 'Source material',
    items: [
      {
        q: 'What file formats does Dimindo support?',
        a: (
          <>
            You can paste text directly into the input field, or upload a .txt or
            .pdf file. PDF support applies to digitally created documents — files
            where the text exists as selectable characters. Scanned PDFs,
            photographs of pages, and handwritten notes are not supported and
            will produce no output.
          </>
        ),
      },
      {
        q: 'How long can my source material be?',
        a: (
          <>
            It depends on your plan. Free accounts support up to 2,000 words per
            upload. Quick Refill generations support up to 3,000 words. Pro
            accounts support up to 9,000 words.
          </>
        ),
      },
      {
        q: 'What language can my cards be in?',
        a: (
          <>
            Dimindo supports five output languages: English, Swedish, German,
            French, and Spanish. You choose the language before generating — the
            cards, context notes, and any correction labels all appear in that
            language. Your source material can be in any language.
          </>
        ),
      },
    ],
  },
  {
    label: 'Quota and pricing',
    items: [
      {
        q: 'What counts as a generation?',
        a: (
          <>
            One generation is one upload processed through Dimindo&apos;s
            analysis. Free accounts and Quick Refill generations each cost
            exactly one generation per upload. Pro accounts use variable pricing
            based on length: up to 3,000 words costs 1 generation, 3,001–6,000
            words costs 2, and 6,001–9,000 words costs 3. The analysis always
            runs as a single pass — the variable cost reflects the depth of work,
            not the number of requests.
          </>
        ),
      },
      {
        q: "What's the difference between Free and Pro?",
        a: (
          <>
            Free gives you 3 lifetime generations with a 2,000-word limit per
            upload. Pro gives you 30 generations per month, a 9,000-word limit
            per upload, and early access to new features. Your monthly generation
            count resets on your billing anniversary — unused generations
            don&apos;t carry over.
          </>
        ),
      },
      {
        q: 'What is Quick Refill?',
        a: (
          <>
            A one-time add-on: $2.99 for 5 generations that never expire and
            stack on top of any plan. Each Quick Refill generation supports up to
            3,000 words. It&apos;s designed for when you need a few extra
            generations without committing to a monthly subscription.
          </>
        ),
      },
      {
        q: 'What happens when I run out of generations?',
        a: (
          <>
            Your existing sessions and cards stay accessible — nothing is
            deleted. You can still review, edit, and export cards from any
            previous session. To generate new cards,{' '}
            <Link href="/pricing" className={styles.answerLink}>
              buy a Quick Refill
            </Link>{' '}
            or{' '}
            <Link href="/pricing" className={styles.answerLink}>
              upgrade to Pro
            </Link>
            .
          </>
        ),
      },
    ],
  },
  {
    label: 'Data and trust',
    items: [
      {
        q: 'Is my source material saved?',
        a: (
          <>
            Yes. Dimindo stores your source material alongside your generated
            cards so you can return to a session and review both together. Your
            data is private to your account.
          </>
        ),
      },
      {
        q: 'Is my source material used to train AI models?',
        a: (
          <>
            No. Your source material is processed solely to generate your cards.
            Dimindo&apos;s AI provider does not use data submitted via API to
            train its models, and your material is not retained beyond the
            processing of your request.
          </>
        ),
      },
      {
        q: 'Can I edit cards before exporting?',
        a: (
          <>
            Yes — the review screen is built for it. Click any card to edit the
            cloze text or the context note, approve or reject individual cards,
            and set a deck name before export. Only approved cards are included
            in the .apkg file.
          </>
        ),
      },
    ],
  },
]

export default function Faq() {
  return (
    <div className={styles.root}>
      <Navbar />

      <main className={styles.container}>

        {/* ── Hero — matches the pricing header pattern (eyebrow · serif H1 · muted subtitle) ── */}
        <header className={styles.hero}>
          <p className={styles.eyebrow}>FAQ</p>
          <h1 className={styles.heading}>Questions, answered.</h1>
          <p className={styles.subtitle}>
            What Dimindo does, what it costs, and what happens to your material.
          </p>
        </header>

        {/* ── Four clusters — semantic grouping shown as mono panel labels (no
            numbering: nothing announces a sequence of four, so 01–04 would
            assert an order that doesn't exist). ── */}
        {clusters.map(cluster => (
          <section key={cluster.label} className={styles.cluster}>
            <h2 className={styles.clusterLabel}>{cluster.label}</h2>
            <div className={styles.items}>
              {cluster.items.map(item => (
                <details key={item.q} className={styles.item}>
                  <summary className={styles.question}>
                    <span className={styles.questionText}>{item.q}</span>
                  </summary>
                  <div className={styles.answer}>
                    <p className={styles.answerText}>{item.a}</p>
                  </div>
                </details>
              ))}
            </div>
          </section>
        ))}

        {/* ── Exit to /why — subtle, narratively motivated, not a button ── */}
        <div className={styles.exit}>
          <Link href="/why" className={styles.exitLink}>
            <span className={styles.exitText}>
              The thinking behind every card
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