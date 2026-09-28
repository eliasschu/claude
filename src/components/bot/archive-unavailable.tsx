import type { BotFailure } from "@/lib/bot/client";
import { EmptyState } from "@/components/ui/primitives";

/** Das Archiv liegt beim lokalen Bot. Ohne Verbindung gibt es keine Archivdaten - und keinen Ersatz. */
export function ArchiveUnavailable({ reason, message }: { reason: BotFailure; message: string }) {
  const hint =
    reason === "not_configured"
      ? "Diese Website ist mit keinem Bot verbunden. Das Meldungsarchiv liegt beim lokal laufenden Bot (./bot-lokal.sh start) und ist nur über die lokal gestartete Website erreichbar."
      : reason === "unreachable"
        ? "Der Bot antwortet nicht. Vermutlich ist der Rechner ausgeschaltet oder im Ruhezustand, oder Docker ist gestoppt."
        : `Der Bot meldet einen Fehler: ${message}.`;
  return <EmptyState title="Meldungsarchiv nicht erreichbar" hint={hint} />;
}
