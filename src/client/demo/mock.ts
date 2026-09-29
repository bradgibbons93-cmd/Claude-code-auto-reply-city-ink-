import { observable } from "@trpc/server/observable";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import type { AppRouter } from "../../server/routers";
import captured from "./fixtures.json";

/**
 * The test drive's pretend server.
 *
 * Every screen is the real one; only the network is replaced. Queries are
 * answered from fixtures.json — recorded from the real server by
 * scripts/demo-fixtures.mjs, so the shapes are exactly what the live app gets
 * — with every timestamp moved forward so "4 minutes ago" is still four
 * minutes ago whenever the page is opened. Mutations change that data in
 * memory. Nothing here can reach Meta, a model, or the studio's inbox: there
 * is no network in this file at all.
 */

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const MYSQL = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/** Everything recorded at capture time, moved to "now". */
function shift(value: Json, delta: number): Json {
  if (typeof value === "string") {
    if (ISO.test(value)) return new Date(new Date(value).getTime() + delta).toISOString();
    if (MYSQL.test(value)) return new Date(new Date(`${value.replace(" ", "T")}Z`).getTime() + delta).toISOString();
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => shift(v, delta));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shift(v, delta)]));
  }
  return value;
}

function fresh() {
  const delta = Date.now() - new Date(captured.capturedAt).getTime();
  const data = shift(JSON.parse(JSON.stringify(captured)), delta);
  // The capture pointed the AI at nowhere on purpose; don't show that address.
  data.queries["llm.status"].baseUrl = null;
  return data as { queries: Record<string, Json>; messages: Record<string, { messages: Json[]; total: number }> };
}

let db = fresh();
export function resetDemo() {
  db = fresh();
}

/* ---------- the studio's calendar, drawn around the viewer's own day ---------- */

const ZONE = "Australia/Melbourne";
function studioMinutes(at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, hour12: false, hour: "2-digit", minute: "2-digit" }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return (get("hour") % 24) * 60 + get("minute");
}
const DAY = [
  { title: "Ella Brooks – fine line forearm", start: 10 * 60, end: 12 * 60 },
  { title: "Noah West – blackwork dagger", start: 13 * 60, end: 15 * 60 + 30 },
  { title: "Priya Sen – consult", start: 16 * 60, end: 16 * 60 + 30 },
];
function atStudioMinute(minutes: number, dayOffset = 0) {
  const now = new Date();
  return new Date(now.getTime() + (minutes - studioMinutes(now)) * 60_000 + dayOffset * 86_400_000);
}
function slotLabel(d: Date) {
  const weekday = d.toLocaleDateString("en-AU", { weekday: "long", timeZone: ZONE });
  const day = Number(d.toLocaleDateString("en-AU", { day: "numeric", timeZone: ZONE }));
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  const time = d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", timeZone: ZONE }).replace(":00", "").replace(" ", "");
  return `${weekday} the ${day}${suffix} at ${time}`;
}
function today() {
  return {
    connected: true,
    nowMin: studioMinutes(),
    bookings: DAY.map((b) => ({ ...b, startMin: b.start, endMin: b.end, start: atStudioMinute(b.start).toISOString(), end: atStudioMinute(b.end).toISOString() })),
  };
}
function upcoming() {
  const now = Date.now();
  const all = [0, 1, 2].flatMap((day) =>
    DAY.map((b, i) => {
      const start = atStudioMinute(b.start + i * 15 * day, day);
      return { title: day ? ["Sam Nguyen – script", "Josh Kay – sleeve session", "Zac Tran – cover-up consult"][i] : b.title, start: start.toISOString(), label: slotLabel(start), t: start.getTime() };
    })
  );
  return all.filter((b) => b.t > now).slice(0, 6).map(({ t: _t, ...b }) => b);
}
function freeSlots() {
  return [1, 2, 3].map((day) => {
    const start = atStudioMinute(11 * 60 + day * 30, day);
    return { start: start.toISOString(), end: new Date(start.getTime() + 2 * 3600_000).toISOString(), label: slotLabel(start) };
  });
}

/* ---------- queries ---------- */

function query(path: string, input: Json): Json {
  const q = db.queries;
  switch (path) {
    case "calendar.today":
      return today();
    case "calendar.upcoming":
      return upcoming();
    case "calendar.freeSlots":
      return freeSlots();
    case "conversations.messages": {
      const thread = db.messages[input?.conversationId] ?? { messages: [], total: 0 };
      return input?.beforeId ? { messages: [], total: thread.total } : thread;
    }
    case "search": {
      const term = String(input?.query ?? "").toLowerCase().trim();
      if (!term) return [];
      return (q["conversations.list"] as Json[])
        .map((c) => {
          const hit = (db.messages[c.conversationId]?.messages ?? []).find((m: Json) => m.content?.toLowerCase().includes(term));
          const named = c.senderName?.toLowerCase().includes(term);
          if (!hit && !named) return null;
          return { conversationId: c.conversationId, senderName: c.senderName, platform: c.platform, lastMessageAt: c.lastMessageAt, snippet: hit?.content ?? c.lastPreview ?? "" };
        })
        .filter(Boolean);
    }
    case "uploads.list":
      return q["uploads.list"];
    default:
      if (path in q) return q[path];
      // A screen asking for something the recording didn't cover gets an
      // empty answer rather than a crash.
      return null;
  }
}

/* ---------- mutations ---------- */

let nextId = 1000;
const now = () => new Date().toISOString();

function mutate(path: string, input: Json): Json {
  const q = db.queries;
  switch (path) {
    case "pendingReplies.approve": {
      const drafts = q["pendingReplies.list"] as Json[];
      const draft = drafts.find((d) => d.id === input.id);
      if (!draft) throw new Error("That draft has already been dealt with.");
      q["pendingReplies.list"] = drafts.filter((d) => d.id !== input.id);
      const text = (input.editedText ?? draft.draftText).trim();
      const thread = (db.messages[draft.conversationId] ??= { messages: [], total: 0 });
      thread.messages = [
        ...thread.messages,
        { id: nextId++, conversationId: draft.conversationId, messageId: `demo_${nextId}`, senderType: "bot", content: text, attachmentUrls: null, autoReplyGenerated: true, autoReplyContent: null, createdAt: now() },
      ];
      thread.total += 1;
      for (const c of q["conversations.list"] as Json[]) {
        if (c.conversationId === draft.conversationId) Object.assign(c, { lastSenderType: "bot", lastMessageAt: now(), lastPreview: text });
      }
      q.dashboard.draftsWaiting = Math.max(0, (q.dashboard.draftsWaiting ?? 1) - 1);
      return null;
    }
    case "pendingReplies.reject":
      q["pendingReplies.list"] = (q["pendingReplies.list"] as Json[]).filter((d) => d.id !== input.id);
      return null;
    case "pendingReplies.redraft":
      return { ok: false, reason: "The AI isn't connected in the test drive." };
    case "pendingReplies.draftUnanswered":
      return { drafted: 0, failed: 0, skipped: 0 };
    case "conversations.pause":
    case "conversations.resume":
      for (const c of q["conversations.list"] as Json[]) {
        if (c.conversationId === input.conversationId)
          c.botPausedUntil = path.endsWith("pause") ? new Date(Date.now() + (input.hours ?? 12) * 3600_000).toISOString() : null;
      }
      return null;
    case "posts.create": {
      const post = { id: nextId++, content: input.content, imageUrl: input.imageUrl ?? null, scheduledAt: new Date(input.scheduledAt).toISOString(), status: "scheduled", aiGenerated: !!input.aiGenerated, facebookPostId: null, lastError: null, publishedAt: null, createdAt: now() };
      q["posts.getScheduled"] = [post, ...(q["posts.getScheduled"] as Json[])];
      return post;
    }
    case "posts.remove":
      q["posts.getScheduled"] = (q["posts.getScheduled"] as Json[]).filter((p) => p.id !== input.id);
      return null;
    case "posts.generateCaption":
      return { caption: "Fresh from the chair this week. DM us to book your own — spots are filling up." };
    case "studios.setAppearance": {
      for (const s of q["account.me"].studios as Json[]) {
        if (s.id !== input.id) continue;
        if (input.theme !== undefined) s.theme = input.theme;
        if (input.mode !== undefined) s.mode = input.mode;
        if (input.accent !== undefined) s.accent = input.accent;
        if (input.homeLayout !== undefined) s.homeLayout = input.homeLayout;
      }
      return null;
    }
    case "account.logout":
      // The real one reloads onto the log-in page. Here that would leave the
      // test drive, so it starts the demo over instead.
      return null;
    default:
      // Everything else — saving settings, turning things on — "works" and
      // changes nothing. Nothing leaves the page.
      return { ok: true };
  }
}

export const mockLink: TRPCLink<AppRouter> = () => ({ op }) =>
  observable((observer) => {
    const timer = setTimeout(() => {
      try {
        const data = op.type === "mutation" ? mutate(op.path, op.input) : query(op.path, op.input);
        // A copy, so the screens can't edit the pretend database by accident.
        observer.next({ result: { type: "data", data: data == null ? data : JSON.parse(JSON.stringify(data)) } });
        observer.complete();
      } catch (error) {
        observer.error(TRPCClientError.from(error as Error));
      }
    }, op.type === "mutation" ? 350 : 120);
    return () => clearTimeout(timer);
  });
