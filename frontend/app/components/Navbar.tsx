'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useUser, useClerk } from '@clerk/nextjs'
import styles from './Navbar.module.css'

// Shared topbar. Extracted from app/page.tsx so every page renders the exact
// same navbar from one source — including /demo, which now renders this
// component (with a "Live demo" badge via the optional `badge` prop) instead of
// its own former self-contained bar. Clerk auth-state drives the right-hand
// slot: Sign in (logged out) ⇄ account icon (logged in), mutually exclusive and
// gated on isLoaded so neither flickers during session resolve.
//
// Nav links (Demo · Why Dimindo? · FAQ · Pricing) sit in the right-hand group in
// the decided order. The active page is marked with aria-current="page"; the CSS
// derives the visual (a muted→ink shift) straight from that attribute, so the
// semantic and visual states share one source of truth. The wordmark is a logo,
// not a nav target, so it is deliberately excluded from active-state — on the
// tool page (/) none of the links match, which is the correct outcome.
//
// /welcome will get its own onboarding navbar; were it ever to render this one,
// usePathname would match none of the links and nothing would be marked active —
// the logic degrades correctly with no special-casing.

const navLinks = [
  { href: '/demo', label: 'Demo' },
  { href: '/why', label: 'Why Dimindo?' },
  { href: '/faq', label: 'FAQ' },
  { href: '/pricing', label: 'Pricing' },
]

export default function Navbar({ badge }: { badge?: string }) {
  const { user, isLoaded } = useUser()
  const { openSignIn, openUserProfile } = useClerk()
  const pathname = usePathname()

  return (
    <header className={styles.topbar}>
      {/* Left group — wordmark plus an optional context badge (e.g. /demo's
          "Live demo"). With no badge it holds the wordmark alone, so the bar is
          visually unchanged on every other page. */}
      <div className={styles.topbarLeft}>
        {/* Logo navigates home — excluded from active-state (it's a logo, not a nav target). */}
        <Link href="/" className={styles.wordmark}>
          Dimindo
        </Link>
        {badge && <span className={styles.badge}>{badge}</span>}
      </div>

      <div className={styles.topbarRight}>
        {navLinks.map(link => (
          <Link
            key={link.href}
            href={link.href}
            className={styles.topbarLink}
            aria-current={pathname === link.href ? 'page' : undefined}
          >
            {link.label}
          </Link>
        ))}

        {isLoaded && !user && (
          <button className={styles.signInBtn} onClick={() => openSignIn()}>
            Sign in
          </button>
        )}

        {user && (
          <button
            className={styles.accountBtn}
            onClick={() => openUserProfile()}
            aria-label="Account"
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="8" r="3.75" />
              <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" />
            </svg>
          </button>
        )}
      </div>
    </header>
  )
}