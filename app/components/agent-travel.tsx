"use client";

import React, { useState } from "react";
import {
  DISCOVERY_CATEGORIES,
  HERO_IMAGE,
  WORKSPACE_BANNER_IMAGE,
  type TravelImage,
} from "./travel-images";

/**
 * Travel-discovery presentational layer for /agent (UI Phase 1.5).
 *
 * Stateless visuals only: hero, quick-action tiles, inspiration grid,
 * trust strip, and the compact workspace banner. Clicking a quick tile
 * sends a real agent message through the caller's handler; inspiration
 * cards are deliberately non-interactive — generic photography that must
 * never masquerade as a live result.
 */

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * Scenic photograph with a warm gradient fallback. If the remote image
 * fails, the fallback surface remains — never a broken-image icon.
 */
export function TravelImage({
  image,
  className,
  imgClassName,
  eager,
}: {
  image: TravelImage;
  className?: string;
  imgClassName?: string;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={cx(
        "overflow-hidden bg-gradient-to-br from-stone-700 via-stone-800 to-teal-950",
        className,
      )}
    >
      {!failed && (
        // Plain <img> keeps remote photography free of next/image
        // remote-pattern configuration; fallback above covers failures.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image.src}
          alt={image.alt}
          loading={eager ? "eager" : "lazy"}
          onError={() => setFailed(true)}
          className={imgClassName}
        />
      )}
    </div>
  );
}

/* ---------- tiny inline icons (no emoji) ---------- */

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

export function PlaneIcon() {
  return (
    <Icon>
      <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
    </Icon>
  );
}

export function CompassIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="10" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </Icon>
  );
}

export function BedIcon() {
  return (
    <Icon>
      <path d="M2 4v16" />
      <path d="M2 8h18a2 2 0 0 1 2 2v10" />
      <path d="M2 17h20" />
      <path d="M6 8v9" />
    </Icon>
  );
}

export function CheckIcon() {
  return (
    <Icon>
      <path d="M20 6 9 17l-5-5" />
    </Icon>
  );
}

/* ---------- discovery hero ---------- */

export function DiscoveryHero({ composer }: { composer: React.ReactNode }) {
  return (
    <section aria-label="Plan your next escape" className="relative overflow-hidden rounded-3xl">
      <TravelImage
        image={HERO_IMAGE}
        eager
        className="absolute inset-0"
        imgClassName="h-full w-full object-cover"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-b from-stone-950/70 via-stone-950/45 to-stone-950/70"
      />
      <div className="relative px-6 py-12 text-center sm:px-10 sm:py-16">
        <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-amber-200">
          GhoomAI
        </p>
        <h2 className="mx-auto mt-3 max-w-lg text-3xl font-bold leading-[1.1] tracking-tight text-white sm:text-5xl">
          Plan your next escape
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-stone-200 sm:text-base">
          Plan it. Check it. Experience it. Plan your trip, verify it against
          live information, and adapt when reality changes.
        </p>
        <div className="mx-auto mt-6 max-w-xl text-left">{composer}</div>
        <p className="mt-3 text-[11px] text-stone-300">
          Live travel data · You approve every important step
        </p>
      </div>
    </section>
  );
}

/* ---------- quick-action travel tiles ---------- */

export interface QuickTile {
  label: string;
  description: string;
  message: string;
  icon: React.ReactNode;
}

export const QUICK_TILES: QuickTile[] = [
  {
    label: "Plan a trip",
    description: "Build your itinerary",
    message: "Plan a 3-day trip to Jaipur for 2 adults",
    icon: <PlaneIcon />,
  },
  {
    label: "Discover places",
    description: "Find places worth experiencing",
    message: "What are the must-visit places in Jaipur?",
    icon: <CompassIcon />,
  },
  {
    label: "Find hotels",
    description: "Stays with live prices",
    message: "Find well-rated hotels in Jaipur",
    icon: <BedIcon />,
  },
  {
    label: "Check an itinerary",
    description: "Verify before you trust it",
    message: "Tell me about Jaipur tourism",
    icon: <CheckIcon />,
  },
];

export function QuickTiles({
  disabled,
  onSelect,
}: {
  disabled: boolean;
  onSelect: (message: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4" role="list" aria-label="Quick actions">
      {QUICK_TILES.map((tile) => (
        <button
          key={tile.label}
          type="button"
          role="listitem"
          disabled={disabled}
          onClick={() => onSelect(tile.message)}
          className="group rounded-2xl border border-stone-200 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-teal-800 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-800 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
        >
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-teal-900/10 text-teal-900 transition-colors group-hover:bg-teal-900 group-hover:text-white">
            {tile.icon}
          </span>
          <span className="mt-2.5 block text-sm font-bold text-stone-900">{tile.label}</span>
          <span className="mt-0.5 block text-xs leading-snug text-stone-500">
            {tile.description}
          </span>
        </button>
      ))}
    </div>
  );
}

/* ---------- inspiration (interactive discovery) ---------- */

/**
 * Visual destination discovery. Each card is a real accessible link to
 * `/agent?discover=<key>`, which auto-submits the category's prompt
 * through the EXISTING agent → router → SerpApi path. The photograph is
 * only a category trigger; returned results render solely from live
 * result data, never from these images.
 */
export function InspirationGrid({
  title = "Explore inspiration",
  subtitle = "Select a category — GhoomAI discovers real destinations live",
}: {
  title?: string;
  subtitle?: string;
}) {
  return (
    <section aria-label="Explore inspiration">
      <div className="flex flex-wrap items-baseline justify-between gap-1">
        <h3 className="text-lg font-bold tracking-tight text-stone-900">
          {title}
        </h3>
        <p className="text-xs text-stone-500">{subtitle}</p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2.5 md:grid-cols-4">
        {DISCOVERY_CATEGORIES.map((card) => (
          <a
            key={card.key}
            href={`/agent?discover=${card.key}`}
            aria-label={`Explore ${card.category} destinations with GhoomAI`}
            className="group relative block overflow-hidden rounded-2xl shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-800 focus-visible:ring-offset-2"
          >
            <TravelImage
              image={card.image}
              className="aspect-[4/3]"
              imgClassName="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-gradient-to-t from-stone-950/80 via-stone-950/10 to-transparent"
            />
            <div className="absolute inset-x-0 bottom-0 p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-200">
                {card.category}
              </p>
              <p className="mt-0.5 text-sm font-semibold leading-snug text-white">
                {card.title}
              </p>
              <p className="mt-1 text-[11px] font-medium text-stone-200 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                Explore destinations →
              </p>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}

/**
 * Workspace context shown when a discovery deep-link started (or
 * continued) the conversation. Purely informational — results below
 * come from the live agent turn, and Back simply returns to /agent.
 */
export function DiscoveryContextHeader({
  heading,
  prompt,
}: {
  heading: string;
  prompt: string;
}) {
  return (
    <div className="rounded-2xl border border-teal-900/15 bg-teal-50 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal-900">
            {heading}
          </p>
          <p className="mt-0.5 text-[13px] text-stone-600">
            Live destination ideas for your next trip — results below are real,
            researched just now.
          </p>
        </div>
        <a
          href="/agent"
          className="inline-flex min-h-[36px] items-center rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-[13px] font-medium text-stone-700 shadow-sm hover:border-stone-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-800 focus-visible:ring-offset-2"
        >
          ← Back to inspiration
        </a>
      </div>
      <p className="mt-2 truncate text-xs text-stone-400" title={prompt}>
        Asked: “{prompt}”
      </p>
    </div>
  );
}

/* ---------- trust strip (honest capabilities only) ---------- */

const TRUST_ITEMS: Array<{ title: string; body: string }> = [
  { title: "Live data", body: "Searches real travel information" },
  { title: "RealityCheck", body: "Tests your itinerary before you trust it" },
  { title: "Adaptive", body: "Helps adjust when plans change" },
  { title: "User control", body: "You approve important actions" },
];

export function TrustStrip() {
  return (
    <section
      aria-label="Why GhoomAI"
      className="grid grid-cols-2 gap-2.5 rounded-3xl bg-stone-900 p-4 sm:p-5 lg:grid-cols-4"
    >
      {TRUST_ITEMS.map((item) => (
        <div key={item.title} className="rounded-2xl px-3 py-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-200">
            {item.title}
          </p>
          <p className="mt-1 text-[13px] leading-snug text-stone-200">{item.body}</p>
        </div>
      ))}
    </section>
  );
}

/* ---------- compact workspace banner ---------- */

export function WorkspaceBanner({ tripStatus }: { tripStatus: string }) {
  return (
    <div className="relative overflow-hidden rounded-2xl">
      <TravelImage
        image={WORKSPACE_BANNER_IMAGE}
        eager
        className="absolute inset-0"
        imgClassName="h-full w-full object-cover"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-r from-stone-950/80 via-stone-950/55 to-stone-950/30"
      />
      <div className="relative flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3.5 sm:px-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-200">
          GhoomAI · Travel Agent
        </p>
        <span className="inline-flex items-center rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
          Trip status: {tripStatus}
        </span>
        <span className="hidden text-[11px] text-stone-300 md:inline">
          Plan → Check → Approve → Book → Go live
        </span>
      </div>
    </div>
  );
}
