"use client";

import { usePathname } from "next/navigation";

/**
 * Global navigation for the GhoomAI travel product.
 *
 * Same four destinations as before (Home, Travel Agent, Trip Planner,
 * Visual Companion), now with travel-product styling and an active-state
 * pill derived from the current path. Client-side only for the active
 * state — links remain plain anchors, no routing framework changes.
 */

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/agent", label: "Travel Agent" },
  { href: "/plan", label: "Trip Planner" },
  { href: "/vision", label: "Visual Companion" },
] as const;

export default function SiteNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="GhoomAI sections"
      className="sticky top-0 z-20 border-b border-stone-200/80 bg-[#f7f4ee]/95 backdrop-blur"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-1.5 gap-y-1 px-4 py-2.5 sm:px-6">
        <a
          href="/"
          aria-label="GhoomAI home"
          className="mr-1 flex items-center gap-2 rounded-full pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-800 focus-visible:ring-offset-2"
        >
          <span
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-900 text-xs font-bold text-white"
          >
            G
          </span>
          <span className="text-sm font-bold tracking-tight text-stone-900">
            GhoomAI
          </span>
        </a>
        {LINKS.map((link) => {
          const active =
            link.href === "/"
              ? pathname === "/"
              : pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <a
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "rounded-full bg-stone-900 px-3 py-1.5 text-[13px] font-semibold text-white shadow-sm"
                  : "rounded-full px-3 py-1.5 text-[13px] font-medium text-stone-600 transition-colors hover:bg-stone-900/5 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-800 focus-visible:ring-offset-2"
              }
            >
              {link.label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
