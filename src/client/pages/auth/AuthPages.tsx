import { useState, type FormEvent } from "react";
import { Link, useSearch } from "wouter";
import { ArrowRight, Eye, EyeOff, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useSession } from "@/lib/session";
import { DashboardPreview } from "@/components/DashboardPreview";
import { Field, GoldButton, RunnitLogo, RunnitShell, inputClass } from "@/components/RunnitShell";

function PasswordInput({
  value,
  onChange,
  autoComplete,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  id?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <span className="relative block">
      <input
        id={id}
        type={shown ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required
        className={`${inputClass} pr-12`}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        className="absolute inset-y-0 right-1 flex w-11 items-center justify-center rounded-xl text-muted-foreground transition hover:text-charcoal"
        aria-label={shown ? "Hide password" : "Show password"}
      >
        {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </span>
  );
}

/** Form on the left; on a wide screen, a taste of the product on the right. */
function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <RunnitShell>
      <div className="mx-auto grid min-h-[100dvh] max-w-6xl lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="flex flex-col px-5 pb-10 pt-6 sm:px-10">
          <RunnitLogo />
          <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10 animate-fade-up">
            <h1 className="text-[2rem] font-bold leading-tight tracking-tight text-charcoal">{title}</h1>
            <p className="mt-2 text-[15px] text-muted-foreground">{subtitle}</p>
            <div className="mt-8">{children}</div>
          </div>
          <p className="text-center text-xs text-muted-foreground">
            <ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-sepia" />
            Nothing sends to a customer without your OK.
          </p>
        </div>

        <div className="relative hidden items-center justify-center p-10 lg:flex">
          <div className="absolute inset-6 rounded-[2rem] border border-white/[0.06] bg-white/[0.02]" />
          <div className="relative w-[330px] rounded-[2.4rem] border border-white/10 bg-black/60 p-2.5 shadow-[0_40px_120px_-40px_rgba(217,169,78,0.45)]">
            <div className="overflow-hidden rounded-[1.9rem]">
              <DashboardPreview
                look={{ theme: "noir", mode: "dark" }}
                identity={{ studioName: "Your Studio", location: "Your city", userName: "You" }}
              />
            </div>
          </div>
        </div>
      </div>
    </RunnitShell>
  );
}

function errorText(error: unknown) {
  const message = (error as { message?: string })?.message;
  if (!message || /fetch|network/i.test(message)) return "Couldn't reach Runnit — check your connection and try again.";
  return message;
}

export function LoginPage() {
  const { me } = useSession();
  const utils = trpc.useUtils();
  const search = new URLSearchParams(useSearch());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [forgot, setForgot] = useState(false);
  // Nothing to navigate here: once the session says who you are, App sends
  // you on (to ?next=, your dashboard, or setup). Navigating from here as
  // well raced that rule and bounced through the wrong page.
  const login = trpc.account.login.useMutation({
    onSuccess: (data) => utils.account.me.setData(undefined, data),
  });

  const expired = search.get("expired") === "1" || me?.expired;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ email, password });
  };

  return (
    <AuthLayout title="Welcome back" subtitle="Log in to your studio's front desk.">
      {expired && !login.isError && (
        <p className="mb-5 rounded-xl border border-sepia/30 bg-sepia/10 px-4 py-3 text-sm text-charcoal">
          You were signed out. Log in again to pick up where you left off.
        </p>
      )}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email">
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className={inputClass}
            placeholder="you@studio.com"
          />
        </Field>
        <Field
          label="Password"
          hint={
            <button type="button" onClick={() => setForgot((f) => !f)} className="text-sepia hover:underline">
              Forgot it?
            </button>
          }
        >
          <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" />
        </Field>
        {forgot && (
          <p className="rounded-xl border border-border bg-surface px-4 py-3 text-xs leading-relaxed text-muted-foreground">
            Password resets aren't emailed out yet.{" "}
            {me?.supportEmail ? (
              <>
                Email{" "}
                <a className="text-sepia underline" href={`mailto:${me.supportEmail}?subject=Runnit%20password%20reset`}>
                  {me.supportEmail}
                </a>{" "}
                from the address on your account and we'll reset it for you.
              </>
            ) : (
              <>Contact whoever set up Runnit for your studio and they'll reset it for you.</>
            )}
          </p>
        )}
        {login.isError && (
          <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {errorText(login.error)}
          </p>
        )}
        <GoldButton type="submit" disabled={login.isPending || !email || !password} className="w-full">
          {login.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {login.isPending ? "Logging in…" : "Log in"}
        </GoldButton>
      </form>

      {(me?.signupsOpen || me?.inviteOnly) && (
        <p className="mt-8 text-center text-sm text-muted-foreground">
          {me.signupsOpen ? "New to Runnit? " : "Setting up for the first time? "}
          <Link href="/signup" className="font-medium text-sepia hover:underline">
            {me.signupsOpen ? "Create your studio" : "Create your account"}
          </Link>
        </p>
      )}
    </AuthLayout>
  );
}

export function SignupPage() {
  const { me } = useSession();
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const signup = trpc.account.signup.useMutation({
    onSuccess: (data) => utils.account.me.setData(undefined, data),
  });

  const inviteOnly = !!me?.inviteOnly && !me?.signupsOpen;
  const closed = !!me && !me.signupsOpen && !me.inviteOnly;
  const short = password.length > 0 && password.length < 8;
  const duplicate = signup.error?.data?.code === "CONFLICT";

  if (closed) {
    return (
      <AuthLayout title="Accounts are invite-only" subtitle="This Runnit workspace isn't taking new sign-ups.">
        <p className="text-sm text-muted-foreground">
          If you already have an account,{" "}
          <Link href="/login" className="text-sepia underline">
            log in here
          </Link>
          .
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={inviteOnly ? "Create your account" : "Create your studio"}
      subtitle={
        inviteOnly
          ? `Your login for ${me?.claimable?.name ?? "the studio"}. Takes a minute.`
          : "Two minutes to set up. Your inbox, your voice, your look."
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          signup.mutate({ name, email, password, code: inviteOnly ? code : undefined });
        }}
        className="space-y-4"
        noValidate
      >
        <Field label="Your name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            required
            className={inputClass}
            placeholder="Brad Gibbons"
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className={inputClass}
            placeholder="you@studio.com"
          />
        </Field>
        <Field label="Password" hint="8 characters or more" error={short ? "A little longer — at least 8 characters." : null}>
          <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" />
        </Field>
        {inviteOnly && (
          <Field
            label="Studio code"
            hint={
              <span className="inline-flex items-center gap-1">
                <KeyRound className="h-3 w-3" /> The password you used for the dashboard
              </span>
            }
          >
            <PasswordInput value={code} onChange={setCode} autoComplete="off" />
          </Field>
        )}
        {signup.isError && (
          <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {errorText(signup.error)}{" "}
            {duplicate && (
              <Link href="/login" className="font-medium underline">
                Log in
              </Link>
            )}
          </p>
        )}
        <GoldButton
          type="submit"
          disabled={signup.isPending || !name.trim() || !email || password.length < 8 || (inviteOnly && !code)}
          className="w-full"
        >
          {signup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {signup.isPending ? "Creating your account…" : "Create account"}
          {!signup.isPending && <ArrowRight className="h-4 w-4" />}
        </GoldButton>
      </form>
      <p className="mt-8 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-sepia hover:underline">
          Log in
        </Link>
      </p>
    </AuthLayout>
  );
}
