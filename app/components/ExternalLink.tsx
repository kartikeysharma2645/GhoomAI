"use client";

import React from "react";

import type { ReactNode } from "react";

/**
 * Single external-link contract for the whole app (link rendering fix).
 *
 * Renders a real anchor opening the destination in a new tab — or nothing
 * at all. The href must be an absolute http(s) URL that came from live
 * provider data; anything else (javascript:, data:, relative paths,
 * non-strings) renders null so a fake or unsafe destination can never
 * become clickable. URLs are never constructed here.
 */

export function isExternalHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

export default function ExternalLink({
  href,
  children,
  className,
  ariaLabel,
}: {
  /** Trustworthy absolute URL from live provider data, or unknown. */
  href: unknown;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  if (!isExternalHttpUrl(href)) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      {...(ariaLabel ? { "aria-label": ariaLabel } : {})}
    >
      {children}
    </a>
  );
}
