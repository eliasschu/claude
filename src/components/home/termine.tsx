import { upcomingEvents } from "@/config/calendar";
import { Card } from "@/components/ui/primitives";
import { formatDate } from "@/lib/finance/format";

/** Von Hand aus offiziellen Fed-/EZB-Kalendern gepflegt - keine automatische Quelle. */
export function Termine() {
  const events = upcomingEvents().slice(0, 5);
  return (
    <Card className="p-4 sm:p-5">
      <h2 className="mb-3 text-[12px] font-bold uppercase tracking-wide text-faint">Anstehende Termine</h2>
      {events.length === 0 ? (
        <p className="text-[13px] text-muted">Keine bestätigten Termine in der Kalenderliste.</p>
      ) : (
        <ul className="space-y-2.5">
          {events.map((event) => (
            <li key={event.id} className="flex gap-3">
              <span className="num w-[52px] shrink-0 text-[12px] font-semibold text-muted">{formatDate(event.date).slice(0, 5)}</span>
              <span className="min-w-0">
                <a href={event.sourceUrl} className="block text-[13px] font-semibold leading-snug hover:underline">{event.title}</a>
                <span className="block text-[11px] text-faint">{event.institution} · {event.note}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[10px] text-faint">Von Hand aus offiziellen Kalendern übernommen (Fed, EZB), keine automatische Quelle.</p>
    </Card>
  );
}
