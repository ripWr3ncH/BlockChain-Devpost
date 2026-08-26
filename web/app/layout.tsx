import type { Metadata } from 'next';
import { IBM_Plex_Mono, Plus_Jakarta_Sans } from 'next/font/google';

import { Shell } from '@/components/Shell';
import './globals.css';

/**
 * next/font downloads these at BUILD time and serves them from our own origin,
 * so the venue needs no internet. A demo that depends on fonts.googleapis.com
 * resolving is a demo that can fail in front of judges for no good reason.
 *
 * Plus Jakarta Sans carries the rounded, high-x-height geometry the interface
 * is built on, and holds its weight on a projector. IBM Plex Mono carries every
 * number that has to be read exactly: hashes, transaction ids, block heights,
 * and the approval count the whole demo turns on.
 */
const sans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-sans',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Quorum — a board vote that proves itself',
  description:
    'Board approval for loan write-offs, proved in zero knowledge on Midnight. The supervisor learns that enough directors approved; nothing else reaches the ledger. Brainwave 2026 Midnight Track, Team Logarithm. Synthetic data throughout.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
