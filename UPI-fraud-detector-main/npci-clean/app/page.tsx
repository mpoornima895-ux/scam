'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import type { CheckResult, RiskLevel } from '@/lib/schema'

// ── Theme ──────────────────────────────────────────────────────────────────────
const THEMES = {
  dark:  { bg:'#0a0a0f', surface:'#111318', surface2:'#0f1117', surface3:'#1a1d27', border:'#1e2330', border2:'#252a3a', text:'#e2e8f0', text2:'#94a3b8', text3:'#475569', accent:'#00e5a0', accent3:'#7c6fff' },
  light: { bg:'#f8fafc', surface:'#ffffff', surface2:'#f1f5f9', surface3:'#e2e8f0', border:'#e2e8f0', border2:'#cbd5e1', text:'#0f172a', text2:'#475569', text3:'#94a3b8', accent:'#059669', accent3:'#6d28d9' },
}

// ── Risk config ────────────────────────────────────────────────────────────────
type RiskCfg = { bg:string; border:string; badge:string; badgeBg:string; label:string; dot:string; action:string; ifSent:string }
const RISK: Record<RiskLevel, RiskCfg> = {
  High:   { bg:'rgba(220,38,38,0.08)',   border:'rgba(220,38,38,0.5)',   badge:'#fca5a5', badgeBg:'rgba(220,38,38,0.2)',   label:'⚠ High Risk — Likely Scam',       dot:'#ef4444', action:'rgba(220,38,38,0.12)',   ifSent:'rgba(234,88,12,0.12)' },
  Medium: { bg:'rgba(217,119,6,0.08)',   border:'rgba(217,119,6,0.5)',   badge:'#fcd34d', badgeBg:'rgba(217,119,6,0.2)',   label:'◈ Medium Risk — Be Careful',      dot:'#f59e0b', action:'rgba(217,119,6,0.12)',   ifSent:'' },
  Low:    { bg:'rgba(5,150,105,0.06)',   border:'rgba(5,150,105,0.4)',   badge:'#6ee7b7', badgeBg:'rgba(5,150,105,0.15)', label:'✓ Low Risk — Looks Safe',          dot:'#10b981', action:'rgba(5,150,105,0.1)',    ifSent:'' },
}

const SAMPLES: Record<string,string> = {
  'KYC block':      'URGENT: Dear SBI customer, your account has been blocked due to incomplete KYC. Click http://bit.ly/sbi-kyc-verify and enter your UPI PIN within 2 hours or your account will be permanently closed. -SBI Bank',
  'UPI collect':    'Hi, I am from Meesho. A buyer wants to pay ₹4500 for your listing. Please accept this UPI collect request to receive your payment. Just enter your PIN to confirm receipt.',
  'Prize scam':     'Congratulations! You have won ₹25,000 in NPCI UPI Lucky Draw 2024. To claim, share your UPI ID, full name, and Aadhaar with our agent on WhatsApp: 9876543210.',
  'Remote access':  'This is SBI helpdesk. We detected suspicious activity. Please download AnyDesk app and share the 9-digit code with our agent to secure your account immediately.',
}

type Tab = 'scan' | 'history' | 'pinned'
type ScanEntry = CheckResult & { text: string; time: number; pinned?: boolean }

// ── OCR via Tesseract ──────────────────────────────────────────────────────────
async function ocrImage(file: File, onStatus: (s:string)=>void): Promise<string> {
  onStatus('Loading OCR engine...')
  await new Promise<void>((resolve, reject) => {
    if ((window as any).Tesseract) { resolve(); return }
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('OCR library failed to load'))
    document.head.appendChild(s)
  })
  onStatus('Reading text from image...')
  const worker = await (window as any).Tesseract.createWorker('eng')
  const { data: { text } } = await worker.recognize(file)
  await worker.terminate()
  return text.trim()
}

// ── Storage helpers ────────────────────────────────────────────────────────────
function loadHistory(): ScanEntry[] {
  try { return JSON.parse(localStorage.getItem('scamsafe_history') || '[]') } catch { return [] }
}
function saveHistory(h: ScanEntry[]) {
  try { localStorage.setItem('scamsafe_history', JSON.stringify(h.slice(0,200))) } catch {}
}

// ── Main App ───────────────────────────────────────────────────────────────────
export default function App() {
  const [theme, setTheme]           = useState<'dark'|'light'>('dark')
  const [tab, setTab]               = useState<Tab>('scan')
  const [message, setMessage]       = useState('')
  const [imageFile, setImageFile]   = useState<File|null>(null)
  const [imagePreview, setImgPrev]  = useState<string|null>(null)
  const [inputMode, setInputMode]   = useState<'text'|'image'>('text')
  const [loading, setLoading]       = useState(false)
  const [status, setStatus]         = useState('')
  const [result, setResult]         = useState<CheckResult|null>(null)
  const [error, setError]           = useState('')
  const [history, setHistory]       = useState<ScanEntry[]>([])
  const [isDrag, setIsDrag]         = useState(false)
  const [installPrompt, setInstall] = useState<any>(null)
  const fileRef   = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const T = THEMES[theme]

  useEffect(() => {
    setHistory(loadHistory())
    // Capture install prompt
    const handler = (e: any) => { e.preventDefault(); setInstall(e) }
    window.addEventListener('beforeinstallprompt', handler)
    // Handle share target
    const params = new URLSearchParams(location.search)
    const shared = params.get('text') || params.get('url') || params.get('title')
    if (shared) { setMessage(shared); setTab('scan') }
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const t = T // alias

  function applyTheme(th: typeof T) {
    const r = document.documentElement.style
    Object.entries(th).forEach(([k,v]) => r.setProperty('--'+k.replace(/([A-Z])/g,'-$1').toLowerCase(), v as string))
  }
  useEffect(() => applyTheme(T), [T])

  function toggleTheme() { setTheme(th => { const n = th==='dark'?'light':'dark'; return n }) }

  // ── Image handling ────────────────────────────────────────────────────────────
  function handleFile(file: File) {
    if (!file.type.startsWith('image/')) { setError('Please upload an image file'); return }
    setImageFile(file); setError(''); setResult(null)
    const r = new FileReader()
    r.onload = e => setImgPrev(e.target?.result as string)
    r.readAsDataURL(file)
  }

  // ── Analyze ───────────────────────────────────────────────────────────────────
  async function analyze() {
    const hasText  = inputMode === 'text'  && message.trim().length >= 10
    const hasImage = inputMode === 'image' && imageFile !== null
    if ((!hasText && !hasImage) || loading) return
    setLoading(true); setResult(null); setError(''); setStatus('')
    try {
      let body: Record<string,unknown>
      if (hasImage && imageFile) {
        const extracted = await ocrImage(imageFile, setStatus)
        if (!extracted || extracted.length < 5) {
          setError('Could not read text from image. Try a clearer screenshot or paste the text.')
          setLoading(false); setStatus(''); return
        }
        setStatus('Analyzing with AI...')
        body = { message: `[Screenshot] ${extracted}` }
      } else {
        setStatus('Analyzing with AI...')
        body = { message: message.trim() }
      }
      const res  = await fetch('/api/check', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) })
      const json = await res.json()
      if (!json.success) throw new Error(json.message ?? 'Analysis failed')
      setResult(json.data)
      // Save to history
      const entry: ScanEntry = { ...json.data, text: (body.message as string).slice(0,200), time: Date.now() }
      const updated = [entry, ...history].slice(0,200)
      setHistory(updated); saveHistory(updated)
      setTimeout(() => document.getElementById('result')?.scrollIntoView({ behavior:'smooth', block:'nearest' }), 80)
    } catch(e) {
      setError(e instanceof Error ? e.message : 'Could not analyze. Please try again.')
    } finally { setLoading(false); setStatus('') }
  }

  // ── Pin / unpin ───────────────────────────────────────────────────────────────
  function togglePin(time: number) {
    const updated = history.map(h => h.time===time ? {...h, pinned:!h.pinned} : h)
    setHistory(updated); saveHistory(updated)
  }
  function deleteEntry(time: number) {
    const updated = history.filter(h => h.time!==time)
    setHistory(updated); saveHistory(updated)
  }

  // ── Share ─────────────────────────────────────────────────────────────────────
  async function shareResult() {
    if (!result) return
    const text = `ScamSafe verdict: ${result.risk_level} Risk (${result.risk_score}/100)\n\n${result.recommended_action}\n\nCheck your messages free: ${location.origin}`
    if (navigator.share) { await navigator.share({ title:'ScamSafe Result', text }).catch(()=>{}) }
    else { window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank') }
  }

  function reset() { setResult(null); setMessage(''); setImageFile(null); setImgPrev(null); setError('') }

  const pinned   = history.filter(h=>h.pinned)
  const canCheck = inputMode==='text' ? message.trim().length>=10 : imageFile!==null
  const cfg      = result ? RISK[result.risk_level] : null

  // ── Shared styles ─────────────────────────────────────────────────────────────
  const card  = { background:t.surface, border:`1px solid ${t.border}`, borderRadius:16, padding:20, marginBottom:12 } as React.CSSProperties
  const mono  = { fontFamily:'var(--font-dm-mono),monospace' } as React.CSSProperties
  const label = { ...mono, fontSize:10, textTransform:'uppercase' as const, letterSpacing:'1px', color:t.text3, marginBottom:8, display:'block' }

  return (
    <div style={{ minHeight:'100vh', background:t.bg, color:t.text, fontFamily:'system-ui,sans-serif', paddingBottom:80 }}>

      {/* ── Top bar ── */}
      <div style={{ position:'sticky', top:0, zIndex:50, background:t.bg, borderBottom:`1px solid ${t.border}`, padding:'12px 16px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ width:8, height:8, borderRadius:'50%', background:t.accent, boxShadow:`0 0 8px ${t.accent}`, animation:'pulse 2s infinite' }} />
          <span style={{ ...mono, fontSize:15, fontWeight:700, color:t.text }}>ScamSafe</span>
          <span style={{ ...mono, fontSize:9, color:t.text3, background:t.surface2, padding:'2px 6px', borderRadius:20, border:`1px solid ${t.border}` }}>BETA</span>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {installPrompt && (
            <button onClick={()=>installPrompt.prompt()} style={{ ...mono, fontSize:11, padding:'5px 12px', borderRadius:20, background:t.accent, color:'#000', border:'none', cursor:'pointer', fontWeight:700 }}>
              ＋ Install App
            </button>
          )}
          <button onClick={toggleTheme} style={{ background:t.surface2, border:`1px solid ${t.border}`, borderRadius:20, padding:'5px 12px', cursor:'pointer', fontSize:14, color:t.text2 }}>
            {theme==='dark'?'☀️':'🌙'}
          </button>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div style={{ display:'flex', gap:0, borderBottom:`1px solid ${t.border}`, background:t.surface }}>
        {([['scan','🔍 Scan'],['history','🕒 History'],['pinned','📌 Pinned']] as [Tab,string][]).map(([id,lbl])=>(
          <button key={id} onClick={()=>setTab(id)}
            style={{ flex:1, padding:'11px 4px', ...mono, fontSize:11, fontWeight:600, border:'none', borderBottom: tab===id ? `2px solid ${t.accent}` : '2px solid transparent', background:'transparent', color: tab===id ? t.accent : t.text3, cursor:'pointer', transition:'all .2s' }}>
            {lbl}{id==='pinned'&&pinned.length>0?` (${pinned.length})`:''}
          </button>
        ))}
      </div>

      <div style={{ maxWidth:600, margin:'0 auto', padding:'16px 16px 0' }}>

        {/* ══ SCAN TAB ══════════════════════════════════════════════════════════ */}
        {tab==='scan' && (<>

          {/* Hero */}
          <div style={{ textAlign:'center', padding:'20px 0 16px' }}>
            <h1 style={{ fontSize:26, fontWeight:900, lineHeight:1.2, margin:'0 0 8px' }}>
              Is this message<br/><span style={{ color:t.accent }}>trying to scam you?</span>
            </h1>
            <p style={{ fontSize:13, color:t.text2, margin:0 }}>Paste text or upload a screenshot · Free · No login</p>
          </div>

          {/* Mode switcher */}
          <div style={{ display:'flex', gap:4, padding:4, borderRadius:12, background:t.surface2, border:`1px solid ${t.border}`, marginBottom:14 }}>
            {(['text','image'] as const).map(m=>(
              <button key={m} onClick={()=>{setInputMode(m);setResult(null);setError('')}}
                style={{ flex:1, padding:'9px 4px', borderRadius:9, ...mono, fontSize:11, fontWeight:600, border:'none', background: inputMode===m ? t.surface3 : 'transparent', color: inputMode===m ? t.text : t.text3, cursor:'pointer', transition:'all .15s' }}>
                {m==='text'?'⌨ Paste Text':'📷 Screenshot'}
              </button>
            ))}
          </div>

          {/* Input card */}
          <div style={card}>
            {inputMode==='text' ? (<>
              <span style={label}>Paste the suspicious message</span>
              <textarea value={message} onChange={e=>setMessage(e.target.value)} rows={5}
                placeholder={'Paste message here...\n\nExample: "Your SBI account is blocked, click here for KYC"'}
                style={{ width:'100%', borderRadius:10, padding:12, ...mono, fontSize:13, lineHeight:1.6, resize:'vertical', background:t.surface2, border:`1px solid ${t.border}`, color:t.text, outline:'none', boxSizing:'border-box' }}
                onFocus={e=>(e.target.style.borderColor=t.accent)} onBlur={e=>(e.target.style.borderColor=t.border)} />
              {/* Sample chips */}
              <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:10 }}>
                {Object.keys(SAMPLES).map(k=>(
                  <button key={k} onClick={()=>{setMessage(SAMPLES[k]);setResult(null);setError('')}}
                    style={{ ...mono, fontSize:10, padding:'4px 10px', borderRadius:20, background:t.surface2, border:`1px solid ${t.border}`, color:t.text2, cursor:'pointer' }}>
                    {k}
                  </button>
                ))}
              </div>
            </>) : (<>
              <span style={label}>Upload screenshot or take photo</span>
              {!imagePreview ? (
                <div onDrop={e=>{e.preventDefault();setIsDrag(false);const f=e.dataTransfer.files[0];if(f)handleFile(f)}}
                  onDragOver={e=>{e.preventDefault();setIsDrag(true)}} onDragLeave={()=>setIsDrag(false)}
                  onClick={()=>fileRef.current?.click()}
                  style={{ border:`2px dashed ${isDrag?t.accent:t.border2}`, borderRadius:12, padding:'28px 16px', textAlign:'center', cursor:'pointer', background:isDrag?`${t.accent}10`:t.surface2 }}>
                  <div style={{ fontSize:36, marginBottom:10 }}>🖼️</div>
                  <p style={{ fontSize:13, fontWeight:600, color:t.text, marginBottom:6 }}>Drop screenshot here</p>
                  <p style={{ fontSize:11, color:t.text3, marginBottom:16 }}>OCR reads text from image automatically</p>
                  <div style={{ display:'flex', gap:8, justifyContent:'center', flexWrap:'wrap' }}>
                    {[['📁 Choose file',()=>fileRef.current?.click(),''],['📷 Camera',()=>cameraRef.current?.click(),t.accent]].map(([lbl,fn,col]:any)=>(
                      <button key={lbl} type="button" onClick={e=>{e.stopPropagation();fn()}}
                        style={{ ...mono, fontSize:12, padding:'8px 16px', borderRadius:10, border:`1px solid ${col||t.border2}`, background:'transparent', color:col||t.text, cursor:'pointer', fontWeight:600 }}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                  <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}} onChange={e=>{const f=e.target.files?.[0];if(f)handleFile(f);e.target.value=''}} />
                  <input ref={cameraRef} type="file" accept="image/*" capture style={{display:'none'}} onChange={e=>{const f=e.target.files?.[0];if(f)handleFile(f);e.target.value=''}} />
                </div>
              ) : (
                <div style={{ borderRadius:12, overflow:'hidden', border:`1px solid ${t.border2}` }}>
                  <img src={imagePreview} alt="preview" style={{ width:'100%', maxHeight:220, objectFit:'contain', background:t.surface2, display:'block' }} />
                  <div style={{ padding:'8px 12px', background:t.surface2, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                    <span style={{ ...mono, fontSize:11, color:t.accent }}>✓ {imageFile?.name?.slice(0,30)} ready</span>
                    <button onClick={()=>{setImageFile(null);setImgPrev(null);setResult(null)}} style={{ ...mono, fontSize:11, color:t.text3, background:'transparent', border:`1px solid ${t.border}`, borderRadius:6, padding:'3px 8px', cursor:'pointer' }}>✕</button>
                  </div>
                </div>
              )}
            </>)}
          </div>

          {/* Status */}
          {status && (
            <div style={{ ...mono, fontSize:12, color:t.accent, background:`${t.accent}10`, border:`1px solid ${t.accent}30`, borderRadius:10, padding:'10px 14px', marginBottom:12, display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ display:'inline-block', width:12, height:12, border:`2px solid ${t.accent}40`, borderTop:`2px solid ${t.accent}`, borderRadius:'50%', animation:'spin 1s linear infinite' }} />
              {status}
            </div>
          )}

          {/* Analyze button */}
          <button onClick={analyze} disabled={!canCheck||loading}
            style={{ width:'100%', padding:'15px', borderRadius:12, fontWeight:700, fontSize:14, border:'none', cursor: canCheck&&!loading?'pointer':'not-allowed', background: canCheck&&!loading?t.accent:t.surface2, color: canCheck&&!loading?'#000':t.text3, transition:'all .2s', marginBottom:12, ...mono }}>
            {loading ? (status||'Analyzing...') : (inputMode==='image'&&imageFile ? 'Analyze Screenshot →' : 'Check This Message →')}
          </button>

          {/* Error */}
          {error && <div style={{ background:'rgba(220,38,38,.08)', border:'1px solid rgba(220,38,38,.3)', borderRadius:10, padding:'10px 14px', color:'#fca5a5', fontSize:13, marginBottom:12 }}>{error}</div>}

          {/* Result */}
          {result && cfg && (
            <div id="result" style={{ borderRadius:16, overflow:'hidden', border:`2px solid ${cfg.border}`, background:cfg.bg, marginBottom:12 }}>
              <div style={{ padding:'14px 16px', borderBottom:`1px solid ${cfg.border}`, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <span style={{ ...mono, fontSize:12, fontWeight:700, padding:'4px 12px', borderRadius:20, background:cfg.badgeBg, color:cfg.badge, border:`1px solid ${cfg.border}` }}>
                  {cfg.label}
                </span>
                <span style={{ ...mono, fontSize:11, color:t.text3 }}>{result.confidence}% sure</span>
              </div>

              {/* Score bar */}
              <div style={{ padding:'12px 16px', borderBottom:`1px solid ${t.border}` }}>
                <div style={{ display:'flex', justifyContent:'space-between', ...mono, fontSize:10, color:t.text3, marginBottom:6 }}>
                  <span>RISK SCORE</span><span>{result.risk_score}/100</span>
                </div>
                <div style={{ height:6, borderRadius:3, background:t.surface3, overflow:'hidden' }}>
                  <div style={{ height:'100%', width:`${result.risk_score}%`, background:cfg.dot, borderRadius:3, transition:'width .7s ease' }} />
                </div>
              </div>

              <div style={{ padding:'14px 16px', display:'flex', flexDirection:'column', gap:12 }}>
                {result.scam_type!=='None detected' && (
                  <div>
                    <span style={label}>Scam Type</span>
                    <span style={{ ...mono, fontSize:11, padding:'3px 10px', borderRadius:20, background:`${t.accent3}20`, color:t.accent3, border:`1px solid ${t.accent3}40` }}>{result.scam_type}</span>
                  </div>
                )}
                {result.explanation && (
                  <div>
                    <span style={label}>What this means</span>
                    <p style={{ fontSize:13, color:t.text2, lineHeight:1.6, margin:0 }}>{result.explanation}</p>
                  </div>
                )}
                <div>
                  <span style={label}>Why we flagged this</span>
                  {result.scam_signals.map((s,i)=>(
                    <div key={i} style={{ display:'flex', gap:8, alignItems:'flex-start', padding:'8px 10px', borderRadius:8, background:t.surface2, marginBottom:5, fontSize:12, color:t.text2, lineHeight:1.5 }}>
                      <span style={{ width:6, height:6, borderRadius:'50%', background:cfg.dot, flexShrink:0, marginTop:5 }} />{s}
                    </div>
                  ))}
                </div>
                <div>
                  <span style={label}>What to do right now</span>
                  <div style={{ padding:'12px 14px', borderRadius:10, background:cfg.action, fontSize:13, fontWeight:600, color:cfg.badge, lineHeight:1.5 }}>{result.recommended_action}</div>
                </div>
                {result.if_already_sent && (
                  <div>
                    <span style={label}>If you already sent money</span>
                    <div style={{ padding:'12px 14px', borderRadius:10, background:cfg.ifSent, fontSize:12, color:'#fdba74', lineHeight:1.6 }}>{result.if_already_sent}</div>
                  </div>
                )}
              </div>

              <div style={{ display:'flex', gap:8, padding:'12px 16px', borderTop:`1px solid ${t.border}` }}>
                <button onClick={reset} style={{ flex:1, padding:'10px', ...mono, fontSize:12, borderRadius:10, border:`1px solid ${t.border}`, background:'transparent', color:t.text2, cursor:'pointer' }}>Check another</button>
                <button onClick={shareResult} style={{ flex:1, padding:'10px', ...mono, fontSize:12, borderRadius:10, border:`1px solid ${t.accent}40`, background:'transparent', color:t.accent, cursor:'pointer', fontWeight:700 }}>Share result →</button>
              </div>
            </div>
          )}
        </>)}

        {/* ══ HISTORY TAB ═══════════════════════════════════════════════════════ */}
        {tab==='history' && (<>
          <div style={{ padding:'16px 0 12px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontSize:15, fontWeight:700 }}>Scan History ({history.length})</span>
            {history.length>0 && <button onClick={()=>{if(confirm('Clear all history?')){setHistory([]);saveHistory([])}}} style={{ ...mono, fontSize:11, color:'#ef4444', background:'transparent', border:'1px solid rgba(220,38,38,.3)', borderRadius:8, padding:'4px 10px', cursor:'pointer' }}>Clear all</button>}
          </div>
          {history.length===0 ? (
            <div style={{ textAlign:'center', padding:40, color:t.text3 }}>
              <div style={{ fontSize:32, marginBottom:8 }}>🕵️</div>
              <p style={{ ...mono, fontSize:13 }}>No scans yet.<br/>Go to Scan tab to analyze a message.</p>
            </div>
          ) : history.map(h=>(
            <HistoryCard key={h.time} entry={h} t={t} onPin={()=>togglePin(h.time)} onDelete={()=>deleteEntry(h.time)} />
          ))}
        </>)}

        {/* ══ PINNED TAB ════════════════════════════════════════════════════════ */}
        {tab==='pinned' && (<>
          <div style={{ padding:'16px 0 12px' }}>
            <span style={{ fontSize:15, fontWeight:700 }}>📌 Pinned Messages ({pinned.length})</span>
            <p style={{ ...mono, fontSize:11, color:t.text3, marginTop:4 }}>Pin important fraud alerts to review later</p>
          </div>
          {pinned.length===0 ? (
            <div style={{ textAlign:'center', padding:40, color:t.text3 }}>
              <div style={{ fontSize:32, marginBottom:8 }}>📌</div>
              <p style={{ ...mono, fontSize:13 }}>No pinned messages yet.<br/>Pin fraud alerts from History tab.</p>
            </div>
          ) : pinned.map(h=>(
            <HistoryCard key={h.time} entry={h} t={t} onPin={()=>togglePin(h.time)} onDelete={()=>deleteEntry(h.time)} />
          ))}
        </>)}

      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes spin   { to{transform:rotate(360deg)} }
        * { -webkit-tap-highlight-color: transparent; }
        textarea:focus { outline: none; }
        :root {
          --bg:${t.bg}; --surface:${t.surface}; --surface2:${t.surface2}; --surface3:${t.surface3};
          --border:${t.border}; --border2:${t.border2}; --text:${t.text}; --text2:${t.text2}; --text3:${t.text3};
          --accent:${t.accent}; --accent3:${t.accent3};
        }
      `}</style>
    </div>
  )
}

// ── History Card Component ─────────────────────────────────────────────────────
function HistoryCard({ entry, t, onPin, onDelete }: { entry: any; t: any; onPin:()=>void; onDelete:()=>void }) {
  const cfg = RISK[entry.risk_level as RiskLevel]
  const mono = { fontFamily:'var(--font-dm-mono),monospace' }
  const timeStr = new Date(entry.time).toLocaleString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })
  return (
    <div style={{ borderRadius:12, overflow:'hidden', border:`1px solid ${cfg.border}`, background:cfg.bg, marginBottom:10 }}>
      <div style={{ padding:'10px 14px', display:'flex', alignItems:'center', gap:8, borderBottom:`1px solid ${t.border}` }}>
        <span style={{ ...mono, fontSize:10, padding:'2px 8px', borderRadius:20, background:cfg.badgeBg, color:cfg.badge, fontWeight:700 }}>{entry.risk_level}</span>
        <span style={{ ...mono, fontSize:10, color:t.text3 }}>{entry.risk_score}/100</span>
        <span style={{ ...mono, fontSize:10, color:t.text3, marginLeft:'auto' }}>{timeStr}</span>
        <button onClick={onPin} title={entry.pinned?'Unpin':'Pin'} style={{ background:'transparent', border:'none', cursor:'pointer', fontSize:14, padding:'0 2px' }}>{entry.pinned?'📌':'☆'}</button>
        <button onClick={onDelete} style={{ background:'transparent', border:'none', cursor:'pointer', fontSize:12, color:t.text3, padding:'0 2px' }}>✕</button>
      </div>
      <div style={{ padding:'10px 14px' }}>
        <p style={{ ...mono, fontSize:11, color:t.text2, margin:'0 0 4px', lineHeight:1.5, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{entry.text}</p>
        {entry.recommended_action && <p style={{ ...mono, fontSize:11, color:cfg.badge, margin:0, marginTop:6 }}>→ {entry.recommended_action}</p>}
      </div>
    </div>
  )
}
