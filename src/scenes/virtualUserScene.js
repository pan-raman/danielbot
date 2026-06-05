const { Scenes } = require('telegraf');
const { createVirtualUser, updateVirtualUser, getAllVirtualUsers, getVirtualUser, deleteVirtualUser } = require('../db/queries');

const GENDER_KEYBOARD = {
  inline_keyboard: [
    [{ text: '👨 Mężczyzna', callback_data: 'vu_gender:male'   }],
    [{ text: '👩 Kobieta',   callback_data: 'vu_gender:female' }],
    [{ text: '➡️ Pomiń',     callback_data: 'vu_gender:skip'   }],
  ],
};

function roleKeyboard(selected) {
  return {
    inline_keyboard: [
      ['Kelner', 'Barman', 'Kuchnia'].map(r => ({
        text: selected.includes(r) ? `✅ ${r}` : r,
        callback_data: `vu_role:${r}`,
      })),
      [{ text: '➡️ Dalej', callback_data: 'vu_role:done' }],
    ],
  };
}

function priorityKeyboard(selected) {
  return {
    inline_keyboard: [
      ['A', 'B', 'C'].map(p => ({
        text: selected.includes(p) ? `✅ ${p}` : p,
        callback_data: `vu_prio:${p}`,
      })),
      [{ text: '➡️ Dalej', callback_data: 'vu_prio:done' }],
    ],
  };
}

// ── Create Virtual User Scene ─────────────────────────────────────────────────

const createVirtualUserScene = new Scenes.WizardScene(
  'create_virtual_user',

  // Step 0 – imię i nazwisko
  async (ctx) => {
    ctx.scene.state.data = {};
    await ctx.replyWithHTML(
      '👤 <b>Nowy pracownik (offline)</b>\n\n' +
      'Krok 1/6 — Podaj <b>imię i nazwisko</b>:\n\n/cancel — anuluj'
    );
    return ctx.wizard.next();
  },

  // Step 1 – receive name, ask phone
  async (ctx) => {
    if (!ctx.message?.text) return;
    ctx.scene.state.data.reg_name = ctx.message.text.trim();
    await ctx.replyWithHTML('Krok 2/6 — Podaj <b>numer telefonu</b> lub /skip:');
    return ctx.wizard.next();
  },

  // Step 2 – receive phone, ask pesel
  async (ctx) => {
    if (!ctx.message?.text) return;
    const raw = ctx.message.text.trim();
    if (raw !== '/skip') {
      if (!/^[\d\s\+\-\(\)]{7,20}$/.test(raw)) return ctx.reply('⚠️ Nieprawidłowy numer. Spróbuj ponownie lub /skip:');
      ctx.scene.state.data.reg_phone = raw;
    }
    await ctx.replyWithHTML('Krok 3/6 — Podaj <b>PESEL</b> lub /skip:');
    return ctx.wizard.next();
  },

  // Step 3 – receive pesel, ask gender
  async (ctx) => {
    if (!ctx.message?.text) return;
    const raw = ctx.message.text.trim();
    if (raw !== '/skip') {
      if (!/^\d{11}$/.test(raw)) return ctx.reply('⚠️ PESEL musi mieć 11 cyfr lub /skip:');
      ctx.scene.state.data.reg_pesel = raw;
    }
    await ctx.replyWithHTML('Krok 4/6 — Wybierz <b>płeć</b>:', { reply_markup: GENDER_KEYBOARD });
    return ctx.wizard.next();
  },

  // Step 4 – receive gender, ask role
  async (ctx) => {
    if (!ctx.callbackQuery?.data?.startsWith('vu_gender:')) return;
    const val = ctx.callbackQuery.data.replace('vu_gender:', '');
    await ctx.answerCbQuery();
    if (val !== 'skip') ctx.scene.state.data.gender = val;
    ctx.scene.state.selectedRoles = [];
    await ctx.replyWithHTML('Krok 5/6 — Wybierz <b>rolę</b>:', { reply_markup: roleKeyboard([]) });
    return ctx.wizard.next();
  },

  // Step 5 – role multi-select, then ask priority
  async (ctx) => {
    if (!ctx.callbackQuery?.data) return;
    const cb = ctx.callbackQuery.data;
    if (cb.startsWith('vu_role:') && cb !== 'vu_role:done') {
      const r = cb.replace('vu_role:', '');
      const sel = ctx.scene.state.selectedRoles || [];
      const idx = sel.indexOf(r);
      if (idx === -1) sel.push(r); else sel.splice(idx, 1);
      ctx.scene.state.selectedRoles = sel;
      await ctx.editMessageReplyMarkup(roleKeyboard(sel));
      await ctx.answerCbQuery();
      return;
    }
    await ctx.answerCbQuery();
    const sel = ctx.scene.state.selectedRoles || [];
    ctx.scene.state.data.role = sel.length ? sel.join(',') : null;
    ctx.scene.state.selectedPriorities = [];
    await ctx.replyWithHTML('Krok 6/6 — Wybierz <b>priorytet</b>:', { reply_markup: priorityKeyboard([]) });
    return ctx.wizard.next();
  },

  // Step 6 – priority multi-select, ask stawka, then save
  async (ctx) => {
    if (ctx.callbackQuery?.data) {
      const cb = ctx.callbackQuery.data;
      if (cb.startsWith('vu_prio:') && cb !== 'vu_prio:done') {
        const p = cb.replace('vu_prio:', '');
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
      ctx.scene.state.data.priority = sel.length ? sel.join(',') : null;
      await ctx.replyWithHTML('💰 Podaj <b>stawkę godzinową</b> (np. <code>37.00</code>) lub /skip:');
      return ctx.wizard.next();
    }
  },

  // Step 7 – receive stawka, save
  async (ctx) => {
    if (!ctx.message?.text) return;
    const raw = ctx.message.text.trim();
    if (raw !== '/skip') {
      const val = parseFloat(raw.replace(',', '.'));
      if (isNaN(val) || val < 0) return ctx.reply('⚠️ Nieprawidłowa stawka lub /skip:');
      ctx.scene.state.data.stawka = val;
    }

    const { data } = ctx.scene.state;
    const id = createVirtualUser({ ...data, created_by: ctx.from.id });
    const user = getVirtualUser(id);

    await ctx.replyWithHTML(
      `✅ <b>Pracownik offline utworzony!</b>\n\n` +
      `👤 ${user.reg_name}\n` +
      `📞 ${user.reg_phone || '—'}\n` +
      `🪪 ${user.reg_pesel || '—'}\n` +
      `👥 ${user.gender === 'male' ? '👨 Mężczyzna' : user.gender === 'female' ? '👩 Kobieta' : '—'}\n` +
      `🍽 ${user.role || '—'}\n` +
      `⭐ ${user.priority || '—'}\n` +
      `💰 ${user.stawka ? `${user.stawka} zł/h` : '—'}`
    );
    return ctx.scene.leave();
  }
);

createVirtualUserScene.command('cancel', async (ctx) => {
  await ctx.reply('Anulowano.');
  return ctx.scene.leave();
});

module.exports = { createVirtualUserScene };
