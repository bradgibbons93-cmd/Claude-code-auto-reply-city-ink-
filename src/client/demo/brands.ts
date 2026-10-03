/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

/**
 * A test drive dressed as one particular studio, for showing it to them.
 *
 * `VITE_DEMO_BRAND` picks one at build time (`npm run build:demo:allink`).
 * Everything here is laid over the recorded fixtures before the app sees
 * them: the studio's name, logo and colours, the owner's name, the drafts and
 * past replies in their voice and their own published policies, and the
 * scripted DMs the "Send a test DM" button drops in. The customers stay
 * pretend — never a real studio's real customers, in anybody's pitch.
 *
 * Only facts the studio publishes itself go in here (their website, their
 * booking page). Anything not public is left generic rather than guessed.
 */

export type Incoming = {
  name: string;
  platform: "instagram" | "messenger";
  text: string;
  draft: string;
  alternatives: Array<{ label: string; text: string }>;
};

type Brand = {
  /** Shown in the strip across the top of the test drive. */
  label: string;
  /** Page title. */
  title: string;
  /** The studio's own clock, for "today at the studio". Geelong's if left out. */
  timeZone?: string;
  apply: (data: Json) => void;
  incoming: Incoming[];
};

/** For the plain test drive, and any brand without its own script. */
const GENERIC_INCOMING: Incoming[] = [
  {
    name: "Ruby Hale",
    platform: "instagram",
    text: "Hey! Do you have anything free this Saturday for a small script piece behind my ear? 🙏",
    draft: "Hey Ruby! Saturday's looking good, we've got 11am or 2:30pm free. Roughly how big are you thinking for the script? Send the wording through and we'll get you a price 😊",
    alternatives: [{ label: "Short and sweet", text: "Hey Ruby! 11am or 2:30pm Saturday? Send the wording and a rough size and we'll price it 😊" }],
  },
  {
    name: "Liam Ford",
    platform: "messenger",
    text: "How much for a half sleeve? Black and grey realism",
    draft: "Hey Liam! Love a black and grey realism half sleeve. Every piece is priced on its own, so send through your ideas and a few reference pics and we'll talk you through it and get you a quote.",
    alternatives: [{ label: "Book a chat", text: "Hey Liam! Best start is a quick consult so we can see the space and your ideas. Want me to find you a time?" }],
  },
];

const BRANDS: Record<string, Brand> = {
  allink: {
    label: "All Ink Tattoo · test drive · pretend customers · nothing is sent",
    title: "All Ink Front Desk",
    apply(data) {
      const q = data.queries;
      const me = q["account.me"];
      me.user.name = "Mitch Costello";
      me.user.email = "mitch@example.com";
      Object.assign(me.studios[0], {
        name: "All Ink Tattoo",
        location: "Wollongong, NSW",
        address: "Shop 49A, Warilla Grove, 43–57 Shellharbour Rd, Warilla NSW 2528",
        phone: "02 4250 7338",
        email: "info@allinktattoo.com.au",
        instagram: "@allinktattoo.com.au",
        website: "allinktattoo.com.au",
        tagline: "Locally grown, internationally known",
        logoUrl: "demo/allink-icon.png",
        // Black & Gold Ink's heavy condensed capitals suit their wordmark;
        // their blue star replaces the gold.
        theme: "ink",
        mode: "dark",
        accent: "#4CA1DA",
      });
      q["config.facebook"].pageName = "All Ink Tattoo";
      q["config.timely"].bookingPageUrl = "https://bookings.gettimely.com/allinktattoo/bb/book";

      const drafts: Record<string, { draftText: string; alternatives?: Incoming["alternatives"] }> = {
        demo_mia: {
          draftText:
            "Hey Mia! Love a fine line rose 😊 Send us a pic of your wrist and roughly how big you're thinking and we'll get you a price. Or pop into Warilla Grove for a free consult, no booking needed.",
          alternatives: [{ label: "Short and sweet", text: "Hey Mia! Send a pic of your wrist and the size you're after and we'll price it 😊" }],
        },
        demo_josh: {
          draftText:
            "No stress Josh. Mitch has Saturday 10am or Sunday 1:30pm, which suits? Your deposit moves across with you, it's never all or nothing with us.",
        },
        demo_priya: { draftText: "Thanks for letting us know, Priya. Mitch will be in touch about Friday 🖤" },
        demo_zac: {
          draftText:
            "We do! Send a clear photo of it in daylight, or come in for a free in-store consult and Mitch will talk you through what's possible with the shoulder.",
        },
      };
      for (const d of q["pendingReplies.list"] as Json[]) {
        const next = drafts[d.conversationId];
        if (next) Object.assign(d, next);
      }

      const replies: Record<string, string[]> = {
        demo_josh: ["Hey Josh, yep, Thursday 10am with Mitch. See you then!"],
        demo_noah: [
          "Love it. Mitch is free Friday at 12, want me to lock it in? A deposit holds the spot.",
          "Done, Friday 12pm with Mitch. We'll send a reminder the day before.",
        ],
        demo_ella: [
          "Eat a good meal, drink plenty of water and get a decent sleep. Wear something that shows the spot easily, and bring your ID. See you at 10!",
          "No worries 🖤",
        ],
        demo_chloe: [
          "Totally normal at this stage, it's healing. Warm water and no soap for the first couple of days, then a thin layer of balm twice a day. No picking or scratching, and skip the pool and the gym for two weeks. Send a pic if it gets hot or swollen.",
        ],
      };
      for (const [id, texts] of Object.entries(replies)) {
        const ours = (data.messages[id]?.messages ?? []).filter((m: Json) => m.senderType !== "customer");
        ours.forEach((m: Json, i: number) => {
          if (texts[i]) m.content = texts[i];
        });
        for (const c of q["conversations.list"] as Json[]) {
          if (c.conversationId === id && c.lastSenderType !== "customer" && texts.length) c.lastPreview = texts[texts.length - 1];
        }
      }

      const captions = [
        "Sleeve progress with Mitch. Session three and it's coming together.",
        "Two pieces, one very happy client. Done this week at All Ink.",
        "Healed and still this crisp. Fine line rose, six weeks on. Free in-store consults at Warilla Grove, walk-ins welcome.",
        "Fresh forearm wrap from last week. Locally grown, internationally known.",
      ];
      (q["posts.getScheduled"] as Json[]).forEach((p: Json, i: number) => {
        if (captions[i]) p.content = captions[i];
      });

      // Their own published policies (allinktattoo.com.au: FAQs, terms,
      // aftercare, booking page) — what the agent answers from.
      const at = q["knowledge.list"]?.[0]?.createdAt ?? new Date().toISOString();
      q["knowledge.list"] = [
        ["Do you take deposits?", "Yes. A deposit holds every booking, and it's never all or nothing: it can move to a new date, become studio credit or merch, or go to a friend. It's only lost on a short-notice cancellation."],
        ["Do you do walk-ins?", "Yes, walk-ins are welcome, and in-store consultations are free."],
        ["When are you open?", "Tuesday to Sunday, 9:30am to 5:30pm. Mondays by booking only."],
        ["How do bookings work?", "Online bookings are a request at first. We confirm within 12 hours."],
        ["Is there an age limit?", "18 and over, with valid ID."],
        ["How do I pay?", "Cash, card or bank transfer. Gift vouchers are available in store and online."],
        ["Aftercare?", "Wrap off after an hour and don't re-wrap. Warm water only, no soap, for two days. Balm twice a day from day two to day fourteen. No swimming or gym for two weeks. Fully healed in four to six weeks."],
      ].map(([question, answer], i) => ({ id: i + 1, question, answer, isActive: true, createdAt: at }));
    },
    incoming: [
      {
        name: "Ruby Hale",
        platform: "instagram",
        text: "Hey! Do you have anything free this Saturday for a small script piece behind my ear? 🙏",
        draft:
          "Hey Ruby! Saturday's looking good, Mitch has 11am or 2:30pm free. Roughly how big are you thinking for the script? Send the wording through and we'll get you a price 😊",
        alternatives: [
          { label: "Short and sweet", text: "Hey Ruby! 11am or 2:30pm Saturday with Mitch? Send the wording and a rough size and we'll price it 😊" },
          { label: "Walk in", text: "Hey Ruby! Easiest is to pop into Warilla Grove for a free consult, Mitch can size it up on the spot and lock in Saturday." },
        ],
      },
      {
        name: "Tash Moore",
        platform: "instagram",
        text: "Hey I can't make my booking next week 😩 can I use my deposit for merch instead?",
        draft:
          "Of course Tash, our deposits are never all or nothing. We can move it to a new date, turn it into studio credit or merch, or pass it on to a mate. Which would you like? 🖤",
        alternatives: [{ label: "Offer a new date", text: "No worries Tash! Want to move it instead? Mitch has spots the week after, your deposit comes with you." }],
      },
      {
        name: "Liam Ford",
        platform: "messenger",
        text: "How much for a half sleeve? Black and grey realism",
        draft:
          "Hey Liam! Love a black and grey realism half sleeve. Every piece is priced on its own, so the best start is a free in-store consult with Mitch at Warilla Grove, no booking needed. Or send through your ideas and a few reference pics and we'll talk you through it.",
        alternatives: [{ label: "Ask for pics", text: "Hey Liam! Send through a few reference pics and which arm, and we'll get you a rough price 🙌" }],
      },
      {
        name: "Jade Kerr",
        platform: "instagram",
        text: "do you guys do walk ins today?",
        draft: "Hey Jade! We sure do. We're at Warilla Grove 9:30 till 5:30, Tuesday to Sunday. Come say hi, and if the chair's busy we'll book you in for the next free spot 😊",
        alternatives: [{ label: "Short and sweet", text: "Yep! Walk-ins welcome, Tuesday to Sunday till 5:30 😊" }],
      },
    ],
  },
  /*
   * Canggu Ink Club, Bali. Everything below is from cangguinkclub.com (home
   * page, FAQ, booking policies) and their public listing. No owner or
   * artist is named on their own site, so none is named here: with 30-odd
   * artists, "one of our fine line artists" is how they'd say it anyway.
   */
  cic: {
    label: "Canggu Ink Club · test drive · nothing is sent",
    title: "Canggu Ink Club Front Desk",
    timeZone: "Asia/Makassar",
    apply(data) {
      const q = data.queries;
      const me = q["account.me"];
      me.user.name = "Team";
      me.user.email = "team@example.com";
      Object.assign(me.studios[0], {
        name: "Canggu Ink Club",
        location: "Canggu, Bali",
        address: "Jl. Pantai Batu Bolong No.69c, Canggu, Kuta Utara, Badung, Bali 80351",
        phone: "+62 877 778 02000",
        email: null,
        instagram: "@cangguinkclub",
        website: "cangguinkclub.com",
        tagline: "You need a quality tattoo in Bali. Not a 'Bali-quality' tattoo.",
        logoUrl: "demo/cic-icon.png",
        // Their brand is black and white, full stop. White as the accent
        // gives white buttons with black type, like their logo.
        theme: "ink",
        mode: "dark",
        accent: "#F2F2F2",
      });
      q["config.facebook"].pageName = "Canggu Ink Club Tattoo Bali";
      q["config.timely"].bookingPageUrl = "https://cangguinkclub.com";

      const drafts: Record<string, { draftText: string; alternatives?: Incoming["alternatives"] }> = {
        demo_mia: {
          draftText:
            "Hey Mia! Love a little fine line rose 🌹 If it's up to about 5×5cm on the wrist it's 1M IDR, bigger than that we price it off the design. How big are you thinking? We've got 10+ fine line artists so we can usually fit you in this week.",
          alternatives: [{ label: "Short and sweet", text: "Hey Mia! Up to 5×5cm it's 1M IDR. How big are you thinking? 🌹" }],
        },
        demo_josh: {
          draftText:
            "No stress Josh. We can do Saturday 10am or Sunday 1:30pm, which suits? As long as it's 48 hours before your booking, your deposit moves across with you 🙌",
        },
        demo_priya: { draftText: "Thanks for letting us know, Priya. Someone from the team will be in touch about Friday 🖤" },
        demo_zac: {
          draftText:
            "Hell yes we can 🙌 Send us a clear photo of it in daylight and we'll match you with the right artist for the cover-up and get you a price.",
        },
      };
      for (const d of q["pendingReplies.list"] as Json[]) {
        const next = drafts[d.conversationId];
        if (next) Object.assign(d, next);
      }

      const replies: Record<string, string[]> = {
        demo_josh: ["Hey Josh, yep, Thursday 10am. See you then!"],
        demo_noah: [
          "Love it. We've got a blackwork artist free Friday at 12, want me to lock it in? It's a 25% deposit to hold the spot.",
          "Done, Friday 12pm. We'll send a reminder the day before.",
        ],
        demo_ella: [
          "Eat a good meal, drink plenty of water and get a decent sleep. Skip the sun and the big night before, we can't tattoo sunburnt or hungover skin 😅 See you at 10!",
          "No worries 🖤",
        ],
        demo_chloe: [
          "Totally normal at this stage, it's healing. Keep it clean with a thin layer of balm, and no swimming or surfing for two weeks. If it needs a touch-up once it's healed, that's on us. Send a pic if it gets hot or swollen.",
        ],
      };
      for (const [id, texts] of Object.entries(replies)) {
        const ours = (data.messages[id]?.messages ?? []).filter((m: Json) => m.senderType !== "customer");
        ours.forEach((m: Json, i: number) => {
          if (texts[i]) m.content = texts[i];
        });
        for (const c of q["conversations.list"] as Json[]) {
          if (c.conversationId === id && c.lastSenderType !== "customer" && texts.length) c.lastPreview = texts[texts.length - 1];
        }
      }

      const captions = [
        "Sleeve progress, session three and it's coming together.",
        "Two pieces, one very happy client. Done this week at Canggu Ink Club.",
        "Healed and still this crisp. You need a quality tattoo in Bali, not a 'Bali-quality' tattoo. Walk-ins welcome, 10am to 8pm every day.",
        "Fresh forearm wrap from last week. Batu Bolong, open daily.",
      ];
      (q["posts.getScheduled"] as Json[]).forEach((p: Json, i: number) => {
        if (captions[i]) p.content = captions[i];
      });

      // Their own published answers (cangguinkclub.com FAQ and booking policies).
      const at = q["knowledge.list"]?.[0]?.createdAt ?? new Date().toISOString();
      q["knowledge.list"] = [
        ["How much is a small tattoo?", "Our minimum is 1,000,000 IDR per person. Small pieces up to 5×5cm: 1M IDR for one, 1.25M for two, 1.5M for three. Bigger pieces are priced on the design, not by the hour."],
        ["Do you take deposits?", "Yes, 25% of the booking (minimum Rp 500k). It's non-refundable, but it can be passed to a friend or family member for a future tattoo."],
        ["Cancelling or rescheduling?", "We need 48 hours' notice. Inside 48 hours, or a no-show, we may keep the deposit and charge a 50% cancellation fee."],
        ["Do you do walk-ins?", "We always do our best to fit walk-ins in. Booking ahead is the safest way to get your artist and time."],
        ["When are you open?", "10am to 8pm, every day."],
        ["Can I swim or surf after?", "No swimming, surfing or soaking for at least two weeks. The surface heals in about two weeks."],
        ["Touch-ups?", "Every tattoo comes with a complimentary touch-up if it needs one."],
        ["Numbing cream?", "Available on request. Best applied 60 to 90 minutes before your session."],
        ["Is it safe?", "Hospital-grade hygiene, brand-new needles, sterilised equipment and high-quality vegan ink."],
        ["Anything to avoid before?", "Don't come in drunk or sunburnt. Both hurt the result."],
      ].map(([question, answer], i) => ({ id: i + 1, question, answer, isActive: true, createdAt: at }));
    },
    incoming: [
      {
        name: "Lukas Weber",
        platform: "instagram",
        text: "Hey! I fly home Sunday, any chance of a small fine line wave on my ankle before then? 🌊",
        draft:
          "Hey Lukas! Yes, we'll get you sorted before your flight 🙌 If it's up to about 5×5cm it's 1M IDR. We've got fine line artists free tomorrow at 11am or 3pm, which suits? Just keep it out of the ocean for two weeks after, so your last day is the perfect time 😉",
        alternatives: [
          { label: "Short and sweet", text: "Hey Lukas! Tomorrow 11am or 3pm? Up to 5×5cm it's 1M IDR 🌊" },
          { label: "Walk in", text: "Hey Lukas! Just walk in any day 10am to 8pm on Batu Bolong and we'll fit you in before Sunday 🙌" },
        ],
      },
      {
        name: "Chloe Martin",
        platform: "instagram",
        text: "can I still surf after getting tattooed?? 🏄‍♀️",
        draft:
          "Honest answer: not for two weeks. No swimming, surfing or soaking while it heals. Heaps of people book their tattoo for the end of their trip for exactly that reason 😉 Want us to find you a spot near the end of your stay?",
        alternatives: [{ label: "Short and sweet", text: "Not for two weeks sorry! Most people get inked at the end of their trip 😉" }],
      },
      {
        name: "Ana Souza",
        platform: "messenger",
        text: "How much for a half sleeve? Japanese style",
        draft:
          "Hey Ana! Love a Japanese half sleeve. Bigger pieces are priced on the design rather than by the hour, so send through your ideas and a few references, plus which arm, and we'll get you a price and match you with one of our Japanese artists.",
        alternatives: [{ label: "Come in", text: "Hey Ana! Pop into Batu Bolong any day 10 to 8 and we'll go through it with you and price it on the spot 🙌" }],
      },
      {
        name: "Jake Ryan",
        platform: "instagram",
        text: "do you take walk ins today? me and 2 mates want matching tattoos 😂",
        draft:
          "Hell yes we do 🙌 Come down to Batu Bolong, we're open till 8pm. Small matching pieces up to 5×5cm are 1M IDR each. Just don't come in sunburnt or after a big night, it wrecks the result 😅",
        alternatives: [{ label: "Short and sweet", text: "Yep! Open till 8 tonight, 1M IDR each for small ones 🙌" }],
      },
    ],
  },
};

export const DEMO_BRAND = String(import.meta.env.VITE_DEMO_BRAND ?? "");

export function applyBrand(data: Json) {
  BRANDS[DEMO_BRAND]?.apply(data);
}

export function demoLabel() {
  return BRANDS[DEMO_BRAND]?.label ?? "Test drive · pretend customers · nothing is sent";
}

export function demoTitle() {
  return BRANDS[DEMO_BRAND]?.title;
}

export function demoTimeZone() {
  return BRANDS[DEMO_BRAND]?.timeZone ?? "Australia/Melbourne";
}

export function incomingScript(): Incoming[] {
  return BRANDS[DEMO_BRAND]?.incoming ?? GENERIC_INCOMING;
}
