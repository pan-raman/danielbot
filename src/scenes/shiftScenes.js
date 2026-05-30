const { Scenes } = require('telegraf');
const { createShift, updateShift, getShift, setShiftMessage, getSetting } = require('../db/queries');
const { shiftText, shiftKeyboard } = require('../helpers/format');

const BACK_KEYBOARD = {
  inline_keyboard: [[{ text: '⬅️ К списку смен', callback_data: 'ap:shifts' }]],
};

// ── Step definitions ────────────────────────────────────────────────────────

const STEPS = [
  { key: 'date',       prompt: '📅 Введи <b>дату</b> смены в формате ДД.ММ (например: 25.12):' },
  { key: 'location',   prompt: '📍 Enter the <b>location</b>:' },
  { key: 'dress_code', prompt: '👔 Enter the <b>dress code</b>:' },
  { key: 'start_time', prompt: '🕐 Enter the <b>start time</b> (HH:MM):' },
  { key: 'end_time',   prompt: '🕑 Enter the <b>end time</b> (HH:MM):' },
  { key: 'required',   prompt: '👥 How many people are <b>required</b>? (number):' },
];

function parseDate(raw) {
  // Accept DD.MM or DD.MM.YYYY
  const short = raw.match(/^(\d{1,2})\.(\d{1,2})$/);
  const full  = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);

  let day, month, year;

  if (short) {
    [, day, month] = short;
    const now = new Date();
    year = now.getFullYear();
    // If the date has already passed this year, use next year
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

  // Validate
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
      '🆕 <b>New Shift</b>\n\nLet\'s fill in the details step by step.\n\n' +
      STEPS[0].prompt +
      '\n\n/cancel to abort'
    );
    return ctx.wizard.next();
  },

  // Steps 1-5 – generic handler driven by STEPS array
  ...STEPS.slice(1).map((step, i) => async (ctx) => {
    if (!ctx.message?.text) return;
    const prevKey = STEPS[i].key;
    const raw = ctx.message.text.trim();

    // Validate previous input
    if (prevKey === 'date') {
      const parsed = parseDate(raw);
      if (!parsed) return ctx.replyWithHTML('⚠️ Invalid date. Try <code>2024-12-31</code> or <code>31.12.2024</code>');
      ctx.scene.state.data[prevKey] = parsed;
    } else if (prevKey === 'start_time' || prevKey === 'end_time') {
      const parsed = parseTime(raw);
      if (!parsed) return ctx.replyWithHTML('⚠️ Invalid time. Use HH:MM format.');
      ctx.scene.state.data[prevKey] = parsed;
    } else {
      ctx.scene.state.data[prevKey] = raw;
    }

    await ctx.replyWithHTML(step.prompt);
    return ctx.wizard.next();
  }),

  // Final step – validate last field and save
  async (ctx) => {
    if (!ctx.message?.text) return;
    const raw = ctx.message.text.trim();
    const lastStep = STEPS[STEPS.length - 1];

    if (lastStep.key === 'required') {
      const n = parseInt(raw, 10);
      if (isNaN(n) || n < 1) return ctx.reply('⚠️ Please enter a valid number (minimum 1).');
      ctx.scene.state.data.required = n;
    } else {
      ctx.scene.state.data[lastStep.key] = raw;
    }

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
      await ctx.reply(`✅ Shift #${shiftId} posted to the group!`);
    } else {
      sent = await ctx.replyWithHTML(shiftText(shift), {
        reply_markup: shiftKeyboard(shiftId),
      });
      await ctx.reply(`✅ Shift #${shiftId} created!\n\n⚠️ No group linked yet. Use /setchat in your group to link it.`);
    }

    setShiftMessage(shiftId, sent.chat.id, sent.message_id);
    await ctx.replyWithHTML(`✅ Смена создана!`, { reply_markup: BACK_KEYBOARD });
    return ctx.scene.leave();
  }
);

// Cancel command inside wizard
createShiftScene.command('cancel', async (ctx) => {
  await ctx.reply('❌ Shift creation cancelled.');
  return ctx.scene.leave();
});

// ── Edit Shift Scene ─────────────────────────────────────────────────────────

const EDIT_FIELDS = {
  date:       { label: 'Дата',          validate: parseDate,  hint: '(ДД.ММ)' },
  location:   { label: 'Место',         validate: v => v,     hint: '' },
  dress_code: { label: 'Дресс-код',     validate: v => v,     hint: '' },
  start_time: { label: 'Начало',        validate: parseTime,  hint: '(ЧЧ:ММ)' },
  end_time:   { label: 'Конец',         validate: parseTime,  hint: '(ЧЧ:ММ)' },
  required:   { label: 'Кол-во мест',   validate: v => { const n = parseInt(v, 10); return isNaN(n) || n < 1 ? null : n; }, hint: '' },
};

function editFieldsKeyboard() {
  return {
    inline_keyboard: Object.entries(EDIT_FIELDS).map(([key, { label }]) => (
      [{ text: label, callback_data: `editfield:${key}` }]
    )).concat([[{ text: '✅ Завершить редактирование', callback_data: 'editfield:done' }]]),
  };
}

const editShiftScene = new Scenes.WizardScene(
  'edit_shift',

  // Step 0 – show field picker
  async (ctx) => {
    const shiftId = ctx.scene.state.shiftId;
    const shift   = getShift(shiftId);
    if (!shift) { await ctx.reply('Смена не найдена.'); return ctx.scene.leave(); }

    await ctx.replyWithHTML(
      `✏️ <b>Редактировать смену</b>\n\n${shiftText(shift)}\n\nКакое поле изменить?`,
      { reply_markup: editFieldsKeyboard() }
    );
    return ctx.wizard.next();
  },

  // Step 1 – wait for field choice
  async (ctx) => {
    if (!ctx.callbackQuery?.data) return;
    const data = ctx.callbackQuery.data;
    await ctx.answerCbQuery();

    if (data === 'editfield:done') {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      await ctx.reply('✅ Редактирование завершено.', { reply_markup: BACK_KEYBOARD });
      return ctx.scene.leave();
    }

    const field = data.replace('editfield:', '');
    if (!EDIT_FIELDS[field]) return;

    ctx.scene.state.editField = field;
    const { label, hint } = EDIT_FIELDS[field];
    await ctx.replyWithHTML(`Введи новое значение для <b>${label}</b> ${hint}:`);
    return ctx.wizard.next();
  },

  // Step 2 – receive new value, save, go back to step 0
  async (ctx) => {
    if (!ctx.message?.text) return;
    const raw   = ctx.message.text.trim();
    const field = ctx.scene.state.editField;
    const { validate } = EDIT_FIELDS[field];
    const value = validate(raw);

    if (value === null || value === undefined) {
      return ctx.reply('⚠️ Неверное значение. Попробуй ещё раз.');
    }

    const { shiftId } = ctx.scene.state;
    updateShift(shiftId, { [field]: value });
    const shift = getShift(shiftId);

    // Update the group post
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
      `✅ <b>${EDIT_FIELDS[field].label}</b> обновлено.\n\n${shiftText(shift)}\n\nКакое поле изменить ещё?`,
      { reply_markup: editFieldsKeyboard() }
    );
    // Go back to step 1 (field picker)
    ctx.wizard.selectStep(1);
  }
);

editShiftScene.command('cancel', async (ctx) => {
  await ctx.reply('Edit cancelled.');
  return ctx.scene.leave();
});

module.exports = { createShiftScene, editShiftScene };
