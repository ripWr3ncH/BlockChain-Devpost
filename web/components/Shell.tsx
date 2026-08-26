'use client';

/**
 * VERITY — portal chrome.
 *
 * The identity switcher that used to live here belonged to the Hyperledger Fabric
 * prototype, where role and seniority came from an X.509 certificate the gateway
 * read per request. On Midnight the caller's role is a private witness the circuit
 * checks, not a header this page sends, so there is nothing here to switch.
 *
 * The synthetic-data banner is permanent and cannot be dismissed. The whitepaper
 * lists the things Verity does not claim; the least this interface can do is never
 * let a screenshot be mistaken for real supervisory data.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export function Shell({ children }: { children: ReactNode }): ReactNode {
  const pathname = usePathname();
  const onMidnight = pathname.startsWith('/midnight');

  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="brand" style={{ textDecoration: 'none' }}>
          Verity
          <span className="tag">{onMidnight ? 'Midnight Preview' : 'prototype'}</span>
        </Link>
        <nav>
          <Link href="/midnight" data-active={onMidnight}>
            Midnight portal
          </Link>
        </nav>
      </header>

      <div className="synthetic-banner">
        All data synthetic — no real borrower, depositor or institution appears. Institution names are
        placeholders; no organisation has committed to participate.
      </div>

      <main>{children}</main>
    </div>
  );
}
