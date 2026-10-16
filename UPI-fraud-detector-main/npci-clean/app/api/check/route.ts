import Groq from 'groq-sdk'
import { NextRequest } from 'next/server'
import { CheckResultSchema } from '@/lib/schema'
import { SYSTEM_PROMPT } from '@/lib/prompt'
import { z } from 'zod'

const VISION_MODEL = 'qwen/qwen3.6-27b'
const TEXT_MODEL   = 'openai/gpt-oss-20b'

function getGroq() {
  return new Groq({ apiKey: process.env.GROQ_API_KEY ?? '' })
}

const TextRequestSchema = z.object({
  message: z.string().min(10).max(2000),
})

const ImageRequestSchema = z.object({
  image:     z.string().min(1),
  mediaType: z.string(),
})

async function checkRateLimit(ip: string) {
  const url   = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return { allowed: true }
  try {
    const { Ratelimit } = await import('@upstash/ratelimit')
    const { Redis }     = await import('@upstash/redis')
    const rl = new Ratelimit({ redis: new Redis({ url, token }), limiter: Ratelimit.slidingWindow(10, '1 m'), analytics: false })
    const { success, reset } = await rl.limit(ip)
    return { allowed: success, retryAfter: success ? undefined : Math.ceil((reset - Date.now()) / 1000) }
  } catch { return { allowed: true } }
}

export async function POST(req: NextRequest) {
  const ip = (req.headers.get('x-forwarded-for') ?? 'anonymous').split(',')[0].trim()
  const { allowed, retryAfter } = await checkRateLimit(ip)
  if (!allowed) {
    return Response.json({ success: false, error: 'rate_limit_exceeded', message: 'Too many requests. Wait a moment.' }, { status: 429, headers: { 'Retry-After': String(retryAfter ?? 60) } })
  }

  let body: unknown
  try { body = await req.json() }
  catch { return Response.json({ success: false, error: 'invalid_json', message: 'Invalid request.' }, { status: 400 }) }

  const textParsed  = TextRequestSchema.safeParse(body)
  const imageParsed = ImageRequestSchema.safeParse(body)

  if (!textParsed.success && !imageParsed.success) {
    return Response.json({ success: false, error: 'validation_error', message: 'Send a message (min 10 chars) or a valid image.' }, { status: 400 })
  }

  try {
    let raw = ''

    if (imageParsed.success) {
      // Strip data URL prefix if present
      const base64 = imageParsed.data.image.replace(/^data:[^;]+;base64,/, '')
      console.log('[check] Image → Groq vision, base64 length:', base64.length, 'model:', VISION_MODEL)

      const resp = await getGroq().chat.completions.create({
        model:       VISION_MODEL,
        max_tokens:  2000,
        temperature: 0.1,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: SYSTEM_PROMPT + '\n\nRead ALL visible text in this screenshot (WhatsApp, SMS, or any message). Analyze it for fraud and return strict JSON only — no markdown, no explanation outside the JSON.',
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${base64}`,
              },
            },
          ],
        }],
      })
      raw = resp.choices[0]?.message?.content?.trim() ?? ''

    } else if (textParsed.success) {
      console.log('[check] Text → Groq', TEXT_MODEL)
      const resp = await getGroq().chat.completions.create({
        model:       TEXT_MODEL,
        max_tokens:  2000,
        temperature: 0.1,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: `Analyze this message: ${textParsed.data.message}` },
        ],
      })
      raw = resp.choices[0]?.message?.content?.trim() ?? ''
    }

    console.log('[check] Raw response:', raw.slice(0, 300))
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    const data    = CheckResultSchema.parse(JSON.parse(cleaned))
    return Response.json({ success: true, data })

  } catch (err) {
    console.error('[check] ERROR:', err instanceof Error ? err.message : err)
    return Response.json({
      success: false,
      error:   'analysis_failed',
      message: imageParsed.success
        ? 'Image too large or unclear. Try cropping just the message before uploading.'
        : 'Could not analyze. Please try again.',
    }, { status: 500 })
  }
}
