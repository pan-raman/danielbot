const { Scenes } = require('telegraf');
const {
  getShift, getParticipants, getManualParticipants,
  addManualParticipant, removeManualParticipant, removeTgParticipant,
  getAllVirtualUsers, getParticipantRow, setParticipantTime,
} = require('../db/queries');
const { shiftText, shiftKeyboard, userName, formatDate } = require('../helpers/format');

function participantsManageKeyboard(shiftId, tgParticipants, manualParticipants) {
  const rows = [];

  for (const u of tgParticipants) {
    rows.push([{
      text: `❌ ${userName(u)} (TG)`,
      callback_data: `rmp:tg:${shiftId}:${u.id}`,
    }]);
  }

  for (const m of manualParticipants) {
    rows.push([{
      text: `❌ ${m.name}`,
      callback_data: `rmp:manual:${shiftId}:${m.id}`,
    }]);
  }

  rows.push([
    { text: '➕ Z listy offline', callback_data: `rmp:addv:${shiftId}` },
    { text: '✏️ Wpisz ręcznie',   callback_data: `rmp:add:${shiftId}`  },
  ]);
  rows.push([{ text: '⏱ Edytuj czas pracy', callback_data: `rmp:times:${shiftId}` }]);
  rows.push([{ text: '⬅️ Wróć do zmiany', callback_data: `ap:shift:${shiftId}` }]);

  return { inline_keyboard: rows };
}

async function showParticipantsManager(ctx, shiftId) {
  const shift  = getShift(shiftId);
  if (!shift) { await ctx.answerCbQuery('Zmiana nie znaleziona'); return; }

  const tg     = getParticipants(shiftId);
  const manual = getManualParticipants(shiftId);
  const total  = tg.length + manual.length;

  const text =
    `👥 <b>Uczestnicy zmiany</b>\n` +
    `📅 ${formatDate(shift.date)} | ${shift.location}\n` +
    `Zapisanych: ${total}/${shift.required}\n\n` +
    `Naciśnij ❌ aby usunąć uczestnika.`;

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

// ── Scene for adding manual participant (typed name) ─────────────────────────

const manageParticipantsScene = new Scenes.WizardScene(
  'manage_participants',

  async (ctx) => {
    const shiftId = ctx.scene.state.shiftId;
    const shift   = getShift(shiftId);
    if (!shift) { await ctx.reply('Zmiana nie znaleziona.'); return ctx.scene.leave(); }

    await ctx.replyWithHTML(
      `✏️ <b>Dodaj uczestnika ręcznie</b>\n\nPodaj imię i nazwisko:\n\n/cancel — anuluj`
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message?.text) return;
    const name    = ctx.message.text.trim();
    const shiftId = ctx.scene.state.shiftId;

    addManualParticipant(shiftId, name, ctx.from.id);

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

  bot.action(/^ap:members:(\d+)$/, async (ctx) => {
    await showParticipantsManager(ctx, parseInt(ctx.match[1], 10));
  });

  bot.action(/^rmp:tg:(\d+):(\d+)$/, async (ctx) => {
    const shiftId = parseInt(ctx.match[1], 10);
    const userId  = parseInt(ctx.match[2], 10);
    removeTgParticipant(shiftId, userId);
    const shift = getShift(shiftId);
    if (shift.chat_id && shift.message_id) {
      try { await ctx.telegram.editMessageText(shift.chat_id, shift.message_id, undefined, shiftText(shift), { parse_mode: 'HTML', reply_markup: shiftKeyboard(shiftId) }); } catch {}
    }
    await showParticipantsManager(ctx, shiftId);
  });

  bot.action(/^rmp:manual:(\d+):(\d+)$/, async (ctx) => {
    const shiftId  = parseInt(ctx.match[1], 10);
    const manualId = parseInt(ctx.match[2], 10);
    removeManualParticipant(manualId);
    const shift = getShift(shiftId);
    if (shift.chat_id && shift.message_id) {
      try { await ctx.telegram.editMessageText(shift.chat_id, shift.message_id, undefined, shiftText(shift), { parse_mode: 'HTML', reply_markup: shiftKeyboard(shiftId) }); } catch {}
    }
    await showParticipantsManager(ctx, shiftId);
  });

  // Add typed manually
  bot.action(/^rmp:add:(\d+)$/, async (ctx) => {
    const shiftId = parseInt(ctx.match[1], 10);
    await ctx.answerCbQuery();
    await ctx.scene.enter('manage_participants', { shiftId });
  });

  // Add from virtual users list
  bot.action(/^rmp:addv:(\d+)$/, async (ctx) => {
    const shiftId = parseInt(ctx.match[1], 10);
    const vusers  = getAllVirtualUsers();
    await ctx.answerCbQuery();

    if (!vusers.length) {
      return ctx.reply('Brak pracowników offline. Dodaj ich najpierw w sekcji Pracownicy.');
    }

    const rows = vusers.map(v => [{
      text: `${v.reg_name}${v.role ? ` (${v.role})` : ''}`,
      callback_data: `rmp:addvpick:${shiftId}:${v.id}`,
    }]);
    rows.push([{ text: '⬅️ Anuluj', callback_data: `ap:members:${shiftId}` }]);

    await ctx.replyWithHTML(
      '📴 <b>Wybierz pracownika offline:</b>',
      { reply_markup: { inline_keyboard: rows } }
    );
  });

  // Edit participant times
  bot.action(/^rmp:times:(\d+)$/, async (ctx) => {
    const shiftId = parseInt(ctx.match[1], 10);
    const shift   = getShift(shiftId);
    const ps      = getParticipants(shiftId);
    await ctx.answerCbQuery();

    if (!ps.length) {
      return ctx.reply('Brak uczestników z Telegrama do edycji czasu.');
    }

    const rows = ps.map(u => {
      const row = getParticipantRow(shiftId, u.id);
      const start = row?.started_at || '—';
      const end   = row?.ended_at   || '—';
      return [{
        text: `${u.snap_name || u.reg_name || u.first_name}: ${start}→${end}`,
        callback_data: `rmp:edittime:${shiftId}:${u.id}`,
      }];
    });
    rows.push([{ text: '⬅️ Wróć', callback_data: `ap:members:${shiftId}` }]);

    await ctx.replyWithHTML(
      `⏱ <b>Edytuj czas pracy</b>\n📅 ${formatDate(shift.date)} | ${shift.location}\n\nWybierz uczestnika:`,
      { reply_markup: { inline_keyboard: rows } }
    );
  });

  bot.action(/^rmp:edittime:(\d+):(\d+)$/, async (ctx) => {
    const shiftId = parseInt(ctx.match[1], 10);
    const userId  = parseInt(ctx.match[2], 10);
    const row     = getParticipantRow(shiftId, userId);
    await ctx.answerCbQuery();

    await ctx.replyWithHTML(
      `⏱ Aktualny czas:\n▶️ Start: <b>${row?.started_at || '—'}</b>\n⏹ Koniec: <b>${row?.ended_at || '—'}</b>\n\nCo chcesz zmienić?`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '▶️ Zmień start',  callback_data: `rmp:settime:${shiftId}:${userId}:start` }],
            [{ text: '⏹ Zmień koniec', callback_data: `rmp:settime:${shiftId}:${userId}:end`   }],
            [{ text: '🗑 Wyczyść oba',  callback_data: `rmp:cleartime:${shiftId}:${userId}`      }],
            [{ text: '⬅️ Wróć',         callback_data: `rmp:times:${shiftId}`                   }],
          ],
        },
      }
    );
  });

  bot.action(/^rmp:cleartime:(\d+):(\d+)$/, async (ctx) => {
    const shiftId = parseInt(ctx.match[1], 10);
    const userId  = parseInt(ctx.match[2], 10);
    setParticipantTime(shiftId, userId, 'started_at', null);
    setParticipantTime(shiftId, userId, 'ended_at', null);
    await ctx.answerCbQuery('✅ Wyczyszczono');
    await ctx.editMessageText('✅ Czas pracy wyczyszczony.', {
      reply_markup: { inline_keyboard: [[{ text: '⬅️ Wróć', callback_data: `rmp:times:${shiftId}` }]] },
    });
  });

  bot.action(/^rmp:settime:(\d+):(\d+):(start|end)$/, async (ctx) => {
    const shiftId = parseInt(ctx.match[1], 10);
    const userId  = parseInt(ctx.match[2], 10);
    const field   = ctx.match[3];
    await ctx.answerCbQuery();
    ctx.session.editTime = { shiftId, userId, field };
    const label = field === 'start' ? 'START' : 'KONIEC';
    await ctx.reply(`Podaj czas ${label} w formacie GG:MM (np. 12:30):\n\n/cancel — anuluj`);
  });

  bot.hears(/^\d{1,2}:\d{2}$/, async (ctx) => {
    if (!ctx.session?.editTime) return;
    const { shiftId, userId, field } = ctx.session.editTime;
    const raw = ctx.message.text.trim();
    const parsed = raw.length === 4 ? `0${raw}` : raw;
    const dbField = field === 'start' ? 'started_at' : 'ended_at';
    setParticipantTime(shiftId, userId, dbField, parsed);
    ctx.session.editTime = null;
    await ctx.reply(`✅ Czas ${field === 'start' ? 'START' : 'KONIEC'} ustawiony: <b>${parsed}</b>`, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '⬅️ Wróć do listy', callback_data: `rmp:times:${shiftId}` }]] },
    });
  });

  bot.command('cancel', async (ctx) => {
    if (ctx.session?.editTime) {
      ctx.session.editTime = null;
      await ctx.reply('Anulowano.');
    }
  });
    const shiftId = parseInt(ctx.match[1], 10);
    const vId     = parseInt(ctx.match[2], 10);
    const { getVirtualUser } = require('../db/queries');
    const vuser = getVirtualUser(vId);
    if (!vuser) { await ctx.answerCbQuery('Nie znaleziono'); return; }

    addManualParticipant(shiftId, vuser.reg_name, ctx.from.id);

    const shift = getShift(shiftId);
    if (shift.chat_id && shift.message_id) {
      try { await ctx.telegram.editMessageText(shift.chat_id, shift.message_id, undefined, shiftText(shift), { parse_mode: 'HTML', reply_markup: shiftKeyboard(shiftId) }); } catch {}
    }

    await ctx.answerCbQuery(`✅ Dodano: ${vuser.reg_name}`);
    await showParticipantsManager(ctx, shiftId);
  });
}

module.exports = { manageParticipantsScene, registerParticipantCallbacks };
