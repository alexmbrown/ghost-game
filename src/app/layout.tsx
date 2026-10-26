import type { Metadata, Viewport } from 'next';
import { Creepster, Lilita_One, Rubik } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

// Self-hosted at build time, so the static export bundles the fonts (offline-safe).
// Creepster: spooky headings. Lilita One: chunky game UI (buttons, numbers, labels).
// Rubik: small body copy.
const display = Creepster({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});
const ui = Lilita_One({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-ui',
  display: 'swap',
});
const body = Rubik({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

const description = 'A 3D ghoul-duel party game: collect spirits, steal from rival trails, bank them home. Play with friends peer-to-peer.';
// Absolute origin for the share card (src/app/opengraph-image.jpg); set by the deploy workflow.
const site = process.env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  ...(site ? { metadataBase: new URL(site) } : {}),
  title: 'Ghost Game',
  description,
  openGraph: { title: 'Ghost Game', description, type: 'website' },
  twitter: { card: 'summary_large_image', title: 'Ghost Game', description },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0a0913',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
