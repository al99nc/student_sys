import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StudyAI - Learn Smarter",
  description: "Upload lectures and get AI-generated MCQs, summaries, and key concepts",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 min-h-screen">{children}</body>
    </html>
  );
}
