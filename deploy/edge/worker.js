// devlancer.rexindynamics.com -> Cloudflare Tunnel origin (VM). Streams bodies so SSE keeps working.
const ORIGIN = 'https://devlancer-origin.jeromtom.com'

export default {
  async fetch(request) {
    const url = new URL(request.url)
    const target = ORIGIN + url.pathname + url.search
    const headers = new Headers(request.headers)
    headers.set('x-forwarded-host', url.host)
    const res = await fetch(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual',
    })
    // Keep redirects (e.g. Google OAuth) on the public hostname
    const out = new Response(res.body, res)
    const loc = res.headers.get('location')
    if (loc?.startsWith(ORIGIN)) out.headers.set('location', loc.replace(ORIGIN, `https://${url.host}`))
    return out
  },
}
