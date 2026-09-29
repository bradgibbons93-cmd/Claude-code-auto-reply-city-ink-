import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Loader2, Store } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useSession } from "@/lib/session";
import { isHex, getTheme, type Look, type Mode } from "@/lib/themes";
import { Card, CardContent } from "@/components/ui/card";
import { ImageDrop } from "@/components/ImageDrop";
import { LookControls, ThemeCards } from "@/components/ThemePicker";

const input =
  "block w-full min-h-[46px] rounded-xl border border-border bg-input px-4 text-sm text-charcoal outline-none transition focus:border-sepia focus:ring-4 focus:ring-sepia/15";

/**
 * Another location. Two steps: the details (which creates the studio and
 * switches to it), then its logo, banner and look. Each studio keeps its own.
 */
export default function NewStudio() {
  const { user, studio, refresh } = useSession();
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  // Step two lives in the address, not in state: creating the studio switches
  // to it, and the workspace redraws for the newly open studio — which wiped
  // a step held in state and dropped you back on an empty form.
  const search = new URLSearchParams(useSearch());
  const brandId = Number(search.get("brand")) || null;
  const created = brandId && studio?.id === brandId ? brandId : null;
  const [form, setForm] = useState({ name: "", location: "", phone: "", address: "", instagram: "" });
  const [look, setLook] = useState<Look>({ theme: studio?.theme ?? "noir", mode: studio?.mode ?? null, accent: studio?.accent ?? null });

  const create = trpc.studios.create.useMutation();
  const setImage = trpc.studios.setImage.useMutation({ onSuccess: () => refresh() });
  const setAppearance = trpc.studios.setAppearance.useMutation();

  const current = created ? studio : null;
  useEffect(() => {
    if (created && studio) setLook({ theme: studio.theme, mode: studio.mode, accent: studio.accent });
  }, [created]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitDetails = async () => {
    try {
      const { id } = await create.mutateAsync({
        name: form.name,
        location: form.location || null,
        phone: form.phone || null,
        address: form.address || null,
        instagram: form.instagram.replace(/^@/, "") || null,
      });
      // Starts in the same look as the studio you came from; change it below.
      await setAppearance.mutateAsync({
        id,
        theme: getTheme(look.theme).id,
        mode: (look.mode as Mode | null) ?? null,
        accent: isHex(look.accent) ? look.accent : null,
      });
      await refresh();
      await utils.invalidate();
      navigate(`/studios/new?brand=${id}`, { replace: true });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const finish = async () => {
    if (!created) return;
    try {
      await setAppearance.mutateAsync({
        id: created,
        theme: getTheme(look.theme).id,
        mode: (look.mode as Mode | null) ?? null,
        accent: isHex(look.accent) ? look.accent : null,
      });
      await refresh();
      toast.success(`${studio?.name ?? "Your studio"} is ready`);
      navigate("/");
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const identity = {
    studioName: current?.name || form.name || "New studio",
    location: current?.location || form.location,
    logoUrl: current?.logoUrl,
    coverUrl: current?.coverUrl,
    userName: user?.name || "You",
    avatarUrl: user?.avatarUrl,
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <button
        type="button"
        onClick={() => history.back()}
        className="inline-flex min-h-[40px] items-center gap-1.5 text-sm text-muted-foreground transition hover:text-charcoal"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div>
        <p className="text-[0.65rem] uppercase tracking-[0.24em] text-sepia">{created ? "Step 2 of 2" : "Step 1 of 2"}</p>
        <h1 className="mt-2 font-display text-3xl text-charcoal">{created ? `Brand ${studio?.name}` : "Add a studio"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {created
            ? "Its own logo, banner and look. Switch between studios any time from the top of the menu."
            : "A second location, a sister studio or a new brand. It gets its own name, branding, look and settings."}
        </p>
      </div>

      {!created ? (
        <Card>
          <CardContent className="grid gap-4 p-6 sm:grid-cols-2">
            <label className="space-y-1.5 sm:col-span-2">
              <span className="text-sm font-medium text-charcoal">Studio name</span>
              <span className="relative block">
                <Store className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  className={`${input} pl-11`}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="City Ink Melbourne"
                  autoFocus
                />
              </span>
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium text-charcoal">Suburb or city</span>
              <input className={input} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Melbourne, VIC" />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium text-charcoal">Phone</span>
              <input className={input} inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium text-charcoal">Street address</span>
              <input className={input} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium text-charcoal">Instagram</span>
              <input className={input} value={form.instagram} onChange={(e) => setForm({ ...form, instagram: e.target.value })} placeholder="@studio" />
            </label>
            <div className="flex justify-end sm:col-span-2">
              <button
                type="button"
                onClick={submitDetails}
                disabled={!form.name.trim() || create.isPending}
                className="inline-flex min-h-[46px] items-center gap-2 rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground shadow-soft transition hover:-translate-y-0.5 disabled:opacity-50"
              >
                {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Create studio
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="grid gap-8 p-6 sm:grid-cols-[auto_1fr]">
              <ImageDrop
                kind="logo"
                label="Logo"
                value={current?.logoUrl}
                onUploaded={(asset) => setImage.mutateAsync({ id: created, which: "logo", assetId: asset.id })}
                onRemove={() => setImage.mutateAsync({ id: created, which: "logo", assetId: null })}
              />
              <ImageDrop
                kind="cover"
                shape="wide"
                label="Banner"
                hint="A wide photo"
                value={current?.coverUrl}
                onUploaded={(asset) => setImage.mutateAsync({ id: created, which: "cover", assetId: asset.id })}
                onRemove={() => setImage.mutateAsync({ id: created, which: "cover", assetId: null })}
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-6 p-6">
              <p className="font-display text-xl text-charcoal">Its look</p>
              <ThemeCards look={look} identity={identity} onChange={setLook} />
              <LookControls look={look} onChange={setLook} />
            </CardContent>
          </Card>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={finish}
              disabled={setAppearance.isPending}
              className="inline-flex min-h-[46px] items-center gap-2 rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground shadow-soft transition hover:-translate-y-0.5 disabled:opacity-50"
            >
              {setAppearance.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Open {studio?.name}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
