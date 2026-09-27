"use client";

import { useEffect, useState } from "react";
import { classifyFreshness, formatAge, FRESHNESS_TEXT, type Freshness, type FreshnessClass, type FreshnessInput } from "@/lib/core/freshness";
import { Chip } from "@/components/ui/primitives";

const TONE: Record<FreshnessClass, "neutral" | "pos" | "warn" | "neg"> = {
  live: "pos", under_1_min: "pos", delayed_15_min: "neutral", end_of_day: "neutral", daily: "neutral",
  weekly: "neutral", quarterly: "neutral", annual: "neutral", event: "neutral", stale: "warn", unknown: "warn",
};

/** Klassen, bei denen das Alter die Einstufung selbst bestimmt und laufend neu berechnet wird. */
const AGE_DRIVEN: ReadonlySet<FreshnessClass> = new Set(["live", "under_1_min", "delayed_15_min"]);

/**
 * Aktualitaetsklasse einer Zahl. Startet mit der Einstufung des Servers
 * (gleiche Ausgabe beim Hydrieren) und rechnet danach im Browser nach, weil
 * zwischengespeicherte Seiten sonst ein zu junges Alter behaupten wuerden.
 */
export function FreshnessBadge({ input, initial }: { input: FreshnessInput; initial: Freshness }) {
  const [freshness, setFreshness] = useState(initial);

  useEffect(() => {
    const update = () => setFreshness(classifyFreshness(input));
    update();
    const timer = setInterval(update, 15_000);
    return () => clearInterval(timer);
  }, [input]);

  const text = FRESHNESS_TEXT[freshness.cls];
  const age = AGE_DRIVEN.has(freshness.cls) || freshness.cls === "stale" ? formatAge(freshness.ageMs) : null;
  const title = `${text.label} (${text.term}): ${freshness.reason}`;

  return (
    <Chip tone={TONE[freshness.cls]} title={title}>
      <span>{text.label}</span>
      {age ? <span className="num font-normal opacity-80"> · {age}</span> : null}
      <span className="sr-only">. {freshness.reason}</span>
    </Chip>
  );
}
