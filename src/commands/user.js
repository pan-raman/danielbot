const { getAllShifts, getParticipants, getUser, setGender } = require('../db/queries');
const { shiftText, shiftKeyboard } = require('../helpers/format');

const GENDER_KEYBOARD = {
  inline_keyboard: [
    [{ text: '👨 Mężczyzna', callback_data: 'gender:male'   }],
    [{ text: '👩 Kobieta',   callback_data: 'gender:female' }],
  ],
};

const START_KEYBOARD = {
  inline_keyboard: [[{ text: '📋 Moje zmiany', callback_data: 'my:shifts' }]],
};

function registerUserCommands(bot) {

  bot.start(async (ctx) => {
    const user = getUser(ctx.from.id);

    if (!user || !user.gender) {
      await ctx.replyWithHTML(
        '<b>Cześć!</b> 👋\n\n' +
        'Zanim zaczniesz — powiedz nam kim jesteś:'
      , { reply_markup: GENDER_KEYBOARD });
    } else {
      await ctx.replyWithHTML(
        '<b>Cześć!</b> 👋\n\nWybierz co chcesz zrobić:',
        { reply_markup: START_KEYBOARD }
      );
    }
  });

  // Gender selection
  bot.action(/^gender:(male|female)$/, async (ctx) => {
    const gender = ctx.match[1];
    setGender(ctx.from.id, gender);
    await ctx.answerCbQuery();
    const label = gender === 'male' ? '👨 Mężczyzna' : '👩 Kobieta';
    await ctx.editMessageText(
      `✅ Zapisano: <b>${label}</b>\n\nMożesz teraz zapisywać się na zmiany!`,
      { parse_mode: 'HTML', reply_markup: START_KEYBOARD }
    );
  });

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
