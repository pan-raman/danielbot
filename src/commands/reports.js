const path = require('path');
const fs   = require('fs');
const XLSX = require('xlsx');
const { getDb } = require('../db/database');
const { isAdmin } = require('../db/queries');

function toMins(hhmm) {
  if (!hhmm) return 0;
  const [h, m] = hhmm.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}

function minsToH(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function monthRange(year, month) {
  const from = `${year}-${String(month).padStart(2,'0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to   = `${year}-${String(month).padStart(2,'0')}-${lastDay}`;
  return { from, to };
}

function monthName(month) {
  const names = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec',
                 'Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];
  return names[month - 1];
}

// ── Worker report ─────────────────────────────────────────────────────────────
// Per worker: shifts, hours, earnings

function workerReport(year, month) {
  const db = getDb();
  const { from, to } = monthRange(year, month);

  const rows = db.prepare(`
    SELECT
      u.id AS user_id,
      COALESCE(sp.snap_name, u.reg_name, u.first_name) AS name,
      s.date, s.start_time, s.end_time, s.location, s.stawka,
      sp.started_at, sp.ended_at
    FROM shift_participants sp
    JOIN users u ON u.id = sp.user_id
    JOIN shifts s ON s.id = sp.shift_id
    WHERE sp.status = 'approved' AND s.date >= ? AND s.date <= ?
    ORDER BY u.id, s.date
  `).all(from, to);

  // Group by worker
  const workers = {};
  for (const r of rows) {
    if (!workers[r.user_id]) workers[r.user_id] = { name: r.name, shifts: [] };
    workers[r.user_id].shifts.push(r);
  }

  let text = `📊 <b>Raport pracowników — ${monthName(month)} ${year}</b>\n\n`;

  if (!Object.keys(workers).length) {
    return text + 'Brak danych za ten okres.';
  }

  for (const [, w] of Object.entries(workers)) {
    let totalMins = 0;
    let totalEarnings = 0;

    const lines = w.shifts.map(s => {
      const startMins = toMins(s.started_at || s.start_time);
      const endMins   = toMins(s.ended_at   || s.end_time);
      const mins      = Math.max(0, endMins - startMins);
      totalMins += mins;

      const hours = mins / 60;
      const earn  = s.stawka ? hours * s.stawka : null;
      if (earn) totalEarnings += earn;

      const earnStr = earn ? ` = ${earn.toFixed(2)} zł` : '';
      const actual  = (s.started_at || s.ended_at)
        ? ` (real: ${s.started_at || '?'}–${s.ended_at || '?'})`
        : '';
      return `  • ${s.date} ${s.location} ${minsToH(mins)}${actual}${earnStr}`;
    });

    text += `👤 <b>${w.name}</b>\n`;
    text += lines.join('\n') + '\n';
    text += `  📌 Razem: <b>${minsToH(totalMins)}</b>`;
    if (totalEarnings > 0) text += ` | 💰 <b>${totalEarnings.toFixed(2)} zł</b>`;
    text += '\n\n';
  }

  return text;
}

// ── Client report ─────────────────────────────────────────────────────────────
// Per location: dates, workers per shift, total hours

function clientReport(year, month) {
  const db = getDb();
  const { from, to } = monthRange(year, month);

  const shifts = db.prepare(`
    SELECT s.id, s.date, s.location, s.start_time, s.end_time, s.stawka
    FROM shifts s
    WHERE s.date >= ? AND s.date <= ?
    ORDER BY s.location, s.date
  `).all(from, to);

  if (!shifts.length) {
    return `📊 <b>Raport klientów — ${monthName(month)} ${year}</b>\n\nBrak zmian za ten okres.`;
  }

  const participants = db.prepare(`
    SELECT sp.shift_id,
           COALESCE(sp.snap_name, u.reg_name, u.first_name) AS name,
           sp.started_at, sp.ended_at
    FROM shift_participants sp
    JOIN users u ON u.id = sp.user_id
    WHERE sp.status = 'approved'
  `).all();

  const pMap = {};
  for (const p of participants) {
    if (!pMap[p.shift_id]) pMap[p.shift_id] = [];
    pMap[p.shift_id].push(p);
  }

  // Group by location
  const locations = {};
  for (const s of shifts) {
    if (!locations[s.location]) locations[s.location] = [];
    locations[s.location].push(s);
  }

  let text = `📋 <b>Raport klientów — ${monthName(month)} ${year}</b>\n\n`;

  for (const [loc, lShifts] of Object.entries(locations)) {
    text += `📍 <b>${loc}</b>\n`;

    let locMins = 0;

    for (const s of lShifts) {
      const ps    = pMap[s.id] || [];
      const names = ps.map(p => p.name).join(', ') || '—';

      // Total worker-hours for this shift
      let shiftMins = 0;
      for (const p of ps) {
        const sm = toMins(p.started_at || s.start_time);
        const em = toMins(p.ended_at   || s.end_time);
        shiftMins += Math.max(0, em - sm);
      }
      locMins += shiftMins;

      const earnStr = s.stawka && ps.length
        ? ` | 💰 ${((shiftMins / 60) * s.stawka).toFixed(2)} zł`
        : '';

      text += `  ${s.date} ${s.start_time}–${s.end_time} | ${ps.length} os. | ${minsToH(shiftMins)}${earnStr}\n`;
      text += `    👥 ${names}\n`;
    }

    text += `  📌 Łącznie: <b>${minsToH(locMins)}</b>\n\n`;
  }

  return text;
}

// ── Excel generation ──────────────────────────────────────────────────────────

function generateExcel(year, month) {
  const db = getDb();
  const { from, to } = monthRange(year, month);

  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Workers ──────────────────────────────────────────────────────

  const workerRows = db.prepare(`
    SELECT
      COALESCE(sp.snap_name, u.reg_name, u.first_name) AS pracownik,
      COALESCE(sp.snap_phone, u.reg_phone, '') AS telefon,
      s.date AS data,
      s.location AS miejsce,
      s.start_time AS plan_start,
      s.end_time AS plan_end,
      sp.started_at AS real_start,
      sp.ended_at AS real_end,
      s.stawka
    FROM shift_participants sp
    JOIN users u ON u.id = sp.user_id
    JOIN shifts s ON s.id = sp.shift_id
    WHERE sp.status = 'approved' AND s.date >= ? AND s.date <= ?
    ORDER BY u.id, s.date
  `).all(from, to);

  const wsWorkers = workerRows.map(r => {
    const sm   = toMins(r.real_start || r.plan_start);
    const em   = toMins(r.real_end   || r.plan_end);
    const mins = Math.max(0, em - sm);
    const hrs  = parseFloat((mins / 60).toFixed(2));
    const earn = r.stawka ? parseFloat((hrs * r.stawka).toFixed(2)) : '';

    return {
      'Pracownik':      r.pracownik,
      'Telefon':        r.telefon,
      'Data':           r.data,
      'Miejsce':        r.miejsce,
      'Plan start':     r.plan_start,
      'Plan koniec':    r.plan_end,
      'Real start':     r.real_start || '',
      'Real koniec':    r.real_end   || '',
      'Godziny':        hrs,
      'Stawka (zł/h)':  r.stawka || '',
      'Zarobek (zł)':   earn,
    };
  });

  const ws1 = XLSX.utils.json_to_sheet(wsWorkers.length ? wsWorkers : [{ 'Brak danych': '' }]);
  XLSX.utils.book_append_sheet(wb, ws1, 'Pracownicy');

  // ── Sheet 2: Clients ──────────────────────────────────────────────────────

  const shifts = db.prepare(`
    SELECT s.id, s.date, s.location, s.start_time, s.end_time, s.stawka
    FROM shifts s
    WHERE s.date >= ? AND s.date <= ?
    ORDER BY s.location, s.date
  `).all(from, to);

  const allPart = db.prepare(`
    SELECT sp.shift_id,
           COALESCE(sp.snap_name, u.reg_name, u.first_name) AS name,
           sp.started_at, sp.ended_at
    FROM shift_participants sp
    JOIN users u ON u.id = sp.user_id
    WHERE sp.status = 'approved'
  `).all();

  const pMap = {};
  for (const p of allPart) {
    if (!pMap[p.shift_id]) pMap[p.shift_id] = [];
    pMap[p.shift_id].push(p);
  }

  const clientRows = [];
  for (const s of shifts) {
    const ps = pMap[s.id] || [];
    let totalMins = 0;
    for (const p of ps) {
      totalMins += Math.max(0, toMins(p.ended_at || s.end_time) - toMins(p.started_at || s.start_time));
    }
    const hrs  = parseFloat((totalMins / 60).toFixed(2));
    const earn = s.stawka ? parseFloat((hrs * s.stawka).toFixed(2)) : '';

    clientRows.push({
      'Data':           s.date,
      'Miejsce':        s.location,
      'Start':          s.start_time,
      'Koniec':         s.end_time,
      'Liczba osób':    ps.length,
      'Pracownicy':     ps.map(p => p.name).join(', '),
      'Godziny łącznie': hrs,
      'Stawka (zł/h)':  s.stawka || '',
      'Koszt (zł)':     earn,
    });
  }

  const ws2 = XLSX.utils.json_to_sheet(clientRows.length ? clientRows : [{ 'Brak danych': '' }]);
  XLSX.utils.book_append_sheet(wb, ws2, 'Klienci');

  // ── Save temp file ────────────────────────────────────────────────────────

  const tmpPath = path.join('/tmp', `raport_${year}_${month}_${Date.now()}.xlsx`);
  XLSX.writeFile(wb, tmpPath);
  return tmpPath;
}

// ── Register command ──────────────────────────────────────────────────────────

function registerReportCommand(bot) {

  // /raport — show month picker
  bot.command('raport', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply('⛔ Admin only.');

    const now   = new Date();
    const year  = now.getFullYear();
    const month = now.getMonth() + 1;

    const rows = [];
    for (let i = 0; i < 3; i++) {
      let m = month - i;
      let y = year;
      if (m <= 0) { m += 12; y -= 1; }
      rows.push([
        { text: `${monthName(m)} ${y} — Pracownicy`, callback_data: `rpt:w:${y}:${m}` },
        { text: `📥 Excel ${monthName(m)} ${y}`,     callback_data: `rpt:xls:${y}:${m}` },
      ]);
    }

    await ctx.replyWithHTML('📊 <b>Raporty</b>\n\nWybierz miesiąc i typ raportu:', {
      reply_markup: { inline_keyboard: rows },
    });
  });

  // Text report — workers only
  bot.action(/^rpt:w:(\d{4}):(\d{1,2})$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('⛔ Admin only.');
    await ctx.answerCbQuery();

    const year  = parseInt(ctx.match[1], 10);
    const month = parseInt(ctx.match[2], 10);

    const text = workerReport(year, month);
    const chunks = splitMessage(text);
    for (const chunk of chunks) {
      await ctx.replyWithHTML(chunk);
    }

    await ctx.reply('📥 Pobierz raport jako Excel:', {
      reply_markup: { inline_keyboard: [[
        { text: '📥 Pobierz Excel', callback_data: `rpt:xls:${year}:${month}` },
      ]]},
    });
  });

  // Excel export
  bot.action(/^rpt:xls:(\d{4}):(\d{1,2})$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('⛔ Admin only.');
    await ctx.answerCbQuery('Generuję Excel…');

    const year  = parseInt(ctx.match[1], 10);
    const month = parseInt(ctx.match[2], 10);

    const filePath = generateExcel(year, month);

    try {
      await ctx.replyWithDocument(
        { source: filePath, filename: `raport_${year}_${String(month).padStart(2,'0')}.xlsx` },
        { caption: `📊 Raport ${monthName(month)} ${year}` }
      );
    } finally {
      try { fs.unlinkSync(filePath); } catch {}
    }
  });
}

function splitMessage(text, maxLen = 4000) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (current.length + line.length + 1 > maxLen) {
      chunks.push(current);
      current = '';
    }
    current += line + '\n';
  }
  if (current) chunks.push(current);
  return chunks;
}

module.exports = { registerReportCommand };
