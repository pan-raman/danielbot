const { isAdmin, isBanned } = require('../db/queries');

function adminOnly(ctx, next) {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('⛔ Admin only.');
  }
  return next();
}

function notBanned(ctx, next) {
  if (isBanned(ctx.from.id)) {
    return ctx.reply('🚫 You are banned from this bot.');
  }
  return next();
}

module.exports = { adminOnly, notBanned };
