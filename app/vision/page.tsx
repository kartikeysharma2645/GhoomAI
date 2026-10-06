import VisionAnalyzer from "../components/VisionAnalyzer";

export default function VisionPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-8 py-12">
      <header>
        <p className="text-sm font-medium uppercase tracking-widest text-neutral-500">
          GhoomAI · Visual Companion
        </p>
        <h1 className="mt-1 text-4xl font-bold text-neutral-900">
          Identify a place
        </h1>
        <p className="mt-2 text-neutral-600">
          Upload a photo and see what it appears to show. Suggestions are
          starting points for live verification, never confirmed locations.
        </p>
      </header>

      <VisionAnalyzer />

      <footer className="mt-auto pt-8 text-xs text-neutral-400">
        <a href="/" className="font-medium text-sky-700 hover:underline">
          Back to GhoomAI
        </a>
      </footer>
    </main>
  );
}
