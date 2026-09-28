import { SmartSearch } from "@/components/layout/smart-search";
import { EmptyState } from "@/components/ui/primitives";

export default function StockNotFound() {
  return (
    <div className="space-y-5">
      <SmartSearch scope="stock" size="lg" />
      <div className="py-6">
        <EmptyState
          title="Diese Aktie haben wir nicht gefunden"
          hint="Verfügbar sind Aktien, die bei der SEC registriert sind. Suchen Sie oben nach Firmenname oder Börsenkürzel."
        />
      </div>
    </div>
  );
}
