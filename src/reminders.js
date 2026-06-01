const cron = require('node-cron');
const { getAllShifts, getParticipants, getParticipantRow, markNotified } = require('./db/queries');
const { formatDate } = require('./helpers/format');

function toMins(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

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

function timeStrOffset(minutesAhead) {
  const d = new Date(Date.now() + minutesAhead * 60 * 1000);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function dateStrOffset(minutesAhead) {
  const d = new Date(Date.now() + minutesAhead * 60 * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// True if shiftTime falls within [now+offsetMins-1 .. now+offsetMins+1]
function isWithin(shiftTimeHHMM, offsetMins) {
  const shiftMins  = toMins(shiftTimeHHMM.slice(0, 5).padStart(5, '0'));
  const targetMins = nowMins() + offsetMins;
  return Math.abs(shiftMins - targetMins) <= 1;
}

async function sendStartNotification(bot, userId, shift) {
  await bot.telegram.sendMessage(
    userId,
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
}

async function sendEndNotification(bot, userId, shift) {
  await bot.telegram.sendMessage(
    userId,
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
}

function setupReminders(bot) {
  cron.schedule('* * * * *', async () => {
    const today    = todayStr();
    const in24date = dateStrOffset(24 * 60);

    const now = new Date();
    const nowStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    console.log(`[reminders] tick ${today} ${nowStr}, TZ=${process.env.TZ || 'not set'}`);

    const shifts = getAllShifts();

    for (const shift of shifts) {
      const participants = getParticipants(shift.id);

      console.log(`[reminders] shift #${shift.id} date=${shift.date} start=${shift.start_time} end=${shift.end_time} participants=${participants.length}`);

      if (!participants.length) continue;
      if (shift.date !== today) continue;

      // ── 5 min before START ────────────────────────────────────────────
      if (isWithin(shift.start_time, 5)) {
        console.log(`[reminders] → 5min before start for shift #${shift.id}`);
        for (const user of participants) {
          const row = getParticipantRow(shift.id, user.id);
          if (row?.notified_start) { console.log(`[reminders]   user ${user.id} already notified`); continue; }
          try {
            await sendStartNotification(bot, user.id, shift);
            markNotified(shift.id, user.id, 'notified_start');
            console.log(`[reminders]   sent START to ${user.id}`);
          } catch (e) {
            console.error(`[reminders]   failed to send to ${user.id}:`, e.message);
          }
        }
      }

      // ── 5 min before END ──────────────────────────────────────────────
      if (isWithin(shift.end_time, 5)) {
        console.log(`[reminders] → 5min before end for shift #${shift.id}`);
        for (const user of participants) {
          const row = getParticipantRow(shift.id, user.id);
          if (row?.notified_end) continue;
          try {
            await sendEndNotification(bot, user.id, shift);
            markNotified(shift.id, user.id, 'notified_end');
            console.log(`[reminders]   sent END to ${user.id}`);
          } catch (e) {
            console.error(`[reminders]   failed to send to ${user.id}:`, e.message);
          }
        }
      }

      // ── 30 min before START ───────────────────────────────────────────
      if (isWithin(shift.start_time, 30)) {
        for (const user of participants) {
          try {
            await bot.telegram.sendMessage(user.id,
              `⏰ <b>Przypomnienie!</b>\n\nTwoja zmiana zaczyna się za <b>30 minut</b>!\n` +
              `📅 ${formatDate(shift.date)}\n📍 ${shift.location}\n🕐 ${shift.start_time} – ${shift.end_time}` +
              (shift.zbiorka ? `\n📌 Zbiórka: ${shift.zbiorka}` : ''),
              { parse_mode: 'HTML' });
          } catch {}
        }
      }

      // ── 60 min before START ───────────────────────────────────────────
      if (isWithin(shift.start_time, 60)) {
        for (const user of participants) {
          try {
            await bot.telegram.sendMessage(user.id,
              `⏰ <b>Przypomnienie!</b>\n\nTwoja zmiana zaczyna się za <b>1 godzinę</b>!\n` +
              `📅 ${formatDate(shift.date)}\n📍 ${shift.location}\n🕐 ${shift.start_time} – ${shift.end_time}` +
              (shift.zbiorka ? `\n📌 Zbiórka: ${shift.zbiorka}` : ''),
              { parse_mode: 'HTML' });
          } catch {}
        }
      }
    }

    // ── 24h before START ──────────────────────────────────────────────
    for (const shift of shifts) {
      if (shift.date !== in24date) continue;
      if (!isWithin(shift.start_time, 24 * 60)) continue;
      const participants = getParticipants(shift.id);
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
  });
}

module.exports = { setupReminders };
