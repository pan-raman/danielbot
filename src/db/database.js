const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../data/shifts.db');

let db;

function getDb() {
  if (!db) {
    const fs = require('fs');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);
  }
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY,
      username    TEXT,
      first_name  TEXT,
      last_name   TEXT,
      is_admin    INTEGER NOT NULL DEFAULT 0,
      is_banned   INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS shifts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      date          TEXT NOT NULL,
      location      TEXT NOT NULL,
      dress_code    TEXT NOT NULL,
      start_time    TEXT NOT NULL,
      end_time      TEXT NOT NULL,
      required      INTEGER NOT NULL DEFAULT 1,
      lista         TEXT,
      zbiorka       TEXT,
      chat_id       INTEGER,
      message_id    INTEGER,
      created_by    INTEGER NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shift_participants (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_id   INTEGER NOT NULL,
      user_id    INTEGER NOT NULL,
      joined_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(shift_id, user_id),
      FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)  REFERENCES users(id)
    );
  `);

  // Migrations for existing databases
  const cols = db.pragma('table_info(shifts)').map(c => c.name);
  if (!cols.includes('lista'))      db.exec('ALTER TABLE shifts ADD COLUMN lista TEXT');
  if (!cols.includes('zbiorka'))    db.exec('ALTER TABLE shifts ADD COLUMN zbiorka TEXT');
  if (!cols.includes('for_gender')) db.exec('ALTER TABLE shifts ADD COLUMN for_gender TEXT DEFAULT "all"');

  const userCols = db.pragma('table_info(users)').map(c => c.name);
  if (!userCols.includes('gender')) db.exec('ALTER TABLE users ADD COLUMN gender TEXT');
}

module.exports = { getDb };
