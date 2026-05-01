'use client'

import { useEffect, useState } from 'react'

export default function AboutPage() {
  const [content, setContent] = useState<string>('Loading...')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/content/about')
      .then(res => res.json())
      .then(data => {
        setContent(data.content || 'About content not configured yet.')
        setLoading(false)
      })
      .catch(() => {
        setContent('About cortexQ is an AI-powered learning platform designed to help students master complex topics through adaptive practice and personalized insights.')
        setLoading(false)
      })
  }, [])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="prose prose-invert max-w-none">
          <h1 className="text-4xl font-bold tracking-tight text-foreground">
            About cortexQ
          </h1>
          <div className="mt-8 text-muted-foreground">
            <div dangerouslySetInnerHTML={{ __html: content.replace(/\n/g, '<br/>') }} />
          </div>
        </div>
      </div>
    </main>
  )
}
