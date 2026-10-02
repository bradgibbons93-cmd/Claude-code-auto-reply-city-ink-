import {
  mysqlTable,
  varchar,
  int,
  text,
  boolean,
  timestamp,
  json,
  mysqlEnum,
  uniqueIndex,
  index,
  customType,
} from "drizzle-orm/mysql-core";

/**
 * A person who signs in. The table came with the original template and was
 * never used; accounts extend it rather than living beside it.
 *
 * `open_id` is kept for what it was (an identity from an outside provider)
 * and filled with a random id for email sign-ups, so the unique key holds.
 */
export const users = mysqlTable("users", {
  id: int("id").primaryKey().autoincrement(),
  openId: varchar("open_id", { length: 191 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 255 }),
  loginMethod: varchar("login_method", { length: 64 }),
  role: varchar("role", { length: 32 }).default("user"),
  lastSignedIn: timestamp("last_signed_in"),
  createdAt: timestamp("created_at").defaultNow(),
  // scrypt, "salt:hash" in hex. Never the password.
  passwordHash: varchar("password_hash", { length: 255 }),
  avatarAssetId: varchar("avatar_asset_id", { length: 64 }),
  // The studio the dashboard is showing. Remembered on the account, not the
  // device, so switching on the phone is switched on the laptop too.
  currentStudioId: int("current_studio_id"),
  // Where setup got to, so leaving halfway resumes rather than restarts.
  onboardingStep: varchar("onboarding_step", { length: 32 }),
  onboardingCompletedAt: timestamp("onboarding_completed_at"),
});

export type InsertUser = typeof users.$inferInsert;

/**
 * A signed-in browser. The cookie carries a random token; only its SHA-256
 * is stored, so a copy of this table signs nobody in.
 */
export const sessions = mysqlTable(
  "sessions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: int("user_id").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    lastSeenAt: timestamp("last_seen_at").defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
    userAgent: varchar("user_agent", { length: 255 }),
  },
  (t) => ({ userIdx: index("sessions_user_idx").on(t.userId) })
);

/**
 * A studio — one location of a business. A person can own several (City Ink
 * Geelong, City Ink Melbourne…), and each carries its own name, branding and
 * look. The Meta connection, inbox and agent belong to the studio recorded as
 * `data_studio_id` in app_settings — see studios.ts.
 */
export const studios = mysqlTable("studios", {
  id: int("id").primaryKey().autoincrement(),
  name: varchar("name", { length: 255 }).notNull(),
  location: varchar("location", { length: 255 }),
  address: varchar("address", { length: 255 }),
  phone: varchar("phone", { length: 64 }),
  email: varchar("email", { length: 255 }),
  instagram: varchar("instagram", { length: 255 }),
  website: varchar("website", { length: 255 }),
  tagline: varchar("tagline", { length: 255 }),
  logoAssetId: varchar("logo_asset_id", { length: 64 }),
  coverAssetId: varchar("cover_asset_id", { length: 64 }),
  theme: varchar("theme", { length: 32 }),
  // "light" / "dark" / null for "the theme's own default".
  mode: varchar("mode", { length: 8 }),
  accent: varchar("accent", { length: 16 }),
  // Which home screen: null / "new" is the swipe deck (pages/Home.tsx),
  // "classic" the dashboard from before it (pages/Dashboard.tsx). A switch the
  // owner can flip back themselves, because Brad asked for an easy undo.
  homeLayout: varchar("home_layout", { length: 16 }),
  // The 3D illustrations on the Home (the rose bubble, the tattoo machine,
  // the calendar and camera). null / "theme" tints them to the theme's colour,
  // "gold" shows them as drawn, "mono" in black and white, "off" hides them.
  // Brad, 2 October: "they should change colour along with the colour of the
  // theme or just black or white", and an option to remove them.
  art: varchar("art", { length: 16 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

export const studioMembers = mysqlTable(
  "studio_members",
  {
    id: int("id").primaryKey().autoincrement(),
    studioId: int("studio_id").notNull(),
    userId: int("user_id").notNull(),
    // "owner" today. "staff" is the room left for inviting a team later.
    role: varchar("role", { length: 16 }).notNull().default("owner"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    memberIdx: uniqueIndex("studio_member_idx").on(t.studioId, t.userId),
    userIdx: index("studio_member_user_idx").on(t.userId),
  })
);

/**
 * Logos, banners and profile pictures. Same storage as every other image in
 * the app (bytes in MySQL, shrunk by images.ts) but a table of its own,
 * because who may see it is different: branding is shown on the owner's
 * pages and is not a customer's reference photo.
 */
export const brandAssets = mysqlTable("brand_assets", {
  id: varchar("id", { length: 64 }).primaryKey(),
  userId: int("user_id").notNull(),
  kind: varchar("kind", { length: 16 }).notNull(),
  contentType: varchar("content_type", { length: 128 }).notNull(),
  bytes: customType<{ data: Buffer; driverData: Buffer }>({
    dataType: () => "mediumblob",
  })("bytes").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

/**
 * One row per customer thread.
 * botPausedUntil is the human-handoff switch: when a studio member replies
 * from the Page inbox, we set this and the agent stays quiet.
 */
export const messengerConversations = mysqlTable(
  "messenger_conversations",
  {
    id: int("id").primaryKey().autoincrement(),
    conversationId: varchar("conversation_id", { length: 191 }).notNull(),
    senderName: varchar("sender_name", { length: 255 }),
    senderEmail: varchar("sender_email", { length: 255 }),
    // A profile picture when Meta will give one. It usually won't: the
    // per-person lookup is refused for this app, and Instagram only offers
    // one through the conversations edge. Nullable on purpose — the Avatar
    // falls back to initials, which is honest rather than a broken image.
    // Meta's picture URLs also expire, so this is a cache, not a record.
    avatarUrl: varchar("avatar_url", { length: 1024 }),
    // Messenger or Instagram DMs. Both arrive on the same webhook shape but
    // as different webhook objects, and the studio needs to know which
    // inbox a thread is really in.
    platform: mysqlEnum("platform", ["facebook", "instagram"]).default("facebook"),
    botPausedUntil: timestamp("bot_paused_until"),
    // WHY the agent is muted here, because the two reasons deserve opposite
    // treatment when the customer writes again.
    //
    // "manual" is Brad pressing Pause on a thread — an instruction, and it
    // is obeyed until it expires. "handoff" is set automatically when a
    // studio reply arrives from Meta's own inbox, and it used to mute the
    // thread for twelve hours: so a customer who answered that reply got no
    // draft, the board read "All caught up", and the studio's phone stayed
    // quiet while the Meta inbox showed unread messages. Nothing in this app
    // ever sends without approval, so withholding the draft bought nothing
    // and cost the reply.
    botPauseReason: varchar("bot_pause_reason", { length: 16 }),
    lastCustomerMessageAt: timestamp("last_customer_message_at"),
    lastMessageAt: timestamp("last_message_at").defaultNow(),
    createdAt: timestamp("created_at").defaultNow(),
    // Manual-booking handoff: collected piece by piece as the customer
    // replies, then pushed to the studio owner once complete.
    bookingName: varchar("booking_name", { length: 255 }),
    bookingPhone: varchar("booking_phone", { length: 64 }),
    bookingDates: varchar("booking_dates", { length: 255 }),
    bookingPhotoUrls: json("booking_photo_urls").$type<string[]>(),
    bookingNotifiedAt: timestamp("booking_notified_at"),
    // When this thread last set off a phone notification. Five photos in a
    // row is one enquiry, not five, and five buzzes for it is how a person
    // learns to ignore the buzz.
    lastNotifiedAt: timestamp("last_notified_at"),
  },
  (t) => ({
    convIdx: uniqueIndex("conv_id_idx").on(t.conversationId),
  })
);

/**
 * The reference photos themselves, not links to them.
 *
 * Facebook hands over a signed CDN URL that stops working after a while, so
 * a photo stored as a URL is a blank box by the time anyone looks at it. A
 * tattoo enquiry usually IS the picture — it has to still be there tomorrow.
 */
export const messageAttachments = mysqlTable(
  "message_attachments",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    conversationId: varchar("conversation_id", { length: 191 }).notNull(),
    messageId: varchar("message_id", { length: 191 }).notNull(),
    contentType: varchar("content_type", { length: 128 }).notNull(),
    bytes: customType<{ data: Buffer; driverData: Buffer }>({
      dataType: () => "mediumblob",
    })("bytes").notNull(),
    sourceUrl: text("source_url"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    convIdx: index("att_conv_idx").on(t.conversationId),
    msgIdx: index("att_msg_idx").on(t.messageId),
  })
);

/**
 * The studio's own posts, pulled back out of Facebook and Instagram.
 *
 * Kept locally rather than fetched on every page load: the feed then still
 * reads when the network is slow or a token is being renewed, and — the
 * reason that matters — the images are stored as our own copies, because the
 * CDN links Facebook hands over expire and a months-old feed of blank boxes
 * is worse than no feed.
 */
export const feedPosts = mysqlTable(
  "feed_posts",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    source: mysqlEnum("source", ["facebook", "instagram"]).notNull(),
    message: text("message"),
    permalink: varchar("permalink", { length: 1024 }),
    // Path to our stored copy of the image, not Facebook's expiring URL.
    imagePath: varchar("image_path", { length: 512 }),
    mediaType: varchar("media_type", { length: 32 }),
    likeCount: int("like_count").default(0),
    commentCount: int("comment_count").default(0),
    postedAt: timestamp("posted_at").notNull(),
    fetchedAt: timestamp("fetched_at").defaultNow(),
  },
  (t) => ({
    postedIdx: index("feed_posted_idx").on(t.postedAt),
  })
);

/**
 * Work the artists photograph at the end of a session.
 *
 * Reached by a QR code stuck on the wall — no login, no app, no account. An
 * artist points a phone at it, picks the photos, types their name, done. The
 * studio comes back later and pulls what it wants for marketing.
 *
 * Bytes live here rather than on disk because a hosted deploy's filesystem
 * doesn't survive a restart, and a month of work disappearing is not an
 * acceptable way to find that out.
 */
export const artistUploads = mysqlTable(
  "artist_uploads",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    artistName: varchar("artist_name", { length: 191 }),
    note: text("note"),
    contentType: varchar("content_type", { length: 128 }).notNull(),
    bytes: customType<{ data: Buffer; driverData: Buffer }>({
      dataType: () => "mediumblob",
    })("bytes").notNull(),
    // Set when the studio has taken this one for a post, so the grid can
    // show what's already been used without deleting anything.
    usedAt: timestamp("used_at"),
    // The auto-post (autopost.ts): null = not looked at yet, "working" while
    // the logo and caption are being made, "done" once it's in Posts,
    // "failed" with the reason beside it. Claimed atomically so a resend of
    // the same photo, or the safety sweep, can never make a second post.
    autoPostState: varchar("auto_post_state", { length: 16 }),
    autoPostAt: timestamp("auto_post_at"),
    autoPostError: varchar("auto_post_error", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    createdIdx: index("upload_created_idx").on(t.createdAt),
  })
);

/**
 * messageId carries a unique index. Facebook retries webhook deliveries,
 * so the insert is what stops us replying to the same message twice.
 */
export const messengerMessages = mysqlTable(
  "messenger_messages",
  {
    id: int("id").primaryKey().autoincrement(),
    conversationId: varchar("conversation_id", { length: 191 }).notNull(),
    messageId: varchar("message_id", { length: 191 }).notNull(),
    senderType: mysqlEnum("sender_type", ["customer", "bot", "manual"]).notNull(),
    content: text("content").notNull(),
    // Reference photos. A tattoo enquiry usually IS the picture, so the
    // dashboard has to show it — "(sent a photo)" is useless for quoting.
    attachmentUrls: json("attachment_urls").$type<string[]>(),
    autoReplyGenerated: boolean("auto_reply_generated").default(false),
    autoReplyContent: text("auto_reply_content"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    msgIdx: uniqueIndex("message_id_idx").on(t.messageId),
    convIdx: index("msg_conv_idx").on(t.conversationId),
  })
);

export const autoReplyRules = mysqlTable("auto_reply_rules", {
  id: int("id").primaryKey().autoincrement(),
  triggerKeywords: json("trigger_keywords").$type<string[]>().notNull(),
  responseText: text("response_text").notNull(),
  sendBookingLink: boolean("send_booking_link").default(false),
  isActive: boolean("is_active").default(true),
  priority: int("priority").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const scheduledPosts = mysqlTable("scheduled_posts", {
  id: int("id").primaryKey().autoincrement(),
  content: text("content").notNull(),
  imageUrl: varchar("image_url", { length: 1024 }),
  scheduledAt: timestamp("scheduled_at").notNull(),
  // "review" = made by the auto-post from an artist's upload and waiting for
  // the studio's OK. Only "scheduled" is ever published (getDuePosts), so a
  // post nobody approved cannot go out. "draft" is NOT that state — the
  // publisher uses it as its in-flight claim.
  status: mysqlEnum("status", ["draft", "scheduled", "published", "failed", "review"])
    .default("scheduled")
    .notNull(),
  aiGenerated: boolean("ai_generated").default(false),
  facebookPostId: varchar("facebook_post_id", { length: 191 }),
  lastError: text("last_error"),
  publishedAt: timestamp("published_at"),
  // The artist upload this post was made from, so removing it can hand the
  // photo back to the gallery as unused.
  uploadId: varchar("upload_id", { length: 64 }),
  // The 1080x1920 Instagram story made alongside the square post image. The
  // app can't publish stories; it's there to be saved and posted by hand.
  storyUrl: varchar("story_url", { length: 1024 }),
  // Where the photo sits in each picture (autopost.ts PostFraming, as JSON):
  // where sharp put it, or where the studio dragged it. Kept so a redraw
  // keeps a hand-placed position and the drag starts from the real one.
  framing: varchar("framing", { length: 255 }),
  // Which look the pictures were drawn in. A waiting post whose key isn't
  // the current one is redrawn by itself (autopost.ts redrawWaitingPosts).
  lookKey: varchar("look_key", { length: 32 }),
  createdAt: timestamp("created_at").defaultNow(),
});

/**
 * Where to send a notification, one row per device that asked for them.
 *
 * Brad is on a phone all day with his hands full, and the dashboard is a tab
 * he isn't looking at. The Messenger ping that existed before only reaches
 * him inside Facebook's 24-hour window, which closes exactly when a quiet
 * week means he hasn't messaged the Page — so it went silent precisely when
 * it mattered least and stayed silent when it mattered most.
 *
 * Keyed on a hash of the endpoint rather than the endpoint itself: push
 * endpoints run past what MySQL will index, and re-subscribing on the same
 * device should replace the row, not add a second one that double-buzzes.
 */
export const pushSubscriptions = mysqlTable("push_subscriptions", {
  id: varchar("id", { length: 64 }).primaryKey(),
  endpoint: text("endpoint").notNull(),
  p256dh: varchar("p256dh", { length: 255 }).notNull(),
  auth: varchar("auth", { length: 255 }).notNull(),
  /** "iPhone", "Studio iPad" — so a device can be turned off by name. */
  label: varchar("label", { length: 191 }),
  lastSentAt: timestamp("last_sent_at"),
  /** Consecutive failures. A dead endpoint is dropped rather than retried forever. */
  failures: int("failures").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

/**
 * Small, boring key/value store.
 *
 * Holds the VAPID keypair (generated once on first use, then never again —
 * regenerating it silently invalidates every subscription) and the
 * notification preferences. A separate table rather than more columns on
 * facebook_config, because none of this is Facebook's.
 */
/**
 * Follow-ups the app has already put up, so it never nags the same person
 * twice for the same reason.
 *
 * Claimed in the database rather than worked out from the messages, for the
 * same reason the notification slot is: the scan runs daily, the board is
 * re-read constantly, and "have we already done this one" has to survive a
 * restart and a redeploy. One row per conversation per kind.
 */
export const followUps = mysqlTable(
  "follow_ups",
  {
    id: int("id").primaryKey().autoincrement(),
    conversationId: varchar("conversation_id", { length: 191 }).notNull(),
    // "cold" — they went quiet on us. "aftercare" — three days post-tattoo.
    kind: varchar("kind", { length: 32 }).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    once: uniqueIndex("follow_ups_conversation_kind").on(table.conversationId, table.kind),
  })
);

export const appSettings = mysqlTable("app_settings", {
  name: varchar("name", { length: 64 }).primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

export const facebookConfig = mysqlTable("facebook_config", {
  id: int("id").primaryKey().autoincrement(),
  pageId: varchar("page_id", { length: 191 }).notNull(),
  pageName: varchar("page_name", { length: 255 }),
  pageAccessToken: text("page_access_token").notNull(),
  // Meta's newer Instagram flow issues a different kind of token from the
  // Page one, against a different host, and the two are not interchangeable.
  // Kept in its own column so pasting one can't wipe out the other and take
  // Messenger down with it. Optional: a Page token carrying the Instagram
  // permissions does the job on its own, and then this stays empty.
  instagramAccessToken: text("instagram_access_token"),
  // Which of Meta's two Instagram flows this token came from, so it gets sent
  // to the host that will accept it. "facebook" = a Page token carrying the
  // Instagram permissions (graph.facebook.com); "instagram" = a token from the
  // Instagram-login flow (graph.instagram.com). Guessing wrong is silent: the
  // wrong host simply refuses every call.
  instagramTokenHost: varchar("instagram_token_host", { length: 16 }),
  // Instagram signs its webhooks with the Instagram app's own secret, which is
  // a different value from the Facebook app secret even inside one Meta app.
  // Verifying Instagram deliveries with the Facebook secret refused every DM
  // the studio received, silently, for days.
  instagramAppSecret: varchar("instagram_app_secret", { length: 255 }),
  appId: varchar("app_id", { length: 191 }).notNull(),
  appSecret: varchar("app_secret", { length: 255 }).notNull(),
  webhookVerifyToken: varchar("webhook_verify_token", { length: 255 }).notNull(),
  isConfigured: boolean("is_configured").default(false),
  // Messenger PSID of the studio owner's own account. Set by sending
  // "set owner <verify token>" from that account — see agent.ts.
  ownerPsid: varchar("owner_psid", { length: 191 }),
  // When Facebook last delivered anything, and what. Stored rather than held
  // in memory: a module variable resets on every deploy, so the delivery panel
  // reported "nothing has ever arrived" minutes after a push and made a
  // healthy webhook look dead.
  lastDeliveryAt: timestamp("last_delivery_at"),
  lastDeliveryKind: varchar("last_delivery_kind", { length: 64 }),
  // Deliveries Facebook made that we threw away because the signature didn't
  // match. This is the worst possible failure — real customer messages
  // arriving and being binned — and it was completely silent: a 403 back to
  // Facebook, one line in a log nobody reads, and a dashboard showing zero
  // messages with every other panel green.
  lastRejectedAt: timestamp("last_rejected_at"),
  rejectedCount: int("rejected_count").default(0),
  // Why the last one was refused, in a form the settings page can show. The
  // same facts were going to the hosting logs, which is no use to the person
  // who can actually see this app.
  lastRejectionDetail: varchar("last_rejection_detail", { length: 255 }),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

export const timelyConfig = mysqlTable("timely_config", {
  id: int("id").primaryKey().autoincrement(),
  businessId: varchar("business_id", { length: 191 }),
  bookingPageUrl: varchar("booking_page_url", { length: 1024 }).notNull(),
  defaultServiceId: varchar("default_service_id", { length: 191 }),
  isConfigured: boolean("is_configured").default(false),
  // Google Calendar's private "secret address in iCal format". Timely syncs
  // into that calendar, so this is how the agent sees what's already booked
  // without needing Timely API credentials.
  calendarIcsUrl: varchar("calendar_ics_url", { length: 1024 }),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

/** Studio facts the agent answers from. Edit these in Settings, not in code. */
export const studioKnowledge = mysqlTable("studio_knowledge", {
  id: int("id").primaryKey().autoincrement(),
  question: varchar("question", { length: 512 }).notNull(),
  answer: text("answer").notNull(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

/**
 * AI-drafted replies wait here for Brad to approve, edit, or reject before
 * they go to the customer. Fixed answers he wrote himself in Auto-replies
 * don't go through this — he already approved that exact wording in advance.
 */
export const pendingReplies = mysqlTable(
  "pending_replies",
  {
    id: int("id").primaryKey().autoincrement(),
    conversationId: varchar("conversation_id", { length: 191 }).notNull(),
    customerMessageId: varchar("customer_message_id", { length: 191 }).notNull(),
    draftText: text("draft_text").notNull(),
    status: mysqlEnum("status", ["pending", "approved", "rejected"]).default("pending").notNull(),
    // Set when the customer raised something the agent shouldn't answer on
    // its own — illness, violence, grief, anything distressing. The draft is
    // only a holding line and the dashboard flags it for a person to read.
    isSensitive: boolean("is_sensitive").default(false),
    // Both mean "a person should handle this", but for opposite reasons, and
    // telling a customer's difficult message apart from our own outage
    // matters: one needs care, the other needs a key put back.
    llmFailed: boolean("llm_failed").default(false),
    // Other ways of answering the same message. The studio picks one instead
    // of rewriting the only draft it was handed.
    alternatives: json("alternatives").$type<{ label: string; text: string }[]>(),
    // Why the last attempt to send this one didn't reach the customer.
    //
    // Approving used to mark the draft resolved and only then try to send.
    // When Meta refused — routinely, because its standard messaging window
    // closes 24 hours after the customer's last message — the card vanished
    // from the board as though it had gone, and nobody found out that the
    // customer had never been answered. The draft comes back now, with this
    // on it.
    sendError: text("send_error"),
    createdAt: timestamp("created_at").defaultNow(),
    resolvedAt: timestamp("resolved_at"),
  },
  (t) => ({
    msgIdx: uniqueIndex("pending_msg_idx").on(t.customerMessageId),
    convIdx: index("pending_conv_idx").on(t.conversationId),
  })
);

/**
 * Real exchanges from the studio's exported Messenger history, imported
 * through the Training tab. The agent looks up the closest few of these
 * when drafting, so it answers new enquiries the way the studio already
 * answered similar ones.
 */
export const exampleExchanges = mysqlTable("example_exchanges", {
  id: int("id").primaryKey().autoincrement(),
  customerMessage: text("customer_message").notNull(),
  studioReply: text("studio_reply").notNull(),
  // Hash of the pair, so re-importing the same export doesn't duplicate.
  fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
  source: varchar("source", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
});

/**
 * What Brad changed a draft into before sending. These are the strongest
 * signal available — a direct before/after on this exact agent's output —
 * so recent ones are shown to the model as corrections to learn from.
 */
export const draftEdits = mysqlTable("draft_edits", {
  id: int("id").primaryKey().autoincrement(),
  customerMessage: text("customer_message"),
  draftText: text("draft_text").notNull(),
  sentText: text("sent_text").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
