import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const isPublicRoute = createRouteMatcher([
  '/',
  '/demo(.*)',
  '/why(.*)',
  '/faq(.*)',
  '/welcome(.*)',
  '/pricing(.*)',
  '/sign-in(.*)',
  '/sign-up(.*)',
])

export default clerkMiddleware(async (auth, request) => {
  const { userId } = await auth()
  const url = request.nextUrl

  // First-time visitors (no cookie, logged out) land on the onboarding flow.
  // /welcome sets dimindo_demo_seen on load, so this fires only once.
  if (url.pathname === '/' && !userId) {
    const demoCookie = request.cookies.get('dimindo_demo_seen')
    if (!demoCookie) {
      return NextResponse.redirect(new URL('/welcome', request.url))
    }
  }

  if (!isPublicRoute(request)) {
    await auth.protect()
  }
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}