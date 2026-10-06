import AskBox from "./components/AskBox";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-8 py-12">
      <header>
        <p className="text-sm font-medium uppercase tracking-widest text-neutral-500">
          GhoomAI
        </p>
        <h1 className="mt-1 text-4xl font-bold text-neutral-900">
          Plan it. Check it. Experience it.
        </h1>
        <p className="mt-2 text-neutral-600">
          Ask about stays and places — every answer is researched live, never
          guessed.
        </p>
      </header>

      <AskBox />

      <p className="text-sm text-neutral-600">
        Want the full agent experience?{" "}
        <a href="/agent" className="font-medium text-sky-700 hover:underline">
          Chat with GhoomAI
        </a>{" "}
        — plan, verify, book handoff, and track, in one conversation.
      </p>

      <p className="text-sm text-neutral-600">
        Planning a full trip?{" "}
        <a href="/plan" className="font-medium text-sky-700 hover:underline">
          Build a multi-day itinerary
        </a>
      </p>

      <p className="text-sm text-neutral-600">
        Have a photo?{" "}
        <a href="/vision" className="font-medium text-sky-700 hover:underline">
          Identify a place from a picture
        </a>
      </p>

      <footer className="mt-auto pt-8 text-xs text-neutral-400">
        Live travel data via SerpApi · Plans are verified with RealityCheck
        before you approve them.
      </footer>
    </main>
  );
}
