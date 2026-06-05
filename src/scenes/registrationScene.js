const { Scenes } = require('telegraf');
const { setRegistration } = require('../db/queries');

const GENDER_KEYBOARD = {
  inline_keyboard: [
    [{ text: '👨 Mężczyzna', callback_data: 'reg_gender:male'   }],
    [{ text: '👩 Kobieta',   callback_data: 'reg_gender:female' }],
  ],
};

const registrationScene = new Scenes.WizardScene(
  'registration',

  // Step 0 – imię
  async (ctx) => {
    ctx.scene.state.data = {};
    await ctx.replyWithHTML(
      '📋 <b>Rejestracja</b>\n\n' +
      'Aby korzystać z bota, wypełnij swój profil.\n\n' +
      'Krok 1/5 — Podaj swoje <b>imię</b>:'
    );
    return ctx.wizard.next();
  },

  // Step 1 – nazwisko
  async (ctx) => {
    if (!ctx.message?.text) return;
    ctx.scene.state.data.firstName = ctx.message.text.trim();
    await ctx.replyWithHTML('Krok 2/5 — Podaj swoje <b>nazwisko</b>:');
    return ctx.wizard.next();
  },

  // Step 2 – telefon
  async (ctx) => {
    if (!ctx.message?.text) return;
    ctx.scene.state.data.lastName = ctx.message.text.trim();
    await ctx.replyWithHTML('Krok 3/5 — Podaj swój <b>numer telefonu</b>:\n\n(format: <code>+48 888 888 888</code>)');
    return ctx.wizard.next();
  },

  // Step 3 – PESEL
  async (ctx) => {
    if (!ctx.message?.text) return;
    const phone = ctx.message.text.trim();
    if (!/^\+48[\s\-]?\d{3}[\s\-]?\d{3}[\s\-]?\d{3}$/.test(phone)) {
      return ctx.replyWithHTML('⚠️ Nieprawidłowy numer. Wymagany format: <code>+48 888 888 888</code>\n\nSpróbuj ponownie:');
    }
    ctx.scene.state.data.phone = phone;
    await ctx.replyWithHTML('Krok 4/5 — Podaj swój <b>numer PESEL</b>:');
    return ctx.wizard.next();
  },

  // Step 4 – płeć
  async (ctx) => {
    if (!ctx.message?.text) return;
    const pesel = ctx.message.text.trim();
    if (!/^\d{11}$/.test(pesel)) {
      return ctx.reply('⚠️ PESEL musi składać się z 11 cyfr. Spróbuj ponownie:');
    }
    ctx.scene.state.data.pesel = pesel;
    await ctx.replyWithHTML('Krok 5/5 — Wybierz swoją <b>płeć</b>:', { reply_markup: GENDER_KEYBOARD });
    return ctx.wizard.next();
  },

  // Step 5 – zapis
  async (ctx) => {
    if (!ctx.callbackQuery?.data?.startsWith('reg_gender:')) return;
    const gender = ctx.callbackQuery.data.replace('reg_gender:', '');
    await ctx.answerCbQuery();

    const { firstName, lastName, phone, pesel } = ctx.scene.state.data;
    const fullName = `${firstName} ${lastName}`;

    setRegistration(ctx.from.id, {
      reg_name:  fullName,
      reg_phone: phone,
      reg_pesel: pesel,
      gender,
    });

    const genderLabel = gender === 'male' ? '👨 Mężczyzna' : '👩 Kobieta';

    await ctx.editMessageText(
      `✅ <b>Rejestracja zakończona!</b>\n\n` +
      `👤 ${fullName}\n` +
      `📞 ${phone}\n` +
      `🪪 PESEL: ${pesel}\n` +
      `${genderLabel}\n\n` +
      `Możesz teraz zapisywać się na zmiany!`,
      { parse_mode: 'HTML' }
    );

    return ctx.scene.leave();
  }
);

module.exports = { registrationScene };
