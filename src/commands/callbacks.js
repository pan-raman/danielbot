const {
  joinShift, approveParticipant, rejectParticipant, leaveShift,
  getShift, getUser, isBanned, getAllAdminIds, isRegistered,
} = require('../db/queries');
const {
  shiftText, shiftKeyboard, confirmationText, cancellationText, formatDate,
} = require('../helpers/format');

async function refreshShiftMessage(ctx, shiftId) {
  const shift = getShift(shiftId);
  if (!shift) return;

  const text     = shiftText(shift);
  const keyboard = shiftKeyboard(shiftId);

  if (shift.chat_id && shift.message_id) {
    try {
      await ctx.telegram.editMessageText(
        shift.chat_id, shift.message_id, undefined,
        text, { parse_mode: 'HTML', reply_markup: keyboard }
      );
      return;
    } catch {}
  }

  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } catch {}
}

async function sendDm(ctx, userId, text, extra) {
  try {
    await ctx.telegram.sendMessage(userId, text, { parse_mode: 'HTML', ...extra });
  } catch {}
}

function approvalKeyboard(shiftId, userId) {
  return {
    inline_keyboard: [[
      { text: '✅ Zatwierdź',  callback_data: `approve:${shiftId}:${userId}` },
      { text: '❌ Odrzuć',     callback_data: `reject:${shiftId}:${userId}`  },
    ]],
  };
}

function registerCallbacks(bot) {

  // ── Sign Up ──────────────────────────────────────────────────────────────

  bot.action(/^join:(\d+)$/, async (ctx) => {
    const userId  = ctx.from.id;
    const shiftId = parseInt(ctx.match[1], 10);

    if (isBanned(userId)) {
      return ctx.answerCbQuery('🚫 Jesteś zablokowany.', { show_alert: true });
    }

    if (!isRegistered(userId)) {
      const botUsername = ctx.botInfo?.username;
      return ctx.answerCbQuery(
        `Aby się zapisać, najpierw zarejestruj się u bota.\nOtwórz @${botUsername} i naciśnij Start.`,
        { show_alert: true }
      );
    }

    const result = joinShift(shiftId, userId);

    if (result.ok) {
      await ctx.answerCbQuery('⏳ Zgłoszenie wysłane! Czekaj na potwierdzenie admina.', { show_alert: true });

      // Notify all admins with full user details
      const shift = getShift(shiftId);
      const user  = getUser(userId);
      const displayName = user.reg_name
        || [user.first_name, user.last_name].filter(Boolean).join(' ')
        || (user.username ? `@${user.username}` : `#${userId}`);

      const adminText =
        `🔔 <b>Nowe zgłoszenie na zmianę</b>\n\n` +
        `📅 ${formatDate(shift.date)} | ${shift.location}\n` +
        `🕐 ${shift.start_time} – ${shift.end_time}\n\n` +
        `<b>Dane pracownika:</b>\n` +
        `👤 ${displayName}\n` +
        (user.reg_phone ? `📞 ${user.reg_phone}\n` : '') +
        (user.reg_pesel ? `🪪 PESEL: ${user.reg_pesel}\n` : '') +
        (user.gender    ? `${user.gender === 'male' ? '👨' : '👩'} ${user.gender === 'male' ? 'Mężczyzna' : 'Kobieta'}\n` : '');

      const admins = getAllAdminIds();
      for (const adminId of admins) {
        await sendDm(ctx, adminId, adminText, { reply_markup: approvalKeyboard(shiftId, userId) });
      }

    } else if (result.reason === 'already_joined') {
      await ctx.answerCbQuery('Jesteś już zapisany (czeka na zatwierdzenie).', { show_alert: true });
    } else if (result.reason === 'rejected') {
      await ctx.answerCbQuery('⛔ Admin odrzucił Twoje zgłoszenie na tę zmianę.', { show_alert: true });
    } else if (result.reason === 'full') {
      await ctx.answerCbQuery('🔴 Zmiana jest już pełna.', { show_alert: true });
    } else if (result.reason === 'wrong_role') {
      await ctx.answerCbQuery('⛔ Ta zmiana wymaga innej roli (Kelner/Barman/Kuchnia).', { show_alert: true });
    } else if (result.reason === 'wrong_priority') {
      await ctx.answerCbQuery('⛔ Twój priorytet nie pozwala na zapis na tę zmianę.', { show_alert: true });
    } else if (result.reason === 'wrong_gender') {
      await ctx.answerCbQuery('⛔ Ta zmiana jest przeznaczona dla innej płci.', { show_alert: true });
    } else if (result.reason === 'no_gender') {
      const botUsername = ctx.botInfo?.username;
      await ctx.answerCbQuery(
        `Najpierw zarejestruj się u bota! Otwórz @${botUsername} i naciśnij Start.`,
        { show_alert: true }
      );
    } else {
      await ctx.answerCbQuery('Zmiana nie została znaleziona.', { show_alert: true });
    }
  });

  // ── Cancel ───────────────────────────────────────────────────────────────

  bot.action(/^leave:(\d+)$/, async (ctx) => {
    const userId  = ctx.from.id;
    const shiftId = parseInt(ctx.match[1], 10);

    const shift   = getShift(shiftId);
    const user    = getUser(userId);
    const removed = leaveShift(shiftId, userId);

    if (removed) {
      await refreshShiftMessage(ctx, shiftId);
      await ctx.answerCbQuery('Anulowano udział.', { show_alert: false });
      if (shift) await sendDm(ctx, userId, cancellationText(shift));

      // Notify all admins
      if (shift && user) {
        const displayName = user.reg_name
          || [user.first_name, user.last_name].filter(Boolean).join(' ')
          || (user.username ? `@${user.username}` : `#${userId}`);

        const adminText =
          `⚠️ <b>Ktoś zrezygnował ze zmiany!</b>\n\n` +
          `👤 ${displayName}\n` +
          (user.reg_phone ? `📞 ${user.reg_phone}\n` : '') +
          `📅 ${formatDate(shift.date)} | ${shift.location}\n` +
          `🕐 ${shift.start_time} – ${shift.end_time}`;

        const admins = getAllAdminIds();
        for (const adminId of admins) {
          await sendDm(ctx, adminId, adminText);
        }
      }
    } else {
      await ctx.answerCbQuery('Nie byłeś zapisany na tę zmianę.', { show_alert: true });
    }
  });

  // ── Admin: Approve ───────────────────────────────────────────────────────

  bot.action(/^approve:(\d+):(\d+)$/, async (ctx) => {
    const shiftId  = parseInt(ctx.match[1], 10);
    const userId   = parseInt(ctx.match[2], 10);

    const result = approveParticipant(shiftId, userId);

    if (result.ok) {
      await refreshShiftMessage(ctx, shiftId);
      const shift = getShift(shiftId);
      const user  = getUser(userId);
      const name  = [user.first_name, user.last_name].filter(Boolean).join(' ') || `#${userId}`;

      await ctx.editMessageText(
        ctx.callbackQuery.message.text + `\n\n✅ Zatwierdzone przez @${ctx.from.username || ctx.from.id}`,
        { reply_markup: { inline_keyboard: [] } }
      );
      await ctx.answerCbQuery('✅ Zatwierdzono');

      // Notify user
      await sendDm(ctx, userId, confirmationText(shift));

    } else if (result.reason === 'full') {
      await ctx.answerCbQuery('🔴 Zmiana jest już pełna — nie można zatwierdzić.', { show_alert: true });
    } else {
      await ctx.answerCbQuery('Błąd.', { show_alert: true });
    }
  });

  // ── Admin: Reject ────────────────────────────────────────────────────────

  bot.action(/^reject:(\d+):(\d+)$/, async (ctx) => {
    const shiftId = parseInt(ctx.match[1], 10);
    const userId  = parseInt(ctx.match[2], 10);

    rejectParticipant(shiftId, userId);

    const shift = getShift(shiftId);
    const user  = getUser(userId);
    const name  = [user.first_name, user.last_name].filter(Boolean).join(' ') || `#${userId}`;

    await ctx.editMessageText(
      ctx.callbackQuery.message.text + `\n\n❌ Odrzucone przez @${ctx.from.username || ctx.from.id}`,
      { reply_markup: { inline_keyboard: [] } }
    );
    await ctx.answerCbQuery('❌ Odrzucono');

    // Notify user
    if (shift) {
      await sendDm(ctx, userId,
        `❌ <b>Twoje zgłoszenie zostało odrzucone.</b>\n\n` +
        `📅 ${formatDate(shift.date)} | ${shift.location}\n` +
        `🕐 ${shift.start_time} – ${shift.end_time}`
      );
    }
  });
}

module.exports = { registerCallbacks, refreshShiftMessage };
