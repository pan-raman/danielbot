const { Scenes } = require('telegraf');
const {
  getShift, getParticipants, getManualParticipants,
  addManualParticipant, removeManualParticipant, removeTgParticipant,
} = require('../db/queries');
const { shiftText, shiftKeyboard, userName, formatDate } = require('../helpers/format');

function participantsManageKeyboard(shiftId, tgParticipants, manualParticipants) {
  const rows = [];

  // Telegram participants
  for (const u of tgParticipants) {
    rows.push([{
      text: `❌ ${userName(u)} (TG)`,
      callback_data: `rmp:tg:${shiftId}:${u.id}`,
    }]);
  }

  // Manual participants
  for (const m of manualParticipants) {
    rows.push([{
      text: `❌ ${m.name}`,
      callback_data: `rmp:manual:${shiftId}:${m.id}`,
    }]);
  }

  rows.push([{ text: '➕ Dodaj ręcznie', callback_data: `rmp:add:${shiftId}` }]);
  rows.push([{ text: '⬅️ Wróć do zmiany', callback_data: `ap:shift:${shiftId}` }]);

  return { inline_keyboard: rows };
}

async function showParticipantsManager(ctx, shiftId) {
  const shift   = getShift(shiftId);
  if (!shift) { await ctx.answerCbQuery('Zmiana nie znaleziona'); return; }

  const tg     = getParticipants(shiftId);
  const manual = getManualParticipants(shiftId);
  const total  = tg.length + manual.length;

  const text =
    `👥 <b>Uczestnicy zmiany</b>\n` +
    `📅 ${formatDate(shift.date)} | ${shift.location}\n` +
    `Zapisanych: ${total}/${shift.required}\n\n` +
    `Naciśnij ❌ przy osobie, aby ją usunąć.\n` +
    `Naciśnij ➕ aby dodać osobę ręcznie.`;

  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: participantsManageKeyboard(shiftId, tg, manual),
      });
    } catch {}
    await ctx.answerCbQuery();
  } else {
    await ctx.replyWithHTML(text, {
      reply_markup: participantsManageKeyboard(shiftId, tg, manual),
    });
  }
}

// ── Scene for adding manual participant ──────────────────────────────────────

const manageParticipantsScene = new Scenes.WizardScene(
  'manage_participants',

  // Step 0 – ask for name
  async (ctx) => {
    const shiftId = ctx.scene.state.shiftId;
    const shift   = getShift(shiftId);
    if (!shift) { await ctx.reply('Zmiana nie znaleziona.'); return ctx.scene.leave(); }

    await ctx.replyWithHTML(
      `➕ <b>Dodaj uczestnika ręcznie</b>\n\n` +
      `Podaj imię i nazwisko osoby (lub tylko imię):\n\n/cancel — anuluj`
    );
    return ctx.wizard.next();
  },

  // Step 1 – receive name and save
  async (ctx) => {
    if (!ctx.message?.text) return;
    const name    = ctx.message.text.trim();
    const shiftId = ctx.scene.state.shiftId;

    addManualParticipant(shiftId, name, ctx.from.id);

    // Update group post
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

    await ctx.reply(`✅ Dodano: ${name}`);

    // Show updated participant manager
    await showParticipantsManager(ctx, shiftId);
    return ctx.scene.leave();
  }
);

manageParticipantsScene.command('cancel', async (ctx) => {
  const shiftId = ctx.scene.state.shiftId;
  await ctx.reply('Anulowano.');
  await showParticipantsManager(ctx, shiftId);
  return ctx.scene.leave();
});

function registerParticipantCallbacks(bot) {

  // Open participant manager
  bot.action(/^ap:members:(\d+)$/, async (ctx) => {
    await showParticipantsManager(ctx, parseInt(ctx.match[1], 10));
  });

  // Remove TG participant
  bot.action(/^rmp:tg:(\d+):(\d+)$/, async (ctx) => {
    const shiftId = parseInt(ctx.match[1], 10);
    const userId  = parseInt(ctx.match[2], 10);

    removeTgParticipant(shiftId, userId);

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

    await showParticipantsManager(ctx, shiftId);
  });

  // Remove manual participant
  bot.action(/^rmp:manual:(\d+):(\d+)$/, async (ctx) => {
    const shiftId  = parseInt(ctx.match[1], 10);
    const manualId = parseInt(ctx.match[2], 10);

    removeManualParticipant(manualId);

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

    await showParticipantsManager(ctx, shiftId);
  });

  // Add manual — enter scene
  bot.action(/^rmp:add:(\d+)$/, async (ctx) => {
    const shiftId = parseInt(ctx.match[1], 10);
    await ctx.answerCbQuery();
    await ctx.scene.enter('manage_participants', { shiftId });
  });
}

module.exports = { manageParticipantsScene, registerParticipantCallbacks };
