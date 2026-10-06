/**
 * Minimal global navigation (Phase 11 hardening).
 *
 * Server component with plain anchor links — no client JavaScript, no
 * routing framework. Rendered in the root layout so no page strands the
 * user: Home, Travel Agent, Trip Planner, and Visual Companion are always
 * one click away on every surface.
 */

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/agent", label: "Travel Agent" },
  { href: "/plan", label: "Trip Planner" },
  { href: "/vision", label: "Visual Companion" },
] as const;

export default function SiteNav() {
  return (
    <nav
      aria-label="GhoomAI sections"
      className="border-b border-neutral-200 bg-white"
    >
      <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-x-5 gap-y-1 px-8 py-3">
        <span className="text-sm font-bold text-neutral-900">GhoomAI</span>
        {LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="text-sm font-medium text-sky-700 hover:underline"
          >
            {link.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
