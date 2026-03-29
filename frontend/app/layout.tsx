import type { Metadata } from "next";
import "./globals.css";
import Script from "next/script";
import { TelegramProvider } from "@/lib/TelegramProvider";

export const metadata: Metadata = {
  title: "cortexQ - Learn Smarter",
  description: "Upload lectures and get AI-generated MCQs, summaries, and key concepts",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
        {/* Telegram Mini App SDK — must be in <head> before React hydrates */}
        <script src="https://telegram.org/js/telegram-web-app.js" />
      </head>
      <body className="text-on-surface bg-[#111220] min-h-screen">
        <TelegramProvider>
          {children}
        </TelegramProvider>
        <Script id="register-sw" strategy="afterInteractive">{`
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js');
          }
        `}</Script>
      </body>
    </html>
  );
}
