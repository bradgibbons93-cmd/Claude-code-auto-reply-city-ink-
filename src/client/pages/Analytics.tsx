import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

export default function Analytics() {
  const { data: dash } = trpc.dashboard.useQuery(undefined, { refetchInterval: 30000 });
  const { data: stats } = trpc.stats.useQuery();

  const series = dash?.series ?? [];
  const max = Math.max(...series.map((point) => point.count), 1);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl tracking-[0.06em] text-charcoal">Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Counted from real messages — no estimates.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Total threads", stats?.conversations],
          ["Total messages", stats?.messages],
          ["Replies sent", stats?.botReplies],
          ["Bookings handed over", dash?.newBookings],
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <CardContent className="pt-6">
              <p className="font-display text-3xl text-charcoal tabular-nums">{value ?? 0}</p>
              <p className="mt-2 text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
                {label}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6">
          <h2 className="font-display text-base tracking-[0.06em] text-charcoal">
            Messages, last 7 days
          </h2>
          {series.length ? (
            <div className="mt-6 flex h-40 items-end gap-2">
              {series.map((point) => (
                <div key={point.day} className="flex flex-1 flex-col items-center gap-2">
                  <div
                    className="w-full rounded-t-lg bg-beige/60 transition-all duration-500"
                    style={{ height: `${Math.max((point.count / max) * 100, 4)}%` }}
                    title={`${point.count} on ${point.day}`}
                  />
                  <span className="text-[0.6rem] text-muted-foreground">
                    {new Date(point.day).toLocaleDateString("en-AU", { weekday: "short" })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 py-6 text-sm text-muted-foreground">
              Nothing to chart yet — this fills in as messages come through.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
