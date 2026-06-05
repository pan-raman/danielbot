const path = require('path');
const fs   = require('fs');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
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
      u.stawka AS user_stawka,
      s.date, s.start_time, s.end_time, s.location,
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
      const earn  = s.user_stawka ? hours * s.user_stawka : null;
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

// ── Workers Excel (styled) ────────────────────────────────────────────────────

async function generateExcel(year, month) {
  const db = getDb();
  const { from, to } = monthRange(year, month);

  const rows = db.prepare(`
    SELECT
      u.id AS user_id,
      COALESCE(sp.snap_name, u.reg_name, u.first_name) AS name,
      COALESCE(sp.snap_phone, u.reg_phone, '') AS phone,
      u.stawka AS user_stawka,
      s.date, s.location, s.start_time, s.end_time,
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
    if (!workers[r.user_id]) {
      workers[r.user_id] = { name: r.name, phone: r.phone, stawka: r.user_stawka, shifts: [] };
    }
    workers[r.user_id].shifts.push(r);
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Pracownicy');

  const DARK   = 'FF2F2F2F';
  const GRAY   = 'FF808080';
  const LGRAY  = 'FFD9D9D9';
  const GREEN  = 'FF4CAF50';
  const WHITE  = 'FFFFFFFF';
  const YELLOW = 'FFFFF9C4';
  const RED    = 'FFFFCDD2';  // light red background for late
  const REDFNT = 'FFC62828';  // dark red font

  // 10 columns: # | Data | Miejsce | Plan | Rzeczywisty | Godz.plan | Godz.rzecz | Wartość plan | Wartość rzecz | Opóźnienie
  ws.columns = [
    { key: 'lp',       width: 5  },
    { key: 'data',     width: 12 },
    { key: 'miejsce',  width: 26 },
    { key: 'plan',     width: 13 },
    { key: 'real',     width: 13 },
    { key: 'hplan',    width: 11 },
    { key: 'hreal',    width: 11 },
    { key: 'wplan',    width: 13 },
    { key: 'wreal',    width: 13 },
    { key: 'opozn',    width: 11 },
  ];

  function applyBorder(cell) {
    cell.border = {
      top:    { style: 'thin', color: { argb: 'FFBDBDBD' } },
      bottom: { style: 'thin', color: { argb: 'FFBDBDBD' } },
      left:   { style: 'thin', color: { argb: 'FFBDBDBD' } },
      right:  { style: 'thin', color: { argb: 'FFBDBDBD' } },
    };
  }

  function setCell(row, col, value, opts = {}) {
    const cell = ws.getCell(row, col);
    cell.value = value;
    cell.font  = { name: 'Arial', size: opts.size || 10, bold: opts.bold || false, color: { argb: opts.color || 'FF000000' } };
    cell.alignment = { horizontal: opts.align || 'center', vertical: 'middle', wrapText: !!opts.wrap };
    if (opts.bg) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.bg } };
    if (opts.numFmt) cell.numFmt = opts.numFmt;
    applyBorder(cell);
    return cell;
  }

  // ── Global header ─────────────────────────────────────────────────────────
  ws.mergeCells('A1:J1');
  const titleCell = ws.getCell('A1');
  titleCell.value = `Raport pracowników — ${monthName(month)} ${year}`;
  titleCell.font  = { name: 'Arial', size: 13, bold: true, color: { argb: WHITE } };
  titleCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 28;

  // ── Column headers ────────────────────────────────────────────────────────
  ws.getRow(2).height = 18;
  const headers = ['#', 'Data', 'Miejsce', 'Plan', 'Rzeczywisty', 'Godz. plan', 'Godz. rzecz.', 'Wartość plan', 'Wartość rzecz.', 'Opóźnienie'];
  headers.forEach((h, i) => {
    setCell(2, i + 1, h, { bold: true, bg: GRAY, color: WHITE });
  });

  let currentRow = 3;
  let grandPlanMins = 0;
  let grandRealMins = 0;
  let grandPlanEarn = 0;
  let grandRealEarn = 0;

  for (const [, w] of Object.entries(workers)) {
    // Worker name header row
    ws.mergeCells(`A${currentRow}:E${currentRow}`);
    const nameCell = ws.getCell(`A${currentRow}`);
    nameCell.value = `👤  ${w.name}${w.phone ? `   📞 ${w.phone}` : ''}`;
    nameCell.font  = { name: 'Arial', size: 11, bold: true, color: { argb: WHITE } };
    nameCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
    nameCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    nameCell.border = { top: { style: 'medium' }, bottom: { style: 'medium' }, left: { style: 'medium' }, right: { style: 'thin', color: { argb: LGRAY } } };

    ws.mergeCells(`F${currentRow}:J${currentRow}`);
    const rateLabel = ws.getCell(`F${currentRow}`);
    rateLabel.value = w.stawka ? `Stawka: ${w.stawka} zł/h` : '';
    rateLabel.font  = { name: 'Arial', size: 10, italic: true, color: { argb: 'FFEEEEEE' } };
    rateLabel.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
    rateLabel.alignment = { horizontal: 'right', vertical: 'middle' };

    ws.getRow(currentRow).height = 22;
    currentRow++;

    let wPlanMins = 0;
    let wRealMins = 0;
    let wPlanEarn = 0;
    let wRealEarn = 0;

    w.shifts.forEach((s, idx) => {
      // Plan hours
      const planSm   = toMins(s.start_time);
      const planEm   = toMins(s.end_time);
      const planMins = Math.max(0, planEm - planSm);
      const planHrs  = parseFloat((planMins / 60).toFixed(2));
      const planEarn = w.stawka ? parseFloat((planHrs * w.stawka).toFixed(2)) : null;

      // Real hours
      const realSm   = s.started_at ? toMins(s.started_at) : null;
      const realEm   = s.ended_at   ? toMins(s.ended_at)   : null;
      const realMins = (realSm !== null && realEm !== null) ? Math.max(0, realEm - realSm) : null;
      const realHrs  = realMins !== null ? parseFloat((realMins / 60).toFixed(2)) : null;
      const realEarn = (w.stawka && realHrs !== null) ? parseFloat((realHrs * w.stawka).toFixed(2)) : null;

      // Late check: started_at > start_time
      const isLate = s.started_at && toMins(s.started_at) > toMins(s.start_time);
      const lateMin = isLate ? toMins(s.started_at) - toMins(s.start_time) : 0;

      wPlanMins += planMins;
      if (realMins !== null) wRealMins += realMins;
      if (planEarn) wPlanEarn += planEarn;
      if (realEarn) wRealEarn += realEarn;

      const bg      = isLate ? RED : (idx % 2 === 0 ? WHITE : 'FFF5F5F5');
      const txtColor = isLate ? REDFNT : 'FF000000';
      const planStr  = `${s.start_time}–${s.end_time}`;
      const realStr  = (s.started_at && s.ended_at) ? `${s.started_at}–${s.ended_at}` : '—';
      const lateStr  = isLate ? `+${lateMin} min` : '';

      setCell(currentRow, 1,  idx + 1,        { bg, align: 'center', color: txtColor });
      setCell(currentRow, 2,  s.date,          { bg, align: 'center', color: txtColor });
      setCell(currentRow, 3,  s.location,      { bg, align: 'left',   color: txtColor });
      setCell(currentRow, 4,  planStr,         { bg, align: 'center', color: txtColor });
      setCell(currentRow, 5,  realStr,         { bg, align: 'center', color: isLate ? REDFNT : (s.started_at ? 'FF2E7D32' : 'FF9E9E9E') });
      setCell(currentRow, 6,  planHrs,         { bg, align: 'center', numFmt: '#,##0.0', color: txtColor });
      setCell(currentRow, 7,  realHrs ?? '—',  { bg, align: 'center', numFmt: realHrs ? '#,##0.0' : null, color: isLate ? REDFNT : 'FF2E7D32' });
      setCell(currentRow, 8,  planEarn ?? '—', { bg, align: 'center', numFmt: planEarn ? '#,##0.00' : null, color: txtColor });
      setCell(currentRow, 9,  realEarn ?? '—', { bg, align: 'center', numFmt: realEarn ? '#,##0.00' : null, color: isLate ? REDFNT : 'FF2E7D32' });
      setCell(currentRow, 10, lateStr,         { bg: isLate ? RED : bg, align: 'center', bold: isLate, color: isLate ? REDFNT : txtColor });

      ws.getRow(currentRow).height = 16;
      currentRow++;
    });

    // Worker subtotal
    const subPlanHrs  = parseFloat((wPlanMins / 60).toFixed(2));
    const subRealHrs  = parseFloat((wRealMins / 60).toFixed(2));
    const subPlanEarn = wPlanEarn > 0 ? parseFloat(wPlanEarn.toFixed(2)) : null;
    const subRealEarn = wRealEarn > 0 ? parseFloat(wRealEarn.toFixed(2)) : null;

    ws.mergeCells(`A${currentRow}:C${currentRow}`);
    setCell(currentRow, 1,  `Razem: ${w.name}`, { bold: true, bg: LGRAY, align: 'left' });
    setCell(currentRow, 4,  '',              { bg: LGRAY });
    setCell(currentRow, 5,  '',              { bg: LGRAY });
    setCell(currentRow, 6,  subPlanHrs,      { bold: true, bg: LGRAY, numFmt: '#,##0.0' });
    setCell(currentRow, 7,  subRealHrs || '—', { bold: true, bg: LGRAY, numFmt: '#,##0.0' });
    setCell(currentRow, 8,  subPlanEarn || '—', { bold: true, bg: YELLOW, numFmt: subPlanEarn ? '#,##0.00' : null });
    setCell(currentRow, 9,  subRealEarn || '—', { bold: true, bg: YELLOW, numFmt: subRealEarn ? '#,##0.00' : null });
    setCell(currentRow, 10, '', { bg: LGRAY });
    ws.getRow(currentRow).height = 18;
    currentRow++;

    // Gap row
    ws.getRow(currentRow).height = 8;
    currentRow++;

    grandPlanMins += wPlanMins;
    grandRealMins += wRealMins;
    grandPlanEarn += wPlanEarn;
    grandRealEarn += wRealEarn;
  }

  // ── Grand total ───────────────────────────────────────────────────────────
  const totPlanHrs  = parseFloat((grandPlanMins / 60).toFixed(2));
  const totRealHrs  = parseFloat((grandRealMins / 60).toFixed(2));
  const totPlanEarn = grandPlanEarn > 0 ? parseFloat(grandPlanEarn.toFixed(2)) : null;
  const totRealEarn = grandRealEarn > 0 ? parseFloat(grandRealEarn.toFixed(2)) : null;

  ws.mergeCells(`A${currentRow}:C${currentRow}`);
  setCell(currentRow, 1,  'RAZEM ZA MIESIĄC', { bold: true, bg: GREEN, color: WHITE, align: 'left', size: 11 });
  setCell(currentRow, 4,  '',                 { bg: GREEN });
  setCell(currentRow, 5,  '',                 { bg: GREEN });
  setCell(currentRow, 6,  totPlanHrs,         { bold: true, bg: GREEN, color: WHITE, numFmt: '#,##0.0', size: 11 });
  setCell(currentRow, 7,  totRealHrs || '—',  { bold: true, bg: GREEN, color: WHITE, numFmt: '#,##0.0', size: 11 });
  setCell(currentRow, 8,  totPlanEarn || '—', { bold: true, bg: GREEN, color: WHITE, numFmt: totPlanEarn ? '#,##0.00' : null, size: 11 });
  setCell(currentRow, 9,  totRealEarn || '—', { bold: true, bg: GREEN, color: WHITE, numFmt: totRealEarn ? '#,##0.00' : null, size: 11 });
  setCell(currentRow, 10, '',                 { bg: GREEN });
  ws.getRow(currentRow).height = 24;

  const tmpPath = path.join('/tmp', `raport_pracownicy_${year}_${month}_${Date.now()}.xlsx`);
  await wb.xlsx.writeFile(tmpPath);
  return tmpPath;
}

// ── Client Excel (styled, per location) ──────────────────────────────────────

async function generateClientExcel(year, month) {
  const db = getDb();
  const { from, to } = monthRange(year, month);

  const shifts = db.prepare(`
    SELECT s.id, s.date, s.location, s.start_time, s.end_time, s.stawka
    FROM shifts s
    WHERE s.date >= ? AND s.date <= ?
    ORDER BY s.location, s.date
  `).all(from, to);

  const allPart = db.prepare(`
    SELECT sp.shift_id,
           COALESCE(sp.snap_name, u.reg_name, u.first_name) AS name,
           u.stawka AS user_stawka,
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

  // Group by location
  const locations = {};
  for (const s of shifts) {
    if (!locations[s.location]) locations[s.location] = [];
    locations[s.location].push(s);
  }

  const wb = new ExcelJS.Workbook();

  const GRAY   = 'FF808080';
  const WHITE  = 'FFFFFFFF';
  const LIGHT  = 'FFD9D9D9';
  const BLACK  = 'FF000000';

  function hCell(ws, row, col, value, bgColor = GRAY, fontColor = WHITE, bold = true) {
    const cell = ws.getCell(row, col);
    cell.value = value;
    cell.font  = { bold, color: { argb: fontColor }, name: 'Arial', size: 10 };
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top:    { style: 'thin' }, bottom: { style: 'thin' },
      left:   { style: 'thin' }, right:  { style: 'thin' },
    };
    return cell;
  }

  function dCell(ws, row, col, value, bgColor = null, bold = false, numFmt = null) {
    const cell = ws.getCell(row, col);
    cell.value = value;
    cell.font  = { bold, name: 'Arial', size: 10, color: { argb: BLACK } };
    if (bgColor) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top:    { style: 'thin' }, bottom: { style: 'thin' },
      left:   { style: 'thin' }, right:  { style: 'thin' },
    };
    if (numFmt) cell.numFmt = numFmt;
    return cell;
  }

  for (const [location, lShifts] of Object.entries(locations)) {
    const ws = wb.addWorksheet(location.slice(0, 31)); // sheet name max 31 chars

    ws.columns = [
      { key: 'data',    width: 10 },
      { key: 'nazwa',   width: 30 },
      { key: 'stawka',  width: 12 },
      { key: 'godziny', width: 14 },
      { key: 'wartosc', width: 18 },
    ];

    // Row 1: Miesiac / Maj
    ws.mergeCells('A1:B1'); hCell(ws, 1, 1, 'Miesiac');
    ws.mergeCells('D1:E1'); hCell(ws, 1, 4, monthName(month));

    // Row 2: Firma / Location
    ws.mergeCells('A2:B2'); hCell(ws, 2, 1, 'Firma');
    ws.mergeCells('D2:E2'); hCell(ws, 2, 4, location);

    // Row 3: empty
    ws.getRow(3).height = 8;

    // Row 4: column headers
    hCell(ws, 4, 1, 'Data',               GRAY, WHITE);
    hCell(ws, 4, 2, 'Nazwa imprezy',       GRAY, WHITE);
    hCell(ws, 4, 3, 'Stawka',              GRAY, WHITE);
    hCell(ws, 4, 4, 'Godziny pracy',       GRAY, WHITE);
    hCell(ws, 4, 5, 'Wartosc wg stawki',   GRAY, WHITE);

    let dataRow = 5;
    let totalMins = 0;
    let totalEarn = 0;

    for (const s of lShifts) {
      const ps = pMap[s.id] || [];

      // Calculate worker-hours and cost
      let shiftMins = 0;
      let shiftEarn = 0;
      for (const p of ps) {
        const sm = toMins(p.started_at || s.start_time);
        const em = toMins(p.ended_at   || s.end_time);
        const m  = Math.max(0, em - sm);
        shiftMins += m;
        if (p.user_stawka) shiftEarn += (m / 60) * p.user_stawka;
      }

      const hrs  = parseFloat((shiftMins / 60).toFixed(2));
      const earn = shiftEarn > 0 ? parseFloat(shiftEarn.toFixed(2)) : null;

      totalMins += shiftMins;
      if (earn) totalEarn += earn;

      // Date: show only day number
      const dayNum = parseInt(s.date.split('-')[2], 10);

      dCell(ws, dataRow, 1, dayNum);
      dCell(ws, dataRow, 2, ps.map(p => p.name).join(', ') || '—');
      dCell(ws, dataRow, 3, null, null, false, '#,##0.00');
      dCell(ws, dataRow, 4, hrs > 0 ? hrs : null, null, false, '#,##0.0');
      dCell(ws, dataRow, 5, earn || null, LIGHT, false, '#,##0.00');

      dataRow++;
    }

    // Fill empty rows up to row 21 (like in the example)
    while (dataRow <= 21) {
      dCell(ws, dataRow, 1, null);
      dCell(ws, dataRow, 2, null);
      dCell(ws, dataRow, 3, null);
      dCell(ws, dataRow, 4, null);
      dCell(ws, dataRow, 5, null, LIGHT);
      dataRow++;
    }

    // Summary row
    const sumRow = dataRow;
    ws.mergeCells(`A${sumRow}:C${sumRow}`);
    hCell(ws, sumRow, 1, 'Razem za miesiąc', GRAY, WHITE, true);
    dCell(ws, sumRow, 4, parseFloat((totalMins / 60).toFixed(1)), GRAY, true, '#,##0.0');
    dCell(ws, sumRow, 5, parseFloat(totalEarn.toFixed(2)), GRAY, true, '#,##0.00');
    ws.getRow(sumRow).font = { bold: true, name: 'Arial', size: 10, color: { argb: WHITE } };
  }

  const tmpPath = path.join('/tmp', `zalacznik_${year}_${month}_${Date.now()}.xlsx`);
  await wb.xlsx.writeFile(tmpPath);
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
        { text: `${monthName(m)} ${y} — Pracownicy`,   callback_data: `rpt:w:${y}:${m}`   },
        { text: `📥 Excel ${monthName(m)} ${y}`,        callback_data: `rpt:xls:${y}:${m}` },
      ]);
      rows.push([
        { text: `📋 Załącznik klienta ${monthName(m)} ${y}`, callback_data: `rpt:cli:${y}:${m}` },
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

    const filePath = await generateExcel(year, month);

    try {
      await ctx.replyWithDocument(
        { source: filePath, filename: `raport_${year}_${String(month).padStart(2,'0')}.xlsx` },
        { caption: `📊 Raport ${monthName(month)} ${year}` }
      );
    } finally {
      try { fs.unlinkSync(filePath); } catch {}
    }
  });
  // Client Excel — per location, styled
  bot.action(/^rpt:cli:(\d{4}):(\d{1,2})$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('⛔ Admin only.');
    await ctx.answerCbQuery('Generuję załącznik…');

    const year  = parseInt(ctx.match[1], 10);
    const month = parseInt(ctx.match[2], 10);

    const filePath = await generateClientExcel(year, month);

    try {
      await ctx.replyWithDocument(
        { source: filePath, filename: `zalacznik_${year}_${String(month).padStart(2,'0')}.xlsx` },
        { caption: `📋 Załącznik klientów — ${monthName(month)} ${year}` }
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
