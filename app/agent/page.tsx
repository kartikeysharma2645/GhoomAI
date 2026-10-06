import AgentChat from "../components/AgentChat";

export default function AgentPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-8 py-12">
      <header>
        <p className="text-sm font-medium uppercase tracking-widest text-neutral-500">
          GhoomAI · Travel Agent
        </p>
        <h1 className="mt-1 text-4xl font-bold text-neutral-900">
          Chat with GhoomAI
        </h1>
        <p className="mt-2 text-neutral-600">
          One conversation for planning, verification, booking handoff, and
          live-trip tracking — every action runs through a verified
          capability, never guessed.
        </p>
      </header>

      <AgentChat />

      <nav aria-label="Specialized surfaces" className="space-y-1 text-sm text-neutral-600">
        <p>
          Prefer the focused tools?{" "}
          <a href="/plan" className="font-medium text-sky-700 hover:underline">
            Trip planner
          </a>{" "}
          ·{" "}
          <a href="/vision" className="font-medium text-sky-700 hover:underline">
            Photo identification
          </a>{" "}
          ·{" "}
          <a href="/" className="font-medium text-sky-700 hover:underline">
            Quick search
          </a>
        </p>
      </nav>

      <footer className="mt-auto pt-8 text-xs text-neutral-400">
        Live travel data via SerpApi · GhoomAI never completes bookings.
      </footer>
    </main>
  );
}
