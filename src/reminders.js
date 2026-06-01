const cron = require('node-cron');
const { getAllShifts, getParticipants, getParticipantRow, markNotified } = require('./db/queries');
const { formatDate } = require('./helpers/format');

// Convert "HH:MM" to total minutes
function toMins(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Current local time in minutes since midnight
function nowMins() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function dateStrOffset(minutesAhead) {
  const d = new Date(Date.now() + minutesAhead * 60 * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function timeStrOffset(minutesAhead) {
  const d = new Date(Date.now() + minutesAhead * 60 * 1000);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// Check if shift time is within [targetMins-1, targetMins+1] relative to now
function isWithin(shiftTimeHHMM, offsetMins) {
  const shiftMins  = toMins(shiftTimeHHMM.slice(0, 5).padStart(5, '0'));
  const targetMins = nowMins() + offsetMins;
  return Math.abs(shiftMins - targetMins) <= 1;
}

function setupReminders(bot) {
  cron.schedule('* * * * *', async () => {
    const today    = todayStr();
    const tomorrow = dateStrOffset(24 * 60);

    const shifts = getAllShifts();

    for (const shift of shifts) {
      const participants = getParticipants(shift.id);
      if (!participants.length) continue;

      const onToday    = shift.date === today;
      const onTomorrow = shift.date === tomorrow;

      // ── 5 min before START ────────────────────────────────────────────
      if (onToday && isWithin(shift.start_time, 5)) {
        for (const user of participants) {
          const row = getParticipantRow(shift.id, user.id);
          if (!row || row.notified_start) continue;

          try {
            await bot.telegram.sendMessage(
              user.id,
              `⏰ <b>Za 5 minut zaczyna się Twoja zmiana!</b>\n\n` +
              `📍 ${shift.location}\n` +
              `🕐 ${shift.start_time} – ${shift.end_time}\n\n` +
              `Naciśnij przycisk gdy dotrzesz na miejsce:`,
              {
                parse_mode: 'HTML',
                reply_markup: {
                  inline_keyboard: [[
                    { text: '✅ START — jestem na miejscu', callback_data: `wh:start:${shift.id}` },
                  ]],
                },
              }
            );
            markNotified(shift.id, user.id, 'notified_start');
          } catch {}
        }
      }

      // ── 5 min before END ──────────────────────────────────────────────
      if (onToday && isWithin(shift.end_time, 5)) {
        for (const user of participants) {
          const row = getParticipantRow(shift.id, user.id);
          if (!row || row.notified_end) continue;

          try {
            await bot.telegram.sendMessage(
              user.id,
              `🏁 <b>Za 5 minut kończy się Twoja zmiana!</b>\n\n` +
              `📍 ${shift.location}\n` +
              `🕐 ${shift.start_time} – ${shift.end_time}\n\n` +
              `Naciśnij przycisk gdy skończyłeś pracę:`,
              {
                parse_mode: 'HTML',
                reply_markup: {
                  inline_keyboard: [[
                    { text: '🏁 KONIEC — zakończyłem zmianę', callback_data: `wh:end:${shift.id}` },
                  ]],
                },
              }
            );
            markNotified(shift.id, user.id, 'notified_end');
          } catch {}
        }
      }

      // ── 30 min before START ───────────────────────────────────────────
      if (onToday && isWithin(shift.start_time, 30)) {
        for (const user of participants) {
          try {
            await bot.telegram.sendMessage(
              user.id,
              `⏰ <b>Przypomnienie!</b>\n\n` +
              `Twoja zmiana zaczyna się za <b>30 minut</b>!\n` +
              `📅 ${formatDate(shift.date)}\n` +
              `📍 ${shift.location}\n` +
              `🕐 ${shift.start_time} – ${shift.end_time}` +
              (shift.zbiorka ? `\n📌 Zbiórka: ${shift.zbiorka}` : ''),
              { parse_mode: 'HTML' }
            );
          } catch {}
        }
      }

      // ── 60 min before START ───────────────────────────────────────────
      if (onToday && isWithin(shift.start_time, 60)) {
        for (const user of participants) {
          try {
            await bot.telegram.sendMessage(
              user.id,
              `⏰ <b>Przypomnienie!</b>\n\n` +
              `Twoja zmiana zaczyna się za <b>1 godzinę</b>!\n` +
              `📅 ${formatDate(shift.date)}\n` +
              `📍 ${shift.location}\n` +
              `🕐 ${shift.start_time} – ${shift.end_time}` +
              (shift.zbiorka ? `\n📌 Zbiórka: ${shift.zbiorka}` : ''),
              { parse_mode: 'HTML' }
            );
          } catch {}
        }
      }

      // ── 24h before START ──────────────────────────────────────────────
      if (onTomorrow && isWithin(shift.start_time, -(24 * 60 - nowMins()) + nowMins())) {
        // simpler: check if tomorrow's shift time matches current time
      }
    }
  });

  // Separate cron for 24h reminder — runs once per minute but checks date+time match
  cron.schedule('* * * * *', async () => {
    const in24hDate = dateStrOffset(24 * 60);
    const in24hTime = timeStrOffset(24 * 60);

    const shifts = getAllShifts();
    for (const shift of shifts) {
      if (shift.date !== in24hDate) continue;
      if (!isWithin(shift.start_time, 24 * 60)) continue;

      const participants = getParticipants(shift.id);
      for (const user of participants) {
        try {
          await bot.telegram.sendMessage(
            user.id,
            `📅 <b>Jutro masz zmianę!</b>\n\n` +
            `📍 ${shift.location}\n` +
            `🕐 ${shift.start_time} – ${shift.end_time}\n` +
            `👔 ${shift.dress_code}` +
            (shift.zbiorka         ? `\n📌 Zbiórka: ${shift.zbiorka}` : '') +
            (shift.zbiorka_contact ? `\n👤 Kontakt: ${shift.zbiorka_contact}` : ''),
            { parse_mode: 'HTML' }
          );
        } catch {}
      }
    }
  });
}

module.exports = { setupReminders };
