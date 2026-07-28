import { CheckCircle2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar } from "@/components/Avatar";

/** Today's appointments, pulled from the same calendar feed as Bookings. */
export default function CheckIns() {
  const { data: bookings } = trpc.calendar.upcoming.useQuery(undefined, {
    refetchInterval: 60000,
  });

  const today = new Date().toDateString();
  const todays = (bookings ?? []).filter(
    (booking) => new Date(booking.start).toDateString() === today
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl tracking-[0.06em] text-charcoal">Check-ins</h1>
        <p className="mt-1 text-sm text-muted-foreground">Who's due in today.</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="divide-y divide-border">
            {todays.length ? (
              todays.map((booking) => (
                <div key={booking.label} className="flex items-center gap-3 py-3">
                  <Avatar name={booking.title} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-charcoal">{booking.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{booking.label}</p>
                  </div>
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                </div>
              ))
            ) : (
              <p className="py-6 text-sm text-muted-foreground">
                Nothing in the calendar for today.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Marking someone as arrived isn't wired up yet — it would need somewhere to store that,
        which doesn't exist. Say the word and I'll add it.
      </p>
    </div>
  );
}
