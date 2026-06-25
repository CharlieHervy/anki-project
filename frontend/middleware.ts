import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const isPublicRoute = createRouteMatcher([
  '/',
  '/demo(.*)',
  '/pricing(.*)',
  '/sign-in(.*)',
  '/sign-up(.*)',
])

export default clerkMiddleware(async (auth, request) => {
  const { userId } = await auth()
  const url = request.nextUrl

  if (url.pathname === '/' && !userId) {
    const demoCookie = request.cookies.get('dimindo_demo_seen')
    if (!demoCookie) {
      return NextResponse.redirect(new URL('/demo', request.url))
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