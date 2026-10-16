import { z } from 'zod'

// ── Request ───────────────────────────────────────────────────────────────────

export const CheckRequestSchema = z.object({
  message: z.string().min(10, 'Message too short').max(2000, 'Message too long'),
})

export type CheckRequest = z.infer<typeof CheckRequestSchema>

// ── Response ──────────────────────────────────────────────────────────────────

export const RiskLevelSchema = z.enum(['Low', 'Medium', 'High'])
export type RiskLevel = z.infer<typeof RiskLevelSchema>

export const CheckResultSchema = z.object({
  risk_score:         z.number().int().min(0).max(100),
  risk_level:         RiskLevelSchema,
  scam_type:          z.string(),
  scam_signals:       z.array(z.string()).min(1).max(3),
  // optional().default('') so Zod never throws a 500 if Claude omits the field
  explanation:        z.string().optional().default(''),
  recommended_action: z.string(),
  if_already_sent:    z.string().optional().default(''),
  language:           z.enum(['en', 'hi', 'hinglish']),
  confidence:         z.number().int().min(0).max(100),
})

export type CheckResult = z.infer<typeof CheckResultSchema>

export interface APIResponse {
  success: boolean
  data?:    CheckResult
  error?:   string
  message?: string
}
