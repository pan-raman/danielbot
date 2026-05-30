const { getDb } = require('./database');

// ── Users ──────────────────────────────────────────────────────────────────

function upsertUser(tgUser) {
  const db = getDb();
  db.prepare(`
    INSERT INTO users (id, username, first_name, last_name)
    VALUES (@id, @username, @first_name, @last_name)
    ON CONFLICT(id) DO UPDATE SET
      username   = excluded.username,
      first_name = excluded.first_name,
      last_name  = excluded.last_name
  `).run({
    id:         tgUser.id,
    username:   tgUser.username   || null,
    first_name: tgUser.first_name || null,
    last_name:  tgUser.last_name  || null,
  });
}

function getUser(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function isAdmin(userId) {
  const envAdmins = (process.env.ADMIN_IDS || '')
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(Boolean);
  if (envAdmins.includes(userId)) return true;
  const row = getDb().prepare('SELECT is_admin FROM users WHERE id = ?').get(userId);
  return row ? row.is_admin === 1 : false;
}

function isBanned(userId) {
  const row = getDb().prepare('SELECT is_banned FROM users WHERE id = ?').get(userId);
  return row ? row.is_banned === 1 : false;
}

function setBanned(userId, banned) {
  getDb().prepare('UPDATE users SET is_banned = ? WHERE id = ?').run(banned ? 1 : 0, userId);
}

function setAdmin(userId, admin) {
  getDb().prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(admin ? 1 : 0, userId);
}

function setGender(userId, gender) {
  getDb().prepare('UPDATE users SET gender = ? WHERE id = ?').run(gender, userId);
}

function getGender(userId) {
  const row = getDb().prepare('SELECT gender FROM users WHERE id = ?').get(userId);
  return row ? row.gender : null;
}

function getAllUsers() {
  return getDb().prepare('SELECT * FROM users ORDER BY created_at DESC').all();
}

// ── Shifts ─────────────────────────────────────────────────────────────────

function createShift(data) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO shifts (date, location, dress_code, start_time, end_time, required, lista, zbiorka, for_gender, created_by)
    VALUES (@date, @location, @dress_code, @start_time, @end_time, @required, @lista, @zbiorka, @for_gender, @created_by)
  `).run({ lista: null, zbiorka: null, for_gender: 'all', ...data });
  return result.lastInsertRowid;
}

function getShift(id) {
  return getDb().prepare('SELECT * FROM shifts WHERE id = ?').get(id);
}

function getAllShifts() {
  return getDb().prepare('SELECT * FROM shifts ORDER BY date ASC, start_time ASC').all();
}

function updateShift(id, data) {
  const fields = Object.keys(data).map(k => `${k} = @${k}`).join(', ');
  getDb().prepare(`UPDATE shifts SET ${fields} WHERE id = @id`).run({ ...data, id });
}

function deleteShift(id) {
  getDb().prepare('DELETE FROM shifts WHERE id = ?').run(id);
}

function setShiftMessage(shiftId, chatId, messageId) {
  getDb().prepare('UPDATE shifts SET chat_id = ?, message_id = ? WHERE id = ?')
    .run(chatId, messageId, shiftId);
}

// ── Participants ────────────────────────────────────────────────────────────

function joinShift(shiftId, userId) {
  const db = getDb();
  const shift = getShift(shiftId);
  if (!shift) return { ok: false, reason: 'not_found' };

  // Gender check
  const forGender = shift.for_gender || 'all';
  if (forGender !== 'all') {
    const user = getUser(userId);
    if (!user || !user.gender) return { ok: false, reason: 'no_gender' };
    if (user.gender !== forGender) return { ok: false, reason: 'wrong_gender' };
  }

  const count = db.prepare(
    'SELECT COUNT(*) AS n FROM shift_participants WHERE shift_id = ?'
  ).get(shiftId).n;
  if (count >= shift.required) return { ok: false, reason: 'full' };

  try {
    db.prepare(
      'INSERT INTO shift_participants (shift_id, user_id) VALUES (?, ?)'
    ).run(shiftId, userId);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'already_joined' };
  }
}

function leaveShift(shiftId, userId) {
  const result = getDb().prepare(
    'DELETE FROM shift_participants WHERE shift_id = ? AND user_id = ?'
  ).run(shiftId, userId);
  return result.changes > 0;
}

function getParticipants(shiftId) {
  return getDb().prepare(`
    SELECT u.id, u.username, u.first_name, u.last_name
    FROM shift_participants sp
    JOIN users u ON u.id = sp.user_id
    WHERE sp.shift_id = ?
    ORDER BY sp.joined_at ASC
  `).all(shiftId);
}

function isParticipant(shiftId, userId) {
  const row = getDb().prepare(
    'SELECT 1 FROM shift_participants WHERE shift_id = ? AND user_id = ?'
  ).get(shiftId, userId);
  return !!row;
}

// ── Upcoming shifts for reminders ──────────────────────────────────────────

function getShiftsStartingAt(targetDatetime) {
  // targetDatetime: 'YYYY-MM-DD HH:MM'
  const [date, time] = targetDatetime.split(' ');
  return getDb().prepare(`
    SELECT s.*, GROUP_CONCAT(sp.user_id) AS participant_ids
    FROM shifts s
    LEFT JOIN shift_participants sp ON sp.shift_id = s.id
    WHERE s.date = ? AND s.start_time = ?
    GROUP BY s.id
  `).all(date, time);
}

// ── Settings ────────────────────────────────────────────────────────────────

function getSetting(key) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  getDb().prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

module.exports = {
  upsertUser, getUser, isAdmin, isBanned, setBanned, setAdmin, getAllUsers,
  setGender, getGender,
  createShift, getShift, getAllShifts, updateShift, deleteShift, setShiftMessage,
  joinShift, leaveShift, getParticipants, isParticipant,
  getShiftsStartingAt,
  getSetting, setSetting,
};
