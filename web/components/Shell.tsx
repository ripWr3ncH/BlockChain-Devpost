'use client';

/**
 * QUORUM — portal chrome.
 *
 * The reference's top bar is a coloured strip with a round chip on the left and
 * the screen name centred; this keeps that shape but puts navigation on the right,
 * because there is more than one destination.
 *
 * There is no identity switcher. The Fabric prototype had one, because role and
 * seniority came from an X.509 certificate the gateway read per request. On
 * Midnight the caller's role is a private witness the circuit checks — nothing
 * this page sends, and so nothing here to switch.
 *
 * The synthetic-data banner is permanent and cannot be dismissed. The least this
 * interface can do is never let a screenshot be mistaken for supervisory data.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export function Shell({ children }: { children: ReactNode }): ReactNode {
  const pathname = usePathname();
  const onBoard = pathname.startsWith('/board');

  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="brand" style={{ textDecoration: 'none' }}>
          <span className="dot" aria-hidden>
            ◕
          </span>
          Quorum
          <span className="tag">Midnight Preview</span>
        </Link>
        <nav>
          <Link href="/" data-active={!onBoard}>
            Overview
          </Link>
          <Link href="/board" data-active={onBoard}>
            Board room
          </Link>
        </nav>
      </header>

      <div className="synthetic-banner">
        <strong>All data synthetic.</strong> No real borrower, depositor or institution appears
        anywhere. Institution names are placeholders and no organisation has committed to
        participate.
      </div>

      <main>{children}</main>
    </div>
  );
}
