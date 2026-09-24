import Link from "next/link";
import { EmptyState } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <div className="py-10">
      <EmptyState
        title="Dieses Wertpapier oder diese Seite gibt es nicht"
        hint="Der DEMO-Datensatz enthält eine begrenzte Auswahl an Aktien. Nutzen Sie die Suche oben."
        action={<Link href="/" className="mt-1 rounded-[8px] bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-ink">Zur Startseite</Link>}
      />
    </div>
  );
}
