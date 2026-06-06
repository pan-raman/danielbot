const {
  getAllShifts, getShift, deleteShift, getParticipants, getManualParticipants,
  setShiftMessage, getAllUsers, setBanned, setAdmin,
  getSetting, setSetting, getUser, setPriority, setRole, setStawka,
  getAllVirtualUsers, getVirtualUser, deleteVirtualUser,
} = require('../db/queries');
const { shiftText, shiftKeyboard, userName, formatDate } = require('../helpers/format');
const { adminOnly } = require('../middleware/guards');

// ── Keyboard builders ────────────────────────────────────────────────────────

function menuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '➕ Создать смену',  callback_data: 'ap:newshift' }],
      [{ text: '📋 Список смен',    callback_data: 'ap:shifts' }],
      [{ text: '👥 Пользователи',   callback_data: 'ap:users' }],
    ],
  };
}

function shiftsKeyboard(shifts) {
  const rows = shifts.map(s => {
    const count = getParticipants(s.id).length;
    return [{ text: `${formatDate(s.date)} | ${s.location} | ${count}/${s.required}`, callback_data: `ap:shift:${s.id}` }];
  });
  rows.push([{ text: '⬅️ Назад', callback_data: 'ap:menu' }]);
  return { inline_keyboard: rows };
}

function shiftDetailKeyboard(shiftId) {
  return {
    inline_keyboard: [
      [
        { text: '✏️ Редактировать', callback_data: `ap:edit:${shiftId}` },
        { text: '🗑 Удалить',        callback_data: `ap:del_confirm:${shiftId}` },
      ],
      [{ text: '👥 Uczestnícy',      callback_data: `ap:members:${shiftId}` }],
      [{ text: '⬅️ К списку',        callback_data: 'ap:shifts' }],
    ],
  };
}

function deleteConfirmKeyboard(shiftId) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Да, удалить',  callback_data: `ap:del:${shiftId}` },
        { text: '❌ Отмена',        callback_data: `ap:shift:${shiftId}` },
      ],
    ],
  };
}

function backToListKeyboard() {
  return { inline_keyboard: [[{ text: '⬅️ К списку смен', callback_data: 'ap:shifts' }]] };
}

function userPriorityKeyboard(uid, selected) {
  return {
    inline_keyboard: [
      ['A', 'B', 'C'].map(p => ({
        text: selected.includes(p) ? `✅ ${p}` : p,
        callback_data: `ap:uprio:${uid}:${p}`,
      })),
      [{ text: '✅ Zapisz', callback_data: `ap:uprio_done:${uid}` }],
      [{ text: '⬅️ Wróć',  callback_data: `ap:user:${uid}` }],
    ],
  };
}

function userRoleKeyboard(uid, selected) {
  return {
    inline_keyboard: [
      ['Kelner', 'Barman', 'Kuchnia'].map(r => ({
        text: selected.includes(r) ? `✅ ${r}` : r,
        callback_data: `ap:urole:${uid}:${r}`,
      })),
      [{ text: '✅ Zapisz', callback_data: `ap:urole_done:${uid}` }],
      [{ text: '⬅️ Wróć',  callback_data: `ap:user:${uid}` }],
    ],
  };
}

// ── Screen helpers ───────────────────────────────────────────────────────────

async function showMenu(ctx) {
  const text = '🛠 <b>Панель администратора</b>\n\nВыбери действие:';
  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: menuKeyboard() });
    await ctx.answerCbQuery();
  } else {
    await ctx.replyWithHTML(text, { reply_markup: menuKeyboard() });
  }
}

async function showShiftList(ctx) {
  const shifts = getAllShifts();
  if (!shifts.length) {
    const text = 'Смен пока нет.';
    const kb = { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'ap:menu' }]] };
    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, { reply_markup: kb });
      await ctx.answerCbQuery();
    } else {
      await ctx.reply(text, { reply_markup: kb });
    }
    return;
  }
  const text = '📋 <b>Список смен</b>\n\nВыбери смену:';
  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: shiftsKeyboard(shifts) });
    await ctx.answerCbQuery();
  } else {
    await ctx.replyWithHTML(text, { reply_markup: shiftsKeyboard(shifts) });
  }
}

async function showShiftDetail(ctx, shiftId) {
  const shift = getShift(shiftId);
  if (!shift) { await ctx.answerCbQuery('Zmiana nie znaleziona', { show_alert: true }); return; }

  const tgParticipants     = getParticipants(shiftId);
  const manualParticipants = getManualParticipants(shiftId);
  const total              = tgParticipants.length + manualParticipants.length;

  let num = 1;
  const tgLines = tgParticipants.map(u => {
    const name  = u.snap_name  || u.reg_name  || userName(u);
    const phone = u.snap_phone ? ` | 📞 ${u.snap_phone}` : '';
    const pesel = u.snap_pesel ? ` | 🪪 ${u.snap_pesel}` : '';
    const start = u.started_at ? ` | ▶️ ${u.started_at}` : ' | ▶️ —';
    const end   = u.ended_at   ? ` | ⏹ ${u.ended_at}`   : ' | ⏹ —';
    return `${num++}. ${name}${phone}${pesel}${start}${end}`;
  });

  const manualLines = manualParticipants.map(m => {
    const phone = m.phone ? ` | 📞 ${m.phone}` : '';
    const pesel = m.pesel ? ` | 🪪 ${m.pesel}` : '';
    const start = m.started_at ? ` | ▶️ ${m.started_at}` : ' | ▶️ —';
    const end   = m.ended_at   ? ` | ⏹ ${m.ended_at}`   : ' | ⏹ —';
    return `${num++}. ${m.name}${phone}${pesel}${start}${end}`;
  });

  const allLines = [...tgLines, ...manualLines];
  const pList    = allLines.length ? allLines.join('\n') : '—';

  const text = shiftText(shift) + `\n\n<b>Uczestnicy (${total}/${shift.required}):</b>\n${pList}`;

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: shiftDetailKeyboard(shiftId) });
    await ctx.answerCbQuery();
  } else {
    await ctx.replyWithHTML(text, { reply_markup: shiftDetailKeyboard(shiftId) });
  }
}

// ── Register ─────────────────────────────────────────────────────────────────

function registerAdminCommands(bot) {

  // /admin – main panel
  bot.command('admin', adminOnly, (ctx) => showMenu(ctx));

  // ── Navigation callbacks ─────────────────────────────────────────────────

  bot.action('ap:menu',   adminOnly, (ctx) => showMenu(ctx));
  bot.action('ap:shifts', adminOnly, (ctx) => showShiftList(ctx));

  bot.action(/^ap:shift:(\d+)$/, adminOnly, (ctx) =>
    showShiftDetail(ctx, parseInt(ctx.match[1], 10))
  );

  // ── Create ───────────────────────────────────────────────────────────────

  bot.action('ap:newshift', adminOnly, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.enter('create_shift');
  });

  // ── Edit ─────────────────────────────────────────────────────────────────

  bot.action(/^ap:edit:(\d+)$/, adminOnly, async (ctx) => {
    const id = parseInt(ctx.match[1], 10);
    await ctx.answerCbQuery();
    await ctx.scene.enter('edit_shift', { shiftId: id });
  });

  // ── Delete ───────────────────────────────────────────────────────────────

  bot.action(/^ap:del_confirm:(\d+)$/, adminOnly, async (ctx) => {
    const id    = parseInt(ctx.match[1], 10);
    const shift = getShift(id);
    if (!shift) { await ctx.answerCbQuery('Не найдено'); return; }
    await ctx.editMessageText(
      `🗑 Удалить смену?\n\n📅 ${formatDate(shift.date)} | ${shift.location}`,
      { reply_markup: deleteConfirmKeyboard(id) }
    );
    await ctx.answerCbQuery();
  });

  bot.action(/^ap:del:(\d+)$/, adminOnly, async (ctx) => {
    const id    = parseInt(ctx.match[1], 10);
    const shift = getShift(id);
    if (!shift) { await ctx.answerCbQuery('Не найдено'); return; }

    if (shift.chat_id && shift.message_id) {
      try { await ctx.telegram.deleteMessage(shift.chat_id, shift.message_id); } catch {}
    }
    deleteShift(id);

    await ctx.editMessageText('🗑 Смена удалена.', { reply_markup: backToListKeyboard() });
    await ctx.answerCbQuery('Удалено');
  });

  // ── Users ────────────────────────────────────────────────────────────────

  const PRIORITY_LABELS = { A: '⭐ A — VIP', B: '👍 B — dobry', C: '🔵 C — podstawowy' };

  bot.action('ap:users', adminOnly, async (ctx) => {
    const tgUsers      = getAllUsers().filter(u => u.reg_name);
    const virtualUsers = getAllVirtualUsers();

    const keyboard = { inline_keyboard: [] };

    if (tgUsers.length) {
      keyboard.inline_keyboard.push([{ text: '── Telegram ──', callback_data: 'ap:noop' }]);
      for (const u of tgUsers) {
        keyboard.inline_keyboard.push([{
          text: `${u.reg_name} ${u.priority ? `[${u.priority}]` : ''}`,
          callback_data: `ap:user:${u.id}`,
        }]);
      }
    }

    if (virtualUsers.length) {
      keyboard.inline_keyboard.push([{ text: '── Offline ──', callback_data: 'ap:noop' }]);
      for (const v of virtualUsers) {
        keyboard.inline_keyboard.push([{
          text: `📴 ${v.reg_name} ${v.priority ? `[${v.priority}]` : ''}`,
          callback_data: `ap:vuser:${v.id}`,
        }]);
      }
    }

    keyboard.inline_keyboard.push([{ text: '➕ Dodaj pracownika offline', callback_data: 'ap:create_vuser' }]);
    keyboard.inline_keyboard.push([{ text: '⬅️ Назад', callback_data: 'ap:menu' }]);

    const total = tgUsers.length + virtualUsers.length;
    await ctx.editMessageText(
      `<b>👥 Pracownicy</b> (${total})\n\nWybierz osobę lub dodaj nową:`,
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
    await ctx.answerCbQuery();
  });

  bot.action('ap:noop', (ctx) => ctx.answerCbQuery());

  // Create virtual user
  bot.action('ap:create_vuser', adminOnly, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.enter('create_virtual_user');
  });

  // Virtual user detail
  bot.action(/^ap:vuser:(\d+)$/, adminOnly, async (ctx) => {
    const id   = parseInt(ctx.match[1], 10);
    const user = getVirtualUser(id);
    if (!user) { await ctx.answerCbQuery('Nie znaleziono'); return; }

    const text =
      `📴 <b>${user.reg_name}</b> <i>(offline)</i>\n` +
      `📞 ${user.reg_phone || '—'}\n` +
      `🪪 ${user.reg_pesel || '—'}\n` +
      `👥 ${user.gender === 'male' ? '👨 Mężczyzna' : user.gender === 'female' ? '👩 Kobieta' : '—'}\n` +
      `🍽 ${user.role || '—'}\n` +
      `⭐ ${user.priority || '—'}\n` +
      `💰 ${user.stawka ? `${user.stawka} zł/h` : '—'}`;

    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🗑 Usuń',   callback_data: `ap:del_vuser:${id}` }],
          [{ text: '⬅️ Wróć',  callback_data: 'ap:users'           }],
        ],
      },
    });
    await ctx.answerCbQuery();
  });

  // Delete virtual user
  bot.action(/^ap:del_vuser:(\d+)$/, adminOnly, async (ctx) => {
    const id = parseInt(ctx.match[1], 10);
    deleteVirtualUser(id);
    await ctx.editMessageText('🗑 Pracownik offline usunięty.', {
      reply_markup: { inline_keyboard: [[{ text: '⬅️ Wróć', callback_data: 'ap:users' }]] },
    });
    await ctx.answerCbQuery('Usunięto');
  });

  bot.action(/^ap:user:(\d+)$/, adminOnly, async (ctx) => {
    const uid  = parseInt(ctx.match[1], 10);
    const user = getUser(uid);
    if (!user) { await ctx.answerCbQuery('Nie znaleziono'); return; }

    const currentPrio  = user.priority ? user.priority.split(',') : [];
    const currentRole  = user.role || '—';
    const currentStawk = user.stawka ? `${user.stawka} zł/h` : '—';

    const text =
      `👤 <b>${user.reg_name || userName(user)}</b>\n` +
      `📞 ${user.reg_phone || '—'}\n` +
      `🪪 ${user.reg_pesel || '—'}\n` +
      `⭐ Priorytet: <b>${currentPrio.length ? currentPrio.join(', ') : '—'}</b>\n` +
      `🍽 Rola: <b>${currentRole}</b>\n` +
      `💰 Stawka: <b>${currentStawk}</b>\n\n` +
      `Wybierz co chcesz zmienić:`;

    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '⭐ Zmień priorytet', callback_data: `ap:editprio:${uid}` }],
          [{ text: '🍽 Zmień rolę',      callback_data: `ap:editrole:${uid}` }],
          [{ text: '💰 Zmień stawkę',    callback_data: `ap:editstawka:${uid}` }],
          [{ text: '⬅️ Wróć',            callback_data: 'ap:users'            }],
        ],
      },
    });
    await ctx.answerCbQuery();
  });

  // Priority edit
  bot.action(/^ap:editprio:(\d+)$/, adminOnly, async (ctx) => {
    const uid  = parseInt(ctx.match[1], 10);
    const user = getUser(uid);
    if (!user) { await ctx.answerCbQuery(); return; }
    const current = user.priority ? user.priority.split(',') : [];
    await ctx.editMessageText(
      `⭐ <b>Priorytet</b> — ${user.reg_name || userName(user)}\n\nAktualny: <b>${current.join(', ') || '—'}</b>\n\nWybierz (można kilka):`,
      { parse_mode: 'HTML', reply_markup: userPriorityKeyboard(uid, current) }
    );
    await ctx.answerCbQuery();
  });

  bot.action(/^ap:uprio:(\d+):([ABC])$/, adminOnly, async (ctx) => {
    const uid  = parseInt(ctx.match[1], 10);
    const p    = ctx.match[2];
    const user = getUser(uid);
    if (!user) { await ctx.answerCbQuery(); return; }
    const current = user.priority ? user.priority.split(',') : [];
    const idx = current.indexOf(p);
    if (idx === -1) current.push(p); else current.splice(idx, 1);
    current.sort();
    setPriority(uid, current.length ? current.join(',') : null);
    await ctx.editMessageReplyMarkup(userPriorityKeyboard(uid, current));
    await ctx.answerCbQuery(`${p} ${idx === -1 ? 'dodano' : 'usunięto'}`);
  });

  bot.action(/^ap:uprio_done:(\d+)$/, adminOnly, async (ctx) => {
    const uid  = parseInt(ctx.match[1], 10);
    const user = getUser(uid);
    await ctx.editMessageText(
      `✅ Priorytet zapisany: <b>${user?.priority || '—'}</b>`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '⬅️ Do pracownika', callback_data: `ap:user:${uid}` }]] } }
    );
    await ctx.answerCbQuery('✅ Zapisano');
  });

  // Role edit
  bot.action(/^ap:editrole:(\d+)$/, adminOnly, async (ctx) => {
    const uid  = parseInt(ctx.match[1], 10);
    const user = getUser(uid);
    if (!user) { await ctx.answerCbQuery(); return; }
    const current = user.role ? user.role.split(',') : [];
    await ctx.editMessageText(
      `🍽 <b>Rola</b> — ${user.reg_name || userName(user)}\n\nAktualna: <b>${current.join(', ') || '—'}</b>\n\nWybierz (można kilka):`,
      { parse_mode: 'HTML', reply_markup: userRoleKeyboard(uid, current) }
    );
    await ctx.answerCbQuery();
  });

  bot.action(/^ap:urole:(\d+):(Kelner|Barman|Kuchnia)$/, adminOnly, async (ctx) => {
    const uid  = parseInt(ctx.match[1], 10);
    const r    = ctx.match[2];
    const user = getUser(uid);
    if (!user) { await ctx.answerCbQuery(); return; }
    const current = user.role ? user.role.split(',') : [];
    const idx = current.indexOf(r);
    if (idx === -1) current.push(r); else current.splice(idx, 1);
    setRole(uid, current.length ? current.join(',') : null);
    await ctx.editMessageReplyMarkup(userRoleKeyboard(uid, current));
    await ctx.answerCbQuery(`${r} ${idx === -1 ? 'dodano' : 'usunięto'}`);
  });

  bot.action(/^ap:urole_done:(\d+)$/, adminOnly, async (ctx) => {
    const uid  = parseInt(ctx.match[1], 10);
    const user = getUser(uid);
    await ctx.editMessageText(
      `✅ Rola zapisana: <b>${user?.role || '—'}</b>`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '⬅️ Do pracownika', callback_data: `ap:user:${uid}` }]] } }
    );
    await ctx.answerCbQuery('✅ Zapisano');
  });

  // Stawka edit
  bot.action(/^ap:editstawka:(\d+)$/, adminOnly, async (ctx) => {
    const uid  = parseInt(ctx.match[1], 10);
    const user = getUser(uid);
    if (!user) { await ctx.answerCbQuery(); return; }

    ctx.session.awaitingStawka = uid;
    await ctx.editMessageText(
      `💰 <b>Stawka</b> — ${user.reg_name || userName(user)}\n\n` +
      `Aktualna: <b>${user.stawka ? `${user.stawka} zł/h` : '—'}</b>\n\n` +
      `Wpisz nową stawkę (np. <code>37.00</code>) lub /usun aby wyczyścić:`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '⬅️ Anuluj', callback_data: `ap:user:${uid}` }]] } }
    );
    await ctx.answerCbQuery();
  });

  // Receive stawka text input
  bot.hears(/^[\d]+([.,][\d]{1,2})?$/, adminOnly, async (ctx) => {
    const uid = ctx.session?.awaitingStawka;
    if (!uid) return;
    const val = parseFloat(ctx.message.text.replace(',', '.'));
    if (isNaN(val) || val < 0) return ctx.reply('⚠️ Nieprawidłowa wartość.');
    setStawka(uid, val);
    ctx.session.awaitingStawka = null;
    const user = getUser(uid);
    await ctx.reply(
      `✅ Stawka <b>${val} zł/h</b> zapisana dla <b>${user.reg_name || userName(user)}</b>`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '⬅️ Do pracownika', callback_data: `ap:user:${uid}` }]] } }
    );
  });

  bot.command('usun', adminOnly, async (ctx) => {
    const uid = ctx.session?.awaitingStawka;
    if (!uid) return;
    setStawka(uid, null);
    ctx.session.awaitingStawka = null;
    const user = getUser(uid);
    await ctx.reply(`✅ Stawka usunięta dla <b>${user.reg_name || userName(user)}</b>`, { parse_mode: 'HTML' });
  });

  // ── Text commands (kept for power users) ────────────────────────────────

  bot.command('testreminder', adminOnly, async (ctx) => {
    const { runReminderCheck } = require('../reminders');
    const { getAllShifts, getParticipants } = require('../db/queries');

    const now = new Date();
    const nowStr  = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

    const shifts = getAllShifts();

    let report = `🔍 <b>Reminder debug</b>\n\n`;
    report += `🕐 Bot time: <b>${nowStr}</b>\n`;
    report += `📅 Today: <b>${dateStr}</b>\n`;
    report += `🌍 TZ: <b>${process.env.TZ || 'not set'}</b>\n\n`;
    report += `All shifts in DB: <b>${shifts.length}</b>\n`;

    for (const s of shifts) {
      const p = getParticipants(s.id);
      const match = s.date === dateStr ? ' ← TODAY' : '';
      report += `\n#${s.id} | ${s.date}${match} | ${s.start_time}–${s.end_time} | ${s.location} | ${p.length} participants`;
    }

    await ctx.replyWithHTML(report);

    try {
      await runReminderCheck(bot);
      await ctx.reply('✅ Reminder check ran successfully.');
    } catch (e) {
      await ctx.reply(`❌ Error in runReminderCheck: ${e.message}`);
    }
  });

  bot.command('setchat', adminOnly, async (ctx) => {
    if (ctx.chat.type === 'private') {
      return ctx.reply('⚠️ Выполни эту команду внутри группы, которую хочешь привязать.');
    }
    setSetting('target_chat_id', ctx.chat.id);
    await ctx.reply('✅ Группа привязана! Все новые смены будут публиковаться здесь.');
  });

  bot.command('ban', adminOnly, async (ctx) => {
    const uid = parseInt(ctx.message.text.split(' ')[1], 10);
    if (isNaN(uid)) return ctx.reply('Использование: /ban <id>');
    setBanned(uid, true);
    await ctx.reply(`🚫 Пользователь ${uid} заблокирован.`);
  });

  bot.command('unban', adminOnly, async (ctx) => {
    const uid = parseInt(ctx.message.text.split(' ')[1], 10);
    if (isNaN(uid)) return ctx.reply('Использование: /unban <id>');
    setBanned(uid, false);
    await ctx.reply(`✅ Пользователь ${uid} разблокирован.`);
  });

  bot.command('makeadmin', adminOnly, async (ctx) => {
    const uid = parseInt(ctx.message.text.split(' ')[1], 10);
    if (isNaN(uid)) return ctx.reply('Использование: /makeadmin <id>');
    setAdmin(uid, true);
    await ctx.reply(`⭐ Пользователь ${uid} назначен администратором.`);
  });

  bot.command('removeadmin', adminOnly, async (ctx) => {
    const uid = parseInt(ctx.message.text.split(' ')[1], 10);
    if (isNaN(uid)) return ctx.reply('Использование: /removeadmin <id>');
    setAdmin(uid, false);
    await ctx.reply(`Пользователь ${uid} разжалован.`);
  });
}

module.exports = { registerAdminCommands, backToListKeyboard };
