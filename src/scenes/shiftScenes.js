const { Scenes } = require('telegraf');
const { createShift, updateShift, getShift, setShiftMessage, getSetting } = require('../db/queries');
const { shiftText, shiftKeyboard } = require('../helpers/format');

const BACK_KEYBOARD = {
  inline_keyboard: [[{ text: '⬅️ Lista zmian', callback_data: 'ap:shifts' }]],
};

const LISTA_KEYBOARD = {
  inline_keyboard: [
    [{ text: 'Heaven',  callback_data: 'lista:Heaven'  }],
    [{ text: 'Forkers', callback_data: 'lista:Forkers' }],
  ],
};

const ZBIORKA_KEYBOARD = {
  inline_keyboard: [[{ text: 'Pomiń Zbiórka', callback_data: 'zbiorka:skip' }]],
};

const GENDER_KEYBOARD = {
  inline_keyboard: [
    [
      { text: '👨 Tylko mężczyźni', callback_data: 'fg:male'   },
      { text: '👩 Tylko kobiety',   callback_data: 'fg:female' },
    ],
    [{ text: '👥 Wszyscy',          callback_data: 'fg:all'    }],
  ],
};
// Steps that use plain text input (wizard-driven)
// lista and zbiorka are handled separately (inline button + text)

const STEPS = [
  { key: 'date',       prompt: '📅 Podaj <b>datę</b> zmiany w formacie DD.MM (np. 25.12):' },
  { key: 'location',   prompt: '📍 Podaj <b>miejsce</b>:' },
  { key: 'dress_code', prompt: '👔 Podaj <b>dress code</b>:' },
  { key: 'start_time', prompt: '🕐 Podaj <b>godzinę rozpoczęcia</b> (GG:MM):' },
  { key: 'end_time',   prompt: '🕑 Podaj <b>godzinę zakończenia</b> (GG:MM):' },
  { key: 'required',   prompt: '👥 Ile osób jest <b>wymaganych</b>? (liczba):' },
];

function parseDate(raw) {
  const short = raw.match(/^(\d{1,2})\.(\d{1,2})$/);
  const full  = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);

  let day, month, year;

  if (short) {
    [, day, month] = short;
    const now = new Date();
    year = now.getFullYear();
    const candidate = new Date(year, parseInt(month, 10) - 1, parseInt(day, 10));
    if (candidate < now) year += 1;
  } else if (full) {
    [, day, month, year] = full;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  } else {
    return null;
  }

  const d = String(day).padStart(2, '0');
  const m = String(month).padStart(2, '0');
  const y = String(year);
  const date = new Date(`${y}-${m}-${d}`);
  if (isNaN(date.getTime())) return null;
  return `${y}-${m}-${d}`;
}

function parseTime(raw) {
  return /^\d{1,2}:\d{2}$/.test(raw) ? raw.padStart(5, '0') : null;
}

// ── Create Shift Scene ───────────────────────────────────────────────────────

const createShiftScene = new Scenes.WizardScene(
  'create_shift',

  // Step 0 – ask date
  async (ctx) => {
    ctx.scene.state.data = {};
    await ctx.replyWithHTML(
      '🆕 <b>Nowa zmiana</b>\n\nWypełniamy szczegóły krok po kroku.\n\n' +
      STEPS[0].prompt +
      '\n\n/cancel — anuluj'
    );
    return ctx.wizard.next();
  },

  // Steps 1-5 – text fields
  ...STEPS.slice(1).map((step, i) => async (ctx) => {
    if (!ctx.message?.text) return;
    const prevKey = STEPS[i].key;
    const raw = ctx.message.text.trim();

    if (prevKey === 'date') {
      const parsed = parseDate(raw);
      if (!parsed) return ctx.replyWithHTML('⚠️ Nieprawidłowa data. Spróbuj <code>25.12</code>');
      ctx.scene.state.data[prevKey] = parsed;
    } else if (prevKey === 'start_time' || prevKey === 'end_time') {
      const parsed = parseTime(raw);
      if (!parsed) return ctx.replyWithHTML('⚠️ Nieprawidłowy czas. Użyj formatu GG:MM.');
      ctx.scene.state.data[prevKey] = parsed;
    } else {
      ctx.scene.state.data[prevKey] = raw;
    }

    await ctx.replyWithHTML(step.prompt);
    return ctx.wizard.next();
  }),

  // Step 6 – validate required (last text step), ask lista
  async (ctx) => {
    if (!ctx.message?.text) return;
    const n = parseInt(ctx.message.text.trim(), 10);
    if (isNaN(n) || n < 1) return ctx.reply('⚠️ Podaj prawidłową liczbę (minimum 1).');
    ctx.scene.state.data.required = n;

    await ctx.replyWithHTML('📋 Wybierz <b>Lista do wypisu</b>:', { reply_markup: LISTA_KEYBOARD });
    return ctx.wizard.next();
  },

  // Step 7 – receive lista (button), ask zbiorka
  async (ctx) => {
    if (!ctx.callbackQuery?.data?.startsWith('lista:')) return;
    const lista = ctx.callbackQuery.data.replace('lista:', '');
    await ctx.answerCbQuery();
    ctx.scene.state.data.lista = lista;

    await ctx.replyWithHTML('📍 Podaj <b>Zbiórka</b> (miejsce zbiórki) lub pomiń:', { reply_markup: ZBIORKA_KEYBOARD });
    return ctx.wizard.next();
  },

  // Step 8 – receive zbiorka (text or skip), ask for_gender
  async (ctx) => {
    if (ctx.callbackQuery?.data === 'zbiorka:skip') {
      await ctx.answerCbQuery();
      ctx.scene.state.data.zbiorka = null;
    } else if (ctx.message?.text) {
      ctx.scene.state.data.zbiorka = ctx.message.text.trim();
    } else {
      return;
    }

    await ctx.replyWithHTML('👥 Kto może zapisać się na tę zmianę?', { reply_markup: GENDER_KEYBOARD });
    return ctx.wizard.next();
  },

  // Step 9 – receive for_gender, save and post
  async (ctx) => {
    if (!ctx.callbackQuery?.data?.startsWith('fg:')) return;
    const forGender = ctx.callbackQuery.data.replace('fg:', '');
    await ctx.answerCbQuery();
    ctx.scene.state.data.for_gender = forGender;

    const { data } = ctx.scene.state;
    const shiftId = createShift({ ...data, created_by: ctx.from.id });
    const shift   = getShift(shiftId);

    const targetChatId = getSetting('target_chat_id');

    let sent;
    if (targetChatId) {
      sent = await ctx.telegram.sendMessage(targetChatId, shiftText(shift), {
        parse_mode: 'HTML',
        reply_markup: shiftKeyboard(shiftId),
      });
      await ctx.replyWithHTML('✅ Zmiana utworzona i opublikowana w grupie!', { reply_markup: BACK_KEYBOARD });
    } else {
      sent = await ctx.replyWithHTML(shiftText(shift), { reply_markup: shiftKeyboard(shiftId) });
      await ctx.replyWithHTML('✅ Zmiana utworzona!\n\n⚠️ Brak połączonej grupy. Użyj /setchat w grupie.', { reply_markup: BACK_KEYBOARD });
    }

    setShiftMessage(shiftId, sent.chat.id, sent.message_id);
    return ctx.scene.leave();
  }
);

createShiftScene.command('cancel', async (ctx) => {
  await ctx.reply('❌ Tworzenie zmiany anulowane.');
  return ctx.scene.leave();
});

// ── Edit Shift Scene ─────────────────────────────────────────────────────────

const EDIT_FIELDS = {
  date:       { label: 'Data',           validate: parseDate,  hint: '(DD.MM)',  type: 'text' },
  location:   { label: 'Miejsce',        validate: v => v,     hint: '',         type: 'text' },
  dress_code: { label: 'Dress code',     validate: v => v,     hint: '',         type: 'text' },
  start_time: { label: 'Początek',       validate: parseTime,  hint: '(GG:MM)', type: 'text' },
  end_time:   { label: 'Koniec',         validate: parseTime,  hint: '(GG:MM)', type: 'text' },
  required:   { label: 'Liczba miejsc',  validate: v => { const n = parseInt(v, 10); return isNaN(n) || n < 1 ? null : n; }, hint: '', type: 'text' },
  lista:      { label: 'Lista do wypisu',validate: v => v,     hint: '',         type: 'button' },
  zbiorka:    { label: 'Zbiórka',        validate: v => v || null, hint: '',         type: 'text' },
  for_gender: { label: 'Dla kogo',       validate: v => v,         hint: '',         type: 'button' },
};

function editFieldsKeyboard() {
  return {
    inline_keyboard: Object.entries(EDIT_FIELDS).map(([key, { label }]) => (
      [{ text: label, callback_data: `editfield:${key}` }]
    )).concat([[{ text: '✅ Zakończ edycję', callback_data: 'editfield:done' }]]),
  };
}

const editShiftScene = new Scenes.WizardScene(
  'edit_shift',

  // Step 0 – show field picker
  async (ctx) => {
    const shiftId = ctx.scene.state.shiftId;
    const shift   = getShift(shiftId);
    if (!shift) { await ctx.reply('Zmiana nie została znaleziona.'); return ctx.scene.leave(); }

    await ctx.replyWithHTML(
      `✏️ <b>Edytuj zmianę</b>\n\n${shiftText(shift)}\n\nKtóre pole chcesz zmienić?`,
      { reply_markup: editFieldsKeyboard() }
    );
    return ctx.wizard.next();
  },

  // Step 1 – receive field choice
  async (ctx) => {
    if (!ctx.callbackQuery?.data) return;
    const cbData = ctx.callbackQuery.data;
    await ctx.answerCbQuery();

    if (cbData === 'editfield:done') {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      await ctx.reply('✅ Edycja zakończona.', { reply_markup: BACK_KEYBOARD });
      return ctx.scene.leave();
    }

    const field = cbData.replace('editfield:', '');
    if (!EDIT_FIELDS[field]) return;

    ctx.scene.state.editField = field;

    if (field === 'lista') {
      await ctx.replyWithHTML('📋 Wybierz <b>Lista do wypisu</b>:', { reply_markup: LISTA_KEYBOARD });
    } else if (field === 'zbiorka') {
      await ctx.replyWithHTML('📍 Podaj <b>Zbiórka</b> lub usuń:', { reply_markup: ZBIORKA_KEYBOARD });
    } else if (field === 'for_gender') {
      await ctx.replyWithHTML('👥 Kto może zapisać się na tę zmianę?', { reply_markup: GENDER_KEYBOARD });
    } else {
      const { label, hint } = EDIT_FIELDS[field];
      await ctx.replyWithHTML(`Podaj nową wartość dla <b>${label}</b> ${hint}:`);
    }
    return ctx.wizard.next();
  },

  // Step 2 – receive new value (text or button)
  async (ctx) => {
    const field = ctx.scene.state.editField;

    let raw;
    if (field === 'lista') {
      if (!ctx.callbackQuery?.data?.startsWith('lista:')) return;
      raw = ctx.callbackQuery.data.replace('lista:', '');
      await ctx.answerCbQuery();
    } else if (field === 'for_gender') {
      if (!ctx.callbackQuery?.data?.startsWith('fg:')) return;
      raw = ctx.callbackQuery.data.replace('fg:', '');
      await ctx.answerCbQuery();
    } else if (field === 'zbiorka' && ctx.callbackQuery?.data === 'zbiorka:skip') {
      await ctx.answerCbQuery();
      raw = '';
    } else {
      if (!ctx.message?.text) return;
      raw = ctx.message.text.trim();
    }

    const { validate } = EDIT_FIELDS[field];
    const value = validate(raw);

    if (value === null || value === undefined) {
      return ctx.reply('⚠️ Nieprawidłowa wartość. Spróbuj ponownie.');
    }

    const { shiftId } = ctx.scene.state;
    updateShift(shiftId, { [field]: value });
    const shift = getShift(shiftId);

    if (shift.chat_id && shift.message_id) {
      try {
        await ctx.telegram.editMessageText(
          shift.chat_id, shift.message_id, undefined,
          shiftText(shift),
          { parse_mode: 'HTML', reply_markup: shiftKeyboard(shiftId) }
        );
      } catch {}
    }

    await ctx.replyWithHTML(
      `✅ <b>${EDIT_FIELDS[field].label}</b> zaktualizowano.\n\n${shiftText(shift)}\n\nKtóre pole chcesz zmienić?`,
      { reply_markup: editFieldsKeyboard() }
    );
    ctx.wizard.selectStep(1);
  }
);

editShiftScene.command('cancel', async (ctx) => {
  await ctx.reply('Edycja anulowana.');
  return ctx.scene.leave();
});

module.exports = { createShiftScene, editShiftScene };
