import { sql } from "drizzle-orm";
import { getDb } from "./db.js";

/**
 * Creates the tables if they aren't there yet.
 *
 * `npm run db:push` does this too, but it needs drizzle-kit and a terminal.
 * On a hosted deploy nobody gets a terminal, so the first save from Settings
 * failed against an empty database. Every statement is IF NOT EXISTS, so this
 * is safe to run on every boot and does nothing once the tables exist.
 */
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    open_id VARCHAR(191) NOT NULL,
    name VARCHAR(255),
    email VARCHAR(255),
    login_method VARCHAR(64),
    role VARCHAR(32) DEFAULT 'user',
    last_signed_in TIMESTAMP NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY users_open_id_unique (open_id)
  )`,

  `CREATE TABLE IF NOT EXISTS messenger_conversations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    conversation_id VARCHAR(191) NOT NULL,
    sender_name VARCHAR(255),
    sender_email VARCHAR(255),
    bot_paused_until TIMESTAMP NULL,
    last_customer_message_at TIMESTAMP NULL,
    last_message_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    booking_name VARCHAR(255),
    booking_phone VARCHAR(64),
    booking_dates VARCHAR(255),
    booking_photo_urls JSON,
    booking_notified_at TIMESTAMP NULL,
    UNIQUE KEY conv_id_idx (conversation_id)
  )`,

  `CREATE TABLE IF NOT EXISTS messenger_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    conversation_id VARCHAR(191) NOT NULL,
    message_id VARCHAR(191) NOT NULL,
    sender_type ENUM('customer','bot','manual') NOT NULL,
    content TEXT NOT NULL,
    auto_reply_generated BOOLEAN DEFAULT FALSE,
    auto_reply_content TEXT,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY message_id_idx (message_id),
    KEY msg_conv_idx (conversation_id)
  )`,

  `CREATE TABLE IF NOT EXISTS auto_reply_rules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    trigger_keywords JSON NOT NULL,
    response_text TEXT NOT NULL,
    send_booking_link BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    priority INT DEFAULT 0,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS scheduled_posts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    content TEXT NOT NULL,
    image_url VARCHAR(1024),
    scheduled_at TIMESTAMP NOT NULL,
    status ENUM('draft','scheduled','published','failed') NOT NULL DEFAULT 'scheduled',
    ai_generated BOOLEAN DEFAULT FALSE,
    facebook_post_id VARCHAR(191),
    last_error TEXT,
    published_at TIMESTAMP NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS facebook_config (
    id INT AUTO_INCREMENT PRIMARY KEY,
    page_id VARCHAR(191) NOT NULL,
    page_name VARCHAR(255),
    page_access_token TEXT NOT NULL,
    app_id VARCHAR(191) NOT NULL,
    app_secret VARCHAR(255) NOT NULL,
    webhook_verify_token VARCHAR(255) NOT NULL,
    is_configured BOOLEAN DEFAULT FALSE,
    owner_psid VARCHAR(191),
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS timely_config (
    id INT AUTO_INCREMENT PRIMARY KEY,
    business_id VARCHAR(191),
    booking_page_url VARCHAR(1024) NOT NULL,
    default_service_id VARCHAR(191),
    is_configured BOOLEAN DEFAULT FALSE,
    calendar_ics_url VARCHAR(1024),
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS studio_knowledge (
    id INT AUTO_INCREMENT PRIMARY KEY,
    question VARCHAR(512) NOT NULL,
    answer TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS pending_replies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    conversation_id VARCHAR(191) NOT NULL,
    customer_message_id VARCHAR(191) NOT NULL,
    draft_text TEXT NOT NULL,
    status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
    is_sensitive BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP NULL,
    UNIQUE KEY pending_msg_idx (customer_message_id),
    KEY pending_conv_idx (conversation_id)
  )`,

  `CREATE TABLE IF NOT EXISTS message_attachments (
    id VARCHAR(64) PRIMARY KEY,
    conversation_id VARCHAR(191) NOT NULL,
    message_id VARCHAR(191) NOT NULL,
    content_type VARCHAR(128) NOT NULL,
    bytes MEDIUMBLOB NOT NULL,
    source_url TEXT,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    KEY att_conv_idx (conversation_id),
    KEY att_msg_idx (message_id)
  )`,

  `CREATE TABLE IF NOT EXISTS feed_posts (
    id VARCHAR(191) PRIMARY KEY,
    source ENUM('facebook','instagram') NOT NULL,
    message TEXT,
    permalink VARCHAR(1024),
    image_path VARCHAR(512),
    media_type VARCHAR(32),
    like_count INT DEFAULT 0,
    comment_count INT DEFAULT 0,
    posted_at TIMESTAMP NOT NULL,
    fetched_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    KEY feed_posted_idx (posted_at)
  )`,

  `CREATE TABLE IF NOT EXISTS artist_uploads (
    id VARCHAR(64) PRIMARY KEY,
    artist_name VARCHAR(191),
    note TEXT,
    content_type VARCHAR(128) NOT NULL,
    bytes MEDIUMBLOB NOT NULL,
    used_at TIMESTAMP NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    KEY upload_created_idx (created_at)
  )`,

  `CREATE TABLE IF NOT EXISTS example_exchanges (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_message TEXT NOT NULL,
    studio_reply TEXT NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    source VARCHAR(255),
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY example_fingerprint_idx (fingerprint),
    FULLTEXT KEY example_search_idx (customer_message)
  )`,

  `CREATE TABLE IF NOT EXISTS draft_edits (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_message TEXT,
    draft_text TEXT NOT NULL,
    sent_text TEXT NOT NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
  )`,
];

/**
 * Columns added after a table already existed on a live deploy. `CREATE
 * TABLE IF NOT EXISTS` above only helps a brand new database — Brad's
 * Railway database already has these tables from the first deploy, so new
 * columns need an explicit ALTER. Checked against information_schema first
 * because MySQL's `ADD COLUMN IF NOT EXISTS` support is version-dependent.
 */
const COLUMNS: Array<{ table: string; column: string; ddl: string }> = [
  { table: "messenger_conversations", column: "booking_name", ddl: "VARCHAR(255)" },
  { table: "messenger_conversations", column: "booking_phone", ddl: "VARCHAR(64)" },
  { table: "messenger_conversations", column: "booking_dates", ddl: "VARCHAR(255)" },
  { table: "messenger_conversations", column: "booking_photo_urls", ddl: "JSON" },
  { table: "messenger_conversations", column: "booking_notified_at", ddl: "TIMESTAMP NULL" },
  { table: "facebook_config", column: "owner_psid", ddl: "VARCHAR(191)" },
  { table: "timely_config", column: "calendar_ics_url", ddl: "VARCHAR(1024)" },
  { table: "pending_replies", column: "is_sensitive", ddl: "BOOLEAN DEFAULT FALSE" },
  { table: "messenger_messages", column: "attachment_urls", ddl: "JSON" },
  { table: "pending_replies", column: "alternatives", ddl: "JSON" },
  { table: "pending_replies", column: "llm_failed", ddl: "BOOLEAN DEFAULT FALSE" },
  { table: "facebook_config", column: "instagram_access_token", ddl: "TEXT" },
  // Kept in the database, not in memory. Held in a module variable it reset on
  // every deploy, so the delivery panel said "nothing has ever arrived" minutes
  // after a push — which reads as a dead webhook when nothing is wrong at all.
  { table: "facebook_config", column: "instagram_token_host", ddl: "VARCHAR(16)" },
  { table: "facebook_config", column: "last_delivery_at", ddl: "TIMESTAMP NULL" },
  { table: "facebook_config", column: "last_delivery_kind", ddl: "VARCHAR(64)" },
  {
    table: "messenger_conversations",
    column: "platform",
    ddl: "ENUM('facebook','instagram') DEFAULT 'facebook'",
  },
];

async function ensureColumns(): Promise<void> {
  const db = await getDb();
  for (const { table, column, ddl } of COLUMNS) {
    const [rows] = (await db.execute(
      sql.raw(
        `SELECT COUNT(*) AS cnt FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = '${table}' AND column_name = '${column}'`
      )
    )) as unknown as [Array<{ cnt: number }>];
    if (Number(rows[0]?.cnt) === 0) {
      await db.execute(sql.raw(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`));
      console.log(`[DB] Added column ${table}.${column}`);
    }
  }
}

/**
 * Drafts written while the AI was unreachable were stored with is_sensitive
 * set, because one flag stood for both "this customer needs care" and "we
 * couldn't reach the model". So an ordinary question about wait times came up
 * on the board under "They've raised something personal". The flags are
 * separate now, but the rows already waiting still carry the old meaning —
 * this moves them across, once, by the placeholder text they were given.
 */
async function repairFailedDrafts(): Promise<void> {
  const db = await getDb();
  const [result] = (await db.execute(
    sql.raw(
      `UPDATE pending_replies
          SET llm_failed = TRUE, is_sensitive = FALSE, draft_text = ''
        WHERE draft_text LIKE '[The AI couldn%'`
    )
  )) as unknown as [{ affectedRows?: number }];
  const moved = Number(result?.affectedRows ?? 0);
  if (moved) console.log(`[DB] Re-flagged ${moved} draft(s) the AI never wrote`);
}

/**
 * Threads stored under Meta's placeholder name.
 *
 * "Facebook user" is what Meta returns when the app can't read someone's
 * profile. It was being kept as a real name, which meant the thread looked
 * named, the backfill skipped it, and the studio was stuck greeting several
 * different people as "Facebook user" with no way to correct it. Clearing it
 * puts them back in the queue the Fetch customer names button works from.
 */
async function clearPlaceholderNames(): Promise<void> {
  const db = await getDb();
  const [result] = (await db.execute(
    sql.raw(
      `UPDATE messenger_conversations
          SET sender_name = NULL
        WHERE sender_name REGEXP '^[[:space:]]*(Facebook|Instagram|Messenger)[[:space:]]+[Uu]ser[[:space:]]*$'`
    )
  )) as unknown as [{ affectedRows?: number }];
  const cleared = Number(result?.affectedRows ?? 0);
  if (cleared) console.log(`[DB] Cleared ${cleared} placeholder name(s) — they can be looked up now`);
}

/**
 * Put the thread clocks back where they belong.
 *
 * Importing stamped every conversation with the time of the import, so a
 * hundred threads spanning months all read the same age and the inbox order
 * became meaningless — which is what made it look as though everything was
 * being re-imported on every press. The real time is still there, in the
 * messages themselves, so it can simply be recomputed.
 */
async function repairConversationClocks(): Promise<void> {
  const db = await getDb();
  const [result] = (await db.execute(
    sql.raw(
      `UPDATE messenger_conversations c
          JOIN (
            SELECT conversation_id,
                   MAX(created_at) AS newest,
                   MAX(CASE WHEN sender_type = 'customer' THEN created_at END) AS newest_customer
              FROM messenger_messages
             GROUP BY conversation_id
          ) m ON m.conversation_id = c.conversation_id
           SET c.last_message_at = m.newest,
               c.last_customer_message_at = COALESCE(m.newest_customer, c.last_customer_message_at)
         WHERE m.newest IS NOT NULL
           AND (c.last_message_at IS NULL OR c.last_message_at <> m.newest)`
    )
  )) as unknown as [{ affectedRows?: number }];
  const fixed = Number(result?.affectedRows ?? 0);
  if (fixed) console.log(`[DB] Put ${fixed} thread clock(s) back to when the messages actually arrived`);
}

/**
 * Drafts written against something the studio itself said.
 *
 * Threads imported before the sender attribution was fixed have the studio's
 * own replies recorded as the customer's, and the agent duly drafted answers
 * to them — Brad opened the board and found replies to his own sentences.
 * Those are never worth approving, so they go on boot rather than waiting for
 * anyone to notice and press something.
 */
async function dropDraftsAnsweringOurselves(): Promise<void> {
  const db = await getDb();
  const [result] = (await db.execute(
    sql.raw(
      `DELETE p FROM pending_replies p
         JOIN messenger_messages m ON m.message_id = p.customer_message_id
        WHERE p.status = 'pending' AND m.sender_type <> 'customer'`
    )
  )) as unknown as [{ affectedRows?: number }];
  const dropped = Number(result?.affectedRows ?? 0);
  if (dropped) console.log(`[DB] Removed ${dropped} draft(s) that were answering the studio's own words`);
}

export async function ensureTables(): Promise<void> {
  const db = await getDb();
  for (const statement of STATEMENTS) {
    await db.execute(sql.raw(statement));
  }
  await ensureColumns();
  await repairFailedDrafts();
  await clearPlaceholderNames();
  await repairConversationClocks();
  await dropDraftsAnsweringOurselves();
  console.log(`[DB] Schema ready (${STATEMENTS.length} tables checked)`);
}
