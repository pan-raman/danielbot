const { markShiftStarted, markShiftEnded, getShift, getParticipantRow, getAllAdminIds, getUser } = require('../db/queries');
const { formatDate } = require('../helpers/format');

function nowHHMM() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

async function notifyAdmins(bot, text) {
  for (const adminId of getAllAdminIds()) {
    try { await bot.telegram.sendMessage(adminId, text, { parse_mode: 'HTML' }); } catch {}
  }
}

function registerWorkhourCallbacks(bot) {

  // ── START ────────────────────────────────────────────────────────────────

  bot.action(/^wh:start:(\d+)$/, async (ctx) => {
    const shiftId = parseInt(ctx.match[1], 10);
    const userId  = ctx.from.id;
    const shift   = getShift(shiftId);
    if (!shift) return ctx.answerCbQuery('Zmiana nie znaleziona.', { show_alert: true });

    const row = getParticipantRow(shiftId, userId);
    if (!row || row.status !== 'approved') {
      return ctx.answerCbQuery('Nie jesteś uczestnikiem tej zmiany.', { show_alert: true });
    }
    if (row.started_at) {
      return ctx.answerCbQuery(`Już odnotowałeś start o ${row.started_at}.`, { show_alert: true });
    }

    const time = nowHHMM();
    markShiftStarted(shiftId, userId, time);

    // Check if late
    const scheduled = shift.start_time.slice(0, 5);
    const isLate    = time > scheduled;
    const lateNote  = isLate ? ` ⚠️ <b>Spóźnienie</b> (planowo: ${scheduled})` : '';

    await ctx.editMessageText(
      `✅ <b>Start odnotowany!</b>\n\n` +
      `🕐 Godzina przyjścia: <b>${time}</b>${lateNote}\n` +
      `📍 ${shift.location}`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } }
    );
    await ctx.answerCbQuery('✅ Start odnotowany!');

    // Notify admins
    const user = getUser(userId);
    const name = user?.reg_name || user?.first_name || `#${userId}`;
    await notifyAdmins(
      bot,
      `${isLate ? '⚠️' : '✅'} <b>${name}</b> — START o <b>${time}</b>${lateNote}\n` +
      `📅 ${formatDate(shift.date)} | ${shift.location}`
    );
  });

  // ── END ──────────────────────────────────────────────────────────────────

  bot.action(/^wh:end:(\d+)$/, async (ctx) => {
    const shiftId = parseInt(ctx.match[1], 10);
    const userId  = ctx.from.id;
    const shift   = getShift(shiftId);
    if (!shift) return ctx.answerCbQuery('Zmiana nie znaleziona.', { show_alert: true });

    const row = getParticipantRow(shiftId, userId);
    if (!row || row.status !== 'approved') {
      return ctx.answerCbQuery('Nie jesteś uczestnikiem tej zmiany.', { show_alert: true });
    }
    if (!row.started_at) {
      return ctx.answerCbQuery('Najpierw odnotuj START.', { show_alert: true });
    }
    if (row.ended_at) {
      return ctx.answerCbQuery(`Już odnotowałeś koniec o ${row.ended_at}.`, { show_alert: true });
    }

    const time = nowHHMM();
    markShiftEnded(shiftId, userId, time);

    // Calculate worked hours
    const [sh, sm] = row.started_at.split(':').map(Number);
    const [eh, em] = time.split(':').map(Number);
    const mins     = (eh * 60 + em) - (sh * 60 + sm);
    const worked   = `${Math.floor(mins / 60)}h ${mins % 60}min`;

    await ctx.editMessageText(
      `🏁 <b>Koniec zmiany odnotowany!</b>\n\n` +
      `🕐 Start: <b>${row.started_at}</b>\n` +
      `🕑 Koniec: <b>${time}</b>\n` +
      `⏱ Przepracowano: <b>${worked}</b>\n` +
      `📍 ${shift.location}`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } }
    );
    await ctx.answerCbQuery('🏁 Koniec odnotowany!');

    // Notify admins
    const user = getUser(userId);
    const name = user?.reg_name || user?.first_name || `#${userId}`;
    await notifyAdmins(
      bot,
      `🏁 <b>${name}</b> — KONIEC o <b>${time}</b>\n` +
      `⏱ Przepracowano: <b>${worked}</b>\n` +
      `📅 ${formatDate(shift.date)} | ${shift.location}`
    );
  });
}

module.exports = { registerWorkhourCallbacks };
