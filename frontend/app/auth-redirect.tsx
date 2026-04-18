"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export function AuthRedirect() {
  const router = useRouter()
  
  useEffect(() => {
    const isAuthenticated = () => {
      if (typeof window === 'undefined') return false
      return !!localStorage.getItem('token')
    }
    
    if (isAuthenticated()) {
      router.push("/dashboard")
    }
  }, [router])
  
  return null
}
