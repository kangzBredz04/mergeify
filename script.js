"use strict";

const APP_VERSION = "4.1.1";

const elements = {
  tableType: document.getElementById("tableType"),
  editorGrid: document.getElementById("editorGrid"),
  inputSql: document.getElementById("inputSql"),
  outputSql: document.getElementById("outputSql"),
  inputStats: document.getElementById("inputStats"),
  outputStats: document.getElementById("outputStats"),
  feedback: document.getElementById("feedback"),
  convertButton: document.getElementById("convertButton"),
  layoutButton: document.getElementById("layoutButton"),
  layoutModeLabel: document.getElementById("layoutModeLabel"),
  clearButton: document.getElementById("clearButton"),
  copyButton: document.getElementById("copyButton"),
  toast: document.getElementById("toast"),
};

const AUDIT_COLUMNS = new Set([
  "MODIFIED_BY",
  "TIMESTAMP",
  "CREATE_BY",
  "CREATED_BY",
  "CREATE_DATE",
  "CREATED_DATE",
  "MODIFIED_DATE",
  "UPDATED_BY",
  "UPDATED_AT",
]);

let toastTimer;

function normalizeIdentifier(identifier) {
  return String(identifier || "")
    .trim()
    .replace(/^[`"\[]|[`"\]]$/g, "")
    .trim()
    .toUpperCase();
}

function getBaseTableName(tableReference) {
  const parts = String(tableReference).trim().split(".");
  return normalizeIdentifier(parts.at(-1));
}

/**
 * Memisahkan teks berdasarkan delimiter hanya saat berada di luar string SQL
 * dan di luar pasangan tanda kurung. SQL escape dua petik tunggal ('') didukung.
 */
function splitSqlAware(text, delimiter = ",") {
  const result = [];
  let buffer = "";
  let quote = null;
  let depth = 0;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quote) {
      buffer += char;

      if (char === quote) {
        if (next === quote) {
          buffer += next;
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      buffer += char;
      continue;
    }

    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;

    if (char === delimiter && depth === 0) {
      result.push(buffer.trim());
      buffer = "";
      continue;
    }

    buffer += char;
  }

  if (buffer.trim() || text.endsWith(delimiter)) {
    result.push(buffer.trim());
  }

  return result;
}

function findMatchingParenthesis(text, openIndex) {
  let depth = 0;
  let quote = null;

  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quote) {
      if (char === quote) {
        if (next === quote) {
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function skipWhitespace(text, startIndex) {
  let index = startIndex;
  while (index < text.length && /\s/.test(text[index])) index += 1;
  return index;
}

function findKeywordOutsideQuotes(text, keyword, startIndex = 0) {
  const upperText = text.toUpperCase();
  const upperKeyword = keyword.toUpperCase();
  let quote = null;

  for (
    let index = startIndex;
    index <= text.length - keyword.length;
    index += 1
  ) {
    const char = text[index];
    const next = text[index + 1];

    if (quote) {
      if (char === quote) {
        if (next === quote) index += 1;
        else quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (upperText.slice(index, index + upperKeyword.length) === upperKeyword) {
      const before = index === 0 ? " " : text[index - 1];
      const after = text[index + upperKeyword.length] || " ";
      if (!/[A-Z0-9_]/i.test(before) && !/[A-Z0-9_]/i.test(after)) return index;
    }
  }

  return -1;
}

function parseValueTuples(text, startIndex) {
  const tuples = [];
  let index = skipWhitespace(text, startIndex);

  // Perulangan ini penting: satu INSERT dapat mempunyai banyak row VALUES.
  // Contoh: VALUES ('A', 1), ('B', 2), ('C', 3)
  while (index < text.length && text[index] === "(") {
    const closeIndex = findMatchingParenthesis(text, index);
    if (closeIndex === -1)
      throw new Error("Tanda kurung VALUES tidak lengkap.");

    tuples.push(splitSqlAware(text.slice(index + 1, closeIndex)));
    index = skipWhitespace(text, closeIndex + 1);

    if (text[index] !== ",") break;
    index = skipWhitespace(text, index + 1);
  }

  if (!tuples.length)
    throw new Error("VALUES (...) tidak ditemukan atau formatnya tidak valid.");
  return { tuples, endIndex: index };
}

/**
 * Membaca satu atau banyak INSERT, termasuk format multi-row:
 * INSERT INTO TABLE (A, B) VALUES ('x, y', 1), ('z', 2);
 */
function parseInsertStatements(sql) {
  const statements = [];
  const insertRegex = /\bINSERT\s+INTO\s+/gi;
  let match;

  while ((match = insertRegex.exec(sql)) !== null) {
    let cursor = skipWhitespace(sql, insertRegex.lastIndex);
    const tableStart = cursor;

    while (cursor < sql.length && !/[\s(]/.test(sql[cursor])) cursor += 1;
    const tableReference = sql.slice(tableStart, cursor).trim();
    cursor = skipWhitespace(sql, cursor);

    if (!tableReference || sql[cursor] !== "(") {
      throw new Error(
        `Daftar kolom tidak ditemukan pada data ${tableReference || "tabel"}.`,
      );
    }

    const columnsEnd = findMatchingParenthesis(sql, cursor);
    if (columnsEnd === -1)
      throw new Error(
        `Tanda kurung kolom untuk ${tableReference} tidak lengkap.`,
      );

    const columns = splitSqlAware(sql.slice(cursor + 1, columnsEnd)).map(
      normalizeIdentifier,
    );
    const valuesIndex = findKeywordOutsideQuotes(sql, "VALUES", columnsEnd + 1);

    if (valuesIndex === -1)
      throw new Error(
        `Keyword VALUES untuk ${tableReference} tidak ditemukan.`,
      );

    const parsedValues = parseValueTuples(sql, valuesIndex + "VALUES".length);
    parsedValues.tuples.forEach((values) => {
      if (columns.length !== values.length) {
        throw new Error(
          `${tableReference}: jumlah kolom (${columns.length}) tidak sama dengan jumlah nilai (${values.length}).`,
        );
      }

      statements.push({
        tableReference,
        tableName: getBaseTableName(tableReference),
        columns,
        values: values.map((value) => value.trim()),
      });
    });

    insertRegex.lastIndex = parsedValues.endIndex;
  }

  if (!statements.length) {
    throw new Error(
      "Format data tidak dikenali. Periksa kembali data yang dimasukkan.",
    );
  }

  return statements;
}

function createRow(statement) {
  return statement.columns.reduce((row, column, index) => {
    row[column] = statement.values[index];
    return row;
  }, {});
}

function isSqlNull(value) {
  return value == null || /^NULL$/i.test(String(value).trim());
}

function isEmptySqlString(value) {
  return /^'(?:\s*)'$/.test(String(value).trim());
}

function unquoteSqlString(value) {
  const trimmed = String(value).trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

function quoteProcedureValue(value, options = {}) {
  const {
    quoteNull = false,
    emptyAsNull = false,
    alwaysQuote = false,
  } = options;

  if (isSqlNull(value)) return quoteNull ? "'NULL'" : "NULL";
  if (emptyAsNull && isEmptySqlString(value)) return "NULL";

  const trimmed = String(value).trim();
  if (alwaysQuote) {
    const plainValue = unquoteSqlString(trimmed).replace(/'/g, "''");
    return `'${plainValue}'`;
  }

  return trimmed;
}

function requireColumns(row, columns, tableName) {
  const missing = columns.filter((column) => !(column in row));
  if (missing.length) {
    throw new Error(
      `${tableName}: kolom wajib tidak ditemukan: ${missing.join(", ")}.`,
    );
  }
}

function formatCall(procedureName, parameters, spacedSeparators = false) {
  const separator = spacedSeparators ? ", " : ",";
  return `CALL MWCONFIG.${procedureName}(${parameters.join(separator)});`;
}

function convertMappingCombine(statement) {
  const row = createRow(statement);

  if (statement.tableName === "MAPPING") {
    requireColumns(row, ["ID", "DESCRIPTION", "MODULE"], "MAPPING");
    return formatCall("MERGE_MAPPING", [
      quoteProcedureValue(row.ID),
      quoteProcedureValue(row.DESCRIPTION, { emptyAsNull: true }),
      quoteProcedureValue(row.MODULE),
    ]);
  }

  if (statement.tableName === "MAPPING_GROUP") {
    const columns = [
      "MAPPING_ID",
      "ID",
      "SOURCE",
      "TARGET",
      "INCLUDE_MAPPING_ID",
      "INCLUDE_ID",
    ];
    requireColumns(row, columns, "MAPPING_GROUP");
    return formatCall(
      "MERGE_MAPPING_GROUP",
      columns.map((column) =>
        quoteProcedureValue(row[column], { alwaysQuote: true }),
      ),
    );
  }

  if (statement.tableName === "MAPPING_GROUP_LINE") {
    const columns = ["MAPPING_ID", "MAPPING_GROUP_ID", "NAME", "TEXT", "SEQ"];
    requireColumns(row, columns, "MAPPING_GROUP_LINE");
    return formatCall(
      "MERGE_MAPPING_GROUP_LINE",
      columns.map((column) =>
        quoteProcedureValue(row[column], {
          alwaysQuote: true,
          quoteNull: true,
        }),
      ),
    );
  }

  throw new Error(
    `Mode MAPPING_COMBINE tidak menerima tabel ${statement.tableName}. Gunakan MAPPING, MAPPING_GROUP, atau MAPPING_GROUP_LINE.`,
  );
}

function convertParamMap(statement) {
  if (statement.tableName !== "PARAM_MAP") {
    throw new Error(
      `Mode PARAM_MAP tidak sesuai dengan tabel ${statement.tableName}.`,
    );
  }

  const row = createRow(statement);
  const columns = ["GROUP", "NAME", "VALUE", "SEQ", "DESCRIPTION"];
  requireColumns(row, columns, "PARAM_MAP");

  return formatCall(
    "MERGE_PARAM_MAP",
    columns.map((column) => quoteProcedureValue(row[column])),
    true,
  );
}

function convertGeneric(statement, selectedTable) {
  if (statement.tableName !== selectedTable) {
    throw new Error(
      `Dropdown memilih ${selectedTable}, tetapi input berisi tabel ${statement.tableName}.`,
    );
  }

  const parameters = statement.columns
    .map((column, index) => ({ column, value: statement.values[index] }))
    .filter(({ column }) => !AUDIT_COLUMNS.has(column))
    .map(({ value }) => quoteProcedureValue(value));

  if (!parameters.length) {
    throw new Error(
      `${selectedTable}: tidak ada parameter yang dapat dikonversi.`,
    );
  }

  return formatCall(`MERGE_${selectedTable}`, parameters, true);
}

function convertSql(sql, selectedTable) {
  const statements = parseInsertStatements(sql);

  const output = statements.map((statement) => {
    if (selectedTable === "MAPPING_COMBINE")
      return convertMappingCombine(statement);
    if (selectedTable === "PARAM_MAP") return convertParamMap(statement);
    return convertGeneric(statement, selectedTable);
  });

  return {
    output: output.join("\n"),
    count: output.length,
    insertCount: countInsertStatements(sql),
  };
}

function countInsertStatements(value) {
  return (value.match(/\bINSERT\s+INTO\b/gi) || []).length;
}

function updateInputStats() {
  const value = elements.inputSql.value;
  let rowCount = 0;

  // Saat SQL sudah lengkap, hitung jumlah tuple VALUES secara aktual.
  // Jika pengguna masih mengetik SQL yang belum lengkap, UI tetap berjalan normal.
  if (value.trim()) {
    try {
      rowCount = parseInsertStatements(value).length;
    } catch (_error) {
      rowCount = 0;
    }
  }

  const dataLabel = rowCount
    ? `${rowCount} data terdeteksi`
    : "siap menerima data";
  elements.inputStats.textContent = `${value.length.toLocaleString("id-ID")} karakter · ${dataLabel}`;
}

function showFeedback(message = "", type = "error") {
  elements.feedback.textContent = message;
  elements.feedback.classList.toggle("success", type === "success");
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  toastTimer = window.setTimeout(
    () => elements.toast.classList.remove("show"),
    2200,
  );
}

function handleConvert() {
  const sql = elements.inputSql.value.trim();
  if (!sql) {
    elements.inputSql.focus();
    showFeedback("Masukkan data yang ingin dikonversi terlebih dahulu.");
    return;
  }

  try {
    const result = convertSql(sql, elements.tableType.value);
    elements.outputSql.value = result.output;
    elements.outputStats.textContent = `${result.count} hasil berhasil dibuat`;
    elements.copyButton.disabled = false;
    showFeedback(`${result.count} data berhasil dikonversi.`, "success");
    showToast("Data berhasil dikonversi");
  } catch (error) {
    elements.outputSql.value = "";
    elements.outputStats.textContent = "Konversi gagal";
    elements.copyButton.disabled = true;
    showFeedback(error.message || "Terjadi kesalahan saat membaca SQL.");
  }
}

async function copyOutput() {
  if (!elements.outputSql.value) return;

  try {
    await navigator.clipboard.writeText(elements.outputSql.value);
  } catch (_error) {
    elements.outputSql.select();
    document.execCommand("copy");
  }

  showToast("Hasil berhasil disalin");
}

function clearEditors() {
  elements.inputSql.value = "";
  elements.outputSql.value = "";
  elements.outputStats.textContent = "Belum ada hasil";
  elements.copyButton.disabled = true;
  showFeedback();
  updateInputStats();
  elements.inputSql.focus();
}

function toggleLayout() {
  const isStacked = elements.editorGrid.classList.toggle("stacked");
  elements.layoutButton.setAttribute("aria-pressed", String(isStacked));
  elements.layoutModeLabel.textContent = isStacked
    ? "Posisi atas–bawah"
    : "Posisi kiri–kanan";
  showToast(
    isStacked
      ? "Layout diubah menjadi atas-bawah"
      : "Layout diubah menjadi kiri-kanan",
  );
}

elements.inputSql.addEventListener("input", updateInputStats);
elements.convertButton.addEventListener("click", handleConvert);
elements.copyButton.addEventListener("click", copyOutput);
elements.clearButton.addEventListener("click", clearEditors);
elements.layoutButton.addEventListener("click", toggleLayout);
elements.tableType.addEventListener("change", () => showFeedback());

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    handleConvert();
  }
});

document.documentElement.dataset.appVersion = APP_VERSION;
updateInputStats();

// Membuat fungsi inti dapat diuji di Node.js tanpa mengubah perilaku browser.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    splitSqlAware,
    parseInsertStatements,
    convertSql,
  };
}
