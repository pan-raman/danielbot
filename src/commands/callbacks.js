const { joinShift, leaveShift, getShift, isBanned } = require('../db/queries');
const { shiftText, shiftKeyboard, confirmationText, cancellationText } = require('../helpers/format');

async function refreshShiftMessage(ctx, shiftId) {
  const shift = getShift(shiftId);
  if (!shift) return;
  try {
    await ctx.editMessageText(shiftText(shift), {
      parse_mode: 'HTML',
      reply_markup: shiftKeyboard(shiftId),
    });
  } catch {}
}

async function sendDm(ctx, userId, text) {
  try {
    await ctx.telegram.sendMessage(userId, text, { parse_mode: 'HTML' });
  } catch {
    // User hasn't started the bot in private — can't send DM
  }
}

function registerCallbacks(bot) {

  bot.action(/^join:(\d+)$/, async (ctx) => {
    const userId  = ctx.from.id;
    const shiftId = parseInt(ctx.match[1], 10);

    if (isBanned(userId)) {
      return ctx.answerCbQuery('🚫 Jesteś zablokowany.', { show_alert: true });
    }

    const result = joinShift(shiftId, userId);

    if (result.ok) {
      await refreshShiftMessage(ctx, shiftId);
      await ctx.answerCbQuery('✅ Zapisano!', { show_alert: false });
      const shift = getShift(shiftId);
      await sendDm(ctx, userId, confirmationText(shift));
    } else if (result.reason === 'already_joined') {
      await ctx.answerCbQuery('Jesteś już zapisany na tę zmianę.', { show_alert: true });
    } else if (result.reason === 'full') {
      await ctx.answerCbQuery('🔴 Zmiana jest już pełna.', { show_alert: true });
    } else if (result.reason === 'wrong_gender') {
      await ctx.answerCbQuery('⛔ Ta zmiana jest przeznaczona dla innej płci.', { show_alert: true });
    } else if (result.reason === 'no_gender') {
      const botUsername = ctx.botInfo?.username;
      await ctx.answerCbQuery(
        `Najpierw zarejestruj się u bota! Otwórz @${botUsername} i naciśnij Start, aby wybrać płeć.`,
        { show_alert: true }
      );
    } else {
      await ctx.answerCbQuery('Zmiana nie została znaleziona.', { show_alert: true });
    }
  });

  bot.action(/^leave:(\d+)$/, async (ctx) => {
    const userId  = ctx.from.id;
    const shiftId = parseInt(ctx.match[1], 10);

    const shift   = getShift(shiftId);
    const removed = leaveShift(shiftId, userId);

    if (removed) {
      await refreshShiftMessage(ctx, shiftId);
      await ctx.answerCbQuery('Anulowano udział.', { show_alert: false });
      if (shift) await sendDm(ctx, userId, cancellationText(shift));
    } else {
      await ctx.answerCbQuery('Nie byłeś zapisany na tę zmianę.', { show_alert: true });
    }
  });
}

module.exports = { registerCallbacks };
