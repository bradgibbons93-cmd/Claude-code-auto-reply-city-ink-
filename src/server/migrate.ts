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
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS studio_knowledge (
    id INT AUTO_INCREMENT PRIMARY KEY,
    question VARCHAR(512) NOT NULL,
    answer TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
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

export async function ensureTables(): Promise<void> {
  const db = await getDb();
  for (const statement of STATEMENTS) {
    await db.execute(sql.raw(statement));
  }
  await ensureColumns();
  console.log(`[DB] Schema ready (${STATEMENTS.length} tables checked)`);
}
