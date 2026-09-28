import { NextRequest, NextResponse } from "next/server";
import { search, type SearchScope } from "@/lib/services/search";

export const dynamic = "force-dynamic";

/**
 * Zentrale Suche ueber Aktien, Krypto und Maerkte. Sucht bei jeder Eingabe live, kein Vorab-Download des ganzen Universums.
 * `scope=stock` beschraenkt auf Aktien (Firmenname und Boersenkuerzel) und fragt keine Kryptoquelle ab.
 */
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").slice(0, 80);
  const scope: SearchScope = request.nextUrl.searchParams.get("scope") === "stock" ? "stock" : "all";
  if (q.trim().length === 0) return NextResponse.json({ hits: [], issues: [] });
  const result = await search(q, 10, scope);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
