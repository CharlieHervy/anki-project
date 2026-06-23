'use client'

import { useState, useEffect } from 'react'
import { useUser, useClerk } from '@clerk/nextjs'
import Navbar from '../components/Navbar'
import styles from './page.module.css'

const API = 'https://anki-project-production.up.railway.app'

// Same discriminated union the tool page uses — the `plan` tag is what tells us
// whether to show "Current plan" and on which card.
type Quota =
  | {
      plan: 'free'
      lifetime_used: number
      lifetime_limit: number
      lifetime_remaining: number
      quick_refill_remaining: number
    }
  | {
      plan: 'pro'
      monthly_used: number
      monthly_limit: number
      monthly_remaining: number
      monthly_reset_at: string
      quick_refill_remaining: number
    }

// Gold check used both in the feature lists and (inheriting muted) in the
// passive "Current plan" badge.
function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12.5l4 4L19 7" />
    </svg>
  )
}

export default function Pricing() {
  const { user, isLoaded } = useUser()
  const { openSignIn } = useClerk()

  const [quota, setQuota] = useState<Quota | null>(null)

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  const authHeaders = {
    'x-user-id': user?.id || 'anonymous_user',
  }

  // Plan lookup — identical contract to the tool page's quota fetch.
  useEffect(() => {
    if (!user || !isLoaded) return
    fetch(`${API}/api/quota?timezone=${encodeURIComponent(timezone)}`, {
      headers: { 'x-user-id': user.id },
    })
      .then(r => r.json())
      .then(data => setQuota(data))
      .catch(() => {})
  }, [user, isLoaded, timezone])

  const plan = quota?.plan ?? null
  const isFree = !!user && plan === 'free'
  const isPro = !!user && plan === 'pro'

  // Stripe Checkout — mirrors handleCheckout on the tool page (FormData
  // product_type → /api/stripe/create-checkout → redirect to data.url). Guard:
  // logged-out users are sent to sign-in rather than creating an anonymous_user
  // checkout session. (No sessionStorage resume — that's a future iteration.)
  async function handleCheckout(productType: 'pro' | 'quick_refill') {
    if (!user) {
      openSignIn()
      return
    }
    const formData = new FormData()
    formData.append('product_type', productType)
    const res = await fetch(`${API}/api/stripe/create-checkout`, {
      method: 'POST',
      headers: authHeaders,
      body: formData,
    })
    const data = await res.json()
    if (data.url) {
      window.location.href = data.url
    }
  }

  return (
    <div className={styles.root}>
      <Navbar />

      <main className={styles.container}>

        {/* ══════════════════════════════════
            Part 1 — header
        ══════════════════════════════════ */}
        <header className={styles.pageHeader}>
          <p className={styles.eyebrow}>Pricing</p>
          <h1 className={styles.title}>Simple pricing.</h1>
          <p className={styles.subtitle}>Start free. Upgrade when you need more.</p>
        </header>

        {/* ══════════════════════════════════
            Part 2 — plan cards
        ══════════════════════════════════ */}
        <section className={styles.plans}>

          {/* ── Free ── */}
          <div className={styles.card}>
            <p className={styles.planLabel}>Free</p>
            <div className={styles.priceRow}>
              <span className={styles.price}>
                <span className={styles.currency}>$</span>0
              </span>
            </div>
            <p className={styles.planDesc}>For getting started.</p>

            <ul className={styles.features}>
              <li className={styles.feature}>
                <span className={styles.check}><CheckIcon /></span>
                <span className={styles.featureText}>
                  <strong>3</strong> lifetime generations
                </span>
              </li>
              <li className={styles.feature}>
                <span className={styles.check}><CheckIcon /></span>
                <span className={styles.featureText}>
                  Up to <strong>2,000</strong> words per upload
                </span>
              </li>
              <li className={styles.feature}>
                <span className={styles.check}><CheckIcon /></span>
                <span className={styles.featureText}>Export to Anki (.apkg)</span>
              </li>
            </ul>

            <div className={styles.cta}>
              {/* Logged out → sign-up (intent signalled by being on /pricing). */}
              {isLoaded && !user && (
                <button className={styles.ctaBtn} onClick={() => openSignIn()}>
                  Get started →
                </button>
              )}
              {/* Free user → passive status, no action. */}
              {isFree && (
                <div className={styles.currentPlan}>
                  <CheckIcon /> Current plan
                </div>
              )}
              {/* Pro user → neutralised: label only, no downgrade link. */}
              {isPro && <div className={styles.passivePlan}>Free plan</div>}
            </div>
          </div>

          {/* ── Pro ── */}
          <div className={`${styles.card} ${styles.cardPro}`}>
            <p className={styles.planLabel}>Pro</p>
            <div className={styles.priceRow}>
              <span className={styles.price}>
                <span className={styles.currency}>$</span>9.99
              </span>
              <span className={styles.priceUnit}>/ month</span>
            </div>
            <p className={styles.planDesc}>For students who study seriously.</p>

            <ul className={styles.features}>
              <li className={styles.feature}>
                <span className={styles.check}><CheckIcon /></span>
                <span className={styles.featureText}>
                  <strong>30</strong> generations per month
                </span>
              </li>

              <li className={styles.feature}>
                <span className={styles.check}><CheckIcon /></span>
                <div className={styles.featureBody}>
                  <span className={styles.featureText}>
                    Up to <strong>9,000</strong> words per upload
                  </span>
                  {/* Capacity table — contrast-safe (ink throughout, never muted). */}
                  <div className={styles.capacityTable}>
                    <div className={styles.capacityRow}>
                      <span className={styles.capacityRange}>Up to 3,000 words</span>
                      <span className={styles.capacityGen}>1 generation</span>
                    </div>
                    <div className={styles.capacityRow}>
                      <span className={styles.capacityRange}>3,001 – 6,000 words</span>
                      <span className={styles.capacityGen}>2 generations</span>
                    </div>
                    <div className={styles.capacityRow}>
                      <span className={styles.capacityRange}>6,001 – 9,000 words</span>
                      <span className={styles.capacityGen}>3 generations</span>
                    </div>
                  </div>
                </div>
              </li>

              <li className={styles.feature}>
                <span className={styles.check}><CheckIcon /></span>
                <span className={styles.featureText}>Export to Anki (.apkg)</span>
              </li>
              <li className={styles.feature}>
                <span className={styles.check}><CheckIcon /></span>
                <span className={styles.featureText}>Early access to new features</span>
              </li>
            </ul>

            <div className={styles.cta}>
              {isPro ? (
                <div className={styles.currentPlan}>
                  <CheckIcon /> Current plan
                </div>
              ) : (
                <button
                  className={styles.ctaBtn}
                  onClick={() => (user ? handleCheckout('pro') : openSignIn())}
                >
                  Upgrade to Pro →
                </button>
              )}
            </div>
          </div>

        </section>

        {/* ══════════════════════════════════
            Part 3 — add-on
        ══════════════════════════════════ */}
        <hr className={styles.divider} />
        <section className={styles.addon}>
          <p className={styles.addonLabel}>Add-on</p>
          <div className={styles.addonCard}>
            <div className={styles.addonInfo}>
              <p className={styles.addonName}>Quick Refill</p>
              <p className={styles.addonDesc}>
                5 extra generations · up to 3,000 words per upload · never expires · stacks with any plan
              </p>
            </div>
            <div className={styles.addonRight}>
              <span className={styles.addonPrice}>
                <span className={styles.currency}>$</span>2.99
              </span>
              <button
                className={styles.ghostBtn}
                onClick={() => (user ? handleCheckout('quick_refill') : openSignIn())}
              >
                Buy a refill →
              </button>
            </div>
          </div>
        </section>

      </main>
    </div>
  )
}