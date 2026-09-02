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

export const users = mysqlTable("users", {
  id: int("id").primaryKey().autoincrement(),
  openId: varchar("open_id", { length: 191 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 255 }),
  loginMethod: varchar("login_method", { length: 64 }),
  role: varchar("role", { length: 32 }).default("user"),
  lastSignedIn: timestamp("last_signed_in"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type InsertUser = typeof users.$inferInsert;

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
  status: mysqlEnum("status", ["draft", "scheduled", "published", "failed"])
    .default("scheduled")
    .notNull(),
  aiGenerated: boolean("ai_generated").default(false),
  facebookPostId: varchar("facebook_post_id", { length: 191 }),
  lastError: text("last_error"),
  publishedAt: timestamp("published_at"),
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
