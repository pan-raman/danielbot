const { getAllShifts, getParticipants } = require('../db/queries');
const { shiftText, shiftKeyboard } = require('../helpers/format');

function registerUserCommands(bot) {

  bot.start((ctx) => {
    ctx.replyWithHTML(
      '<b>Welcome!</b> 👋\n\n' +
      'I manage event staff shifts.\n\n' +
      'Use <b>/myshifts</b> to see your upcoming shifts.\n' +
      'Shifts will be posted here — tap <b>Sign Up</b> to join one.'
    );
  });

  bot.command('myshifts', async (ctx) => {
    const userId = ctx.from.id;
    const shifts = getAllShifts();
    const mine   = shifts.filter(s =>
      getParticipants(s.id).some(p => p.id === userId)
    );

    if (!mine.length) {
      return ctx.reply("You haven't signed up for any shifts yet.");
    }

    for (const s of mine) {
      await ctx.replyWithHTML(shiftText(s), { reply_markup: shiftKeyboard(s.id) });
    }
  });

  bot.command('help', (ctx) => {
    ctx.replyWithHTML(
      '<b>Commands</b>\n\n' +
      '/myshifts – View your registered shifts\n' +
      '/help – Show this message\n\n' +
      'Tap <b>✅ Sign Up</b> on a shift to register, <b>❌ Cancel</b> to leave.'
    );
  });
}

module.exports = { registerUserCommands };
