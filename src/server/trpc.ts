import { initTRPC, TRPCError } from "@trpc/server";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { userFromRequest, AccountError } from "./accounts.js";
import { viewerFor, type Viewer } from "./studios.js";

/**
 * Every API call knows who is asking and which studio they have open.
 *
 * Three kinds of procedure, and the difference between them is the security
 * model of the whole app:
 *   - `openProcedure`   — anyone: "who am I", sign up, log in.
 *   - `authedProcedure` — anyone signed in: their own profile and studios.
 *   - `studioProcedure` — the connected studio's inbox, agent and settings.
 *     Only for a member of the studio that owns the Meta connection, while
 *     it is the studio they have open. Everything the app did before
 *     accounts existed is one of these.
 */
export async function createContext({ req, res }: CreateExpressContextOptions) {
  let viewer: Viewer | null = null;
  let expired = false;
  try {
    const found = await userFromRequest(req, res);
    expired = found.expired;
    if (found.user) viewer = await viewerFor(found.user);
  } catch (error) {
    console.error("[Auth] Couldn't read the session:", (error as Error).message);
  }
  return { req, res, viewer, expired };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

export const t = initTRPC.context<Context>().create();

export const openProcedure = t.procedure;

export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.viewer) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: ctx.expired ? "You were signed out. Log in again." : "Log in first.",
    });
  }
  return next({ ctx: { ...ctx, viewer: ctx.viewer } });
});

export const studioProcedure = authedProcedure.use(({ ctx, next }) => {
  if (!ctx.viewer.canReadData) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This studio isn't connected to an inbox yet.",
    });
  }
  return next();
});

const STATUS_CODES: Record<number, TRPCError["code"]> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  415: "BAD_REQUEST",
  429: "TOO_MANY_REQUESTS",
};

/** Turn an account/studio rule into the error the browser shows as-is. */
export async function asTrpc<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AccountError) {
      throw new TRPCError({ code: STATUS_CODES[error.status] ?? "BAD_REQUEST", message: error.message });
    }
    throw error;
  }
}
