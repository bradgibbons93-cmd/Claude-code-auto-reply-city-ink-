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
    botPausedUntil: timestamp("bot_paused_until"),
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
  },
  (t) => ({
    convIdx: uniqueIndex("conv_id_idx").on(t.conversationId),
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

export const facebookConfig = mysqlTable("facebook_config", {
  id: int("id").primaryKey().autoincrement(),
  pageId: varchar("page_id", { length: 191 }).notNull(),
  pageName: varchar("page_name", { length: 255 }),
  pageAccessToken: text("page_access_token").notNull(),
  appId: varchar("app_id", { length: 191 }).notNull(),
  appSecret: varchar("app_secret", { length: 255 }).notNull(),
  webhookVerifyToken: varchar("webhook_verify_token", { length: 255 }).notNull(),
  isConfigured: boolean("is_configured").default(false),
  // Messenger PSID of the studio owner's own account. Set by sending
  // "set owner <verify token>" from that account — see agent.ts.
  ownerPsid: varchar("owner_psid", { length: 191 }),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

export const timelyConfig = mysqlTable("timely_config", {
  id: int("id").primaryKey().autoincrement(),
  businessId: varchar("business_id", { length: 191 }),
  bookingPageUrl: varchar("booking_page_url", { length: 1024 }).notNull(),
  defaultServiceId: varchar("default_service_id", { length: 191 }),
  isConfigured: boolean("is_configured").default(false),
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
