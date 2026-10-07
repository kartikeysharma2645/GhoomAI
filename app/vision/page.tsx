import VisionAnalyzer from "../components/VisionAnalyzer";
import { TravelImage } from "../components/agent-travel";
import { DISCOVERY_CATEGORIES } from "../components/travel-images";

export default function VisionPage() {
  return (
    <main className="min-h-screen bg-[#f7f4ee]">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
        <section aria-label="See a place" className="relative overflow-hidden rounded-3xl">
          <TravelImage
            image={DISCOVERY_CATEGORIES[5].image}
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
              GhoomAI · Visual Companion
            </p>
            <h1 className="mt-2 max-w-lg text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl">
              See a place. Understand it.
            </h1>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-stone-200">
              Upload a photo of a landmark or destination. Suggestions are
              starting points for live verification, never confirmed locations.
            </p>
            <p className="mt-3 text-xs text-stone-300">
              Supported: JPEG · PNG · WebP — nothing is uploaded until you analyze.
            </p>
          </div>
        </section>

        <div className="mx-auto w-full max-w-3xl rounded-3xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
          <VisionAnalyzer />
        </div>

        <footer className="mt-auto pt-4 text-xs text-stone-400">
          <a href="/" className="font-medium text-teal-900 hover:underline">
            Back to GhoomAI
          </a>
        </footer>
      </div>
    </main>
  );
}
