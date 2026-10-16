const { GoogleGenerativeAI } = require('@google/generative-ai');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'method_not_allowed' });

  const { message } = req.body || {};
  if (!message || typeof message !== 'string' || message.trim().length < 10) {
    return res.status(400).json({ success: false, error: 'validation_error', message: 'Send a message (min 10 chars).' });
  }

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });
    const prompt = `You are an Indian SMS scam detector. Analyze this message and respond with ONLY valid JSON, no markdown.
Message: "${message.trim()}"
Return exactly:
{"risk_level":"High or Medium or Low","risk_score":0,"scam_type":"category","explanation":"reason","scam_signals":["s1"],"recommended_action":"what to do","confidence":0.9,"if_already_sent":"advice"}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const data = JSON.parse(cleaned);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'analysis_failed', message: err.message });
  }
};
