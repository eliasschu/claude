import { NextResponse } from "next/server";
import { getNews, clusterNews } from "@/lib/services/news";
import { newsToUiMeta } from "@/lib/data/types";

export const dynamic = "force-dynamic";

/**
 * Nachrichten-Endpunkt fuer den fortlaufenden Feed. Liefert immer den
 * aktuellen Stand der angebundenen Pressefeeds; ob eine Meldung neu ist,
 * entscheidet der Client anhand der Meldungs-ID.
 */
export async function GET() {
  const result = await getNews([], 40);
  const data = clusterNews(result.items);
  return NextResponse.json({ data, meta: newsToUiMeta(result) }, { headers: { "Cache-Control": "no-store" } });
}
