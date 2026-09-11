'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { SERVICES } = require('./servicesCatalog');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'crm.sqlite');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_phone TEXT NOT NULL UNIQUE,
    profile_name TEXT,
    last_message_at TEXT NOT NULL,
    unread_inbound INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
    body TEXT NOT NULL,
    twilio_sid TEXT UNIQUE,
    status TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
`);

(function migrateMessages() {
  const cols = db.prepare('PRAGMA table_info(messages)').all();
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('message_type')) {
    db.exec(`ALTER TABLE messages ADD COLUMN message_type TEXT DEFAULT 'text'`);
  }
  if (!names.has('attachments')) {
    db.exec(`ALTER TABLE messages ADD COLUMN attachments TEXT`);
  }
})();

(function migrateConversationsLabel() {
  const cols = db.prepare('PRAGMA table_info(conversations)').all();
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('pipeline_label')) {
    db.exec(`ALTER TABLE conversations ADD COLUMN pipeline_label TEXT`);
  }
  if (!names.has('profile_avatar_url')) {
    db.exec(`ALTER TABLE conversations ADD COLUMN profile_avatar_url TEXT`);
  }
  if (!names.has('bot_paused')) {
    db.exec(
      `ALTER TABLE conversations ADD COLUMN bot_paused INTEGER NOT NULL DEFAULT 0`
    );
  }
  if (!names.has('conv_status')) {
    db.exec(
      `ALTER TABLE conversations ADD COLUMN conv_status TEXT NOT NULL DEFAULT 'inbox'`
    );
  }
  if (!names.has('negotiation_started_at')) {
    db.exec(`ALTER TABLE conversations ADD COLUMN negotiation_started_at TEXT`);
  }
})();

(function migrateConversationProfile() {
  const cols = db.prepare('PRAGMA table_info(conversations)').all();
  const names = new Set(cols.map((c) => c.name));
  const additions = [
    ['lead_name', 'TEXT'],
    ['company_name', 'TEXT'],
    ['lead_source', 'TEXT'],
    ['city', 'TEXT'],
    ['priority', `TEXT NOT NULL DEFAULT 'normal'`],
    ['budget_label', 'TEXT'],
    ['budget_value', 'REAL'],
    ['internal_notes', 'TEXT'],
    ['lost_reason', 'TEXT'],
    ['next_follow_up_at', 'TEXT'],
    ['last_inbound_at', 'TEXT'],
    ['last_outbound_at', 'TEXT'],
    ['last_summary', 'TEXT'],
    ['last_summary_updated_at', 'TEXT'],
    ['handoff_summary', 'TEXT'],
    ['handoff_summary_updated_at', 'TEXT']
  ];
  for (const [name, ddl] of additions) {
    if (!names.has(name)) {
      db.exec(`ALTER TABLE conversations ADD COLUMN ${name} ${ddl}`);
    }
  }
})();

(function migrateCrmEvents() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      customer_phone TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_crm_events_conv ON crm_events(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_crm_events_phone ON crm_events(customer_phone);
  `);
})();

(function migrateFollowUps() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS follow_ups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      customer_phone TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      due_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','done','canceled')),
      kind TEXT NOT NULL DEFAULT 'manual',
      assigned_advisor_id INTEGER REFERENCES advisors(id) ON DELETE SET NULL,
      created_by TEXT NOT NULL DEFAULT 'system',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      done_at TEXT,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_follow_ups_conv
      ON follow_ups(conversation_id, status, due_at);
    CREATE INDEX IF NOT EXISTS idx_follow_ups_phone
      ON follow_ups(customer_phone, status, due_at);
    CREATE INDEX IF NOT EXISTS idx_follow_ups_assigned
      ON follow_ups(assigned_advisor_id, status, due_at);
  `);
})();

(function migrateAdvisors() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS advisors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_advisors_active_sort
      ON advisors(is_active, sort_order, full_name);
  `);
})();

(function migrateAdvisorPortal() {
  const convCols = db.prepare('PRAGMA table_info(conversations)').all();
  const convNames = new Set(convCols.map((c) => c.name));
  if (!convNames.has('assigned_advisor_id')) {
    db.exec(
      `ALTER TABLE conversations ADD COLUMN assigned_advisor_id INTEGER REFERENCES advisors(id) ON DELETE SET NULL`
    );
  }
  const advCols = db.prepare('PRAGMA table_info(advisors)').all();
  const advNames = new Set(advCols.map((c) => c.name));
  if (!advNames.has('password_hash')) {
    db.exec(`ALTER TABLE advisors ADD COLUMN password_hash TEXT`);
  }
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_conversations_assigned_advisor ON conversations(assigned_advisor_id)`
  );
})();

(function migrateServices() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      summary TEXT NOT NULL,
      keywords TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversation_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_phone TEXT NOT NULL,
      service_id INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual'
        CHECK(source IN ('manual','keyword')),
      notes TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
      UNIQUE(customer_phone, service_id)
    );

    CREATE INDEX IF NOT EXISTS idx_conversation_services_phone
      ON conversation_services(customer_phone);
    CREATE INDEX IF NOT EXISTS idx_services_active_sort
      ON services(is_active, sort_order);
  `);

  const svcCols = db.prepare('PRAGMA table_info(services)').all();
  const svcNames = new Set(svcCols.map((c) => c.name));
  if (!svcNames.has('category')) {
    db.exec(`ALTER TABLE services ADD COLUMN category TEXT`);
  }

  const now = new Date().toISOString();
  const ins = db.prepare(`
    INSERT INTO services (slug, name, summary, keywords, sort_order, category, is_active, created_at)
    VALUES (@slug, @name, @summary, @keywords, @sort_order, @category, 1, @created_at)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name,
      summary = excluded.summary,
      keywords = excluded.keywords,
      sort_order = excluded.sort_order,
      category = excluded.category,
      is_active = excluded.is_active
  `);

  for (const s of SERVICES) {
    ins.run({
      slug: s.slug,
      name: s.name,
      summary: s.summary,
      keywords: JSON.stringify(s.keywords || []),
      sort_order: s.sort_order,
      category: s.category || null,
      created_at: now
    });
  }
})();

function normalizeCustomerPhone(fromField) {
  const s = String(fromField || '').trim();
  const m = s.match(/whatsapp:(\+?\d+)/i);
  const digits = (m ? m[1] : s).replace(/\D/g, '');
  return digits || null;
}

module.exports = { db, normalizeCustomerPhone };
