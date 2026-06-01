const { getAllShifts, getParticipants, getUser, isRegistered } = require('../db/queries');
const { shiftText, shiftKeyboard } = require('../helpers/format');
const { profileText, profileKeyboard } = require('../scenes/editProfileScene');

const START_KEYBOARD = {
  inline_keyboard: [
    [{ text: '📋 Moje zmiany',  callback_data: 'my:shifts'  }],
    [{ text: '👤 Mój profil',   callback_data: 'my:profile' }],
  ],
};

function registerUserCommands(bot) {

  bot.start(async (ctx) => {
    if (!isRegistered(ctx.from.id)) {
      await ctx.replyWithHTML(
        '<b>Cześć!</b> 👋\n\n' +
        'Witaj w systemie zarządzania zmianami.\n\n' +
        'Aby korzystać z bota, najpierw wypełnij swój profil.'
      );
      return ctx.scene.enter('registration');
    }

    await ctx.replyWithHTML(
      '<b>Cześć!</b> 👋\n\nWybierz co chcesz zrobić:',
      { reply_markup: START_KEYBOARD }
    );
  });

  // My profile
  bot.action('my:profile', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.enter('edit_profile');
  });

  bot.command('profile', (ctx) => ctx.scene.enter('edit_profile'));

  // My shifts
  bot.action('my:shifts', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const shifts = getAllShifts();
    const mine   = shifts.filter(s =>
      getParticipants(s.id).some(p => p.id === userId)
    );

    if (!mine.length) {
      return ctx.replyWithHTML(
        'Nie jesteś jeszcze zapisany na żadną zmianę.\n\n' +
        'Zmiany są publikowane w grupie — naciśnij <b>✅ Zapisz się</b>, aby dołączyć.'
      );
    }

    await ctx.reply(`Twoje zmiany (${mine.length}):`);
    for (const s of mine) {
      await ctx.replyWithHTML(shiftText(s), { reply_markup: shiftKeyboard(s.id) });
    }
  });

  bot.command('myshifts', async (ctx) => {
    const userId = ctx.from.id;
    const shifts = getAllShifts();
    const mine   = shifts.filter(s =>
      getParticipants(s.id).some(p => p.id === userId)
    );

    if (!mine.length) {
      return ctx.replyWithHTML(
        'Nie jesteś jeszcze zapisany na żadną zmianę.\n\n' +
        'Zmiany są publikowane w grupie — naciśnij <b>✅ Zapisz się</b>, aby dołączyć.',
        { reply_markup: START_KEYBOARD }
      );
    }

    await ctx.reply(`Twoje zmiany (${mine.length}):`);
    for (const s of mine) {
      await ctx.replyWithHTML(shiftText(s), { reply_markup: shiftKeyboard(s.id) });
    }
  });

  bot.command('help', (ctx) => {
    ctx.replyWithHTML(
      '<b>Dostępne komendy</b>\n\n' +
      '/myshifts – Twoje aktualne zmiany\n' +
      '/help – Ta wiadomość\n\n' +
      'Naciśnij <b>✅ Zapisz się</b> przy zmianie, aby dołączyć.\n' +
      'Naciśnij <b>❌ Anuluj</b>, aby zrezygnować.'
    );
  });
}

module.exports = { registerUserCommands };
