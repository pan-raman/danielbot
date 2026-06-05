const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/shifts.db');

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
      status     TEXT NOT NULL DEFAULT 'approved',
      joined_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(shift_id, user_id),
      FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)  REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS shift_manual_participants (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_id   INTEGER NOT NULL,
      name       TEXT NOT NULL,
      added_by   INTEGER NOT NULL,
      added_at   TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE
    );
  `);

  // Migrations for existing databases
  const cols = db.pragma('table_info(shifts)').map(c => c.name);
  if (!cols.includes('lista'))             db.exec('ALTER TABLE shifts ADD COLUMN lista TEXT');
  if (!cols.includes('zbiorka'))           db.exec('ALTER TABLE shifts ADD COLUMN zbiorka TEXT');
  if (!cols.includes('for_gender'))        db.exec('ALTER TABLE shifts ADD COLUMN for_gender TEXT DEFAULT "all"');
  if (!cols.includes('zbiorka_contact'))   db.exec('ALTER TABLE shifts ADD COLUMN zbiorka_contact TEXT');
  if (!cols.includes('priority_filter'))   db.exec('ALTER TABLE shifts ADD COLUMN priority_filter TEXT');
  if (!cols.includes('stawka'))            db.exec('ALTER TABLE shifts ADD COLUMN stawka REAL');
  if (!cols.includes('role_filter'))       db.exec('ALTER TABLE shifts ADD COLUMN role_filter TEXT');

  const userCols = db.pragma('table_info(users)').map(c => c.name);
  if (!userCols.includes('gender'))        db.exec('ALTER TABLE users ADD COLUMN gender TEXT');
  if (!userCols.includes('reg_name'))      db.exec('ALTER TABLE users ADD COLUMN reg_name TEXT');
  if (!userCols.includes('reg_phone'))     db.exec('ALTER TABLE users ADD COLUMN reg_phone TEXT');
  if (!userCols.includes('reg_pesel'))     db.exec('ALTER TABLE users ADD COLUMN reg_pesel TEXT');
  if (!userCols.includes('priority'))      db.exec('ALTER TABLE users ADD COLUMN priority TEXT');
  if (!userCols.includes('role'))          db.exec('ALTER TABLE users ADD COLUMN role TEXT');
  if (!userCols.includes('stawka'))        db.exec('ALTER TABLE users ADD COLUMN stawka REAL');

  const spCols = db.pragma('table_info(shift_participants)').map(c => c.name);
  if (!spCols.includes('status'))        db.exec("ALTER TABLE shift_participants ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'");
  if (!spCols.includes('snap_name'))     db.exec('ALTER TABLE shift_participants ADD COLUMN snap_name TEXT');
  if (!spCols.includes('snap_phone'))    db.exec('ALTER TABLE shift_participants ADD COLUMN snap_phone TEXT');
  if (!spCols.includes('snap_pesel'))    db.exec('ALTER TABLE shift_participants ADD COLUMN snap_pesel TEXT');
  if (!spCols.includes('started_at'))       db.exec('ALTER TABLE shift_participants ADD COLUMN started_at TEXT');
  if (!spCols.includes('ended_at'))         db.exec('ALTER TABLE shift_participants ADD COLUMN ended_at TEXT');
  if (!spCols.includes('notified_start'))   db.exec('ALTER TABLE shift_participants ADD COLUMN notified_start INTEGER DEFAULT 0');
  if (!spCols.includes('notified_end'))     db.exec('ALTER TABLE shift_participants ADD COLUMN notified_end INTEGER DEFAULT 0');
}

module.exports = { getDb };
