const cron = require('node-cron');
const { getAllShifts, getParticipants, getParticipantRow } = require('./db/queries');
const { formatDate } = require('./helpers/format');

function padTime(t) {
  return t.length === 4 ? '0' + t : t;
}

function addMinutes(dateObj, min) {
  return new Date(dateObj.getTime() + min * 60 * 1000);
}

function toHHMM(dateObj) {
  return String(dateObj.getHours()).padStart(2, '0') + ':' + String(dateObj.getMinutes()).padStart(2, '0');
}

function toDateStr(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function setupReminders(bot) {
  cron.schedule('* * * * *', async () => {
    const now = new Date();

    const todayDate    = toDateStr(now);
    const tomorrowDate = toDateStr(addMinutes(now, 24 * 60));
    const tomorrowTime = toHHMM(addMinutes(now, 24 * 60));

    // Offset targets: minutes from now → label + button type
    const targets = [
      { offset: 5,  type: 'pre_start',  label: '5 minut' },
      { offset: 30, type: 'reminder',   label: '30 minut' },
      { offset: 60, type: 'reminder',   label: '1 godzinę' },
    ];

    const shifts = getAllShifts();

    for (const shift of shifts) {
      const participants = getParticipants(shift.id);
      if (!participants.length) continue;

      const shiftStartTime = padTime(shift.start_time);
      const shiftEndTime   = padTime(shift.end_time);

      // ── 5 min before START → send "Start" button ──────────────────────
      if (shift.date === todayDate && toHHMM(addMinutes(now, 5)) === shiftStartTime) {
        for (const user of participants) {
          const row = getParticipantRow(shift.id, user.id);
          if (row?.started_at) continue; // already started

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
          } catch {}
        }
      }

      // ── 5 min before END → send "End" button ──────────────────────────
      if (shift.date === todayDate && toHHMM(addMinutes(now, 5)) === shiftEndTime) {
        for (const user of participants) {
          const row = getParticipantRow(shift.id, user.id);
          if (row?.ended_at) continue; // already ended

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
          } catch {}
        }
      }

      // ── 30 / 60 min before START → plain reminder ─────────────────────
      for (const t of [30, 60]) {
        if (shift.date === todayDate && toHHMM(addMinutes(now, t)) === shiftStartTime) {
          for (const user of participants) {
            try {
              await bot.telegram.sendMessage(
                user.id,
                `⏰ <b>Przypomnienie!</b>\n\n` +
                `Twoja zmiana zaczyna się za <b>${t} minut</b>!\n` +
                `📅 ${formatDate(shift.date)}\n` +
                `📍 ${shift.location}\n` +
                `🕐 ${shift.start_time} – ${shift.end_time}` +
                (shift.zbiorka ? `\n📌 Zbiórka: ${shift.zbiorka}` : ''),
                { parse_mode: 'HTML' }
              );
            } catch {}
          }
        }
      }

      // ── 24h before START ──────────────────────────────────────────────
      if (shift.date === tomorrowDate && tomorrowTime === shiftStartTime) {
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
    }
  });
}

module.exports = { setupReminders };
