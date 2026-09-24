import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Portfolio – Finanzwelt-App" };

export default function PortfolioPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-[26px] font-extrabold tracking-[-0.03em]">Portfolio, Benachrichtigungen und Profil</h1>
      <EmptyState
        title="Noch nicht Teil des MVP"
        hint="Portfolio-Analyse, Kursalarme und Nutzerkonten setzen eine Datenbank und eine Anmeldung voraus. Beides ist in der Architektur vorgesehen (DATABASE_URL in .env.example), im MVP aber bewusst nicht umgesetzt. Bis dahin steht die lokale Watchlist zur Verfügung."
      />
    </div>
  );
}
