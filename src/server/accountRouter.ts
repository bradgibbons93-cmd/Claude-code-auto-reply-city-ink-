import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { t, openProcedure, authedProcedure, asTrpc } from "./trpc.js";
import {
  AccountError,
  checkCredentials,
  clearAttempts,
  clientAddress,
  createUser,
  endOtherSessions,
  endSession,
  findUserByEmail,
  getUser,
  hashPassword,
  looksLikeEmail,
  MIN_PASSWORD,
  normaliseEmail,
  noteAttempt,
  sessionToken,
  startSession,
  tooManyAttempts,
  updateUser,
  verifyPassword,
} from "./accounts.js";
import {
  claimableStudio,
  claimDataStudio,
  isClaimCode,
  signupsOpen,
  createStudio,
  deleteStudio,
  describeViewer,
  setAppearance,
  setAvatar,
  setStudioImage,
  switchStudio,
  THEMES,
  updateStudio,
  viewerFor,
} from "./studios.js";

const TOO_MANY = "Too many attempts. Give it fifteen minutes and try again.";

const studioFields = z.object({
  name: z.string().max(255).optional(),
  location: z.string().max(255).nullish(),
  address: z.string().max(255).nullish(),
  phone: z.string().max(64).nullish(),
  email: z.string().max(255).nullish(),
  instagram: z.string().max(255).nullish(),
  website: z.string().max(255).nullish(),
  tagline: z.string().max(255).nullish(),
});

/** Sign up, log in, and the signed-in person's own details. */
export const accountRouter = t.router({
  /** Who is signed in, their studios, and where setup got to. Never throws for "nobody". */
  me: openProcedure.query(({ ctx }) => describeViewer(ctx.viewer, ctx.expired)),

  signup: openProcedure
    .input(
      z.object({
        name: z.string().max(255),
        email: z.string().max(254),
        password: z.string().max(200),
        // Needed when sign-up isn't public: the studio's own code.
        code: z.string().max(200).optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      asTrpc(async () => {
        const keys = [`signup:${clientAddress(ctx.req)}`];
        if (tooManyAttempts(keys)) throw new AccountError(TOO_MANY, 429);
        noteAttempt(keys);
        const invited = !signupsOpen();
        if (invited) {
          if (!(await claimableStudio())) {
            throw new AccountError("New accounts aren't open here. Ask the studio owner, or log in.", 403);
          }
          if (!isClaimCode(input.code)) {
            throw new AccountError("That studio code doesn't match. It's the password you used for the dashboard.", 401);
          }
        }
        const user = await createUser(input);
        // The code proves who they are, so link the studio straight away.
        if (invited) await claimDataStudio(user.id, input.code!);
        await startSession(ctx.req, ctx.res, user.id);
        return describeViewer(await viewerFor((await getUser(user.id)) ?? user));
      })
    ),

  login: openProcedure
    .input(z.object({ email: z.string().max(254), password: z.string().max(200) }))
    .mutation(({ ctx, input }) =>
      asTrpc(async () => {
        const email = normaliseEmail(input.email);
        const keys = [`login-ip:${clientAddress(ctx.req)}`, `login-email:${email}`];
        if (tooManyAttempts(keys)) throw new AccountError(TOO_MANY, 429);
        const user = await checkCredentials(email, input.password);
        if (!user) {
          noteAttempt(keys);
          // One message for both halves, so it says nothing about which
          // emails have accounts.
          throw new AccountError("That email and password don't match.", 401);
        }
        clearAttempts([`login-email:${email}`]);
        await startSession(ctx.req, ctx.res, user.id);
        return describeViewer(await viewerFor(user));
      })
    ),

  logout: openProcedure.mutation(async ({ ctx }) => {
    await endSession(ctx.req, ctx.res);
    return { ok: true };
  }),

  updateProfile: authedProcedure
    .input(z.object({ name: z.string().max(255).optional(), email: z.string().max(254).optional() }))
    .mutation(({ ctx, input }) =>
      asTrpc(async () => {
        const set: { name?: string; email?: string } = {};
        if (input.name !== undefined) {
          const name = input.name.trim();
          if (!name) throw new AccountError("Your name can't be empty.");
          set.name = name;
        }
        if (input.email !== undefined) {
          const email = normaliseEmail(input.email);
          if (!looksLikeEmail(email)) throw new AccountError("That email doesn't look right.");
          const taken = await findUserByEmail(email);
          if (taken && taken.id !== ctx.viewer.user.id) {
            throw new AccountError("Another account already uses that email.", 409);
          }
          set.email = email;
        }
        if (Object.keys(set).length) await updateUser(ctx.viewer.user.id, set);
        return { ok: true };
      })
    ),

  changePassword: authedProcedure
    .input(z.object({ current: z.string().max(200), next: z.string().max(200) }))
    .mutation(({ ctx, input }) =>
      asTrpc(async () => {
        const keys = [`password:${ctx.viewer.user.id}`];
        if (tooManyAttempts(keys)) throw new AccountError(TOO_MANY, 429);
        if (!(await verifyPassword(input.current, ctx.viewer.user.passwordHash))) {
          noteAttempt(keys);
          throw new AccountError("Your current password isn't right.", 401);
        }
        if (input.next.length < MIN_PASSWORD) {
          throw new AccountError(`Use at least ${MIN_PASSWORD} characters for your new password.`);
        }
        await updateUser(ctx.viewer.user.id, { passwordHash: await hashPassword(input.next) });
        // Anyone else signed in as you is signed out; this browser stays in.
        await endOtherSessions(ctx.viewer.user.id, sessionToken(ctx.req));
        return { ok: true };
      })
    ),

  /** Sign out every other phone and computer; this one stays in. */
  logoutOthers: authedProcedure.mutation(async ({ ctx }) => {
    await endOtherSessions(ctx.viewer.user.id, sessionToken(ctx.req));
    return { ok: true };
  }),

  setAvatar: authedProcedure
    .input(z.object({ assetId: z.string().max(64).nullable() }))
    .mutation(({ ctx, input }) =>
      asTrpc(async () => {
        await setAvatar(ctx.viewer.user.id, input.assetId);
        return { ok: true };
      })
    ),
});

export const ONBOARDING_STEPS = ["welcome", "you", "studio", "brand", "look", "preview", "done"] as const;

/** Where first-time setup got to — saved as it goes, so it resumes. */
export const onboardingRouter = t.router({
  setStep: authedProcedure
    .input(z.object({ step: z.enum(ONBOARDING_STEPS) }))
    .mutation(async ({ ctx, input }) => {
      // Finished is finished: stepping back through setup from Settings must
      // never put someone back into first-run.
      if (ctx.viewer.user.onboardingCompletedAt) return { ok: true };
      await updateUser(ctx.viewer.user.id, { onboardingStep: input.step });
      return { ok: true };
    }),

  complete: authedProcedure.mutation(({ ctx }) =>
    asTrpc(async () => {
      if (!ctx.viewer.studio) throw new AccountError("Set up your studio first.");
      if (!ctx.viewer.user.onboardingCompletedAt) {
        await updateUser(ctx.viewer.user.id, { onboardingStep: "done", onboardingCompletedAt: new Date() });
      }
      return { ok: true };
    })
  ),
});

/** A person's studios: make, edit, brand, switch, remove, and claim the one with the inbox. */
export const studiosRouter = t.router({
  create: authedProcedure
    .input(studioFields.extend({ name: z.string().max(255) }))
    .mutation(({ ctx, input }) =>
      asTrpc(async () => {
        const studio = await createStudio(ctx.viewer.user.id, input);
        return { id: studio.id };
      })
    ),

  update: authedProcedure
    .input(studioFields.extend({ id: z.number().int() }))
    .mutation(({ ctx, input }) =>
      asTrpc(async () => {
        const { id, ...fields } = input;
        await updateStudio(ctx.viewer.user.id, id, fields);
        return { ok: true };
      })
    ),

  setAppearance: authedProcedure
    .input(
      z.object({
        id: z.number().int(),
        theme: z.enum(THEMES).optional(),
        mode: z.enum(["light", "dark"]).nullable().optional(),
        accent: z.string().max(16).nullable().optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      asTrpc(async () => {
        const { id, ...look } = input;
        await setAppearance(ctx.viewer.user.id, id, look);
        return { ok: true };
      })
    ),

  setImage: authedProcedure
    .input(
      z.object({
        id: z.number().int(),
        which: z.enum(["logo", "cover"]),
        assetId: z.string().max(64).nullable(),
      })
    )
    .mutation(({ ctx, input }) =>
      asTrpc(async () => {
        await setStudioImage(ctx.viewer.user.id, input.id, input.which, input.assetId);
        return { ok: true };
      })
    ),

  switch: authedProcedure.input(z.object({ id: z.number().int() })).mutation(({ ctx, input }) =>
    asTrpc(async () => {
      await switchStudio(ctx.viewer.user.id, input.id);
      return { ok: true };
    })
  ),

  remove: authedProcedure.input(z.object({ id: z.number().int() })).mutation(({ ctx, input }) =>
    asTrpc(async () => {
      await deleteStudio(ctx.viewer.user.id, input.id);
      return { ok: true };
    })
  ),

  claim: authedProcedure.input(z.object({ code: z.string().max(200) })).mutation(({ ctx, input }) =>
    asTrpc(async () => {
      const keys = [`claim:${clientAddress(ctx.req)}`, `claim-user:${ctx.viewer.user.id}`];
      if (tooManyAttempts(keys)) throw new AccountError(TOO_MANY, 429);
      try {
        const studio = await claimDataStudio(ctx.viewer.user.id, input.code);
        clearAttempts(keys);
        return { id: studio.id, name: studio.name };
      } catch (error) {
        if (error instanceof AccountError && error.status === 401) noteAttempt(keys);
        throw error;
      }
    })
  ),
});

export { TRPCError };
