const { getParticipants } = require('../db/queries');

function userName(user) {
  if (user.first_name || user.last_name) {
    return [user.first_name, user.last_name].filter(Boolean).join(' ');
  }
  return user.username ? `@${user.username}` : `#${user.id}`;
}

function shiftText(shift) {
  const participants = getParticipants(shift.id);
  const filled  = participants.length;
  const slots   = shift.required;
  const spotsLeft = slots - filled;

  const participantLines = participants.length
    ? participants.map((u, i) => `  ${i + 1}. ${userName(u)}`).join('\n')
    : '  —';

  const statusBar = buildStatusBar(filled, slots);

  return (
    `📅 <b>${shift.date}</b>\n` +
    `📍 <b>${shift.location}</b>\n` +
    `👔 ${shift.dress_code}\n` +
    `🕐 ${shift.start_time} – ${shift.end_time}\n` +
    `👥 Spots: ${filled}/${slots}  ${statusBar}\n` +
    (spotsLeft > 0
      ? `✅ ${spotsLeft} spot${spotsLeft > 1 ? 's' : ''} available\n`
      : `🔴 Shift is full\n`) +
    `\n<b>Participants:</b>\n${participantLines}`
  );
}

function buildStatusBar(filled, total) {
  const bars  = 10;
  const done  = Math.round((filled / total) * bars);
  return '▓'.repeat(done) + '░'.repeat(bars - done);
}

function shiftKeyboard(shiftId) {
  return {
    inline_keyboard: [[
      { text: '✅ Sign Up',  callback_data: `join:${shiftId}` },
      { text: '❌ Cancel',   callback_data: `leave:${shiftId}` },
    ]],
  };
}

module.exports = { shiftText, shiftKeyboard, userName };
