import { Link } from "wouter";
import { CalendarCheck, CalendarPlus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/Avatar";

export default function Bookings() {
  const { data: bookings, isLoading } = trpc.calendar.upcoming.useQuery(undefined, {
    refetchInterval: 60000,
  });
  const { data: freeSlots } = trpc.calendar.freeSlots.useQuery(undefined, {
    refetchInterval: 60000,
  });
  const { data: timely } = trpc.config.timely.useQuery();

  if (!timely?.calendarIcsUrl) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <CalendarPlus className="mx-auto mb-3 h-6 w-6 text-beige" />
          <p className="text-charcoal">No calendar connected yet.</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Bookings here are read straight from the Google Calendar that Timely syncs into. Add
            its private iCal address and this fills itself in.
          </p>
          <Link href="/settings">
            <Button className="mt-5">Add the calendar link</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl tracking-[0.06em] text-charcoal">Bookings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Read from your calendar. Bookings are still made in Timely — this is the view, not a
          second place to keep them.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <h2 className="font-display text-base tracking-[0.06em] text-charcoal">
            Next 30 days
          </h2>
          <div className="mt-4 divide-y divide-border">
            {isLoading ? (
              <p className="py-6 text-sm text-muted-foreground">Reading the calendar…</p>
            ) : bookings?.length ? (
              bookings.map((booking) => (
                <div key={booking.label + booking.title} className="flex items-center gap-3 py-3">
                  <Avatar name={booking.title} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-charcoal">{booking.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{booking.label}</p>
                  </div>
                  <CalendarCheck className="h-4 w-4 shrink-0 text-sepia" />
                </div>
              ))
            ) : (
              <p className="py-6 text-sm text-muted-foreground">
                Nothing booked in the next 30 days — or the calendar feed couldn't be read. Check
                the Railway logs for a calendar error if that looks wrong.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <h2 className="font-display text-base tracking-[0.06em] text-charcoal">
            Next free slots
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            These are exactly what the agent offers customers — nothing else.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {freeSlots?.length ? (
              freeSlots.map((slot) => (
                <span
                  key={slot.label}
                  className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-charcoal"
                >
                  {slot.label}
                </span>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No free slots found in the next fortnight.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
