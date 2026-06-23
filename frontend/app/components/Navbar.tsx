'use client'

import Link from 'next/link'
import { useUser, useClerk } from '@clerk/nextjs'
import styles from './Navbar.module.css'

// Shared topbar. Extracted from app/page.tsx so the tool page and /pricing
// render the exact same navbar from one source. Clerk auth-state drives the
// right-hand slot: Sign in (logged out) ⇄ account icon (logged in), mutually
// exclusive and gated on isLoaded so neither flickers during session resolve.
export default function Navbar() {
  const { user, isLoaded } = useUser()
  const { openSignIn, openUserProfile } = useClerk()

  return (
    <header className={styles.topbar}>
      {/* Logo now navigates home — the app has multiple routes as of /pricing. */}
      <Link href="/" className={styles.wordmark}>
        Dimindo
      </Link>

      <div className={styles.topbarRight}>
        {/* Pricing — between the logo and the Sign in / account slot. */}
        <Link href="/pricing" className={styles.topbarLink}>
          Pricing
        </Link>

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