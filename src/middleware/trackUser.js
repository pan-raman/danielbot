const { upsertUser } = require('../db/queries');

function trackUser(ctx, next) {
  if (ctx.from) {
    upsertUser(ctx.from);
  }
  return next();
}

module.exports = { trackUser };
