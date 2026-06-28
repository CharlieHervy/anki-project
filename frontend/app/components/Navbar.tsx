'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useUser, useClerk } from '@clerk/nextjs'
import { useState, useEffect, useRef } from 'react'
import styles from './Navbar.module.css'

// Shared topbar. Extracted from app/page.tsx so every page renders the exact
// same navbar from one source — including /demo, which renders it with a
// "Live demo" badge via the optional `badge` prop. Clerk auth-state drives the
// right-hand slot: Sign in (logged out) ⇄ account icon (logged in), gated on
// isLoaded so neither flickers during session resolve.
//
// Nav links (Demo · Our Philosophy · FAQ · Pricing) sit in the right-hand group
// in the decided order. The active page is marked with aria-current="page"; the
// CSS derives the visual (a muted→ink shift) straight from that attribute. The
// wordmark is a logo, not a nav target, so it is excluded from active-state.
//
// Mobile (≤768px): the whole right group — links AND auth — collapses behind a
// hamburger that opens a drop panel under the bar. This is a disclosure, not a
// modal: no focus trap. Focus moves to the first item on open; Escape returns it
// to the toggle; an outside pointer or a route change closes it. The auth slot
// is rendered by one renderAuth() factory in both the desktop bar and the panel,
// so the Clerk handlers live in a single place; the copy hidden at each
// breakpoint is display:none and so leaves the accessibility tree.
//
// /welcome uses its own onboarding navbar and is unaffected.

const navLinks = [
  { href: '/demo', label: 'Demo' },
  { href: '/why', label: 'Our Philosophy' },
  { href: '/faq', label: 'FAQ' },
  { href: '/pricing', label: 'Pricing' },
]

export default function Navbar({ badge }: { badge?: string }) {
  const { user, isLoaded } = useUser()
  const { openSignIn, openUserProfile } = useClerk()
  const pathname = usePathname()

  const [menuOpen, setMenuOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const firstItemRef = useRef<HTMLAnchorElement>(null)

  // Close on route change. (Covers tapping a link to a different page; the
  // per-link onClick below covers re-tapping the current page, where pathname
  // doesn't change.)
  useEffect(() => {
    setMenuOpen(false)
  }, [pathname])

  // While open: focus the first item, and wire Escape + outside-pointer to close.
  useEffect(() => {
    if (!menuOpen) return

    firstItemRef.current?.focus({ preventScroll: true })

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMenuOpen(false)
        toggleRef.current?.focus()
      }
    }
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node
      if (
        !panelRef.current?.contains(target) &&
        !toggleRef.current?.contains(target)
      ) {
        setMenuOpen(false)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [menuOpen])

  // Auth slot — shared by the desktop bar and the mobile panel. Closing the menu
  // here is a no-op on desktop (already closed) and tidies the panel away before
  // the Clerk modal opens on mobile.
  function renderAuth() {
    if (isLoaded && !user) {
      return (
        <button
          className={styles.signInBtn}
          onClick={() => { setMenuOpen(false); openSignIn() }}
        >
          Sign in
        </button>
      )
    }
    if (user) {
      return (
        <button
          className={styles.accountBtn}
          onClick={() => { setMenuOpen(false); openUserProfile() }}
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
      )
    }
    return null
  }

  return (
    <header className={styles.topbar}>
      {/* Left group — wordmark plus an optional context badge (e.g. /demo's
          "Live demo"). With no badge it holds the wordmark alone. */}
      <div className={styles.topbarLeft}>
        {/* Logo navigates home — excluded from active-state (it's a logo). */}
        <Link href="/" className={styles.wordmark}>
          Dimindo
        </Link>
        {badge && <span className={styles.badge}>{badge}</span>}
      </div>

      {/* Desktop nav + auth — hidden ≤768px, replaced by the menu toggle. */}
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
        {renderAuth()}
      </div>

      {/* Mobile toggle — hidden on desktop. Hamburger ⇄ X, direct swap. */}
      <button
        ref={toggleRef}
        className={styles.menuToggle}
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={menuOpen}
        aria-controls="navbar-mobile-menu"
        onClick={() => setMenuOpen(o => !o)}
      >
        {menuOpen ? (
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        )}
      </button>

      {/* Mobile drop panel — rendered only when open. */}
      {menuOpen && (
        <div id="navbar-mobile-menu" ref={panelRef} className={styles.mobileMenu}>
          {navLinks.map((link, i) => (
            <Link
              key={link.href}
              href={link.href}
              ref={i === 0 ? firstItemRef : undefined}
              className={styles.mobileLink}
              aria-current={pathname === link.href ? 'page' : undefined}
              onClick={() => setMenuOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <div className={styles.mobileAuth}>
            {renderAuth()}
          </div>
        </div>
      )}
    </header>
  )
}