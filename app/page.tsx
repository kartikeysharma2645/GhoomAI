export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-8">
      <p className="text-sm font-medium uppercase tracking-widest text-neutral-500">
        GhoomAI &mdash; Phase 1
      </p>
      <h1 className="text-4xl font-bold">Plan it. Check it. Experience it.</h1>
      <p className="text-neutral-600">
        Project architecture and configuration are being set up. Trip planning,
        RealityCheck verification, and live trip features arrive in later
        phases.
      </p>
      <ul className="list-disc space-y-1 pl-6 text-neutral-700">
        <li>Phase 1: Architecture &amp; configuration (in progress)</li>
        <li>Phase 2: Secure SerpApi integration (not started)</li>
      </ul>
      <p className="text-sm text-neutral-500">
        Backend status: <code>/api/health</code>
      </p>
    </main>
  );
}
