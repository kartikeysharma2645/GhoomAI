import TripForm from "../components/TripForm";
import { InspirationGrid, TravelImage } from "../components/agent-travel";
import { HERO_IMAGE } from "../components/travel-images";

export default function PlanPage() {
  return (
    <main className="min-h-screen bg-[#f7f4ee]">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
        <section aria-label="Plan your journey" className="relative overflow-hidden rounded-3xl">
          <TravelImage
            image={HERO_IMAGE}
            eager
            className="absolute inset-0"
            imgClassName="h-full w-full object-cover"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-r from-stone-950/80 via-stone-950/55 to-stone-950/30"
          />
          <div className="relative px-6 py-10 sm:px-10 sm:py-12">
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-amber-200">
              GhoomAI · Trip Planner
            </p>
            <h1 className="mt-2 max-w-lg text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl">
              Plan your journey
            </h1>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-stone-200">
              Tell GhoomAI where you&apos;re going. We&apos;ll research it
              against live information before building your itinerary — and
              check it again before you approve.
            </p>
          </div>
        </section>

        <div className="mx-auto w-full max-w-3xl">
          <TripForm />
        </div>

        <div className="mx-auto w-full max-w-5xl">
          <InspirationGrid
            title="Not sure where to go?"
            subtitle="Select a category — GhoomAI discovers real destinations live"
          />
        </div>

        <footer className="mt-auto pt-4 text-xs text-stone-400">
          Live travel data via SerpApi · Verify with RealityCheck before
          approving.
        </footer>
      </div>
    </main>
  );
}
