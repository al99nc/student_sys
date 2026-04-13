import type { Metadata } from "next";
import "./globals.css";
import Script from "next/script";
import { TelegramProvider } from "@/lib/TelegramProvider";
import { Plus_Jakarta_Sans } from "next/font/google";

// next/font self-hosts this font — zero external network request, zero render-blocking
const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-plus-jakarta",
  preload: true,
});

export const metadata: Metadata = {
  title: "cortexQ - Learn Smarter",
  description: "Upload lectures and get AI-generated MCQs, summaries, and key concepts",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${plusJakarta.variable}`}>
      <head>
        <link rel="manifest" href="/manifest.json" />

        {/*
          Material Symbols — icon font only.
          - Narrowed to a single axis point (matches the font-variation-settings in globals.css)
            so the download is ~70% smaller than the full variable range.
          - crossOrigin + preconnect warms the connection before the stylesheet fires.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=block"
          rel="stylesheet"
        />
      </head>
      <body className="text-on-surface bg-[#111220] min-h-screen" style={{ fontFamily: "var(--font-plus-jakarta), sans-serif" }}>
        <TelegramProvider>
          {children}
        </TelegramProvider>

        {/* Telegram Mini App SDK — lazyOnload so it never blocks initial paint */}
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="lazyOnload"
        />

        {/* Service worker — non-critical, fires after page is interactive */}
        <Script id="register-sw" strategy="afterInteractive">{`
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js');
          }
        `}</Script>
      </body>
    </html>
  );
}
