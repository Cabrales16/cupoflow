/* ============================================================================
 * xlsx.js — Generador mínimo de archivos .xlsx (sin dependencias) para simular
 * las exportaciones a Excel del backend. Sin compresión (ZIP "stored").
 *
 *   DemoKit.makeXlsx([{ name:'Hoja1', rows:[['A','B'],[1,2]] }, ...]) → Uint8Array
 *   DemoKit.makeXlsxBase64(sheets) → string base64
 *   DemoKit.toCsv(rows) → string (con BOM UTF-8)
 * ========================================================================== */
(function () {
  'use strict';
  const O = window.DemoKit;
  const enc = new TextEncoder();
  const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const xml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const colName = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

  function sheetXml(rows) {
    let out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
    rows.forEach((r, ri) => {
      out += '<row r="' + (ri + 1) + '">';
      r.forEach((v, ci) => {
        const ref = colName(ci) + (ri + 1);
        if (typeof v === 'number' && isFinite(v)) out += '<c r="' + ref + '"><v>' + v + '</v></c>';
        else if (v === null || v === undefined || v === '') out += '';
        else out += '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xml(v) + '</t></is></c>';
      });
      out += '</row>';
    });
    return out + '</sheetData></worksheet>';
  }

  function zip(files) {
    const chunks = [], central = []; let offset = 0;
    const u16 = n => [n & 255, (n >>> 8) & 255], u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    files.forEach(f => {
      const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
      const head = new Uint8Array([0x50, 0x4b, 3, 4, 20, 0, 0, 8, 0, 0, 0, 0, 0x21, 0, ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), 0, 0]);
      chunks.push(head, name, data);
      central.push({ name, crc, size: data.length, offset });
      offset += head.length + name.length + data.length;
    });
    const cdStart = offset;
    central.forEach(c => {
      const h = new Uint8Array([0x50, 0x4b, 1, 2, 20, 0, 20, 0, 0, 8, 0, 0, 0, 0, 0x21, 0, ...u32(c.crc), ...u32(c.size), ...u32(c.size), ...u16(c.name.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u32(c.offset)]);
      chunks.push(h, c.name); offset += h.length + c.name.length;
    });
    const end = new Uint8Array([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(central.length), ...u16(central.length), ...u32(offset - cdStart), ...u32(cdStart), 0, 0]);
    chunks.push(end);
    const total = chunks.reduce((a, c) => a + c.length, 0), out = new Uint8Array(total); let p = 0;
    chunks.forEach(c => { out.set(c, p); p += c.length; });
    return out;
  }

  O.makeXlsx = function (sheets) {
    sheets = (sheets || []).length ? sheets : [{ name: 'Hoja1', rows: [[]] }];
    const names = sheets.map((s, i) => xml(String(s.name || 'Hoja' + (i + 1)).replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31)));
    const files = [
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + sheets.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + names.map((n, i) => '<sheet name="' + n + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '</Relationships>' }
    ];
    sheets.forEach((s, i) => files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: sheetXml(s.rows || []) }));
    return zip(files);
  };
  O.makeXlsxBase64 = function (sheets) {
    const bytes = O.makeXlsx(sheets); let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  O.toCsv = rows => '﻿' + (rows || []).map(r => r.map(v => { v = v == null ? '' : String(v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',')).join('\r\n');
  O.b64 = s => { const b = new TextEncoder().encode(s); let bin = ''; b.forEach(x => bin += String.fromCharCode(x)); return btoa(bin); };
})();
