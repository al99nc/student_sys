import { NextRequest, NextResponse } from 'next/server'

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export async function GET(
  request: NextRequest,
  { params }: { params: { key: string } }
) {
  try {
    const res = await fetch(`${BACKEND_URL}/content/${params.key}`, {
      cache: 'no-store',
    })

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Content not found' },
        { status: res.status }
      )
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch content' },
      { status: 500 }
    )
  }
}
