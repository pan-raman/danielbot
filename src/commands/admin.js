const {
  getAllShifts, getShift, deleteShift, getParticipants,
  setShiftMessage, getAllUsers, setBanned, setAdmin,
  getSetting, setSetting,
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
      [{ text: '⬅️ К списку', callback_data: 'ap:shifts' }],
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
  if (!shift) { await ctx.answerCbQuery('Смена не найдена', { show_alert: true }); return; }

  const participants = getParticipants(shiftId);
  const pList = participants.length
    ? participants.map((u, i) => `${i + 1}. ${userName(u)}`).join('\n')
    : '—';

  const text = shiftText(shift) + `\n\n<b>Участники (${participants.length}/${shift.required}):</b>\n${pList}`;

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

  bot.action('ap:users', adminOnly, async (ctx) => {
    const users = getAllUsers();
    const lines = users.length
      ? users.map(u => `<code>${u.id}</code> ${userName(u)} ${u.is_admin ? '⭐' : ''} ${u.is_banned ? '🚫' : ''}`)
      : ['Пользователей пока нет.'];

    await ctx.editMessageText(
      '<b>👥 Пользователи</b>\n\n' + lines.join('\n'),
      {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'ap:menu' }]] },
      }
    );
    await ctx.answerCbQuery();
  });

  // ── Text commands (kept for power users) ────────────────────────────────

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
