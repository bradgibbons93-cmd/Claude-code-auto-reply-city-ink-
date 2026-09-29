import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  Camera,
  Check,
  CheckCheck,
  HandHeart,
  Link2,
  MessageCircle,
  Moon,
  PenLine,
  ReceiptText,
  Send,
  ShieldCheck,
  Sparkles,
  CalendarX,
  Layers,
  Palette,
} from "lucide-react";
import { LandingStyles, Reveal, useLandingChrome } from "@/components/landing/motion";
import {
  Container,
  Emblem,
  Eyebrow,
  FacebookBadge,
  GhostLink,
  GoldLink,
  IgBadge,
  SectionHeading,
  StencilRing,
  Wordmark,
} from "@/components/landing/primitives";
import { LandingNav, NAV_LINKS } from "@/components/landing/Nav";
import { HeroPreview } from "@/components/landing/HeroPreview";
import { FeatureBento } from "@/components/landing/FeatureBento";
import { StudioSwitcherDemo } from "@/components/landing/MultiStudio";

type Icon = LucideIcon;

/**
 * Runnit's public landing page.
 *
 * Paints its own ground and never reads the dashboard's theme variables, so it
 * looks the same whichever theme the app last used. Every customer on it is
 * invented and labelled as demo data; there are no testimonials, logos,
 * statistics or prices for Runnit itself, because none of those exist yet.
 */
export default function Landing() {
  useLandingChrome();

  return (
    <div className="rn-root font-runnit relative isolate min-h-screen overflow-x-hidden bg-[#07070A] text-[#F4F1EA]">
      <LandingStyles />
      <a
        href="#main"
        className="sr-only z-[60] rounded-full bg-[#F4F1EA] px-4 py-2 text-[14px] font-semibold text-[#07070A] focus:not-sr-only focus:fixed focus:left-4 focus:top-3"
      >
        Skip to content
      </a>
      <LandingNav />

      <main id="main">
        <Hero />
        <BuiltFor />
        <Features />
        <HowItWorks />
        <MultiStudio />
        <Control />
        <FinalCta />
      </main>

      <Footer />
    </div>
  );
}

/* ---------------------------------------------------------------- hero -- */

function Hero() {
  return (
    <section id="top" aria-labelledby="rn-hero-title" className="relative scroll-mt-24 pb-20 pt-28 sm:pb-28 sm:pt-36 lg:pb-32 lg:pt-40">
      {/* Backdrop: a warm light from above over a faint drafting grid. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="rn-grid-bg absolute inset-0" />
        <div className="absolute left-1/2 top-[-280px] h-[620px] w-[1100px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(217,169,78,0.16),rgba(217,169,78,0.04)_60%,transparent)]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-[#07070A]" />
      </div>

      <Container className="grid items-center gap-16 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-8">
        <div className="text-center lg:text-left">
          <Reveal>
            <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] py-1.5 pl-1.5 pr-3.5 text-[12.5px] font-medium text-[#D8D2C9]">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-[#0B0B0F] ring-1 ring-inset ring-[#D9A94E]/30">
                <Emblem className="h-[15px] w-[16px]" />
              </span>
              The AI front desk for tattoo studios
            </p>
          </Reveal>

          <Reveal delay={90}>
            <h1
              id="rn-hero-title"
              className="mx-auto mt-6 max-w-[15ch] text-balance text-[38px] font-semibold leading-[1.02] tracking-[-0.045em] text-[#F4F1EA] min-[380px]:text-[42px] min-[420px]:text-[46px] sm:mt-7 sm:text-[62px] lg:mx-0 lg:max-w-none lg:text-[56px] xl:text-[66px]"
            >
              <span className="block">Every DM answered.</span>{" "}
              <span className="rn-gold-text block">Without putting the machine down.</span>
            </h1>
          </Reveal>

          <Reveal delay={180}>
            <p className="mx-auto mt-6 max-w-[34rem] text-pretty text-[17px] leading-relaxed text-[#A6A09A] sm:text-[19px] lg:mx-0">
              Runnit drafts a reply to every Instagram and Messenger enquiry in your voice, with a quote from your price
              list and times from your calendar, then waits for your OK.
            </p>
          </Reveal>

          <Reveal delay={270}>
            <div className="mt-9 flex flex-col items-stretch justify-center gap-3 min-[420px]:flex-row min-[420px]:items-center lg:justify-start">
              <GoldLink href="/signup" size="lg">
                Create your studio
                <ArrowRight className="h-[18px] w-[18px]" strokeWidth={2.2} />
              </GoldLink>
              <GhostLink href="/login" size="lg">
                Log in
              </GhostLink>
            </div>
          </Reveal>

          <Reveal delay={360}>
            <ul className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13.5px] text-[#A6A09A] lg:justify-start">
              <li className="inline-flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-[#D9A94E]" strokeWidth={2} />
                Nothing sends without your OK
              </li>
              <li className="inline-flex items-center gap-2">
                <span className="flex -space-x-1">
                  <IgBadge className="h-4 w-4" />
                  <FacebookBadge className="h-4 w-4" />
                </span>
                Instagram and Facebook
              </li>
            </ul>
          </Reveal>
        </div>

        <Reveal delay={200}>
          <HeroPreview />
        </Reveal>
      </Container>
    </section>
  );
}

/* ----------------------------------------------------------- built for -- */

const PAINS: Array<{ icon: Icon; title: string; body: string }> = [
  {
    icon: Moon,
    title: "DMs at midnight",
    body: "Enquiries land while you’re tattooing, driving or asleep. Each one has a draft waiting when you look.",
  },
  {
    icon: Camera,
    title: "“How much for this?”",
    body: "A screenshot and a question. Runnit reads the size and placement and quotes from your prices.",
  },
  {
    icon: CalendarX,
    title: "Cold leads and no-shows",
    body: "Quiet quotes get a follow-up. Bookings get a deposit request, the way your policy says.",
  },
];

function BuiltFor() {
  return (
    <section aria-labelledby="rn-built-title" className="relative">
      <div aria-hidden className="rn-hairline h-px w-full" />
      <Container className="py-16 sm:py-20">
        <Reveal className="mx-auto max-w-3xl text-center">
          <Eyebrow>Built for tattoo studios</Eyebrow>
          <h2
            id="rn-built-title"
            className="mt-4 text-balance text-[26px] font-semibold leading-[1.15] tracking-[-0.03em] text-[#F4F1EA] sm:text-[34px]"
          >
            Made behind the counter of a working studio.{" "}
            <span className="text-[#8C867F]">Not in a call centre.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-[15.5px] leading-relaxed text-[#A6A09A] sm:text-[17px]">
            Runnit started as the private front desk of a busy tattoo studio in Geelong, Australia. Now it’s ready
            for yours.
          </p>
        </Reveal>

        <ul className="mt-12 grid gap-4 sm:mt-14 md:grid-cols-3 md:gap-0">
          {PAINS.map((p, i) => (
            <li key={p.title} className="md:px-8 md:first:pl-0 md:last:pr-0 md:[&:not(:first-child)]:border-l md:[&:not(:first-child)]:border-white/[0.08]">
              <Reveal delay={i * 90} className="flex gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 md:block md:border-0 md:bg-transparent md:p-0">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#D9A94E]/30 text-[#F6D58E]">
                  <p.icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
                </span>
                <div className="md:mt-5">
                  <h3 className="text-[17px] font-semibold tracking-[-0.015em] text-[#F4F1EA]">{p.title}</h3>
                  <p className="mt-1.5 text-[14.5px] leading-relaxed text-[#A6A09A]">{p.body}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ul>
      </Container>
      <div aria-hidden className="rn-hairline h-px w-full" />
    </section>
  );
}

/* ------------------------------------------------------------ features -- */

function Features() {
  return (
    <section id="features" aria-labelledby="rn-features-title" className="relative scroll-mt-24 py-20 sm:py-28 lg:py-32">
      <Container>
        <Reveal>
          <SectionHeading
            id="rn-features-title"
            eyebrow="Features"
            title={
              <>
                A front desk that <span className="rn-gold-text">knows tattoos.</span>
              </>
            }
            lead="Built around how enquiries actually arrive: a photo, a placement and “how much?”. Every reply is a draft until you approve it."
          />
        </Reveal>
        <div className="mt-12 sm:mt-16">
          <FeatureBento />
        </div>
      </Container>
    </section>
  );
}

/* -------------------------------------------------------- how it works -- */

const STEPS: Array<{ icon: Icon; title: string; body: string; visual: ReactNode }> = [
  {
    icon: Link2,
    title: "Connect Instagram and Facebook",
    body: "Link your studio’s accounts. DMs from both land in one inbox, in the order Meta shows them.",
    visual: (
      <div className="flex items-center gap-2.5">
        <span className="flex -space-x-1.5">
          <IgBadge className="h-8 w-8" />
          <FacebookBadge className="h-8 w-8" />
        </span>
        <span aria-hidden className="h-px flex-1 bg-[linear-gradient(90deg,rgba(255,255,255,0.15),rgba(217,169,78,0.6))]" />
        <span className="grid h-9 w-9 place-items-center rounded-full bg-[#0B0B0F] ring-1 ring-inset ring-[#D9A94E]/40">
          <Emblem className="h-[22px] w-[23px]" />
        </span>
      </div>
    ),
  },
  {
    icon: ReceiptText,
    title: "Tell it your prices and policies",
    body: "Your price list, deposit rules and how you like to work. It quotes and books from what you tell it, never a guess.",
    visual: (
      <ul className="space-y-1.5 text-[12.5px]">
        {[
          ["Fine line · medium", "$350–$450"],
          ["Deposit to book", "$100"],
        ].map(([k, v]) => (
          <li key={k} className="flex items-center justify-between rounded-lg bg-white/[0.035] px-3 py-2 ring-1 ring-inset ring-white/[0.06]">
            <span className="text-[#A6A09A]">{k}</span>
            <span className="font-semibold text-[#F4F1EA]">{v}</span>
          </li>
        ))}
      </ul>
    ),
  },
  {
    icon: CheckCheck,
    title: "Approve replies in a tap",
    body: "Read the draft, tweak it or pick another take, then send. Every edit teaches it more of your voice.",
    visual: (
      <div className="flex items-center gap-2">
        <span className="grid h-10 place-items-center rounded-full px-4 text-[13px] font-medium text-[#D8D2C9] ring-1 ring-inset ring-white/15">
          Edit
        </span>
        <span className="rn-gold-fill flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full text-[13px] font-semibold text-[#1A1206] shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
          <Check className="h-4 w-4" strokeWidth={2.6} /> Approve &amp; send
        </span>
      </div>
    ),
  },
];

function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="rn-how-title" className="relative scroll-mt-24 py-20 sm:py-28 lg:py-32">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(255,255,255,0.025),transparent)]" />
      <Container>
        <Reveal>
          <SectionHeading
            id="rn-how-title"
            eyebrow="How it works"
            align="center"
            title="Set it up once. Then just approve."
            lead="No new habits. Your customers keep messaging you exactly where they already do."
          />
        </Reveal>

        <div className="relative mt-12 sm:mt-16">
          <div aria-hidden className="rn-gold-line pointer-events-none absolute left-[16%] right-[16%] top-[27px] hidden h-px opacity-70 lg:block" />
          <ol className="relative grid gap-4 lg:grid-cols-3 lg:gap-5">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative">
                {/* On a phone the steps hang off one gold thread, top to bottom. */}
                {i < STEPS.length - 1 ? (
                  <span
                    aria-hidden
                    className="absolute bottom-[-16px] left-[19.5px] top-10 w-px bg-gradient-to-b from-[#D9A94E]/55 to-[#D9A94E]/10 lg:hidden"
                  />
                ) : null}
                <Reveal delay={i * 110} className="h-full">
                  <div className="grid h-full grid-cols-[40px_minmax(0,1fr)] gap-3 sm:gap-4 lg:flex lg:flex-col lg:gap-0">
                    <div className="lg:flex lg:justify-center">
                      <span className="relative z-10 grid h-10 w-10 place-items-center rounded-full border border-[#D9A94E]/45 bg-[#0A0A0D] shadow-[0_0_0_5px_#07070A] lg:h-14 lg:w-14 lg:shadow-[0_0_0_6px_#07070A]">
                        <span className="rn-gold-text text-[15px] font-semibold tabular-nums lg:text-[18px]">{i + 1}</span>
                      </span>
                    </div>
                    <div className="rn-card rn-lift flex flex-1 flex-col rounded-[24px] p-5 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,230px)] sm:items-center sm:gap-8 sm:p-6 lg:mt-6 lg:flex lg:gap-0">
                      <div>
                        <p className="sr-only">Step {i + 1}</p>
                        <s.icon className="h-5 w-5 text-[#D9A94E]" strokeWidth={1.8} />
                        <h3 className="mt-3.5 text-[18px] font-semibold leading-snug tracking-[-0.02em] text-[#F4F1EA] sm:mt-4 sm:text-[19px]">
                          {s.title}
                        </h3>
                        <p className="mt-2 text-[15px] leading-relaxed text-[#A6A09A]">{s.body}</p>
                      </div>
                      <div aria-hidden className="mt-5 flex flex-1 flex-col justify-end sm:mt-0 lg:mt-6">
                        {s.visual}
                      </div>
                    </div>
                  </div>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </Container>
    </section>
  );
}

/* -------------------------------------------------------- multi-studio -- */

const MULTI: Array<{ icon: Icon; title: string; body: string }> = [
  { icon: Layers, title: "One login", body: "Every studio and location under one account." },
  { icon: Palette, title: "Its own look", body: "Each studio keeps its name, logo, colours and theme." },
  { icon: PenLine, title: "Its own settings", body: "Prices, policies and voice stay separate per studio." },
];

function MultiStudio() {
  return (
    <section id="studios" aria-labelledby="rn-multi-title" className="relative scroll-mt-24 py-20 sm:py-28 lg:py-32">
      <Container className="grid items-center gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
        <Reveal>
          <SectionHeading
            id="rn-multi-title"
            eyebrow="Studios"
            title="One login. Every studio you run."
            lead="A second location, a sister shop or a new brand. Switch between them from the top of the screen."
          />
          <ul className="mt-8 grid gap-4 md:grid-cols-3 md:gap-6 lg:grid-cols-1 lg:gap-4">
            {MULTI.map((m) => (
              <li key={m.title} className="flex gap-4 md:flex-col md:gap-3 lg:flex-row lg:gap-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[0.04] text-[#F6D58E] ring-1 ring-inset ring-white/[0.08]">
                  <m.icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
                </span>
                <div>
                  <p className="text-[16px] font-semibold text-[#F4F1EA]">{m.title}</p>
                  <p className="mt-0.5 text-[14.5px] leading-relaxed text-[#A6A09A]">{m.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={120}>
          <StudioSwitcherDemo />
        </Reveal>
      </Container>
    </section>
  );
}

/* ------------------------------------------------------------- control -- */

const FLOW: Array<{ icon: Icon; label: string; you?: boolean }> = [
  { icon: MessageCircle, label: "DM lands" },
  { icon: Sparkles, label: "Runnit drafts" },
  { icon: Check, label: "You approve", you: true },
  { icon: Send, label: "It sends" },
];

const PROMISES: Array<{ icon: Icon; title: string; body: string }> = [
  {
    icon: ShieldCheck,
    title: "Nothing auto-sends",
    body: "Replies, follow-ups and aftercare all wait as drafts until you tap Approve & send.",
  },
  {
    icon: ReceiptText,
    title: "Your prices only",
    body: "Quotes come from your price list. It doesn’t invent numbers.",
  },
  {
    icon: HandHeart,
    title: "People for the personal stuff",
    body: "Health and personal messages are flagged for you instead of answered.",
  },
  {
    icon: PenLine,
    title: "Learns from your edits",
    body: "Change a word and the next draft sounds more like you.",
  },
];

function Control() {
  return (
    <section aria-labelledby="rn-control-title" className="relative py-20 sm:py-28 lg:py-32">
      <div aria-hidden className="rn-hairline absolute inset-x-0 top-0 h-px" />
      <Container>
        <Reveal>
          <SectionHeading
            id="rn-control-title"
            eyebrow="You’re in control"
            align="center"
            title={
              <>
                You approve <span className="rn-gold-text">every word.</span>
              </>
            }
            lead="Runnit writes the draft. You make the call. Nothing reaches a customer until someone at your studio says so."
          />
        </Reveal>

        <Reveal delay={120}>
          <div className="relative mx-auto mt-14 max-w-3xl">
            <div aria-hidden className="absolute left-[12.5%] right-[12.5%] top-[31px] h-px bg-[linear-gradient(90deg,rgba(255,255,255,0.12),rgba(217,169,78,0.7)_50%,rgba(255,255,255,0.12))] sm:top-[39px]" />
            <ol className="relative grid grid-cols-4">
              {FLOW.map((f) => (
                <li key={f.label} className="flex flex-col items-center text-center">
                  <span
                    className={
                      f.you
                        ? "rn-glow grid h-16 w-16 place-items-center rounded-full border border-[#D9A94E]/70 bg-[#120F0A] text-[#F6D58E] shadow-[0_0_40px_-8px_rgba(217,169,78,0.6),0_0_0_6px_#07070A] sm:h-20 sm:w-20"
                        : "grid h-16 w-16 place-items-center rounded-full border border-white/10 bg-[#0C0C10] text-[#A6A09A] shadow-[0_0_0_6px_#07070A] sm:h-20 sm:w-20"
                    }
                  >
                    <f.icon className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={f.you ? 2.4 : 1.8} />
                  </span>
                  <span
                    className={
                      f.you
                        ? "mt-3 text-[12.5px] font-semibold text-[#F6D58E] sm:text-[14px]"
                        : "mt-3 text-[12.5px] font-medium text-[#A6A09A] sm:text-[14px]"
                    }
                  >
                    {f.label}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </Reveal>

        <ul className="rn-card-xs mt-12 divide-y divide-white/[0.06] rounded-[24px] px-5 sm:mt-14 sm:grid sm:grid-cols-2 sm:gap-4 sm:divide-y-0 sm:px-0 lg:mt-16 lg:grid-cols-4">
          {PROMISES.map((p, i) => (
            <li key={p.title}>
              <Reveal delay={i * 80} className="h-full">
                <div className="rn-card-sm flex h-full gap-4 py-5 sm:block sm:rounded-[22px] sm:p-6 sm:transition-transform sm:duration-500 sm:hover:-translate-y-1">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#D9A94E]/10 text-[#F6D58E] ring-1 ring-inset ring-[#D9A94E]/25 sm:h-auto sm:w-auto sm:place-items-start sm:bg-transparent sm:text-[#D9A94E] sm:ring-0">
                    <p.icon className="h-[18px] w-[18px] sm:h-5 sm:w-5" strokeWidth={1.8} />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-[16.5px] font-semibold tracking-[-0.015em] text-[#F4F1EA] sm:mt-4">{p.title}</h3>
                    <p className="mt-1 text-[14.5px] leading-relaxed text-[#A6A09A] sm:mt-1.5">{p.body}</p>
                  </div>
                </div>
              </Reveal>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

/* ----------------------------------------------------------- final cta -- */

function FinalCta() {
  return (
    <section aria-labelledby="rn-cta-title" className="relative pb-20 pt-4 sm:pb-28">
      <Container>
        <Reveal>
          <div className="relative isolate overflow-hidden rounded-[32px] border border-[#D9A94E]/20 bg-[#0B0A08] px-5 py-16 text-center sm:px-10 sm:py-20 lg:py-24">
            <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
              <div className="absolute left-1/2 top-0 h-[480px] w-[900px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-[radial-gradient(closest-side,rgba(217,169,78,0.22),rgba(217,169,78,0.05)_60%,transparent)]" />
              <StencilRing className="rn-spin-slow absolute left-1/2 top-1/2 h-[720px] w-[720px] -translate-x-1/2 -translate-y-1/2 opacity-30" />
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#F6D58E]/50 to-transparent" />
            </div>

            <Emblem sheen className="mx-auto h-[74px] w-[79px] sm:h-[88px] sm:w-[94px]" />
            <h2
              id="rn-cta-title"
              className="mx-auto mt-7 max-w-[14ch] text-balance text-[34px] font-semibold leading-[1.05] tracking-[-0.04em] text-[#F4F1EA] sm:max-w-none sm:text-[50px] lg:text-[60px]"
            >
              <span className="sm:block">Hand over the front desk.</span>{" "}
              <span className="rn-gold-text sm:block">Keep the final say.</span>
            </h2>
            <p className="mx-auto mt-5 max-w-md text-pretty text-[16px] leading-relaxed text-[#A6A09A] sm:text-[18px]">
              Set up your studio, connect your inbox and let the drafts start stacking up for you.
            </p>
            <div className="mt-9 flex flex-col items-stretch justify-center gap-3 min-[420px]:flex-row min-[420px]:items-center">
              <GoldLink href="/signup" size="lg">
                Create your studio
                <ArrowRight className="h-[18px] w-[18px]" strokeWidth={2.2} />
              </GoldLink>
              <GhostLink href="/login" size="lg">
                Log in
              </GhostLink>
            </div>
            <p className="mt-6 inline-flex items-center gap-2 text-[13px] text-[#8C867F]">
              <ShieldCheck className="h-4 w-4 text-[#D9A94E]" strokeWidth={2} />
              Nothing sends without your OK.
            </p>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}

/* -------------------------------------------------------------- footer -- */

function Footer() {
  const linkClass =
    "inline-flex h-11 items-center rounded-md text-[14.5px] text-[#A6A09A] transition-colors hover:text-[#F4F1EA]";
  return (
    <footer className="border-t border-white/[0.07]">
      <Container className="grid gap-10 py-12 sm:py-14 md:grid-cols-[minmax(0,1fr)_auto] md:gap-16">
        <div>
          <a href="#top" className="inline-flex min-h-[44px] items-center gap-2.5 rounded-lg">
            <Emblem className="h-[26px] w-[28px]" />
            <Wordmark className="h-[15px]" />
          </a>
          <p className="mt-3 max-w-[19rem] text-[14px] leading-relaxed text-[#8C867F]">
            The AI front desk for tattoo studios. Every reply drafted, nothing sent without your OK.
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:gap-16">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6F6A64]">Product</p>
            <ul className="mt-2">
              {NAV_LINKS.map((l) => (
                <li key={l.href}>
                  <a href={l.href} className={linkClass}>
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6F6A64]">Account</p>
            <ul className="mt-2">
              <li>
                <Link href="/login" className={linkClass}>
                  Log in
                </Link>
              </li>
              <li>
                <Link href="/signup" className={cn(linkClass, "font-medium text-[#F6D58E] hover:text-[#F8DB98]")}>
                  Get started
                </Link>
              </li>
            </ul>
          </div>
        </nav>
      </Container>
      <div className="border-t border-white/[0.05]">
        <Container className="flex flex-col gap-1 py-6 text-[12.5px] text-[#6F6A64] sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 Runnit</p>
          <p>Made in Geelong, Australia</p>
        </Container>
      </div>
    </footer>
  );
}
