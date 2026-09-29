import { Check, ChevronLeft, ReceiptText, ScanSearch, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, DemoTag, Emblem, PeonyLineArt, StencilRing } from "./primitives";

/**
 * The hero's product shot, built in markup rather than a screenshot so it is
 * sharp on every screen and costs nothing to load: a phone open on one
 * enquiry — reference photos in, a drafted reply out, waiting on a tap.
 */
export function HeroPreview() {
  return (
    <figure className="relative mx-auto w-full max-w-[540px]">
      <figcaption className="sr-only">
        Illustration with made-up data: a customer sends two reference photos on Instagram at 11:41 pm, and
        Runnit has a drafted reply with a quote from the studio’s price list and two free times, waiting for the
        studio to approve and send.
      </figcaption>

      {/* Stage lighting: a warm pool and the emblem’s ring, very faint. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 sm:h-[640px] sm:w-[640px]"
      >
        <div className="absolute inset-[12%] rounded-full bg-[radial-gradient(closest-side,rgba(217,169,78,0.24),rgba(217,169,78,0.07)_55%,transparent)] blur-2xl" />
        <StencilRing className="rn-spin-slow absolute inset-0 h-full w-full opacity-50" />
      </div>

      <div aria-hidden className="relative mx-auto w-[284px] sm:w-[300px]">
        <div className="rn-float">
          <Phone />
        </div>
      </div>

      {/* Floating cards sit over the phone's quiet corners — the status bar and
          the space beside the photos — so they never cover the draft itself. */}
      <PushCard className="absolute -top-7 left-0 hidden w-[240px] sm:block lg:-left-6 xl:-left-14" />
      <PriceCard className="absolute right-0 top-[146px] hidden w-[224px] sm:block lg:-right-8 lg:w-[208px] xl:-right-12 xl:w-[224px]" />

      <div className="mt-7 flex justify-center">
        <DemoTag />
      </div>
    </figure>
  );
}

function Phone() {
  return (
    <div className="relative rounded-[50px] bg-[linear-gradient(155deg,#34343B_0%,#141418_30%,#0B0B0E_65%,#26262C_100%)] p-[9px] shadow-[0_60px_120px_-40px_rgba(0,0,0,0.95),0_30px_140px_-60px_rgba(217,169,78,0.55),inset_0_0_0_1px_rgba(255,255,255,0.14)]">
      <div className="relative overflow-hidden rounded-[41px] bg-[#0A0A0D] ring-1 ring-black">
        <div className="absolute left-1/2 top-[11px] z-20 h-[27px] w-[88px] -translate-x-1/2 rounded-full bg-black" />
        <StatusBar />
        <ThreadHeader />
        <Thread />
        <ActionBar />
      </div>
    </div>
  );
}

function StatusBar() {
  return (
    <div className="flex h-[48px] items-end justify-between px-[26px] pb-[7px] text-[12.5px] font-semibold tracking-tight text-white">
      <span>11:42</span>
      <span className="flex items-center gap-[5px]">
        <span className="flex items-end gap-[2px]">
          {[4, 6, 8, 10].map((h) => (
            <span key={h} className="w-[3px] rounded-[1px] bg-white" style={{ height: h }} />
          ))}
        </span>
        <span className="relative ml-1 h-[11px] w-[22px] rounded-[3.5px] border border-white/50 p-[1.5px]">
          <span className="block h-full w-[70%] rounded-[1.5px] bg-white" />
          <span className="absolute -right-[3px] top-1/2 h-[4px] w-[1.5px] -translate-y-1/2 rounded-r bg-white/50" />
        </span>
      </span>
    </div>
  );
}

function ThreadHeader() {
  return (
    <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-3 pb-3 pt-2.5">
      <ChevronLeft className="h-5 w-5 shrink-0 text-[#D9A94E]" strokeWidth={2.2} />
      <Avatar initials="CH" tone={0} platform="ig" className="h-9 w-9" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-semibold leading-tight text-[#F4F1EA]">Chloe H.</p>
        <p className="mt-0.5 text-[11px] leading-tight text-[#8C867F]">Instagram · 1m</p>
      </div>
      <span className="shrink-0 rounded-full bg-[#D9A94E]/[0.12] px-2 py-[5px] text-[9.5px] font-semibold uppercase tracking-[0.08em] text-[#F6D58E] ring-1 ring-inset ring-[#D9A94E]/30">
        Needs a reply
      </span>
    </div>
  );
}

function Thread() {
  return (
    <div className="space-y-2.5 px-3 pt-3">
      <p className="text-center text-[9.5px] font-medium uppercase tracking-[0.16em] text-[#66615B]">Today 11:41 pm</p>

      <div className="flex gap-1.5">
        {/* Reference photo: the flash they want */}
        <div className="relative h-[92px] w-[76px] overflow-hidden rounded-[14px] bg-[linear-gradient(160deg,#4A3A30,#2A201A_60%,#1C1612)] ring-1 ring-inset ring-white/10">
          <div className="absolute inset-0 bg-[radial-gradient(90%_60%_at_30%_20%,rgba(255,226,196,0.16),transparent)]" />
          <PeonyLineArt className="absolute left-1/2 top-1/2 h-[70px] w-[50px] -translate-x-1/2 -translate-y-1/2 text-[#F4F1EA]/80" />
        </div>
        {/* Reference photo: where it goes, with Runnit’s read of the size */}
        <div className="relative h-[92px] w-[76px] overflow-hidden rounded-[14px] bg-[linear-gradient(160deg,#2B2622,#16130F)] ring-1 ring-inset ring-white/10">
          <div className="absolute left-[18px] top-[-10px] h-[120px] w-[42px] rotate-[14deg] rounded-[22px] bg-[linear-gradient(90deg,rgba(214,168,132,0.22),rgba(236,196,160,0.34)_50%,rgba(214,168,132,0.2))]" />
          <div className="absolute left-[22px] top-[26px] h-[40px] w-[30px] rotate-[14deg] rounded-[4px] border border-dashed border-[#F6D58E]" />
          <span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/70 px-1.5 py-[2px] text-[9px] font-semibold text-[#F6D58E]">~12 cm</span>
        </div>
      </div>

      <div className="max-w-[92%] rounded-[18px] rounded-tl-[6px] bg-[#1B1B21] px-3 py-2 text-[12.5px] leading-[1.45] text-[#E9E4DB]">
        Hey! Could I get this fine-line peony on my forearm, about this big? When’s your next spot?
      </div>

      <div className="flex items-center gap-1.5 pl-0.5 text-[10.5px] text-[#8C867F]">
        <ScanSearch className="h-3.5 w-3.5 text-[#D9A94E]" />
        Read 2 photos · forearm · ~12 cm · fine line
      </div>

      <div className="rounded-[18px] border border-[#D9A94E]/35 bg-[linear-gradient(180deg,rgba(217,169,78,0.11),rgba(217,169,78,0.025))] p-3 shadow-[0_10px_30px_-18px_rgba(217,169,78,0.6)]">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#F6D58E]">
            <Sparkles className="h-3 w-3" />
            Draft reply
          </span>
          <span className="text-[10px] text-[#8C867F]">In your voice</span>
        </div>
        <p className="mt-2 text-[12.5px] leading-[1.5] text-[#EFEAE1]">
          Hey Chloe! Love this one. At that size on the forearm it’s{" "}
          <span className="font-semibold text-[#F6D58E]">$350–$450</span> from our price list. I’ve got Thu 11am or
          Sat 2pm free. Want one? A $100 deposit locks it in.
          <span className="rn-caret ml-0.5 inline-block h-[13px] w-[1.5px] translate-y-[2px] bg-[#F6D58E]" />
        </p>
        <div className="mt-2.5 flex flex-wrap gap-1">
          {["Short and casual", "Explains the work", "Pushes to book"].map((v) => (
            <span
              key={v}
              className="rounded-full bg-white/[0.05] px-2 py-[4px] text-[9.5px] font-medium text-[#CFC9C0] ring-1 ring-inset ring-white/10"
            >
              {v}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function ActionBar() {
  return (
    <div className="mt-3 border-t border-white/[0.06] px-3 pb-2.5 pt-3">
      <div className="flex gap-2">
        <span className="grid h-10 flex-none place-items-center rounded-full px-4 text-[12.5px] font-medium text-[#D8D2C9] ring-1 ring-inset ring-white/15">
          Edit
        </span>
        <span className="rn-gold-fill rn-glow flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full text-[13px] font-semibold text-[#1A1206] shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
          <Check className="h-4 w-4" strokeWidth={2.6} />
          Approve &amp; send
        </span>
      </div>
      <div className="mx-auto mt-3 h-[4px] w-[108px] rounded-full bg-white/30" />
    </div>
  );
}

function PushCard({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "rn-float-alt z-10 rounded-[20px] border border-white/10 bg-[#16161B]/95 p-3 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl",
        className
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[#08080A] ring-1 ring-inset ring-white/10">
          <Emblem className="h-[22px] w-[22px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#A6A09A]">Runnit</span>
            <span className="text-[10.5px] text-[#6F6A64]">now</span>
          </div>
          <p className="mt-0.5 truncate text-[13px] font-semibold text-[#F4F1EA]">New enquiry · Chloe H.</p>
          <p className="text-[12px] text-[#A6A09A]">Draft ready. Tap to review.</p>
        </div>
      </div>
    </div>
  );
}

function PriceCard({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "rn-float z-10 rounded-[18px] border border-white/10 bg-[#121216]/85 p-3 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl",
        className
      )}
    >
      <p className="flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-[#A6A09A]">
        <ReceiptText className="h-3.5 w-3.5 text-[#D9A94E]" />
        Your price list
      </p>
      <div className="mt-2 flex items-center justify-between rounded-[10px] bg-[#D9A94E]/10 px-2.5 py-1.5 ring-1 ring-inset ring-[#D9A94E]/25">
        <span className="text-[11.5px] text-[#E9DFC9]">Fine line · medium</span>
        <span className="text-[12.5px] font-semibold text-[#F6D58E]">$350–$450</span>
      </div>
      <p className="mt-2 truncate text-[10.5px] text-[#8C867F]">Sized from their photos. Never guessed.</p>
    </div>
  );
}
