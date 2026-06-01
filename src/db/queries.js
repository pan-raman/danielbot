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

function setPriority(userId, priority) {
  getDb().prepare('UPDATE users SET priority = ? WHERE id = ?').run(priority, userId);
}

function setRegistration(userId, { reg_name, reg_phone, reg_pesel, gender }) {
  getDb().prepare(
    'UPDATE users SET reg_name = ?, reg_phone = ?, reg_pesel = ?, gender = ? WHERE id = ?'
  ).run(reg_name, reg_phone, reg_pesel, gender, userId);
}

function isRegistered(userId) {
  const row = getDb().prepare('SELECT reg_name, gender FROM users WHERE id = ?').get(userId);
  return !!(row && row.reg_name && row.gender);
}

function getAllAdminIds() {
  const envAdmins = (process.env.ADMIN_IDS || '')
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(Boolean);
  const dbAdmins = getDb().prepare('SELECT id FROM users WHERE is_admin = 1').all().map(r => r.id);
  return [...new Set([...envAdmins, ...dbAdmins])];
}

// ── Shifts ─────────────────────────────────────────────────────────────────

function createShift(data) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO shifts (date, location, dress_code, start_time, end_time, required, lista, zbiorka, zbiorka_contact, for_gender, priority_filter, created_by)
    VALUES (@date, @location, @dress_code, @start_time, @end_time, @required, @lista, @zbiorka, @zbiorka_contact, @for_gender, @priority_filter, @created_by)
  `).run({ lista: null, zbiorka: null, zbiorka_contact: null, for_gender: 'all', priority_filter: null, ...data });
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

  const user = getUser(userId);

  // Gender check
  const forGender = shift.for_gender || 'all';
  if (forGender !== 'all') {
    if (!user || !user.gender) return { ok: false, reason: 'no_gender' };
    if (user.gender !== forGender) return { ok: false, reason: 'wrong_gender' };
  }

  // Priority check
  if (shift.priority_filter) {
    const allowed = shift.priority_filter.split(',');
    if (!user?.priority || !allowed.includes(user.priority)) {
      return { ok: false, reason: 'wrong_priority' };
    }
  }

  // Check if already has any status (pending, approved, rejected)
  const existing = db.prepare(
    'SELECT status FROM shift_participants WHERE shift_id = ? AND user_id = ?'
  ).get(shiftId, userId);

  if (existing) {
    if (existing.status === 'rejected') return { ok: false, reason: 'rejected' };
    return { ok: false, reason: 'already_joined' };
  }

  // Count only approved participants toward the limit
  const count = db.prepare(
    "SELECT COUNT(*) AS n FROM shift_participants WHERE shift_id = ? AND status = 'approved'"
  ).get(shiftId).n;
  if (count >= shift.required) return { ok: false, reason: 'full' };

  db.prepare(
    "INSERT INTO shift_participants (shift_id, user_id, status, snap_name, snap_phone, snap_pesel) VALUES (?, ?, 'pending', ?, ?, ?)"
  ).run(shiftId, userId, user?.reg_name || null, user?.reg_phone || null, user?.reg_pesel || null);

  return { ok: true };
}

function approveParticipant(shiftId, userId) {
  const db = getDb();
  const shift = getShift(shiftId);
  if (!shift) return { ok: false, reason: 'not_found' };

  // Re-check capacity before approving
  const count = db.prepare(
    "SELECT COUNT(*) AS n FROM shift_participants WHERE shift_id = ? AND status = 'approved'"
  ).get(shiftId).n;
  if (count >= shift.required) return { ok: false, reason: 'full' };

  db.prepare(
    "UPDATE shift_participants SET status = 'approved' WHERE shift_id = ? AND user_id = ?"
  ).run(shiftId, userId);
  return { ok: true };
}

function rejectParticipant(shiftId, userId) {
  getDb().prepare(
    "UPDATE shift_participants SET status = 'rejected' WHERE shift_id = ? AND user_id = ?"
  ).run(shiftId, userId);
}

function leaveShift(shiftId, userId) {
  const result = getDb().prepare(
    'DELETE FROM shift_participants WHERE shift_id = ? AND user_id = ?'
  ).run(shiftId, userId);
  return result.changes > 0;
}

// Only approved participants shown in the public post
function getParticipants(shiftId) {
  return getDb().prepare(`
    SELECT u.id, u.username, u.first_name, u.last_name, u.reg_name,
           sp.snap_name, sp.snap_phone, sp.snap_pesel,
           sp.started_at, sp.ended_at
    FROM shift_participants sp
    JOIN users u ON u.id = sp.user_id
    WHERE sp.shift_id = ? AND sp.status = 'approved'
    ORDER BY sp.joined_at ASC
  `).all(shiftId);
}

function markShiftStarted(shiftId, userId, time) {
  getDb().prepare(
    "UPDATE shift_participants SET started_at = ? WHERE shift_id = ? AND user_id = ? AND status = 'approved'"
  ).run(time, shiftId, userId);
}

function markShiftEnded(shiftId, userId, time) {
  getDb().prepare(
    "UPDATE shift_participants SET ended_at = ? WHERE shift_id = ? AND user_id = ? AND status = 'approved'"
  ).run(time, shiftId, userId);
}

function getParticipantRow(shiftId, userId) {
  return getDb().prepare(
    'SELECT * FROM shift_participants WHERE shift_id = ? AND user_id = ?'
  ).get(shiftId, userId);
}

function isParticipant(shiftId, userId) {
  const row = getDb().prepare(
    "SELECT 1 FROM shift_participants WHERE shift_id = ? AND user_id = ? AND status = 'approved'"
  ).get(shiftId, userId);
  return !!row;
}

function getParticipantStatus(shiftId, userId) {
  const row = getDb().prepare(
    'SELECT status FROM shift_participants WHERE shift_id = ? AND user_id = ?'
  ).get(shiftId, userId);
  return row ? row.status : null;
}

// ── Upcoming shifts for reminders ──────────────────────────────────────────

function getShiftsStartingAt(targetDatetime) {
  const [date, time] = targetDatetime.split(' ');
  return getDb().prepare(`
    SELECT s.*, GROUP_CONCAT(sp.user_id) AS participant_ids
    FROM shifts s
    LEFT JOIN shift_participants sp ON sp.shift_id = s.id AND sp.status = 'approved'
    WHERE s.date = ? AND s.start_time = ?
    GROUP BY s.id
  `).all(date, time);
}

// ── Manual participants ─────────────────────────────────────────────────────

function addManualParticipant(shiftId, name, addedBy) {
  const result = getDb().prepare(
    'INSERT INTO shift_manual_participants (shift_id, name, added_by) VALUES (?, ?, ?)'
  ).run(shiftId, name, addedBy);
  return result.lastInsertRowid;
}

function removeManualParticipant(id) {
  getDb().prepare('DELETE FROM shift_manual_participants WHERE id = ?').run(id);
}

function getManualParticipants(shiftId) {
  return getDb().prepare(
    'SELECT * FROM shift_manual_participants WHERE shift_id = ? ORDER BY added_at ASC'
  ).all(shiftId);
}

function removeTgParticipant(shiftId, userId) {
  getDb().prepare(
    'DELETE FROM shift_participants WHERE shift_id = ? AND user_id = ?'
  ).run(shiftId, userId);
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
  upsertUser, getUser, isAdmin, isBanned, setBanned, setAdmin, getAllUsers, getAllAdminIds,
  setGender, getGender, setRegistration, isRegistered, setPriority,
  createShift, getShift, getAllShifts, updateShift, deleteShift, setShiftMessage,
  joinShift, approveParticipant, rejectParticipant, leaveShift,
  getParticipants, isParticipant, getParticipantStatus, getParticipantRow,
  markShiftStarted, markShiftEnded,
  addManualParticipant, removeManualParticipant, getManualParticipants, removeTgParticipant,
  getShiftsStartingAt,
  getSetting, setSetting,
};
