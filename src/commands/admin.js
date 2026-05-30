const { Markup } = require('telegraf');
const {
  getAllShifts, getShift, deleteShift, getParticipants,
  setShiftMessage, getAllUsers, setBanned, setAdmin, isBanned,
} = require('../db/queries');
const { shiftText, shiftKeyboard, userName } = require('../helpers/format');
const { adminOnly } = require('../middleware/guards');

function registerAdminCommands(bot) {

  // /newshift – start wizard
  bot.command('newshift', adminOnly, (ctx) => {
    ctx.scene.enter('create_shift');
  });

  // /shifts – list all upcoming shifts
  bot.command('shifts', adminOnly, async (ctx) => {
    const shifts = getAllShifts();
    if (!shifts.length) return ctx.reply('No shifts found.');

    const lines = shifts.map(s => {
      const count = getParticipants(s.id).length;
      return `#${s.id} | ${s.date} | ${s.location} | ${s.start_time}–${s.end_time} | ${count}/${s.required}`;
    });

    await ctx.replyWithHTML(
      '<b>All Shifts:</b>\n\n' + lines.join('\n') +
      '\n\nUse /shift_&lt;id&gt; to manage a specific shift.'
    );
  });

  // /shift_<id> – manage specific shift
  bot.hears(/^\/shift_(\d+)$/, adminOnly, async (ctx) => {
    const id    = parseInt(ctx.match[1], 10);
    const shift = getShift(id);
    if (!shift) return ctx.reply('Shift not found.');

    const participants = getParticipants(id);
    const pList = participants.length
      ? participants.map((u, i) => `${i + 1}. ${userName(u)}`).join('\n')
      : '—';

    await ctx.replyWithHTML(
      shiftText(shift) + `\n\n<b>Full participant list:</b>\n${pList}`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✏️ Edit',   callback_data: `admin_edit:${id}` },
              { text: '🗑 Delete', callback_data: `admin_delete:${id}` },
            ],
            [
              { text: '📤 Post to chat', callback_data: `admin_post:${id}` },
            ],
          ],
        },
      }
    );
  });

  // Admin action callbacks
  bot.action(/^admin_edit:(\d+)$/, adminOnly, async (ctx) => {
    const id = parseInt(ctx.match[1], 10);
    await ctx.answerCbQuery();
    ctx.scene.state = { shiftId: id };
    ctx.scene.enter('edit_shift');
  });

  bot.action(/^admin_delete:(\d+)$/, adminOnly, async (ctx) => {
    const id    = parseInt(ctx.match[1], 10);
    const shift = getShift(id);
    if (!shift) { await ctx.answerCbQuery('Not found'); return; }

    // Remove the original shift post if possible
    if (shift.chat_id && shift.message_id) {
      try {
        await ctx.telegram.deleteMessage(shift.chat_id, shift.message_id);
      } catch {}
    }

    deleteShift(id);
    await ctx.answerCbQuery('Deleted');
    await ctx.editMessageText(`🗑 Shift #${id} deleted.`);
  });

  bot.action(/^admin_post:(\d+)$/, adminOnly, async (ctx) => {
    const id    = parseInt(ctx.match[1], 10);
    const shift = getShift(id);
    if (!shift) { await ctx.answerCbQuery('Not found'); return; }

    await ctx.answerCbQuery('Posting…');

    const sent = await ctx.replyWithHTML(shiftText(shift), {
      reply_markup: shiftKeyboard(id),
    });
    setShiftMessage(id, sent.chat.id, sent.message_id);
    await ctx.reply(`✅ Shift #${id} posted.`);
  });

  // ── User management ──────────────────────────────────────────────────────

  // /users – list all known users
  bot.command('users', adminOnly, async (ctx) => {
    const users = getAllUsers();
    if (!users.length) return ctx.reply('No users yet.');

    const lines = users.map(u =>
      `${u.id} | ${userName(u)} | admin:${u.is_admin ? 'yes' : 'no'} | banned:${u.is_banned ? 'yes' : 'no'}`
    );
    await ctx.replyWithHTML('<b>Users:</b>\n\n<code>' + lines.join('\n') + '</code>');
  });

  // /ban <user_id>
  bot.command('ban', adminOnly, async (ctx) => {
    const args  = ctx.message.text.split(' ');
    const uid   = parseInt(args[1], 10);
    if (isNaN(uid)) return ctx.reply('Usage: /ban <user_id>');
    setBanned(uid, true);
    await ctx.reply(`🚫 User ${uid} banned.`);
  });

  // /unban <user_id>
  bot.command('unban', adminOnly, async (ctx) => {
    const args  = ctx.message.text.split(' ');
    const uid   = parseInt(args[1], 10);
    if (isNaN(uid)) return ctx.reply('Usage: /unban <user_id>');
    setBanned(uid, false);
    await ctx.reply(`✅ User ${uid} unbanned.`);
  });

  // /makeadmin <user_id>
  bot.command('makeadmin', adminOnly, async (ctx) => {
    const args  = ctx.message.text.split(' ');
    const uid   = parseInt(args[1], 10);
    if (isNaN(uid)) return ctx.reply('Usage: /makeadmin <user_id>');
    setAdmin(uid, true);
    await ctx.reply(`⭐ User ${uid} promoted to admin.`);
  });

  // /removeadmin <user_id>
  bot.command('removeadmin', adminOnly, async (ctx) => {
    const args  = ctx.message.text.split(' ');
    const uid   = parseInt(args[1], 10);
    if (isNaN(uid)) return ctx.reply('Usage: /removeadmin <user_id>');
    setAdmin(uid, false);
    await ctx.reply(`User ${uid} demoted.`);
  });

  // /adminhelp
  bot.command('adminhelp', adminOnly, (ctx) => {
    ctx.replyWithHTML(
      '<b>Admin Commands</b>\n\n' +
      '/newshift – Create a new shift (interactive)\n' +
      '/shifts – List all shifts\n' +
      '/shift_&lt;id&gt; – Manage a specific shift\n' +
      '/users – List all users\n' +
      '/ban &lt;id&gt; – Ban a user\n' +
      '/unban &lt;id&gt; – Unban a user\n' +
      '/makeadmin &lt;id&gt; – Promote to admin\n' +
      '/removeadmin &lt;id&gt; – Demote admin\n'
    );
  });
}

module.exports = { registerAdminCommands };
