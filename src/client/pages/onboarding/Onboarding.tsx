import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Instagram,
  KeyRound,
  Loader2,
  LogOut,
  MapPin,
  Phone,
  Sparkles,
  Store,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { firstName, useSession, useSignOut, type StudioSummary } from "@/lib/session";
import { getTheme, isHex, type Look, type Mode } from "@/lib/themes";
import { LookControls, ThemeCards } from "@/components/ThemePicker";
import { ImageDrop } from "@/components/ImageDrop";
import { DashboardPreview, type PreviewIdentity } from "@/components/DashboardPreview";
import { Field, GoldButton, RunnitLogo, RunnitShell, inputClass } from "@/components/RunnitShell";

/**
 * First-time setup, one screen at a time.
 *
 * Every step saves as you leave it — to the account, the studio, the stored
 * images — so this is never a form held in memory. Close the tab on step four
 * and you come back to step four, with everything you'd already entered.
 * Once finished it never shows again (onboarding_completed_at), and every
 * value here can be changed later in Settings.
 */

const STEPS = ["welcome", "you", "studio", "brand", "look", "preview", "done"] as const;
type Step = (typeof STEPS)[number];
const COUNTED: Step[] = ["you", "studio", "brand", "look", "preview"];

function errorText(error: unknown) {
  return (error as { message?: string })?.message || "That didn't save — try again.";
}

export default function Onboarding() {
  const { me, user, studio, refresh } = useSession();
  const saved = (user?.onboardingStep as Step) ?? "welcome";
  const [step, setStepState] = useState<Step>(STEPS.includes(saved) ? saved : "welcome");
  const [direction, setDirection] = useState<1 | -1>(1);
  const setStep = trpc.onboarding.setStep.useMutation();

  const go = (next: Step) => {
    setDirection(STEPS.indexOf(next) >= STEPS.indexOf(step) ? 1 : -1);
    setStepState(next);
    setStep.mutate({ step: next });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const logout = useSignOut();

  // The look being tried on. Starts from what's saved, so a refresh on the
  // look step shows the choice that was made.
  const [look, setLook] = useState<Look>({ theme: studio?.theme ?? "noir", mode: studio?.mode ?? null, accent: studio?.accent ?? null });
  useEffect(() => {
    if (studio) setLook({ theme: studio.theme, mode: studio.mode, accent: studio.accent });
    // Only when the studio itself changes, not on every refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studio?.id]);

  const identity: PreviewIdentity = {
    studioName: studio?.name || "Your Studio",
    location: studio?.location,
    logoUrl: studio?.logoUrl,
    coverUrl: studio?.coverUrl,
    userName: user?.name || "You",
    avatarUrl: user?.avatarUrl,
  };

  if (!me || !user) return null;

  const counted = COUNTED.indexOf(step);

  return (
    <RunnitShell>
      <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-[#0A0A0C]/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-5 py-3.5">
          <RunnitLogo link={false} />
          <div className="flex-1" />
          {counted >= 0 && (
            <span className="hidden text-xs text-muted-foreground sm:block">
              Step {counted + 1} of {COUNTED.length}
            </span>
          )}
          <button
            type="button"
            onClick={() => logout.mutate()}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-3 text-xs text-muted-foreground transition hover:text-charcoal"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Save & log out</span>
          </button>
        </div>
        {counted >= 0 && (
          <div className="mx-auto flex max-w-5xl gap-1.5 px-5 pb-3">
            {COUNTED.map((s, i) => (
              <span key={s} className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
                <span
                  className="block h-full rounded-full bg-[linear-gradient(90deg,#F6D58E,#D9A94E)] transition-all duration-700 ease-out"
                  style={{ width: i < counted ? "100%" : i === counted ? "50%" : "0%" }}
                />
              </span>
            ))}
          </div>
        )}
      </header>

      <main className="mx-auto max-w-5xl px-5 pb-16 pt-8 sm:pt-12">
        <div key={step} className={direction === 1 ? "animate-step-in" : "animate-step-back"}>
          {step === "welcome" && <Welcome name={user.name} onNext={() => go("you")} />}
          {step === "you" && <You onBack={() => go("welcome")} onNext={() => go("studio")} />}
          {step === "studio" && <StudioStep onBack={() => go("you")} onNext={() => go("brand")} />}
          {step === "brand" && studio && (
            <Brand studio={studio} identity={identity} onBack={() => go("studio")} onNext={() => go("look")} />
          )}
          {step === "look" && studio && (
            <LookStep
              studio={studio}
              identity={identity}
              look={look}
              setLook={setLook}
              onBack={() => go("brand")}
              onNext={() => go("preview")}
            />
          )}
          {step === "preview" && (
            <Preview identity={identity} look={look} onEdit={go} onBack={() => go("look")} onNext={() => go("done")} />
          )}
          {step === "done" && (
            <Done identity={identity} look={look} refresh={refresh} />
          )}
          {/* A studio step that got skipped somehow — send them back to it. */}
          {(step === "brand" || step === "look") && !studio && <MissingStudio onFix={() => go("studio")} />}
        </div>
      </main>
    </RunnitShell>
  );
}

/* ------------------------------------------------------------------ */

function StepHeader({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="max-w-2xl">
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-sepia">{eyebrow}</p>
      <h1 className="mt-3 text-[2rem] font-bold leading-[1.1] tracking-tight text-charcoal sm:text-[2.6rem]">{title}</h1>
      {children && <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{children}</p>}
    </div>
  );
}

function Nav({
  onBack,
  onNext,
  nextLabel = "Continue",
  busy,
  disabled,
  skip,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  busy?: boolean;
  disabled?: boolean;
  skip?: { label: string; onClick: () => void };
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-5 mt-10 flex items-center gap-3 border-t border-white/[0.06] bg-[#0A0A0C]/85 px-5 py-4 backdrop-blur-xl sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:backdrop-blur-none">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-[48px] items-center gap-1.5 rounded-full px-4 text-sm text-muted-foreground transition hover:text-charcoal"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      )}
      <div className="flex-1" />
      {skip && (
        <button
          type="button"
          onClick={skip.onClick}
          className="min-h-[48px] rounded-full px-4 text-sm text-muted-foreground transition hover:text-charcoal"
        >
          {skip.label}
        </button>
      )}
      <GoldButton type="button" onClick={onNext} disabled={busy || disabled}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {nextLabel}
        {!busy && <ArrowRight className="h-4 w-4" />}
      </GoldButton>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Welcome({ name, onNext }: { name: string; onNext: () => void }) {
  return (
    <div className="flex flex-col items-center py-6 text-center sm:py-12">
      <div className="relative">
        <div className="absolute inset-0 -z-10 animate-pulse rounded-full bg-[radial-gradient(closest-side,rgba(217,169,78,0.35),transparent)] blur-2xl" />
        <img src="/brand/runnit-emblem.png" alt="" className="h-28 w-28 animate-emblem-in object-contain sm:h-36 sm:w-36" />
      </div>
      <p className="mt-8 text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-sepia">
        Welcome{firstName(name) ? `, ${firstName(name)}` : ""}
      </p>
      <h1 className="mt-3 max-w-xl text-[2.3rem] font-bold leading-[1.05] tracking-tight text-charcoal sm:text-[3.2rem]">
        Let's get your studio set up.
      </h1>
      <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted-foreground">
        A couple of minutes: who you are, your studio, your logo and the look of your dashboard. You can change all of
        it later.
      </p>
      <ol className="mt-8 grid w-full max-w-md gap-2 text-left">
        {[
          ["You", "Your name and photo"],
          ["Your studio", "Name, location, contact"],
          ["Branding", "Logo and banner"],
          ["Your look", "Pick a theme and colour"],
        ].map(([title, detail], i) => (
          <li key={title} className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-sepia/40 text-xs font-semibold text-sepia">
              {i + 1}
            </span>
            <span className="text-sm">
              <span className="font-medium text-charcoal">{title}</span>
              <span className="text-muted-foreground"> · {detail}</span>
            </span>
          </li>
        ))}
      </ol>
      <GoldButton className="mt-10 w-full max-w-md" onClick={onNext}>
        Let's go <ArrowRight className="h-4 w-4" />
      </GoldButton>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function You({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const { user, refresh } = useSession();
  const [name, setName] = useState(user?.name ?? "");
  const update = trpc.account.updateProfile.useMutation();
  const setAvatar = trpc.account.setAvatar.useMutation({ onSuccess: () => refresh() });

  const next = async () => {
    try {
      if (name.trim() !== user?.name) await update.mutateAsync({ name });
      await refresh();
      onNext();
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  return (
    <div>
      <StepHeader eyebrow="Step 1 · You" title="First, you.">
        This is how you'll appear in your dashboard. Your photo shows in the corner, and your name in the greeting.
      </StepHeader>
      <div className="mt-10 grid max-w-2xl gap-8 sm:grid-cols-[auto_1fr] sm:items-start">
        <ImageDrop
          kind="avatar"
          shape="circle"
          label="Profile photo"
          hint="Optional"
          value={user?.avatarUrl}
          onUploaded={(asset) => setAvatar.mutateAsync({ assetId: asset.id })}
          onRemove={() => setAvatar.mutateAsync({ assetId: null })}
        />
        <div className="space-y-4">
          <Field label="Your name" error={!name.trim() ? "What should we call you?" : null}>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={inputClass} />
          </Field>
          <Field label="Email" hint="Change it later in Settings">
            <input value={user?.email ?? ""} disabled className={`${inputClass} opacity-70`} />
          </Field>
        </div>
      </div>
      <Nav onBack={onBack} onNext={next} busy={update.isPending} disabled={!name.trim()} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function StudioStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const { studio, me, refresh } = useSession();
  const [form, setForm] = useState({
    name: studio?.name ?? "",
    location: studio?.location ?? "",
    address: studio?.address ?? "",
    phone: studio?.phone ?? "",
    instagram: studio?.instagram ?? "",
  });
  // A studio arriving (claimed, or on a refresh) fills the form in.
  useEffect(() => {
    if (studio)
      setForm({
        name: studio.name ?? "",
        location: studio.location ?? "",
        address: studio.address ?? "",
        phone: studio.phone ?? "",
        instagram: studio.instagram ?? "",
      });
  }, [studio?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = trpc.studios.create.useMutation();
  const update = trpc.studios.update.useMutation();
  const claim = trpc.studios.claim.useMutation({
    onSuccess: async (claimed) => {
      toast.success(`${claimed.name} is linked to your account`);
      await refresh();
    },
  });
  const [code, setCode] = useState("");
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const busy = create.isPending || update.isPending;
  const next = async () => {
    try {
      const fields = {
        name: form.name,
        location: form.location || null,
        address: form.address || null,
        phone: form.phone || null,
        instagram: form.instagram.replace(/^@/, "") || null,
      };
      if (studio) await update.mutateAsync({ id: studio.id, ...fields });
      else await create.mutateAsync(fields);
      await refresh();
      onNext();
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  return (
    <div>
      <StepHeader eyebrow="Step 2 · Your studio" title={studio ? "Your studio." : "Tell us about your studio."}>
        {studio?.connected
          ? "This studio already has its inbox connected. Check the details and fill in anything missing."
          : "The basics customers see and the name on your dashboard. Got more than one location? Add the others any time from the studio menu."}
      </StepHeader>

      {me?.claimable && !studio && (
        <div className="mt-8 max-w-2xl rounded-2xl border border-sepia/30 bg-sepia/[0.07] p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-charcoal">
            <KeyRound className="h-4 w-4 text-sepia" /> Already running {me.claimable.name}?
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Link it with your studio code (the password you used for the dashboard) and your inbox, drafts and settings
            come with it.
          </p>
          <form
            className="mt-4 flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              claim.mutate({ code });
            }}
          >
            <input
              type="password"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Studio code"
              autoComplete="off"
              className={`${inputClass} sm:flex-1`}
            />
            <button
              type="submit"
              disabled={!code || claim.isPending}
              className="min-h-[48px] rounded-full border border-sepia/60 px-5 text-sm font-medium text-sepia transition hover:bg-sepia/10 disabled:opacity-50"
            >
              {claim.isPending ? "Linking…" : "Link studio"}
            </button>
          </form>
          {claim.isError && <p className="mt-2 text-xs text-destructive">{errorText(claim.error)}</p>}
        </div>
      )}

      <div className="mt-8 grid max-w-2xl gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Studio name">
            <span className="relative block">
              <Store className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input value={form.name} onChange={set("name")} className={`${inputClass} pl-11`} placeholder="Northside Ink" />
            </span>
          </Field>
        </div>
        <Field label="Suburb or city">
          <span className="relative block">
            <MapPin className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={form.location} onChange={set("location")} className={`${inputClass} pl-11`} placeholder="Geelong, VIC" />
          </span>
        </Field>
        <Field label="Phone" hint="Optional">
          <span className="relative block">
            <Phone className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={form.phone} onChange={set("phone")} inputMode="tel" className={`${inputClass} pl-11`} placeholder="03 5200 0000" />
          </span>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Street address" hint="Optional">
            <input value={form.address} onChange={set("address")} className={inputClass} placeholder="12 Moorabool St" />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Instagram" hint="Optional">
            <span className="relative block">
              <Instagram className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input value={form.instagram} onChange={set("instagram")} className={`${inputClass} pl-11`} placeholder="@yourstudio" />
            </span>
          </Field>
        </div>
      </div>
      <Nav onBack={onBack} onNext={next} busy={busy} disabled={!form.name.trim()} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Brand({
  studio,
  identity,
  onBack,
  onNext,
}: {
  studio: StudioSummary;
  identity: PreviewIdentity;
  onBack: () => void;
  onNext: () => void;
}) {
  const { user, refresh } = useSession();
  const setImage = trpc.studios.setImage.useMutation({ onSuccess: () => refresh() });
  const setAvatar = trpc.account.setAvatar.useMutation({ onSuccess: () => refresh() });
  const done = !!studio.logoUrl || !!studio.coverUrl;

  return (
    <div>
      <StepHeader eyebrow="Step 3 · Branding" title="Make it look like yours.">
        Your logo sits at the top of the dashboard and the banner behind your greeting. Square logos work best; for the
        banner, a wide photo of the studio or your work.
      </StepHeader>
      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_300px]">
        <div className="space-y-8">
          <div className="grid gap-8 sm:grid-cols-2">
            <ImageDrop
              kind="logo"
              label="Studio logo"
              hint="PNG with a transparent background is ideal"
              value={studio.logoUrl}
              onUploaded={(asset) => setImage.mutateAsync({ id: studio.id, which: "logo", assetId: asset.id })}
              onRemove={() => setImage.mutateAsync({ id: studio.id, which: "logo", assetId: null })}
            />
            <ImageDrop
              kind="avatar"
              shape="circle"
              label="Your profile photo"
              hint={user?.avatarUrl ? "Added" : "Optional"}
              value={user?.avatarUrl}
              onUploaded={(asset) => setAvatar.mutateAsync({ assetId: asset.id })}
              onRemove={() => setAvatar.mutateAsync({ assetId: null })}
            />
          </div>
          <ImageDrop
            kind="cover"
            shape="wide"
            label="Banner"
            hint="Wide photo, at least 1500px across"
            value={studio.coverUrl}
            onUploaded={(asset) => setImage.mutateAsync({ id: studio.id, which: "cover", assetId: asset.id })}
            onRemove={() => setImage.mutateAsync({ id: studio.id, which: "cover", assetId: null })}
          />
        </div>
        <div className="hidden lg:block">
          <p className="mb-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">Live preview</p>
          <div className="overflow-hidden rounded-[1.6rem] border border-white/10 shadow-[0_30px_80px_-40px_rgba(217,169,78,0.5)]">
            <DashboardPreview look={{ theme: studio.theme, mode: studio.mode, accent: studio.accent }} identity={identity} />
          </div>
        </div>
      </div>
      <Nav
        onBack={onBack}
        onNext={onNext}
        skip={done ? undefined : { label: "Skip for now", onClick: onNext }}
        nextLabel={done ? "Continue" : "Continue"}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function LookStep({
  studio,
  identity,
  look,
  setLook,
  onBack,
  onNext,
}: {
  studio: StudioSummary;
  identity: PreviewIdentity;
  look: Look;
  setLook: (look: Look) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { refresh } = useSession();
  const save = trpc.studios.setAppearance.useMutation();

  const next = async () => {
    try {
      await save.mutateAsync({
        id: studio.id,
        theme: getTheme(look.theme).id,
        mode: (look.mode as Mode | null) ?? null,
        accent: isHex(look.accent) ? look.accent : null,
      });
      await refresh();
      onNext();
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  return (
    <div>
      <StepHeader eyebrow="Step 4 · Your look" title="Choose your look.">
        Tap a theme to try it on. Every card is your actual dashboard, with your name, logo and banner in it. Fine-tune
        the colour and light or dark underneath.
      </StepHeader>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_320px]">
        <ThemeCards look={look} identity={identity} onChange={setLook} />
        <div className="space-y-6">
          <div className="hidden overflow-hidden rounded-[1.6rem] border border-white/10 shadow-[0_30px_80px_-40px_rgba(217,169,78,0.5)] lg:block">
            <DashboardPreview look={look} identity={identity} />
          </div>
          <LookControls look={look} onChange={setLook} />
        </div>
      </div>

      <Nav onBack={onBack} onNext={next} busy={save.isPending} nextLabel="Use this look" />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Preview({
  identity,
  look,
  onEdit,
  onBack,
  onNext,
}: {
  identity: PreviewIdentity;
  look: Look;
  onEdit: (step: Step) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [view, setView] = useState<"phone" | "desktop">(() =>
    typeof window !== "undefined" && window.innerWidth >= 900 ? "desktop" : "phone"
  );
  return (
    <div>
      <StepHeader eyebrow="Step 5 · Preview" title="Here's your workspace.">
        This is what you'll see every time you log in — on your phone and on a computer. Anything look off? Jump back
        and change it.
      </StepHeader>

      <div className="mt-8 inline-flex rounded-full border border-white/[0.08] p-1">
        {(["phone", "desktop"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={cn(
              "min-h-[38px] rounded-full px-4 text-xs capitalize transition",
              view === v ? "bg-white/10 text-charcoal" : "text-muted-foreground hover:text-charcoal"
            )}
          >
            {v}
          </button>
        ))}
      </div>

      <div className="mt-6 flex justify-center">
        {view === "phone" ? (
          <div className="w-full max-w-[330px] rounded-[2.4rem] border border-white/10 bg-black p-2.5 shadow-[0_40px_120px_-40px_rgba(217,169,78,0.5)]">
            <div className="overflow-hidden rounded-[1.9rem]">
              <DashboardPreview look={look} identity={identity} />
            </div>
          </div>
        ) : (
          <div className="w-full overflow-hidden rounded-2xl border border-white/10 shadow-[0_40px_120px_-40px_rgba(217,169,78,0.5)]">
            <div className="flex items-center gap-1.5 border-b border-white/[0.06] bg-[#111114] px-3 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
            </div>
            <DashboardPreview look={look} identity={identity} variant="desktop" />
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {(
          [
            ["you", "Your name & photo"],
            ["studio", "Studio details"],
            ["brand", "Logo & banner"],
            ["look", "Theme & colour"],
          ] as [Step, string][]
        ).map(([s, label]) => (
          <button
            key={s}
            type="button"
            onClick={() => onEdit(s)}
            className="min-h-[40px] rounded-full border border-white/[0.08] px-4 text-xs text-muted-foreground transition hover:border-sepia/50 hover:text-charcoal"
          >
            Edit {label.toLowerCase()}
          </button>
        ))}
      </div>

      <Nav onBack={onBack} onNext={onNext} nextLabel="Looks good" />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Done({
  identity,
  look,
  refresh,
}: {
  identity: PreviewIdentity;
  look: Look;
  refresh: () => Promise<unknown>;
}) {
  const complete = trpc.onboarding.complete.useMutation();
  const [entering, setEntering] = useState(false);
  const bits = useMemo(() => Array.from({ length: 18 }, (_, i) => i), []);

  const enter = async () => {
    setEntering(true);
    try {
      await complete.mutateAsync();
      // Once the session says setup is finished, App opens the dashboard.
      await refresh();
    } catch (error) {
      setEntering(false);
      toast.error(errorText(error));
    }
  };

  return (
    <div className="relative flex flex-col items-center py-8 text-center sm:py-14">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-10 flex justify-center">
        {bits.map((i) => (
          <span
            key={i}
            className="absolute h-1.5 w-1.5 rounded-full bg-[#E9C27A] opacity-0 animate-spark"
            style={
              {
                "--r": `${(360 / bits.length) * i}deg`,
                animationDelay: `${120 + i * 18}ms`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>
      <div className="relative flex h-24 w-24 animate-emblem-in items-center justify-center rounded-full border border-sepia/50 bg-sepia/10 shadow-[0_0_60px_-10px_rgba(217,169,78,0.7)]">
        <Check className="h-10 w-10 text-sepia" strokeWidth={2.5} />
      </div>
      <p className="mt-8 text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-sepia">All set</p>
      <h1 className="mt-3 text-[2.3rem] font-bold leading-[1.05] tracking-tight text-charcoal sm:text-[3rem]">
        Your workspace is ready.
      </h1>
      <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted-foreground">
        {identity.studioName} is set up. Next time you log in, you'll go straight to your dashboard.
      </p>
      <div className="mt-8 w-full max-w-[300px] rounded-[2.2rem] border border-white/10 bg-black p-2 shadow-[0_40px_120px_-40px_rgba(217,169,78,0.55)]">
        <div className="overflow-hidden rounded-[1.8rem]">
          <DashboardPreview look={look} identity={identity} />
        </div>
      </div>
      <GoldButton className="mt-10 w-full max-w-sm" onClick={enter} disabled={entering}>
        {entering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        Enter your dashboard
        {!entering && <ArrowRight className="h-4 w-4" />}
      </GoldButton>
    </div>
  );
}

function MissingStudio({ onFix }: { onFix: () => void }) {
  return (
    <div className="py-12 text-center">
      <p className="text-muted-foreground">Your studio details didn't save yet.</p>
      <GoldButton className="mt-6" onClick={onFix}>
        Add your studio
      </GoldButton>
    </div>
  );
}
