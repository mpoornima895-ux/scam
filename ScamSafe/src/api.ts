export type ApiResult = {
  risk_level: 'High' | 'Medium' | 'Low';
  risk_score: number;
  scam_type: string;
  explanation: string;
  scam_signals: string[];
  recommended_action: string;
  confidence: number;
  if_already_sent?: string;
};

const API_URL = 'https://upi-fraud-detector-10.vercel.app/api/check';

export async function analyzeMessage(message: string): Promise<ApiResult | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ message }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    const json = await response.json();
    if (!json || json.success !== true || !json.data) {
      return null;
    }

    const data = json.data;

    return {
      risk_level: data.risk_level === 'High' || data.risk_level === 'Medium' || data.risk_level === 'Low' ? data.risk_level : 'Low',
      risk_score: typeof data.risk_score === 'number' ? data.risk_score : 0,
      scam_type: typeof data.scam_type === 'string' ? data.scam_type : 'Unknown',
      explanation: typeof data.explanation === 'string' ? data.explanation : '',
      scam_signals: Array.isArray(data.scam_signals) ? data.scam_signals.filter((item: unknown): item is string => typeof item === 'string') : [],
      recommended_action: typeof data.recommended_action === 'string' ? data.recommended_action : '',
      confidence: typeof data.confidence === 'number' ? data.confidence : 0,
      if_already_sent: typeof data.if_already_sent === 'string' ? data.if_already_sent : undefined
    };
  } catch {
    return null;
  }
}
