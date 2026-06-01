const { Scenes } = require('telegraf');
const { createShift, updateShift, getShift, setShiftMessage, getSetting } = require('../db/queries');
const { shiftText, shiftKeyboard } = require('../helpers/format');

const BACK_KEYBOARD = {
  inline_keyboard: [[{ text: '⬅️ Lista zmian', callback_data: 'ap:shifts' }]],
};

const LISTA_KEYBOARD = {
  inline_keyboard: [
    [{ text: 'Heaven',  callback_data: 'lista:Heaven'  }, { text: 'Forkers', callback_data: 'lista:Forkers' }],
    [{ text: 'A2',      callback_data: 'lista:A2'      }, { text: 'Konik',   callback_data: 'lista:Konik'   }],
    [{ text: 'Kapitan', callback_data: 'lista:Kapitan' }, { text: 'Lili',    callback_data: 'lista:Lili'    }],
  ],
};

const ZBIORKA_KEYBOARD = {
  inline_keyboard: [[{ text: 'Pomiń', callback_data: 'zbiorka:skip' }]],
};

const GENDER_KEYBOARD = {
  inline_keyboard: [
    [
      { text: '👨 Tylko mężczyźni', callback_data: 'fg:male'   },
      { text: '👩 Tylko kobiety',   callback_data: 'fg:female' },
    ],
    [{ text: '👥 Wszyscy', callback_data: 'fg:all' }],
  ],
};

const DRESS_CODE_KEYBOARD = {
  inline_keyboard: [
    [{ text: 'Biała koszula',           callback_data: 'dc:Biała koszula'           }],
    [{ text: 'Czarna koszula',          callback_data: 'dc:Czarna koszula'          }],
    [{ text: 'Czarna koszula, zapaska', callback_data: 'dc:Czarna koszula, zapaska' }],
    [{ text: 'Biała koszula, zapaska',  callback_data: 'dc:Biała koszula, zapaska'  }],
    [{ text: '✏️ Wpisz własny',         callback_data: 'dc:custom'                  }],
  ],
};

function priorityKeyboard(selected) {
  return {
    inline_keyboard: [
      ['A', 'B', 'C'].map(p => ({
        text: selected.includes(p) ? `✅ ${p}` : p,
        callback_data: `prio:${p}`,
      })),
      [{ text: '➡️ Dalej', callback_data: 'prio:done' }],
    ],
  };
}

function roleKeyboard(selected) {
  return {
    inline_keyboard: [
      ['Kelner', 'Barman', 'Kuchnia'].map(r => ({
        text: selected.includes(r) ? `✅ ${r}` : r,
        callback_data: `role:${r}`,
      })),
      [{ text: '➡️ Wszyscy role', callback_data: 'role:done' }],
    ],
  };
}

function parseDate(raw) {
  const short = raw.match(/^(\d{1,2})\.(\d{1,2})$/);
  const full  = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  let day, month, year;

  if (short) {
    [, day, month] = short;
    const now = new Date();
    year = now.getFullYear();
    const candidate    = new Date(year, parseInt(month, 10) - 1, parseInt(day, 10));
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (candidate < todayMidnight) year += 1;
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
// Steps (each wizard step handles ONE piece of input):
//  0 → show date prompt
//  1 → receive date, show location prompt
//  2 → receive location, show dress_code buttons
//  3 → receive dress_code (button or custom text), show start_time prompt
//  4 → receive start_time, show end_time prompt
//  5 → receive end_time, show required prompt
//  6 → receive required, show stawka prompt
//  7 → receive stawka, show lista buttons
//  8 → receive lista, show zbiorka prompt
//  9 → receive zbiorka (text or skip), show zbiorka_contact (or jump to gender)
// 10 → receive zbiorka_contact, show gender buttons
// 11 → receive gender, show priority buttons (multi-select, stays until done)
// 12 → receive priority:done, show role buttons (multi-select, stays until done)
// 13 → receive role:done, save & post

const createShiftScene = new Scenes.WizardScene(
  'create_shift',

  // Step 0 – date
  async (ctx) => {
    ctx.scene.state.data = {};
    ctx.scene.state.waitingDcCustom = false;
    await ctx.replyWithHTML('🆕 <b>Nowa zmiana</b>\n\n📅 Podaj <b>datę</b> (DD.MM):\n\n/cancel — anuluj');
    return ctx.wizard.next();
  },

  // Step 1 – receive date, ask location
  async (ctx) => {
    if (!ctx.message?.text) return;
    const parsed = parseDate(ctx.message.text.trim());
    if (!parsed) return ctx.replyWithHTML('⚠️ Nieprawidłowa data. Spróbuj <code>25.12</code>');
    ctx.scene.state.data.date = parsed;
    await ctx.replyWithHTML('📍 Podaj <b>miejsce</b>:');
    return ctx.wizard.next();
  },

  // Step 2 – receive location, show dress_code buttons
  async (ctx) => {
    if (!ctx.message?.text) return;
    ctx.scene.state.data.location = ctx.message.text.trim();
    await ctx.replyWithHTML('👔 Wybierz <b>dress code</b>:', { reply_markup: DRESS_CODE_KEYBOARD });
    return ctx.wizard.next();
  },

  // Step 3 – receive dress_code (button or custom text), ask start_time
  async (ctx) => {
    if (ctx.scene.state.waitingDcCustom) {
      // Waiting for custom text input
      if (!ctx.message?.text) return;
      ctx.scene.state.data.dress_code = ctx.message.text.trim();
      ctx.scene.state.waitingDcCustom = false;
    } else if (ctx.callbackQuery?.data?.startsWith('dc:')) {
      const val = ctx.callbackQuery.data.replace('dc:', '');
      await ctx.answerCbQuery();
      if (val === 'custom') {
        ctx.scene.state.waitingDcCustom = true;
        await ctx.reply('Wpisz własny dress code:');
        return; // stay on this step
      }
      ctx.scene.state.data.dress_code = val;
    } else {
      return;
    }
    await ctx.replyWithHTML('🕐 Podaj <b>godzinę rozpoczęcia</b> (GG:MM):');
    return ctx.wizard.next();
  },

  // Step 4 – receive start_time, ask end_time
  async (ctx) => {
    if (!ctx.message?.text) return;
    const parsed = parseTime(ctx.message.text.trim());
    if (!parsed) return ctx.replyWithHTML('⚠️ Nieprawidłowy czas. Użyj formatu GG:MM.');
    ctx.scene.state.data.start_time = parsed;
    await ctx.replyWithHTML('🕑 Podaj <b>godzinę zakończenia</b> (GG:MM):');
    return ctx.wizard.next();
  },

  // Step 5 – receive end_time, ask required
  async (ctx) => {
    if (!ctx.message?.text) return;
    const parsed = parseTime(ctx.message.text.trim());
    if (!parsed) return ctx.replyWithHTML('⚠️ Nieprawidłowy czas. Użyj formatu GG:MM.');
    ctx.scene.state.data.end_time = parsed;
    await ctx.replyWithHTML('👥 Ile osób jest <b>wymaganych</b>? (liczba):');
    return ctx.wizard.next();
  },

  // Step 6 – receive required, ask stawka
  async (ctx) => {
    if (!ctx.message?.text) return;
    const n = parseInt(ctx.message.text.trim(), 10);
    if (isNaN(n) || n < 1) return ctx.reply('⚠️ Podaj prawidłową liczbę (minimum 1).');
    ctx.scene.state.data.required = n;
    await ctx.replyWithHTML(
      '💰 Podaj <b>stawkę godzinową</b> (zł, np. <code>25.50</code>)\n\nlub wyślij /skip aby pominąć:'
    );
    return ctx.wizard.next();
  },

  // Step 7 – receive stawka, show lista buttons
  async (ctx) => {
    if (!ctx.message?.text) return;
    const raw = ctx.message.text.trim();
    if (raw === '/skip') {
      ctx.scene.state.data.stawka = null;
    } else {
      const val = parseFloat(raw.replace(',', '.'));
      if (isNaN(val) || val < 0) return ctx.reply('⚠️ Nieprawidłowa stawka. Podaj liczbę (np. 25.50) lub /skip.');
      ctx.scene.state.data.stawka = val;
    }
    await ctx.replyWithHTML('📋 Wybierz <b>Lista do wypisu</b>:', { reply_markup: LISTA_KEYBOARD });
    return ctx.wizard.next();
  },

  // Step 8 – receive lista, ask zbiorka
  async (ctx) => {
    if (!ctx.callbackQuery?.data?.startsWith('lista:')) return;
    ctx.scene.state.data.lista = ctx.callbackQuery.data.replace('lista:', '');
    await ctx.answerCbQuery();
    await ctx.replyWithHTML('📍 Podaj <b>Zbiórka</b> (miejsce i czas) lub pomiń:', { reply_markup: ZBIORKA_KEYBOARD });
    return ctx.wizard.next();
  },

  // Step 9 – receive zbiorka, ask zbiorka_contact (or skip to gender)
  async (ctx) => {
    if (ctx.callbackQuery?.data === 'zbiorka:skip') {
      await ctx.answerCbQuery();
      ctx.scene.state.data.zbiorka         = null;
      ctx.scene.state.data.zbiorka_contact = null;
      await ctx.replyWithHTML('👥 Kto może zapisać się na tę zmianę?', { reply_markup: GENDER_KEYBOARD });
      ctx.wizard.selectStep(11); // jump to gender-receive step
      return;
    }
    if (!ctx.message?.text) return;
    ctx.scene.state.data.zbiorka = ctx.message.text.trim();
    await ctx.replyWithHTML(
      '👤 Podaj <b>osobę kontaktową</b> dla Zbiórka\n(np. <code>Jan Kowalski +48 600 100 200</code>)\n\nlub pomiń:',
      { reply_markup: ZBIORKA_KEYBOARD }
    );
    return ctx.wizard.next();
  },

  // Step 10 – receive zbiorka_contact, show gender
  async (ctx) => {
    if (ctx.callbackQuery?.data === 'zbiorka:skip') {
      await ctx.answerCbQuery();
      ctx.scene.state.data.zbiorka_contact = null;
    } else if (ctx.message?.text) {
      ctx.scene.state.data.zbiorka_contact = ctx.message.text.trim();
    } else {
      return;
    }
    await ctx.replyWithHTML('👥 Kto może zapisać się na tę zmianę?', { reply_markup: GENDER_KEYBOARD });
    return ctx.wizard.next();
  },

  // Step 11 – receive gender, show priority (multi-select)
  async (ctx) => {
    if (!ctx.callbackQuery?.data?.startsWith('fg:')) return;
    ctx.scene.state.data.for_gender = ctx.callbackQuery.data.replace('fg:', '');
    await ctx.answerCbQuery();
    ctx.scene.state.selectedPriorities = [];
    await ctx.replyWithHTML(
      '⭐ Wybierz <b>priorytet</b> pracowników (można wybrać kilka, ➡️ aby pominąć):',
      { reply_markup: priorityKeyboard([]) }
    );
    return ctx.wizard.next();
  },

  // Step 12 – priority multi-select, then show role (multi-select)
  async (ctx) => {
    if (!ctx.callbackQuery?.data) return;
    const cb = ctx.callbackQuery.data;

    if (cb.startsWith('prio:') && cb !== 'prio:done') {
      const p = cb.replace('prio:', '');
      const sel = ctx.scene.state.selectedPriorities || [];
      const idx = sel.indexOf(p);
      if (idx === -1) sel.push(p); else sel.splice(idx, 1);
      ctx.scene.state.selectedPriorities = sel;
      await ctx.editMessageReplyMarkup(priorityKeyboard(sel));
      await ctx.answerCbQuery();
      return;
    }

    await ctx.answerCbQuery();
    const sel = ctx.scene.state.selectedPriorities || [];
    ctx.scene.state.data.priority_filter = sel.length ? sel.join(',') : null;
    ctx.scene.state.selectedRoles = [];
    await ctx.replyWithHTML(
      '🍽 Wybierz <b>role</b> pracowników (można wybrać kilka, ➡️ aby pominąć):',
      { reply_markup: roleKeyboard([]) }
    );
    return ctx.wizard.next();
  },

  // Step 13 – role multi-select, then save & post
  async (ctx) => {
    if (!ctx.callbackQuery?.data) return;
    const cb = ctx.callbackQuery.data;

    if (cb.startsWith('role:') && cb !== 'role:done') {
      const r = cb.replace('role:', '');
      const sel = ctx.scene.state.selectedRoles || [];
      const idx = sel.indexOf(r);
      if (idx === -1) sel.push(r); else sel.splice(idx, 1);
      ctx.scene.state.selectedRoles = sel;
      await ctx.editMessageReplyMarkup(roleKeyboard(sel));
      await ctx.answerCbQuery();
      return;
    }

    await ctx.answerCbQuery();
    const selRoles = ctx.scene.state.selectedRoles || [];
    ctx.scene.state.data.role_filter = selRoles.length ? selRoles.join(',') : null;

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
      await ctx.replyWithHTML('✅ Zmiana utworzona!\n\n⚠️ Brak połączonej grupy.', { reply_markup: BACK_KEYBOARD });
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
  date:            { label: 'Data',            validate: parseDate,  hint: '(DD.MM)',      type: 'text'   },
  location:        { label: 'Miejsce',         validate: v => v,     hint: '',             type: 'text'   },
  dress_code:      { label: 'Dress code',      validate: v => v,     hint: '',             type: 'button' },
  start_time:      { label: 'Początek',        validate: parseTime,  hint: '(GG:MM)',      type: 'text'   },
  end_time:        { label: 'Koniec',          validate: parseTime,  hint: '(GG:MM)',      type: 'text'   },
  required:        { label: 'Liczba miejsc',   validate: v => { const n = parseInt(v, 10); return isNaN(n) || n < 1 ? null : n; }, hint: '', type: 'text' },
  stawka:          { label: 'Stawka (zł/h)',   validate: v => { if (!v || v === '/skip') return null; const n = parseFloat(v.replace(',','.')); return isNaN(n) ? null : n; }, hint: '(lub /skip)', type: 'text' },
  lista:           { label: 'Lista do wypisu', validate: v => v,         hint: '',         type: 'button' },
  zbiorka:         { label: 'Zbiórka',         validate: v => v || null, hint: '',         type: 'text'   },
  zbiorka_contact: { label: 'Zbiórka kontakt', validate: v => v || null, hint: '',         type: 'text'   },
  for_gender:      { label: 'Dla kogo (płeć)', validate: v => v,         hint: '',         type: 'button' },
  priority_filter: { label: 'Priorytet',       validate: v => v || null, hint: '',         type: 'button' },
  role_filter:     { label: 'Role',            validate: v => v || null, hint: '',         type: 'button' },
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

  // Step 1 – receive field choice, show appropriate input
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
    ctx.scene.state.waitingDcCustom = false;

    if (field === 'dress_code') {
      await ctx.replyWithHTML('👔 Wybierz <b>dress code</b>:', { reply_markup: DRESS_CODE_KEYBOARD });
    } else if (field === 'lista') {
      await ctx.replyWithHTML('📋 Wybierz <b>Lista do wypisu</b>:', { reply_markup: LISTA_KEYBOARD });
    } else if (field === 'zbiorka' || field === 'zbiorka_contact') {
      await ctx.replyWithHTML(`📍 Podaj <b>${EDIT_FIELDS[field].label}</b> lub pomiń:`, { reply_markup: ZBIORKA_KEYBOARD });
    } else if (field === 'for_gender') {
      await ctx.replyWithHTML('👥 Kto może się zapisać?', { reply_markup: GENDER_KEYBOARD });
    } else if (field === 'priority_filter') {
      const shift   = getShift(ctx.scene.state.shiftId);
      const current = shift?.priority_filter ? shift.priority_filter.split(',') : [];
      ctx.scene.state.editPriorities = current;
      await ctx.replyWithHTML('⭐ Wybierz <b>priorytet</b>:', { reply_markup: priorityKeyboard(current) });
    } else if (field === 'role_filter') {
      const shift   = getShift(ctx.scene.state.shiftId);
      const current = shift?.role_filter ? shift.role_filter.split(',') : [];
      ctx.scene.state.editRoles = current;
      await ctx.replyWithHTML('🍽 Wybierz <b>role</b>:', { reply_markup: roleKeyboard(current) });
    } else {
      const { label, hint } = EDIT_FIELDS[field];
      await ctx.replyWithHTML(`Podaj nową wartość dla <b>${label}</b> ${hint}:`);
    }
    return ctx.wizard.next();
  },

  // Step 2 – receive value, update shift
  async (ctx) => {
    const field = ctx.scene.state.editField;

    // Dress code
    if (field === 'dress_code') {
      if (ctx.scene.state.waitingDcCustom) {
        if (!ctx.message?.text) return;
        ctx.scene.state.waitingDcCustom = false;
        return applyEdit(ctx, field, ctx.message.text.trim());
      }
      if (!ctx.callbackQuery?.data?.startsWith('dc:')) return;
      const val = ctx.callbackQuery.data.replace('dc:', '');
      await ctx.answerCbQuery();
      if (val === 'custom') {
        ctx.scene.state.waitingDcCustom = true;
        await ctx.reply('Wpisz własny dress code:');
        return;
      }
      return applyEdit(ctx, field, val);
    }

    // Priority multi-select
    if (field === 'priority_filter') {
      if (!ctx.callbackQuery?.data) return;
      const cb = ctx.callbackQuery.data;
      if (cb.startsWith('prio:') && cb !== 'prio:done') {
        const p = cb.replace('prio:', '');
        const sel = ctx.scene.state.editPriorities || [];
        const idx = sel.indexOf(p);
        if (idx === -1) sel.push(p); else sel.splice(idx, 1);
        ctx.scene.state.editPriorities = sel;
        await ctx.editMessageReplyMarkup(priorityKeyboard(sel));
        await ctx.answerCbQuery();
        return;
      }
      await ctx.answerCbQuery();
      const sel = ctx.scene.state.editPriorities || [];
      return applyEdit(ctx, field, sel.length ? sel.join(',') : null, true);
    }

    // Role multi-select
    if (field === 'role_filter') {
      if (!ctx.callbackQuery?.data) return;
      const cb = ctx.callbackQuery.data;
      if (cb.startsWith('role:') && cb !== 'role:done') {
        const r = cb.replace('role:', '');
        const sel = ctx.scene.state.editRoles || [];
        const idx = sel.indexOf(r);
        if (idx === -1) sel.push(r); else sel.splice(idx, 1);
        ctx.scene.state.editRoles = sel;
        await ctx.editMessageReplyMarkup(roleKeyboard(sel));
        await ctx.answerCbQuery();
        return;
      }
      await ctx.answerCbQuery();
      const sel = ctx.scene.state.editRoles || [];
      return applyEdit(ctx, field, sel.length ? sel.join(',') : null, true);
    }

    // Lista
    if (field === 'lista') {
      if (!ctx.callbackQuery?.data?.startsWith('lista:')) return;
      await ctx.answerCbQuery();
      return applyEdit(ctx, field, ctx.callbackQuery.data.replace('lista:', ''));
    }

    // Gender
    if (field === 'for_gender') {
      if (!ctx.callbackQuery?.data?.startsWith('fg:')) return;
      await ctx.answerCbQuery();
      return applyEdit(ctx, field, ctx.callbackQuery.data.replace('fg:', ''));
    }

    // Zbiorka skip
    if ((field === 'zbiorka' || field === 'zbiorka_contact') && ctx.callbackQuery?.data === 'zbiorka:skip') {
      await ctx.answerCbQuery();
      return applyEdit(ctx, field, null, true);
    }

    // Text fields
    if (!ctx.message?.text) return;
    const raw = ctx.message.text.trim();
    const { validate } = EDIT_FIELDS[field];
    const value = validate(raw);
    if (value === null || value === undefined) {
      return ctx.reply('⚠️ Nieprawidłowa wartość. Spróbuj ponownie.');
    }
    return applyEdit(ctx, field, value);
  }
);

async function applyEdit(ctx, field, value, skipValidate = false) {
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

editShiftScene.command('cancel', async (ctx) => {
  await ctx.reply('Edycja anulowana.');
  return ctx.scene.leave();
});

module.exports = { createShiftScene, editShiftScene };
