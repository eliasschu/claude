import Link from "next/link";
import { EmptyState } from "@/components/ui/primitives";

export default function MessageNotFound() {
  return (
    <div className="py-8">
      <EmptyState
        title="Diese Meldung gibt es im Archiv nicht"
        hint="Die Adresse ist ungültig oder die Meldung stammt aus einem anderen Archiv."
        action={<Link href="/meldungen" className="mt-1 rounded-[8px] bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-ink">Zum Meldungsarchiv</Link>}
      />
    </div>
  );
}
