import { NextRequest, NextResponse } from "next/server";
import { search } from "@/lib/services/search";

export const dynamic = "force-dynamic";

/** Zentrale Suche ueber Aktien, Krypto und Maerkte. Sucht bei jeder Eingabe live, kein Vorab-Download des ganzen Universums. */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  if (q.trim().length === 0) return NextResponse.json({ hits: [], issues: [] });
  const result = await search(q, 10);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
