const { joinShift, leaveShift, getShift, isBanned } = require('../db/queries');
const { shiftText, shiftKeyboard } = require('../helpers/format');

async function refreshShiftMessage(ctx, shiftId) {
  const shift = getShift(shiftId);
  if (!shift) return;
  try {
    await ctx.editMessageText(shiftText(shift), {
      parse_mode: 'HTML',
      reply_markup: shiftKeyboard(shiftId),
    });
  } catch (e) {
    // Message unchanged or not editable – silently skip
  }
}

function registerCallbacks(bot) {

  bot.action(/^join:(\d+)$/, async (ctx) => {
    const userId  = ctx.from.id;
    const shiftId = parseInt(ctx.match[1], 10);

    if (isBanned(userId)) {
      return ctx.answerCbQuery('🚫 You are banned.', { show_alert: true });
    }

    const result = joinShift(shiftId, userId);

    if (result.ok) {
      await refreshShiftMessage(ctx, shiftId);
      await ctx.answerCbQuery('✅ You signed up!', { show_alert: false });
    } else if (result.reason === 'already_joined') {
      await ctx.answerCbQuery("You're already signed up.", { show_alert: true });
    } else if (result.reason === 'full') {
      await ctx.answerCbQuery('🔴 This shift is full.', { show_alert: true });
    } else {
      await ctx.answerCbQuery('Shift not found.', { show_alert: true });
    }
  });

  bot.action(/^leave:(\d+)$/, async (ctx) => {
    const userId  = ctx.from.id;
    const shiftId = parseInt(ctx.match[1], 10);

    const removed = leaveShift(shiftId, userId);

    if (removed) {
      await refreshShiftMessage(ctx, shiftId);
      await ctx.answerCbQuery('You have been removed from the shift.', { show_alert: false });
    } else {
      await ctx.answerCbQuery("You weren't signed up.", { show_alert: true });
    }
  });
}

module.exports = { registerCallbacks };
