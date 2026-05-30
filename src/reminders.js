const cron = require('node-cron');
const { getAllShifts, getParticipants } = require('./db/queries');

function padTime(t) {
  return t.length === 4 ? '0' + t : t;
}

function setupReminders(bot) {
  // Run every minute
  cron.schedule('* * * * *', async () => {
    const now     = new Date();
    const nowDate = now.toISOString().slice(0, 10);

    // Build HH:MM string for 30 and 60 minutes from now
    const targets = [30, 60].map(offset => {
      const d = new Date(now.getTime() + offset * 60 * 1000);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return { label: `${offset} min`, time: `${hh}:${mm}` };
    });

    const shifts = getAllShifts();

    for (const shift of shifts) {
      for (const target of targets) {
        if (shift.date !== nowDate) continue;
        if (padTime(shift.start_time) !== target.time) continue;

        const participants = getParticipants(shift.id);
        if (!participants.length) continue;

        for (const user of participants) {
          try {
            await bot.telegram.sendMessage(
              user.id,
              `⏰ Reminder: your shift at <b>${shift.location}</b> starts in <b>${target.label}</b>!\n` +
              `📅 ${shift.date}  🕐 ${shift.start_time}–${shift.end_time}`,
              { parse_mode: 'HTML' }
            );
          } catch {
            // User may have blocked the bot
          }
        }
      }
    }
  });
}

module.exports = { setupReminders };
