import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const auth = request.headers.get("Authorization") || "";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(`${BACKEND}/jobs/${params.jobId}`, {
      headers: { Authorization: auth },
      signal: controller.signal,
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error: any) {
    if (error.name === "AbortError") {
      return NextResponse.json({ error: "Backend request timed out" }, { status: 504 });
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  } finally {
    clearTimeout(timeoutId);
  }
}
