const cron = require('node-cron');
const { getAllShifts, getParticipants } = require('./db/queries');
const { formatDate } = require('./helpers/format');

function padTime(t) {
  return t.length === 4 ? '0' + t : t;
}

function setupReminders(bot) {
  cron.schedule('* * * * *', async () => {
    const now = new Date();

    // ── Reminders 60 min and 30 min before shift ──────────────────────────
    const todayDate = now.toISOString().slice(0, 10);

    const intraday = [30, 60].map(offset => {
      const d  = new Date(now.getTime() + offset * 60 * 1000);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return { label: `${offset} min`, time: `${hh}:${mm}` };
    });

    // ── Reminder 24 hours before shift ────────────────────────────────────
    const tomorrow     = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowDate = tomorrow.toISOString().slice(0, 10);
    const tomorrowHH   = String(tomorrow.getHours()).padStart(2, '0');
    const tomorrowMM   = String(tomorrow.getMinutes()).padStart(2, '0');
    const tomorrowTime = `${tomorrowHH}:${tomorrowMM}`;

    const shifts = getAllShifts();

    for (const shift of shifts) {
      const participants = getParticipants(shift.id);
      if (!participants.length) continue;

      // 30 / 60 min reminders
      for (const target of intraday) {
        if (shift.date !== todayDate) continue;
        if (padTime(shift.start_time) !== target.time) continue;

        for (const user of participants) {
          try {
            await bot.telegram.sendMessage(
              user.id,
              `⏰ <b>Przypomnienie!</b>\n\n` +
              `Twoja zmiana zaczyna się za <b>${target.label}</b>!\n` +
              `📅 ${formatDate(shift.date)}\n` +
              `📍 ${shift.location}\n` +
              `🕐 ${shift.start_time} – ${shift.end_time}` +
              (shift.zbiorka ? `\n📌 Zbiórka: ${shift.zbiorka}` : ''),
              { parse_mode: 'HTML' }
            );
          } catch {}
        }
      }

      // 24h reminder
      if (shift.date !== tomorrowDate) continue;
      if (padTime(shift.start_time) !== tomorrowTime) continue;

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
