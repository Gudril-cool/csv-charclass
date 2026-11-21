// CharClass (register-return build) — a fast drop-in replacement for csv-reader 1.0.0.
// One pass over the text with charCodeAt; fields are built from whole slices
// between special characters (never char by char), with a pieces array only
// when a field is interrupted (stray CRs, doubled quotes, CRs inside quotes).
// Returns exactly { columns, rows, errors } as csv-reader 1.0.0 does.

const COMMA_END = 0;
const BREAK_END = 1;
const EOF_END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  let recordLine = 1;
  let recordRow = null;
  let fValue = '';
  let fEnded = EOF_END;
  let fAdded = 0;

  // Reads unquoted characters starting from prefix; sets fValue/fEnded/fAdded.
  function readUnquoted(prefix) {
    let segs = null;
    let start = pos;
    let added = 0;
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 44) {
        const s = text.slice(start, pos);
        added += s.length;
        pos += 1;
        fValue = segs ? prefix + segs.join('') + s : prefix + s;
        fEnded = COMMA_END;
        fAdded = added;
        return;
      }
      if (c === 10) {
        const s = text.slice(start, pos);
        added += s.length;
        pos += 1;
        line += 1;
        fValue = segs ? prefix + segs.join('') + s : prefix + s;
        fEnded = BREAK_END;
        fAdded = added;
        return;
      }
      if (c === 13) {
        if (text.charCodeAt(pos + 1) === 10) {
          const s = text.slice(start, pos);
          added += s.length;
          pos += 2;
          line += 1;
          fValue = segs ? prefix + segs.join('') + s : prefix + s;
          fEnded = BREAK_END;
          fAdded = added;
          return;
        }
        if (pos > start) {
          const s = text.slice(start, pos);
          added += s.length;
          if (segs) segs.push(s); else segs = [s];
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        pos += 1;
        start = pos;
        continue;
      }
      pos += 1;
    }
    const s = text.slice(start, pos);
    added += s.length;
    fValue = segs ? prefix + segs.join('') + s : prefix + s;
    fEnded = EOF_END;
    fAdded = added;
  }

  // Reads a quoted field whose opening quote is at pos; sets fValue/fEnded.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let segs = null;
    let start = pos;
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 34) {
        if (text.charCodeAt(pos + 1) === 34) {
          const s = text.slice(start, pos);
          if (segs) segs.push(s, '"'); else segs = [s, '"'];
          pos += 2;
          start = pos;
          continue;
        }
        const s = text.slice(start, pos);
        const value = segs ? segs.join('') + s : s;
        pos += 1;
        if (pos >= len) { fValue = value; fEnded = EOF_END; return; }
        const d = text.charCodeAt(pos);
        if (d === 44) { pos += 1; fValue = value; fEnded = COMMA_END; return; }
        if (d === 10) { pos += 1; line += 1; fValue = value; fEnded = BREAK_END; return; }
        if (d === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; fValue = value; fEnded = BREAK_END; return; }
        readUnquoted(value);
        if (fAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        return;
      }
      if (c === 13) {
        const s = text.slice(start, pos);
        if (segs) segs.push(s, '\n'); else segs = [s, '\n'];
        line += 1;
        pos += text.charCodeAt(pos + 1) === 10 ? 2 : 1;
        start = pos;
        continue;
      }
      if (c === 10) line += 1;
      pos += 1;
    }
    pos = open + 1;
    line = openLine;
    errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
    readUnquoted('"');
  }

  while (true) {
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let ended = COMMA_END;
    let lastQuoted = false;
    while (ended === COMMA_END) {
      lastQuoted = text.charCodeAt(pos) === 34;
      if (lastQuoted) readQuoted(); else readUnquoted('');
      fields.push(fValue);
      ended = fEnded;
    }

    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
