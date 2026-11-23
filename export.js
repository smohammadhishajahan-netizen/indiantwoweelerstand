/* export.js — file builders with no external libraries (work offline):
   - VExport.pdf(blocks, title)  -> Blob (real PDF; Tamil text drawn on canvas pages)
   - VExport.xlsx(sheets)        -> Blob (real .xlsx workbook)
   - VExport.csv(rows)           -> Blob (UTF-8 CSV, opens in Excel with Tamil intact)
*/
(function () {
  'use strict';
  const enc = new TextEncoder();

  /* ---------------- CRC32 + ZIP (store) ---------------- */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function concat(parts) {
    let len = 0;
    for (const p of parts) len += p.length;
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  function zip(files) {
    const locals = [], centrals = [];
    let offset = 0;
    const DOS_DATE = (2026 - 1980) << 9 | 1 << 5 | 1; // fixed date, harmless
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, 0, true); lh.setUint16(12, DOS_DATE, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      locals.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, 0, true); ch.setUint16(14, DOS_DATE, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true);
      ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
      centrals.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cd = concat(centrals);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cd.length, true); end.setUint32(16, offset, true);
    return concat([...locals, cd, new Uint8Array(end.buffer)]);
  }

  /* ---------------- XLSX ---------------- */
  const xmlEsc = s => String(s == null ? '' : s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function colName(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function safeSheetName(n, used) {
    let s = String(n).replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31) || 'Sheet';
    let base = s, k = 2;
    while (used.has(s.toLowerCase())) s = (base.slice(0, 28) + ' ' + k++);
    used.add(s.toLowerCase());
    return s;
  }
  function sheetXML(sh) {
    const bold = new Set(sh.boldRows || []);
    let cols = '';
    if (sh.widths && sh.widths.length) {
      cols = '<cols>' + sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>';
    }
    const rows = sh.rows.map((row, ri) => {
      const st = bold.has(ri) ? ' s="1"' : '';
      const cells = row.map((v, ci) => {
        const ref = colName(ci) + (ri + 1);
        if (v === null || v === undefined || v === '') return '';
        if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
        return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
      }).join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      cols + '<sheetData>' + rows + '</sheetData></worksheet>';
  }
  function xlsx(sheets) {
    const used = new Set();
    const names = sheets.map(s => safeSheetName(s.name, used));
    const files = [];
    files.push({ name: '[Content_Types].xml', data:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '</Types>' });
    files.push({ name: '_rels/.rels', data:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>' });
    files.push({ name: 'xl/workbook.xml', data:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      names.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      '</sheets></workbook>' });
    files.push({ name: 'xl/_rels/workbook.xml.rels', data:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      '</Relationships>' });
    files.push({ name: 'xl/styles.xml', data:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>' });
    sheets.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXML(s) }));
    return new Blob([zip(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  /* ---------------- CSV ---------------- */
  function csv(rows) {
    const body = rows.map(r => r.map(v => {
      const s = String(v == null ? '' : v);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\r\n');
    return new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' });
  }

  /* ---------------- PDF (canvas pages -> JPEG -> PDF) ---------------- */
  function dataURLBytes(url) {
    const b64 = url.split(',')[1];
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function jpegsToPdf(imgs, pxW, pxH) {
    const parts = []; let len = 0; const offs = [];
    const push = x => { const u = typeof x === 'string' ? enc.encode(x) : x; parts.push(u); len += u.length; };
    const PW = 595.28, PH = 841.89;
    push(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 37, 226, 227, 207, 211, 10])); // %PDF-1.4 + binary marker
    const obj = (id, body) => { offs[id] = len; push(id + ' 0 obj\n'); body(); push('\nendobj\n'); };
    const n = imgs.length;
    obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => push(`<< /Type /Pages /Kids [${imgs.map((_, i) => (3 + 3 * i) + ' 0 R').join(' ')}] /Count ${n} >>`));
    imgs.forEach((img, i) => {
      const p = 3 + 3 * i;
      obj(p, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 ${p + 2} 0 R >> >> /Contents ${p + 1} 0 R >>`));
      const cs = `q ${PW} 0 0 ${PH} 0 0 cm /Im0 Do Q`;
      obj(p + 1, () => push(`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`));
      obj(p + 2, () => {
        push(`<< /Type /XObject /Subtype /Image /Width ${pxW} /Height ${pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>\nstream\n`);
        push(img); push('\nendstream');
      });
    });
    const total = 3 + 3 * n;
    const xrefAt = len;
    let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
    for (let i = 1; i < total; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
    push(x);
    push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
    return concat(parts);
  }

  async function pdf(blocks, title) {
    const W = 1240, H = 1754, M = 70, BOTTOM = H - M - 40;
    const FONT = '"Noto Sans Tamil","Latha","Vijaya",system-ui,-apple-system,Roboto,sans-serif';
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) { /* ignore */ }
    const pages = []; let ctx, y;
    const newPage = () => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#000'; ctx.strokeStyle = '#000'; ctx.textBaseline = 'middle';
      pages.push(c); y = M;
    };
    const font = (sz, b) => { ctx.font = (b ? '700 ' : '400 ') + sz + 'px ' + FONT; };
    const need = h => { if (y + h > BOTTOM) { newPage(); return true; } return false; };
    const fit = (txt, maxW) => {
      txt = String(txt == null ? '' : txt);
      if (ctx.measureText(txt).width <= maxW) return txt;
      while (txt.length > 1 && ctx.measureText(txt + '…').width > maxW) txt = txt.slice(0, -1);
      return txt + '…';
    };
    const wrap = (txt, maxW) => {
      const words = String(txt).split(/\s+/); const lines = []; let cur = '';
      for (const w of words) {
        const t = cur ? cur + ' ' + w : w;
        if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
      }
      if (cur) lines.push(cur);
      return lines;
    };
    newPage();
    for (const b of blocks) {
      if (b.t === 'h1') { need(64); font(40, 1); ctx.fillText(b.text, M, y + 26); y += 60; }
      else if (b.t === 'meta') { need(34); font(21, 0); ctx.fillStyle = '#333'; ctx.fillText(b.text, M, y + 14); ctx.fillStyle = '#000'; y += 34; }
      else if (b.t === 'h2') { need(120); y += 18; font(28, 1); ctx.fillText(b.text, M, y + 18); y += 42; ctx.fillRect(M, y, W - 2 * M, 3); y += 14; }
      else if (b.t === 'p') { font(21, 0); for (const ln of wrap(b.text, W - 2 * M)) { need(32); ctx.fillText(ln, M, y + 14); y += 32; } y += 6; }
      else if (b.t === 'kv') {
        const rh = 46; const tw = W - 2 * M;
        for (const [k, v, strong] of b.rows) {
          need(rh);
          ctx.lineWidth = strong ? 3 : 1.2;
          ctx.strokeRect(M, y, tw, rh);
          font(23, !!strong); ctx.textAlign = 'left'; ctx.fillText(fit(k, tw * 0.6), M + 14, y + rh / 2);
          ctx.textAlign = 'right'; ctx.fillText(fit(v, tw * 0.38), M + tw - 14, y + rh / 2); ctx.textAlign = 'left';
          y += rh;
        }
        y += 10;
      }
      else if (b.t === 'table') {
        const tw = W - 2 * M; const rh = 42; const fs = b.small ? 18 : 20;
        const wsum = b.cols.reduce((a, c) => a + (c.w || 1), 0);
        const xs = []; let acc = M;
        b.cols.forEach(c => { xs.push(acc); acc += tw * (c.w || 1) / wsum; });
        const cw = i => (i < b.cols.length - 1 ? xs[i + 1] : M + tw) - xs[i];
        const drawRow = (cells, bold, thick) => {
          ctx.lineWidth = thick ? 2.5 : 1.2;
          cells.forEach((v, i) => {
            ctx.strokeRect(xs[i], y, cw(i), rh);
            font(fs, bold);
            const al = b.cols[i].a === 'r' ? 'right' : 'left';
            ctx.textAlign = al;
            const tx = al === 'right' ? xs[i] + cw(i) - 8 : xs[i] + 8;
            ctx.fillText(fit(v, cw(i) - 14), tx, y + rh / 2);
          });
          ctx.textAlign = 'left';
          y += rh;
        };
        const header = () => drawRow(b.cols.map(c => c.l), true, true);
        need(rh * 2); header();
        if (!b.rows.length) { need(rh); font(fs, 0); ctx.strokeRect(M, y, tw, rh); ctx.fillText(b.empty || '—', M + 8, y + rh / 2); y += rh; }
        for (const r of b.rows) { if (need(rh)) header(); drawRow(r, false, false); }
        if (b.total) { if (need(rh)) header(); drawRow(b.total, true, true); }
        y += 14;
      }
    }
    pages.forEach((c, i) => {
      const cx = c.getContext('2d'); cx.fillStyle = '#000';
      cx.font = '400 18px ' + FONT; cx.textAlign = 'center'; cx.textBaseline = 'middle';
      cx.fillText(`${title || ''}   —   ${i + 1} / ${pages.length}`, W / 2, H - M / 2 - 6);
    });
    const imgs = pages.map(c => dataURLBytes(c.toDataURL('image/jpeg', 0.9)));
    return new Blob([jpegsToPdf(imgs, W, H)], { type: 'application/pdf' });
  }

  window.VExport = { pdf, xlsx, csv, _zip: zip, _crc32: crc32 };
})();
