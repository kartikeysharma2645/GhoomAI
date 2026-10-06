import TripForm from "../components/TripForm";

export default function PlanPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-8 py-12">
      <header>
        <p className="text-sm font-medium uppercase tracking-widest text-neutral-500">
          GhoomAI · Trip Planner
        </p>
        <h1 className="mt-1 text-4xl font-bold text-neutral-900">
          Plan a real trip
        </h1>
        <p className="mt-2 text-neutral-600">
          Tell us where and when — stays and places are researched live, and
          every itinerary item keeps its evidence.
        </p>
      </header>

      <TripForm />

      <footer className="mt-auto pt-8 text-xs text-neutral-400">
        Live travel data via SerpApi · Verify with RealityCheck before
        approving.
      </footer>
    </main>
  );
}
