require('dotenv').config();

const { Telegraf, Scenes, session } = require('telegraf');

const { trackUser }             = require('./middleware/trackUser');
const { notBanned }             = require('./middleware/guards');
const { createShiftScene, editShiftScene } = require('./scenes/shiftScenes');
const { manageParticipantsScene, registerParticipantCallbacks } = require('./scenes/participantsScene');
const { registrationScene } = require('./scenes/registrationScene');
const { editProfileScene } = require('./scenes/editProfileScene');
const { createVirtualUserScene } = require('./scenes/virtualUserScene');
const { registerAdminCommands } = require('./commands/admin');
const { registerUserCommands }  = require('./commands/user');
const { registerCallbacks }         = require('./commands/callbacks');
const { registerWorkhourCallbacks } = require('./commands/workhours');
const { registerReportCommand }     = require('./commands/reports');
const { setupReminders }            = require('./reminders');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('ERROR: BOT_TOKEN is not set. Copy .env.example to .env and set your token.');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ── Session + Scenes ─────────────────────────────────────────────────────────

const stage = new Scenes.Stage([createShiftScene, editShiftScene, manageParticipantsScene, registrationScene, editProfileScene, createVirtualUserScene]);
bot.use(session());
bot.use(stage.middleware());

// ── Global middleware ─────────────────────────────────────────────────────────

bot.use(trackUser);
bot.use(notBanned);

// ── Register handlers ─────────────────────────────────────────────────────────

registerUserCommands(bot);
registerAdminCommands(bot);
registerCallbacks(bot);
registerParticipantCallbacks(bot);
registerWorkhourCallbacks(bot);
registerReportCommand(bot);

// ── Reminders ─────────────────────────────────────────────────────────────────

setupReminders(bot);

// ── Error handler ─────────────────────────────────────────────────────────────

bot.catch((err, ctx) => {
  console.error(`Error for update ${ctx.updateType}:`, err);
  ctx.reply('⚠️ Something went wrong. Please try again.').catch(() => {});
});

// ── Launch ────────────────────────────────────────────────────────────────────

bot.launch({ dropPendingUpdates: true })
  .then(() => console.log('✅ Bot is running'))
  .catch(err => { console.error('Failed to start bot:', err); process.exit(1); });

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
