import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Bell, BellOff, Loader2, Send, Smartphone } from "lucide-react";
import { toast } from "sonner";
import {
  currentEndpoint,
  deviceLabel,
  isInstalled,
  pushReadiness,
  subscribeThisDevice,
  unsubscribeThisDevice,
} from "@/lib/push";

/**
 * The panel that turns the phone on.
 *
 * The hard part isn't the switch, it's that "on" is a claim and a buzz in the
 * pocket is evidence. So the panel says which device it is talking about,
 * lists the others, and has a Send test button that does the whole round trip
 * — because "Subscribed ✓" next to a phone that never buzzes is the exact
 * shape of every other silent failure in this app.
 */

const EVENTS = [
  {
    key: "onMessage" as const,
    label: "A customer messages",
    hint: "Messenger or Instagram. One buzz per thread, not one per photo.",
  },
  {
    key: "onBooking" as const,
    label: "Someone books",
    hint: "Name, phone and dates all collected. Comes through even in quiet hours.",
  },
  {
    key: "onDraft" as const,
    label: "A reply is waiting for your OK",
    hint: "Off by default — it lands right behind the message that caused it.",
  },
  {
    key: "onProblem" as const,
    label: "Something needs looking at",
    hint: "A token about to expire, or messages being turned away.",
  },
];

export default function PhoneNotifications() {
  const [thisEndpoint, setThisEndpoint] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const key = trpc.push.key.useQuery();
  const status = trpc.push.status.useQuery(undefined, { refetchInterval: 60000 });

  const subscribe = trpc.push.subscribe.useMutation();
  const unsubscribe = trpc.push.unsubscribe.useMutation();
  const saveSettings = trpc.push.saveSettings.useMutation({
    onSuccess: () => {
      toast.success("Saved");
      status.refetch();
    },
    onError: () => toast.error("Couldn't save that."),
  });
  const test = trpc.push.test.useMutation({
    onSuccess: (result) =>
      result.sent
        ? toast.success(
            `Sent to ${result.sent} device${result.sent === 1 ? "" : "s"} — check your phone.`
          )
        : toast.error("No devices are registered yet. Turn it on here first."),
    onError: () => toast.error("Couldn't send the test."),
  });

  useEffect(() => {
    currentEndpoint().then(setThisEndpoint).catch(() => undefined);
  }, [status.data]);

  const readiness = pushReadiness();
  const settings = status.data?.settings;
  const on = !!thisEndpoint;

  async function turnOn() {
    if (!key.data?.publicKey) return;
    setBusy(true);
    try {
      const sub = await subscribeThisDevice(key.data.publicKey);
      await subscribe.mutateAsync({ ...sub, label: deviceLabel() });
      setThisEndpoint(sub.endpoint);
      await status.refetch();
      toast.success("On. Send yourself a test to be sure.");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      const endpoint = (await unsubscribeThisDevice()) ?? thisEndpoint;
      if (endpoint) await unsubscribe.mutateAsync({ endpoint });
      setThisEndpoint(undefined);
      await status.refetch();
      toast.success("Off on this device.");
    } catch {
      toast.error("Couldn't turn it off.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-border" id="notifications">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display text-xl text-charcoal">
          <Smartphone className="h-5 w-5" />
          Notifications on your phone
        </CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          A buzz when a customer messages and when one books, whether or not the dashboard is
          open. Separate from Facebook on purpose — it has to keep working when Facebook doesn't.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        <div
          className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 ${
            on ? "border-success/40 bg-success/10" : "border-border bg-beige/20"
          }`}
        >
          <div className="text-sm">
            <p className={on ? "text-success" : "text-charcoal"}>
              {on ? `On for this ${deviceLabel().toLowerCase()}` : "Off on this device"}
            </p>
            {!readiness.ok && <p className="mt-1 text-muted-foreground">{readiness.reason}</p>}
            {readiness.ok && !on && !isInstalled() && (
              <p className="mt-1 text-muted-foreground">
                Add the dashboard to your home screen first if you're on an iPhone.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {on ? (
              <Button variant="outline" size="sm" onClick={turnOff} disabled={busy}>
                <BellOff className="mr-2 h-3.5 w-3.5" />
                Turn off here
              </Button>
            ) : (
              <Button size="sm" onClick={turnOn} disabled={busy || !readiness.ok || !key.data}>
                {busy ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Bell className="mr-2 h-3.5 w-3.5" />
                )}
                Turn on notifications
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => test.mutate()}
              disabled={test.isPending || !status.data?.count}
            >
              <Send className="mr-2 h-3.5 w-3.5" />
              {test.isPending ? "Sending…" : "Send test"}
            </Button>
          </div>
        </div>

        {!!status.data?.devices.length && (
          <div className="rounded-xl border border-border p-3">
            <p className="text-[0.6rem] uppercase tracking-[0.18em] text-sepia">
              Devices getting notifications
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {status.data.devices.map((device) => (
                <li key={device.id} className="flex items-center justify-between gap-3">
                  <span className="text-charcoal">{device.label || "A device"}</span>
                  <span className="text-xs text-muted-foreground">
                    {device.lastSentAt
                      ? `last sent ${new Date(device.lastSentAt).toLocaleDateString("en-AU")}`
                      : "nothing sent yet"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {settings && (
          <div className="space-y-3">
            {EVENTS.map((event) => (
              <label
                key={event.key}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3"
              >
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={settings[event.key]}
                  onChange={(e) => saveSettings.mutate({ [event.key]: e.target.checked })}
                />
                <span>
                  <span className="text-sm text-charcoal">{event.label}</span>
                  <span className="block text-xs text-muted-foreground">{event.hint}</span>
                </span>
              </label>
            ))}

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="text-sm">Quiet from</label>
                <Input
                  type="time"
                  defaultValue={settings.quietFrom}
                  onBlur={(e) => saveSettings.mutate({ quietFrom: e.target.value })}
                  className="mt-2 border-border"
                />
              </div>
              <div>
                <label className="text-sm">Until</label>
                <Input
                  type="time"
                  defaultValue={settings.quietTo}
                  onBlur={(e) => saveSettings.mutate({ quietTo: e.target.value })}
                  className="mt-2 border-border"
                />
              </div>
              <div>
                <label className="text-sm">One buzz per thread every</label>
                <select
                  value={settings.throttleMinutes}
                  onChange={(e) =>
                    saveSettings.mutate({ throttleMinutes: Number(e.target.value) })
                  }
                  className="mt-2 h-10 w-full rounded-md border border-border px-3 text-sm"
                >
                  <option value={0}>every message</option>
                  <option value={5}>5 minutes</option>
                  <option value={10}>10 minutes</option>
                  <option value={30}>30 minutes</option>
                  <option value={60}>hour</option>
                </select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Bookings and faults come through in quiet hours anyway — those are the ones worth
              waking up for.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
