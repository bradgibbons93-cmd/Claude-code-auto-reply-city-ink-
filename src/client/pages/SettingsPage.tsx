import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { toast } from "sonner";
import {
  Bot,
  Check,
  KeyRound,
  Loader2,
  LogOut,
  Palette,
  Plus,
  Shield,
  Store,
  Trash2,
  UserRound,
  Building2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useSession, useSignOut } from "@/lib/session";
import { applyLook, getTheme, isHex, type Look, type Mode } from "@/lib/themes";
import { Card, CardContent } from "@/components/ui/card";
import { ImageDrop } from "@/components/ImageDrop";
import { DashboardPreview } from "@/components/DashboardPreview";
import { LookControls, ThemeCards } from "@/components/ThemePicker";
import { StudioMark } from "@/components/StudioSwitcher";
import { ConnectState } from "@/components/ConnectState";
import InboxSettings from "./Settings";

/**
 * Everything onboarding collected, and everything the studio runs on, in one
 * place. Each tab saves to the same records onboarding wrote, so a change
 * here is a change everywhere — header, switcher, greeting, theme.
 */

const TABS = [
  { id: "profile", label: "Profile", icon: UserRound },
  { id: "studio", label: "Studio", icon: Store },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "studios", label: "Studios", icon: Building2 },
  { id: "inbox", label: "Inbox & AI", icon: Bot },
  { id: "account", label: "Account", icon: Shield },
] as const;
type Tab = (typeof TABS)[number]["id"];

const input =
  "block w-full min-h-[46px] rounded-xl border border-border bg-input px-4 text-sm text-charcoal outline-none transition focus:border-sepia focus:ring-4 focus:ring-sepia/15 disabled:opacity-60";

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card className="animate-fade-up">
      <CardContent className="space-y-5 p-6 sm:p-7">
        <div>
          <h2 className="font-display text-xl text-charcoal">{title}</h2>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function SaveButton({ busy, disabled, children = "Save changes" }: { busy?: boolean; disabled?: boolean; children?: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground shadow-soft transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-50"
    >
      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export default function SettingsPage() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const initial = (new URLSearchParams(search).get("tab") as Tab) || "profile";
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.id === initial) ? initial : "profile");
  useEffect(() => {
    const t = new URLSearchParams(search).get("tab") as Tab | null;
    if (t && TABS.some((x) => x.id === t)) setTab(t);
  }, [search]);
  const choose = (t: Tab) => {
    setTab(t);
    navigate(`/settings?tab=${t}`, { replace: true });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-charcoal">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your profile, your studios, and how Runnit runs them.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[210px_1fr]">
        <nav
          aria-label="Settings sections"
          className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0"
        >
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => choose(id)}
              aria-current={tab === id ? "page" : undefined}
              className={cn(
                "flex min-h-[42px] shrink-0 items-center gap-2.5 rounded-full px-4 text-sm transition lg:rounded-xl",
                tab === id
                  ? "bg-beige/40 text-charcoal shadow-soft"
                  : "text-muted-foreground hover:bg-beige/15 hover:text-charcoal"
              )}
            >
              <Icon className={cn("h-4 w-4", tab === id && "text-sepia")} />
              {label}
            </button>
          ))}
        </nav>
        <div key={tab} className="min-w-0 space-y-6">
          {tab === "profile" && <ProfileTab />}
          {tab === "studio" && <StudioTab />}
          {tab === "appearance" && <AppearanceTab />}
          {tab === "studios" && <StudiosTab />}
          {tab === "inbox" && <InboxTab />}
          {tab === "account" && <AccountTab />}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ProfileTab() {
  const { user, refresh } = useSession();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const update = trpc.account.updateProfile.useMutation({
    onSuccess: async () => {
      await refresh();
      toast.success("Profile saved");
    },
    onError: (error) => toast.error(error.message),
  });
  const setAvatar = trpc.account.setAvatar.useMutation({ onSuccess: () => refresh() });
  const dirty = name.trim() !== (user?.name ?? "") || email.trim().toLowerCase() !== (user?.email ?? "");

  return (
    <Section title="Your profile" description="Your photo and name appear in the header and the greeting on your dashboard.">
      <div className="grid gap-8 sm:grid-cols-[auto_1fr]">
        <ImageDrop
          kind="avatar"
          shape="circle"
          label="Photo"
          value={user?.avatarUrl}
          onUploaded={(asset) => setAvatar.mutateAsync({ assetId: asset.id })}
          onRemove={() => setAvatar.mutateAsync({ assetId: null })}
        />
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({ name, email });
          }}
        >
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-charcoal">Name</span>
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-charcoal">Email</span>
            <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            <span className="block text-xs text-muted-foreground">This is what you log in with.</span>
          </label>
          <SaveButton busy={update.isPending} disabled={!dirty || !name.trim()} />
        </form>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */

function StudioTab() {
  const { studio, refresh } = useSession();
  const blank = { name: "", location: "", address: "", phone: "", email: "", instagram: "", website: "", tagline: "" };
  const fromStudio = () =>
    studio
      ? {
          name: studio.name ?? "",
          location: studio.location ?? "",
          address: studio.address ?? "",
          phone: studio.phone ?? "",
          email: studio.email ?? "",
          instagram: studio.instagram ?? "",
          website: studio.website ?? "",
          tagline: studio.tagline ?? "",
        }
      : blank;
  const [form, setForm] = useState(fromStudio);
  useEffect(() => setForm(fromStudio()), [studio?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = trpc.studios.update.useMutation({
    onSuccess: async () => {
      await refresh();
      toast.success("Studio saved");
    },
    onError: (error) => toast.error(error.message),
  });
  const setImage = trpc.studios.setImage.useMutation({ onSuccess: () => refresh(), onError: (e) => toast.error(e.message) });
  if (!studio) return null;
  const owner = studio.role === "owner";
  const field = (key: keyof typeof form, label: string, extra?: { placeholder?: string; type?: string; wide?: boolean; inputMode?: "tel" | "email" | "url" }) => (
    <label className={cn("block space-y-1.5", extra?.wide && "sm:col-span-2")}>
      <span className="text-sm font-medium text-charcoal">{label}</span>
      <input
        className={input}
        value={form[key]}
        disabled={!owner}
        type={extra?.type}
        inputMode={extra?.inputMode}
        placeholder={extra?.placeholder}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </label>
  );

  return (
    <>
      <Section title="Branding" description={`Shown across ${studio.name}'s dashboard: the logo in the menu and switcher, the banner behind your greeting.`}>
        <div className="grid gap-8 sm:grid-cols-[auto_1fr]">
          <ImageDrop
            kind="logo"
            label="Logo"
            value={studio.logoUrl}
            onUploaded={(asset) => setImage.mutateAsync({ id: studio.id, which: "logo", assetId: asset.id })}
            onRemove={() => setImage.mutateAsync({ id: studio.id, which: "logo", assetId: null })}
          />
          <ImageDrop
            kind="cover"
            shape="wide"
            label="Banner"
            hint="A wide photo"
            value={studio.coverUrl}
            onUploaded={(asset) => setImage.mutateAsync({ id: studio.id, which: "cover", assetId: asset.id })}
            onRemove={() => setImage.mutateAsync({ id: studio.id, which: "cover", assetId: null })}
          />
        </div>
      </Section>
      <Section title="Studio details" description="The basics for this location.">
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({
              id: studio.id,
              ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() || null])),
              name: form.name,
              instagram: form.instagram.replace(/^@/, "") || null,
            });
          }}
        >
          {field("name", "Studio name", { wide: true })}
          {field("tagline", "Tagline", { wide: true, placeholder: "Fine line and blackwork, walk-ins Saturdays" })}
          {field("location", "Suburb or city")}
          {field("phone", "Phone", { inputMode: "tel" })}
          {field("address", "Street address", { wide: true })}
          {field("email", "Studio email", { type: "email", inputMode: "email" })}
          {field("instagram", "Instagram", { placeholder: "@studio" })}
          {field("website", "Website", { wide: true, inputMode: "url", placeholder: "https://" })}
          <div className="sm:col-span-2">
            <SaveButton busy={update.isPending} disabled={!owner || !form.name.trim()} />
          </div>
        </form>
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------ */

function AppearanceTab() {
  const { user, studio, refresh } = useSession();
  const [look, setLook] = useState<Look>({ theme: studio?.theme, mode: studio?.mode, accent: studio?.accent });
  useEffect(() => setLook({ theme: studio?.theme, mode: studio?.mode, accent: studio?.accent }), [studio?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = trpc.studios.setAppearance.useMutation({
    onSuccess: async () => {
      await refresh();
      toast.success("Look saved — on every device");
    },
    onError: (error) => toast.error(error.message),
  });
  if (!studio) return null;
  const saved = { theme: studio.theme, mode: studio.mode, accent: studio.accent };
  const dirty =
    getTheme(look.theme).id !== getTheme(saved.theme).id || (look.mode ?? null) !== (saved.mode ?? null) || (look.accent ?? null) !== (saved.accent ?? null);
  const identity = {
    studioName: studio.name,
    location: studio.location,
    logoUrl: studio.logoUrl,
    coverUrl: studio.coverUrl,
    userName: user?.name ?? "",
    avatarUrl: user?.avatarUrl,
  };

  return (
    <Section title="Appearance" description={`${studio.name}'s look. Each studio keeps its own.`}>
      <div className="grid gap-8 xl:grid-cols-[1fr_300px]">
        <ThemeCards look={look} identity={identity} onChange={setLook} />
        <div className="space-y-6">
          <div className="overflow-hidden rounded-2xl border border-border shadow-soft">
            <DashboardPreview look={look} identity={identity} />
          </div>
          <LookControls look={look} onChange={setLook} />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!dirty || save.isPending}
              onClick={() => {
                applyLook(look);
                save.mutate({
                  id: studio.id,
                  theme: getTheme(look.theme).id,
                  mode: (look.mode as Mode | null) ?? null,
                  accent: isHex(look.accent) ? look.accent : null,
                });
              }}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground shadow-soft transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-50"
            >
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Apply this look
            </button>
            {dirty && (
              <button
                type="button"
                onClick={() => setLook(saved)}
                className="min-h-[44px] rounded-full px-4 text-sm text-muted-foreground transition hover:text-charcoal"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */

function StudiosTab() {
  const { studio, studios, refresh } = useSession();
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const [confirming, setConfirming] = useState<number | null>(null);
  const change = trpc.studios.switch.useMutation({
    onSuccess: async () => {
      await refresh();
      await utils.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.studios.remove.useMutation({
    onSuccess: async () => {
      setConfirming(null);
      await refresh();
      await utils.invalidate();
      toast("Studio removed");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Section title="Studios & locations" description="Every studio this login runs. Each has its own name, branding, look and settings.">
      <div className="grid gap-3">
        {studios.map((s) => {
          const current = s.id === studio?.id;
          return (
            <div
              key={s.id}
              className={cn(
                "flex flex-wrap items-center gap-3 rounded-2xl border p-3.5 transition sm:flex-nowrap",
                current ? "border-sepia/50 bg-beige/15" : "border-border"
              )}
            >
              <StudioMark studio={s} size={44} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-charcoal">
                  {s.name}
                  {current && <span className="rounded-full bg-sepia/15 px-2 py-0.5 text-[0.6rem] uppercase tracking-wider text-sepia">Open</span>}
                  {s.connected && <span className="rounded-full bg-success/15 px-2 py-0.5 text-[0.6rem] uppercase tracking-wider text-success">Inbox connected</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {[s.location, getTheme(s.theme).name].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {!current && (
                  <button
                    type="button"
                    onClick={() => change.mutate({ id: s.id })}
                    disabled={change.isPending}
                    className="min-h-[38px] rounded-full border border-border px-3.5 text-xs text-charcoal transition hover:border-sepia/60"
                  >
                    Switch to
                  </button>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    if (!current) await change.mutateAsync({ id: s.id });
                    navigate("/settings?tab=studio");
                  }}
                  className="min-h-[38px] rounded-full border border-border px-3.5 text-xs text-charcoal transition hover:border-sepia/60"
                >
                  Edit
                </button>
                {!s.connected && studios.length > 1 && s.role === "owner" && (
                  confirming === s.id ? (
                    <button
                      type="button"
                      onClick={() => remove.mutate({ id: s.id })}
                      disabled={remove.isPending}
                      className="min-h-[38px] rounded-full bg-destructive px-3.5 text-xs text-white"
                    >
                      {remove.isPending ? "Removing…" : "Tap to confirm"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirming(s.id)}
                      aria-label={`Remove ${s.name}`}
                      className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded-full text-muted-foreground transition hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
      <Link
        href="/studios/new"
        className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-dashed border-sepia/60 px-5 text-sm text-sepia transition hover:bg-sepia/10"
      >
        <Plus className="h-4 w-4" /> Add a studio
      </Link>
    </Section>
  );
}

/* ------------------------------------------------------------------ */

function InboxTab() {
  const { connected } = useSession();
  if (!connected) return <ConnectState what="Inbox & AI" />;
  // The settings the connected studio always had — Meta, the AI, alerts,
  // calendar, review link and what the agent knows — untouched.
  return <InboxSettings />;
}

/* ------------------------------------------------------------------ */

function AccountTab() {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const change = trpc.account.changePassword.useMutation({
    onSuccess: () => {
      setCurrent("");
      setNext("");
      toast.success("Password changed. Other devices have been signed out.");
    },
    onError: (e) => toast.error(e.message),
  });
  const others = trpc.account.logoutOthers.useMutation({
    onSuccess: () => toast.success("Signed out everywhere else"),
    onError: (e) => toast.error(e.message),
  });
  const logout = useSignOut();

  return (
    <>
      <Section title="Password" description="At least 8 characters. Changing it signs you out on every other device.">
        <form
          className="grid max-w-md gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            change.mutate({ current, next });
          }}
        >
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-charcoal">Current password</span>
            <input className={input} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-charcoal">New password</span>
            <input className={input} type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
            {next && next.length < 8 && <span className="block text-xs text-destructive">A little longer — at least 8 characters.</span>}
          </label>
          <div>
            <SaveButton busy={change.isPending} disabled={!current || next.length < 8}>
              <KeyRound className="h-4 w-4" /> Change password
            </SaveButton>
          </div>
        </form>
      </Section>
      <Section title="Sessions" description="Where you're logged in.">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => others.mutate()}
            disabled={others.isPending}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-border px-5 text-sm text-charcoal transition hover:border-sepia/60"
          >
            <Shield className="h-4 w-4" /> Sign out other devices
          </button>
          <button
            type="button"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-destructive/40 px-5 text-sm text-destructive transition hover:bg-destructive/10"
          >
            <LogOut className="h-4 w-4" /> Log out
          </button>
        </div>
      </Section>
    </>
  );
}
