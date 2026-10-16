'use client'
import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
export default function SharePage() {
  const router = useRouter()
  const params = useSearchParams()
  useEffect(() => {
    const text = params.get('text') || params.get('url') || params.get('title') || ''
    router.replace(`/?text=${encodeURIComponent(text)}`)
  }, [])
  return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',fontFamily:'monospace',color:'#00e5a0'}}>Loading ScamSafe...</div>
}
