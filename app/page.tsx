import AskBox from "./components/AskBox";
import { InspirationGrid, TravelImage, TrustStrip } from "./components/agent-travel";
import { DISCOVERY_CATEGORIES, WORKSPACE_BANNER_IMAGE } from "./components/travel-images";

const LIFECYCLE_STEPS = [
  { name: "Plan", detail: "Describe your trip; GhoomAI researches it live" },
  { name: "RealityCheck", detail: "Every item tested against fresh evidence" },
  { name: "Fix", detail: "Verified alternatives for what fails" },
  { name: "Approve", detail: "You sign off — nothing auto-applies" },
  { name: "Book / Handoff", detail: "Real options, booked externally by you" },
  { name: "Go live", detail: "Track and adapt while you travel" },
] as const;

const CAPABILITIES = [
  {
    name: "Travel Agent",
    detail:
      "One conversation for planning, verification, booking handoff, and live-trip tracking.",
    href: "/agent",
    cta: "Chat with GhoomAI",
    image: DISCOVERY_CATEGORIES[0].image,
  },
  {
    name: "Trip Planner",
    detail:
      "Multi-day itineraries researched live, with RealityCheck, fixes, and approval built in.",
    href: "/plan",
    cta: "Build an itinerary",
    image: DISCOVERY_CATEGORIES[5].image,
  },
  {
    name: "Visual Companion",
    detail:
      "Upload a landmark photo to understand what it shows — honest about its limits.",
    href: "/vision",
    cta: "Identify a photo",
    image: DISCOVERY_CATEGORIES[6].image,
  },
] as const;

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#f7f4ee]">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-10 px-4 py-6 sm:px-6 sm:py-8">
        {/* Hero */}
        <section aria-label="GhoomAI introduction" className="relative overflow-hidden rounded-3xl">
          <TravelImage
            image={WORKSPACE_BANNER_IMAGE}
            eager
            className="absolute inset-0"
            imgClassName="h-full w-full object-cover"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-b from-stone-950/70 via-stone-950/45 to-stone-950/70"
          />
          <div className="relative px-6 py-14 text-center sm:px-10 sm:py-20">
            <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-amber-200">
              GhoomAI
            </p>
            <h1 className="mx-auto mt-3 max-w-xl text-3xl font-bold leading-[1.1] tracking-tight text-white sm:text-5xl">
              Plan smarter. Travel better.
            </h1>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-stone-200 sm:text-base">
              GhoomAI plans trips, checks them against live information, and
              helps adapt when reality changes.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
              <a
                href="/plan"
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-amber-200 px-6 py-2.5 text-sm font-bold text-stone-900 shadow-lg transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200 focus-visible:ring-offset-2"
              >
                Plan a trip →
              </a>
              <a
                href="/agent"
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-white/40 bg-white/10 px-6 py-2.5 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2"
              >
                Ask GhoomAI
              </a>
            </div>
          </div>
        </section>

        {/* Functional discovery */}
        <InspirationGrid
          title="Discover where next"
          subtitle="Select a category — GhoomAI discovers real destinations live"
        />

        {/* Lifecycle */}
        <section aria-label="How GhoomAI works">
          <h2 className="text-lg font-bold tracking-tight text-stone-900">
            How GhoomAI works
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            Not just generated text — researched, checked, and kept under your control.
          </p>
          <ol className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            {LIFECYCLE_STEPS.map((step, i) => (
              <li
                key={step.name}
                className="relative rounded-2xl border border-stone-200 bg-white p-3.5 shadow-sm"
              >
                <p className="text-[11px] font-bold tabular-nums text-teal-900">
                  {String(i + 1).padStart(2, "0")}
                </p>
                <p className="mt-1 text-sm font-bold text-stone-900">{step.name}</p>
                <p className="mt-0.5 text-xs leading-snug text-stone-500">{step.detail}</p>
              </li>
            ))}
          </ol>
        </section>

        <TrustStrip />

        {/* Capabilities */}
        <section aria-label="Product capabilities">
          <h2 className="text-lg font-bold tracking-tight text-stone-900">
            One product, three ways in
          </h2>
          <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-3">
            {CAPABILITIES.map((cap) => (
              <article
                key={cap.name}
                className="group overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
              >
                <TravelImage
                  image={cap.image}
                  className="aspect-[16/8]"
                  imgClassName="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <div className="p-4">
                  <h3 className="text-[15px] font-bold text-stone-900">{cap.name}</h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-stone-600">
                    {cap.detail}
                  </p>
                  <a
                    href={cap.href}
                    aria-label={`${cap.cta} — ${cap.name}`}
                    className="mt-3 inline-flex min-h-[40px] items-center rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-offset-2"
                  >
                    {cap.cta} →
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* Quick search (existing capability, preserved) */}
        <section
          aria-label="Quick search"
          className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6"
        >
          <h2 className="text-lg font-bold tracking-tight text-stone-900">
            Try a quick search
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            Stays and places, researched live. For multi-turn planning, use the agent.
          </p>
          <div className="mt-4">
            <AskBox />
          </div>
        </section>

        <footer className="mt-auto pt-4 text-xs text-stone-400">
          Live travel data via SerpApi · Plans are verified with RealityCheck
          before you approve them.
        </footer>
      </div>
    </main>
  );
}
