/**
 * simple_csv_parser.js
 *
 * A minimal CSV parser that correctly handles quoted fields containing
 * commas (our stimuli text sometimes contains commas inside quotes,
 * e.g. "though it's become almost redundant to say so, major kudos...").
 * Not a general-purpose CSV library -- written specifically for the
 * well-formed CSVs produced by our own Python scripts.
 */

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  // Normalize line endings.
  const cleaned = text.replace(/\r\n/g, "\n");

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    const next = cleaned[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i++; // skip the escaped quote
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        row.push(field);
        field = "";
      } else if (char === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += char;
      }
    }
  }

  // Push the final field/row if the file didn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const header = rows[0];
  const dataRows = rows.slice(1).filter((r) => r.length === header.length && r.some((v) => v !== ""));

  return dataRows.map((r) => {
    const obj = {};
    header.forEach((key, idx) => {
      obj[key.trim()] = r[idx];
    });
    return obj;
  });
}

module.exports = { parseCsv };
