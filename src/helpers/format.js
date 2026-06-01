const { getParticipants, getManualParticipants } = require('../db/queries');

const DAYS_PL = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb'];

function formatDate(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  const day  = String(date.getDate()).padStart(2, '0');
  const mon  = String(date.getMonth() + 1).padStart(2, '0');
  const dow  = DAYS_PL[date.getDay()];
  return `${day}.${mon} ${dow}`;
}

function userName(user) {
  if (user.first_name || user.last_name) {
    return [user.first_name, user.last_name].filter(Boolean).join(' ');
  }
  return user.username ? `@${user.username}` : `#${user.id}`;
}

const GENDER_LABEL = { male: '👨 Tylko mężczyźni', female: '👩 Tylko kobiety', all: '👥 Wszyscy' };

function shiftText(shift) {
  const participants       = getParticipants(shift.id);
  const manualParticipants = getManualParticipants(shift.id);
  const filled    = participants.length + manualParticipants.length;
  const slots     = shift.required;
  const spotsLeft = slots - filled;

  let num = 1;
  const tgLines     = participants.map(u => `  ${num++}. ${userName(u)}`);
  const manualLines = manualParticipants.map(m => `  ${num++}. ${m.name}`);
  const allLines    = [...tgLines, ...manualLines];

  const participantLines = allLines.length ? allLines.join('\n') : '  —';
  const statusBar = buildStatusBar(filled, slots);

  return (
    `📅 <b>${formatDate(shift.date)}</b>\n` +
    `📍 <b>${shift.location}</b>\n` +
    `👔 ${shift.dress_code}\n` +
    `🕐 ${shift.start_time} – ${shift.end_time}\n` +
    (shift.zbiorka    ? `📌 Zbiórka: ${shift.zbiorka}\n`                            : '') +
    (shift.lista      ? `📋 Lista do wypisu: ${shift.lista}\n`                       : '') +
    (shift.for_gender && shift.for_gender !== 'all'
      ? `${GENDER_LABEL[shift.for_gender]}\n`
      : '') +
    `👥 Miejsca: ${filled}/${slots}  ${statusBar}\n` +
    (spotsLeft > 0
      ? `✅ Wolne miejsca: ${spotsLeft}\n`
      : `🔴 Zmiana jest pełna\n`) +
    `\n<b>Uczestnicy:</b>\n${participantLines}`
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

function confirmationText(shift) {
  return (
    `✅ <b>Zostałeś zapisany na zmianę!</b>\n\n` +
    `📅 ${formatDate(shift.date)}\n` +
    `📍 ${shift.location}\n` +
    `👔 ${shift.dress_code}\n` +
    `🕐 ${shift.start_time} – ${shift.end_time}\n\n` +
    `Jeśli nie możesz przyjść — anuluj udział przyciskiem przy wiadomości ze zmianą.`
  );
}

function cancellationText(shift) {
  return (
    `❌ <b>Anulowałeś udział w zmianie.</b>\n\n` +
    `📅 ${formatDate(shift.date)}\n` +
    `📍 ${shift.location}\n` +
    `🕐 ${shift.start_time} – ${shift.end_time}`
  );
}

module.exports = { shiftText, shiftKeyboard, userName, formatDate, confirmationText, cancellationText };
