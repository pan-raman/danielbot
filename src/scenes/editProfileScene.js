const { Scenes } = require('telegraf');
const { setRegistration, getUser } = require('../db/queries');

const GENDER_KEYBOARD = {
  inline_keyboard: [
    [{ text: '👨 Mężczyzna', callback_data: 'edit_gender:male'   }],
    [{ text: '👩 Kobieta',   callback_data: 'edit_gender:female' }],
  ],
};

function profileKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '✏️ Imię i nazwisko', callback_data: 'profile:name'   }],
      [{ text: '📞 Telefon',          callback_data: 'profile:phone'  }],
      [{ text: '🪪 PESEL',            callback_data: 'profile:pesel'  }],
      [{ text: '👤 Płeć',             callback_data: 'profile:gender' }],
    ],
  };
}

function profileText(user) {
  return (
    `👤 <b>Twój profil</b>\n\n` +
    `Imię i nazwisko: <b>${user.reg_name  || '—'}</b>\n` +
    `Telefon:         <b>${user.reg_phone || '—'}</b>\n` +
    `PESEL:           <b>${user.reg_pesel || '—'}</b>\n` +
    `Płeć:            <b>${user.gender === 'male' ? '👨 Mężczyzna' : user.gender === 'female' ? '👩 Kobieta' : '—'}</b>\n\n` +
    `⚠️ <i>Zmiana danych nie wpływa na już istniejące zgłoszenia — są zapisane z danymi z dnia zapisu.</i>`
  );
}

const editProfileScene = new Scenes.WizardScene(
  'edit_profile',

  // Step 0 – show profile and pick field
  async (ctx) => {
    const user = getUser(ctx.from.id);
    await ctx.replyWithHTML(profileText(user), { reply_markup: profileKeyboard() });
    return ctx.wizard.next();
  },

  // Step 1 – handle field choice
  async (ctx) => {
    if (!ctx.callbackQuery?.data?.startsWith('profile:')) return;
    const field = ctx.callbackQuery.data.replace('profile:', '');
    await ctx.answerCbQuery();
    ctx.scene.state.field = field;

    if (field === 'gender') {
      await ctx.replyWithHTML('Wybierz płeć:', { reply_markup: GENDER_KEYBOARD });
    } else {
      const labels = { name: 'imię i nazwisko', phone: 'numer telefonu', pesel: 'PESEL' };
      await ctx.replyWithHTML(`Podaj nowe <b>${labels[field]}</b>:\n\n/cancel — anuluj`);
    }
    return ctx.wizard.next();
  },

  // Step 2 – receive new value and save
  async (ctx) => {
    const field = ctx.scene.state.field;
    const user  = getUser(ctx.from.id);

    let newName  = user.reg_name;
    let newPhone = user.reg_phone;
    let newPesel = user.reg_pesel;
    let newGender = user.gender;

    if (field === 'gender') {
      if (!ctx.callbackQuery?.data?.startsWith('edit_gender:')) return;
      newGender = ctx.callbackQuery.data.replace('edit_gender:', '');
      await ctx.answerCbQuery();
    } else if (ctx.message?.text) {
      const val = ctx.message.text.trim();

      if (field === 'phone' && !/^[\d\s\+\-\(\)]{7,20}$/.test(val)) {
        return ctx.reply('⚠️ Nieprawidłowy numer telefonu. Spróbuj ponownie:');
      }
      if (field === 'pesel' && !/^\d{11}$/.test(val)) {
        return ctx.reply('⚠️ PESEL musi składać się z 11 cyfr. Spróbuj ponownie:');
      }

      if (field === 'name')  newName  = val;
      if (field === 'phone') newPhone = val;
      if (field === 'pesel') newPesel = val;
    } else {
      return;
    }

    setRegistration(ctx.from.id, {
      reg_name:  newName,
      reg_phone: newPhone,
      reg_pesel: newPesel,
      gender:    newGender,
    });

    const updated = getUser(ctx.from.id);

    if (field === 'gender' && ctx.callbackQuery) {
      await ctx.editMessageText(
        profileText(updated),
        { parse_mode: 'HTML', reply_markup: profileKeyboard() }
      );
    } else {
      await ctx.replyWithHTML(`✅ Zaktualizowano!\n\n${profileText(updated)}`, {
        reply_markup: profileKeyboard(),
      });
    }

    return ctx.scene.leave();
  }
);

editProfileScene.command('cancel', async (ctx) => {
  await ctx.reply('Anulowano edycję profilu.');
  return ctx.scene.leave();
});

module.exports = { editProfileScene, profileText, profileKeyboard };
