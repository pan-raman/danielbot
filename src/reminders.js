const cron = require('node-cron');
const { getAllShifts, getParticipants, getParticipantRow, markNotified } = require('./db/queries');
const { formatDate } = require('./helpers/format');

function toMins(hhmm) {
  const [h, m] = hhmm.slice(0, 5).padStart(5, '0').split(':').map(Number);
  return h * 60 + m;
}

function nowMins() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function dateStrOffset(minutesAhead) {
  const d = new Date(Date.now() + minutesAhead * 60 * 1000);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function isWithin(shiftTimeHHMM, offsetMins) {
  const shiftMins  = toMins(shiftTimeHHMM);
  const targetMins = nowMins() + offsetMins;
  return Math.abs(shiftMins - targetMins) <= 1;
}

async function runReminderCheck(bot) {
  const today  = todayStr();
  const in24d  = dateStrOffset(24 * 60);
  const shifts = getAllShifts();

  for (const shift of shifts) {
    const participants = getParticipants(shift.id);
    if (!participants.length) continue;

    if (shift.date === today) {
      // 5 min before START
      if (isWithin(shift.start_time, 5)) {
        for (const user of participants) {
          const row = getParticipantRow(shift.id, user.id);
          if (row?.notified_start) continue;
          try {
            await bot.telegram.sendMessage(user.id,
              `⏰ <b>Za 5 minut zaczyna się Twoja zmiana!</b>\n\n` +
              `📍 ${shift.location}\n🕐 ${shift.start_time} – ${shift.end_time}\n\n` +
              `Naciśnij przycisk gdy dotrzesz na miejsce:`,
              { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[
                { text: '✅ START — jestem na miejscu', callback_data: `wh:start:${shift.id}` },
              ]]}}
            );
            markNotified(shift.id, user.id, 'notified_start');
          } catch {}
        }
      }

      // 5 min before END
      if (isWithin(shift.end_time, 5)) {
        for (const user of participants) {
          const row = getParticipantRow(shift.id, user.id);
          if (row?.notified_end) continue;
          try {
            await bot.telegram.sendMessage(user.id,
              `🏁 <b>Za 5 minut kończy się Twoja zmiana!</b>\n\n` +
              `📍 ${shift.location}\n🕐 ${shift.start_time} – ${shift.end_time}\n\n` +
              `Naciśnij przycisk gdy skończyłeś pracę:`,
              { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[
                { text: '🏁 KONIEC — zakończyłem zmianę', callback_data: `wh:end:${shift.id}` },
              ]]}}
            );
            markNotified(shift.id, user.id, 'notified_end');
          } catch {}
        }
      }

      // 30 min before START
      if (isWithin(shift.start_time, 30)) {
        for (const user of participants) {
          try {
            await bot.telegram.sendMessage(user.id,
              `⏰ <b>Przypomnienie!</b>\n\nZmiana za <b>30 minut</b>!\n` +
              `📅 ${formatDate(shift.date)}\n📍 ${shift.location}\n🕐 ${shift.start_time} – ${shift.end_time}` +
              (shift.zbiorka ? `\n📌 Zbiórka: ${shift.zbiorka}` : ''),
              { parse_mode: 'HTML' });
          } catch {}
        }
      }

      // 60 min before START
      if (isWithin(shift.start_time, 60)) {
        for (const user of participants) {
          try {
            await bot.telegram.sendMessage(user.id,
              `⏰ <b>Przypomnienie!</b>\n\nZmiana za <b>1 godzinę</b>!\n` +
              `📅 ${formatDate(shift.date)}\n📍 ${shift.location}\n🕐 ${shift.start_time} – ${shift.end_time}` +
              (shift.zbiorka ? `\n📌 Zbiórka: ${shift.zbiorka}` : ''),
              { parse_mode: 'HTML' });
          } catch {}
        }
      }
    }

    // 24h before START
    if (shift.date === in24d && isWithin(shift.start_time, 24 * 60)) {
      for (const user of participants) {
        try {
          await bot.telegram.sendMessage(user.id,
            `📅 <b>Jutro masz zmianę!</b>\n\n📍 ${shift.location}\n🕐 ${shift.start_time} – ${shift.end_time}\n👔 ${shift.dress_code}` +
            (shift.zbiorka         ? `\n📌 Zbiórka: ${shift.zbiorka}` : '') +
            (shift.zbiorka_contact ? `\n👤 Kontakt: ${shift.zbiorka_contact}` : ''),
            { parse_mode: 'HTML' });
        } catch {}
      }
    }
  }
}

function setupReminders(bot) {
  cron.schedule('* * * * *', () => runReminderCheck(bot).catch(() => {}));
}

module.exports = { setupReminders, runReminderCheck };
