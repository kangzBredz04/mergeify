"use strict";

const APP_VERSION = "4.5.0";

const elements = {
  tableType: document.getElementById("tableType"),
  operationType: document.getElementById("operationType"),
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
  samplePanel: document.getElementById("samplePanel"),
  sampleSql: document.getElementById("sampleSql"),
  sampleHint: document.getElementById("sampleHint"),
  copySampleButton: document.getElementById("copySampleButton"),
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

function splitDelimitedLine(line, delimiter) {
  if (delimiter === "\t") return line.split("\t");

  const values = [];
  let buffer = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        buffer += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === delimiter && !quoted) {
      values.push(buffer);
      buffer = "";
      continue;
    }

    buffer += char;
  }

  values.push(buffer);
  return values;
}

function detectTabularDelimiter(line) {
  if (line.includes("\t")) return "\t";
  if (line.includes("|")) return "|";
  if (line.includes(",")) return ",";
  return null;
}

const TABULAR_NUMERIC_COLUMNS = {
  SERVER_PORT: new Set(["PORT"]),
  PARAM_MAP: new Set(["SEQ"]),
  MAPPING_GROUP: new Set(["ID"]),
  MAPPING_GROUP_LINE: new Set(["MAPPING_GROUP_ID", "SEQ"]),
  CLIENT_TARGET: new Set(["SEQ", "WEIGHT"]),
  CHARGES: new Set([
    "C1_VALUE",
    "C2_VALUE",
    "C3_VALUE",
    "C4_VALUE",
    "C5_VALUE",
  ]),
};

function tabularValueToSqlLiteral(value, tableName, columnName) {
  const raw = String(value ?? "").replace(/\r$/, "");
  const trimmed = raw.trim();

  if (trimmed === "") return "''";
  if (/^(?:NULL|\[NULL\]|<NULL>|\(NULL\))$/i.test(trimmed)) return "NULL";
  if (/^'(?:[^']|'')*'$/.test(trimmed)) return trimmed;

  const numericColumns = TABULAR_NUMERIC_COLUMNS[tableName];
  if (
    numericColumns?.has(columnName) &&
    /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)
  ) {
    return trimmed;
  }

  return `'${raw.replace(/'/g, "''")}'`;
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

const TABLE_RULES = {
  SERVER_PORT: {
    columns: ["ADAPTOR_ID", "PORT", "SERVER", "GROUP"],
    keyColumns: ["ADAPTOR_ID"],
    procedure: "MERGE_SERVER_PORT",
  },
};

const UNAVAILABLE_TABLES = new Set([
  "ADAPTOR",
  "ADAPTOR_CODEX",
  "ADAPTOR_PARAM",
  "CLIENT",
]);

const MAPPING_RULES = {
  MAPPING: {
    columns: ["ID", "DESCRIPTION", "MODULE"],
    keyColumns: ["ID"],
    procedure: "MERGE_MAPPING",
  },
  MAPPING_GROUP: {
    columns: [
      "MAPPING_ID",
      "ID",
      "SOURCE",
      "TARGET",
      "INCLUDE_MAPPING_ID",
      "INCLUDE_ID",
    ],
    keyColumns: ["MAPPING_ID", "ID"],
    procedure: "MERGE_MAPPING_GROUP",
  },
  MAPPING_GROUP_LINE: {
    columns: ["MAPPING_ID", "MAPPING_GROUP_ID", "NAME", "TEXT", "SEQ"],
    keyColumns: ["MAPPING_ID", "MAPPING_GROUP_ID", "NAME"],
    procedure: "MERGE_MAPPING_GROUP_LINE",
  },
};

const ROUTING_TABLE_COLUMNS = [
  "CODE_START",
  "CODE_END",
  "CHANNEL",
  "QUEUE",
  "STATUS",
  "SUBCODEX",
  "REPLY_TO",
  "REPLY_TO_QMGR",
];

const PARAM_MAP_COLUMNS = ["GROUP", "NAME", "VALUE", "DESCRIPTION", "SEQ"];
const ERROR_MAP_COLUMNS = ["GROUP", "ORIGINAL", "TARGET", "DETAIL"];
const DTREE_REQUIRED_COLUMNS = ["GROUP", "PATH", "VALUE"];
const DTREE_OUTPUT_COLUMNS = ["GROUP", "PATH", "VALUE", "MODULE"];
const DEV_TELLER_MAP_COLUMNS = [
  "GROUP",
  "DEVICE_ID",
  "DEVICE_NAME",
  "TERMINAL_ID",
  "TERMINAL_IP",
  "TELLER_ID",
  "CTRL_UNIT_ID",
];
const CLIENT_TARGET_COLUMNS = ["CLIENT_ID", "ID", "HOST", "SEQ", "WEIGHT"];
const CHARGES_COLUMNS = [
  "ID",
  "C1_NAME",
  "C1_VALUE",
  "C1_SCRIPT",
  "C1_ACCOUNT",
  "C2_NAME",
  "C2_VALUE",
  "C2_SCRIPT",
  "C2_ACCOUNT",
  "C3_NAME",
  "C3_VALUE",
  "C3_SCRIPT",
  "C3_ACCOUNT",
  "C4_NAME",
  "C4_VALUE",
  "C4_SCRIPT",
  "C4_ACCOUNT",
  "C5_NAME",
  "C5_VALUE",
  "C5_SCRIPT",
  "C5_ACCOUNT",
];

const SAMPLE_SELECTS = {
  SERVER_PORT: [
    "SELECT ADAPTOR_ID, PORT, SERVER, GROUP FROM MWCONFIG.SERVER_PORT WHERE ADAPTOR_ID LIKE '%ISI_ADAPTOR_ID%';",
  ],
  ROUTING_TABLE: [
    "SELECT CODE_START, CODE_END, CHANNEL, QUEUE, STATUS, SUBCODEX, REPLY_TO, REPLY_TO_QMGR FROM MWCONFIG.ROUTING_TABLE WHERE CHANNEL LIKE '%ISI_CHANNEL%' AND CODE_START LIKE '%ISI_CODE_START%' AND CODE_END LIKE '%ISI_CODE_END%';",
  ],
  PARAM_MAP: [
    "SELECT GROUP, NAME, VALUE, DESCRIPTION, SEQ FROM MWCONFIG.PARAM_MAP WHERE GROUP LIKE '%ISI_GROUP%' AND NAME LIKE '%ISI_NAME%';",
  ],
  MAPPING_COMBINE: [
    "SELECT ID, DESCRIPTION, MODULE FROM MWCONFIG.MAPPING WHERE ID LIKE '%ISI_MAPPING_ID%';",
    "SELECT MAPPING_ID, ID, SOURCE, TARGET, INCLUDE_MAPPING_ID, INCLUDE_ID FROM MWCONFIG.MAPPING_GROUP WHERE MAPPING_ID LIKE '%ISI_MAPPING_ID%' AND CAST(ID AS VARCHAR(20)) LIKE '%ISI_GROUP_ID%';",
    "SELECT MAPPING_ID, MAPPING_GROUP_ID, NAME, TEXT, SEQ FROM MWCONFIG.MAPPING_GROUP_LINE WHERE MAPPING_ID LIKE '%ISI_MAPPING_ID%' AND CAST(MAPPING_GROUP_ID AS VARCHAR(20)) LIKE '%ISI_GROUP_ID%' AND NAME LIKE '%ISI_NAME%';",
  ],
  ERROR_MAP: [
    "SELECT GROUP, ORIGINAL, TARGET, DETAIL FROM MWCONFIG.ERROR_MAP WHERE GROUP LIKE '%ISI_GROUP%' AND ORIGINAL LIKE '%ISI_ORIGINAL%';",
  ],
  DTREE: [
    "SELECT GROUP, PATH, VALUE, MODULE FROM MWCONFIG.DTREE WHERE GROUP LIKE '%ISI_GROUP%' AND PATH LIKE '%ISI_PATH%';",
  ],
  DEV_TELLER_MAP: [
    "SELECT GROUP, DEVICE_ID, DEVICE_NAME, TERMINAL_ID, TERMINAL_IP, TELLER_ID, CTRL_UNIT_ID FROM MWCONFIG.DEV_TELLER_MAP WHERE GROUP LIKE '%ISI_GROUP%' AND DEVICE_ID LIKE '%ISI_DEVICE_ID%';",
  ],
  CLIENT_TARGET: [
    "SELECT CLIENT_ID, ID, HOST, SEQ, WEIGHT FROM MWCONFIG.CLIENT_TARGET WHERE CLIENT_ID LIKE '%ISI_CLIENT_ID%' AND ID LIKE '%ISI_ID%';",
  ],
  CHARGES: [
    `SELECT ${CHARGES_COLUMNS.join(", ")} FROM MWCONFIG.CHARGES WHERE ID LIKE '%ISI_ID%';`,
  ],
};

function getExpectedTabularSchemas(selectedTable) {
  if (selectedTable === "MAPPING_COMBINE") {
    return Object.entries(MAPPING_RULES).map(([tableName, rule]) => ({
      tableName,
      requiredColumns: rule.columns,
    }));
  }

  const schemas = {
    SERVER_PORT: TABLE_RULES.SERVER_PORT.columns,
    ROUTING_TABLE: ROUTING_TABLE_COLUMNS,
    PARAM_MAP: PARAM_MAP_COLUMNS,
    ERROR_MAP: ERROR_MAP_COLUMNS,
    DTREE: DTREE_OUTPUT_COLUMNS,
    DEV_TELLER_MAP: DEV_TELLER_MAP_COLUMNS,
    CLIENT_TARGET: CLIENT_TARGET_COLUMNS,
    CHARGES: CHARGES_COLUMNS,
  };

  const columns = schemas[selectedTable];
  return columns
    ? [{ tableName: selectedTable, requiredColumns: columns }]
    : [];
}

function matchTabularHeader(fields, selectedTable) {
  const normalized = fields.map(normalizeIdentifier);
  const headerSet = new Set(normalized);

  const match = getExpectedTabularSchemas(selectedTable).find(
    ({ requiredColumns }) =>
      requiredColumns.every((column) => headerSet.has(column)),
  );

  if (!match) return null;
  return {
    tableName: match.tableName,
    columns: normalized,
  };
}

function parseTabularResult(input, selectedTable) {
  const lines = String(input).replace(/\r\n?/g, "\n").split("\n");
  const statements = [];
  let activeHeader = null;
  let delimiter = null;

  for (const originalLine of lines) {
    if (!originalLine.trim()) continue;

    if (!delimiter) {
      delimiter = detectTabularDelimiter(originalLine);
      if (!delimiter) continue;
    }

    const fields = splitDelimitedLine(originalLine, delimiter);
    const headerMatch = matchTabularHeader(fields, selectedTable);
    if (headerMatch) {
      activeHeader = headerMatch;
      continue;
    }

    if (!activeHeader) continue;

    // Header dapat berulang saat beberapa hasil SELECT dicopy sekaligus.
    const normalizedFields = fields.map(normalizeIdentifier);
    if (
      normalizedFields.length === activeHeader.columns.length &&
      normalizedFields.every(
        (field, index) => field === activeHeader.columns[index],
      )
    ) {
      continue;
    }

    while (fields.length < activeHeader.columns.length) fields.push("");
    if (fields.length > activeHeader.columns.length) {
      throw new Error(
        `${activeHeader.tableName}: jumlah nilai hasil SELECT lebih banyak dari jumlah kolom header.`,
      );
    }

    statements.push({
      tableReference: `MWCONFIG.${activeHeader.tableName}`,
      tableName: activeHeader.tableName,
      columns: activeHeader.columns,
      values: fields.map((value, index) =>
        tabularValueToSqlLiteral(
          value,
          activeHeader.tableName,
          activeHeader.columns[index],
        ),
      ),
      sourceType: "TABULAR",
    });
  }

  if (!statements.length) {
    throw new Error(
      "Hasil SELECT belum dikenali. Copy header kolom beserta row data dari database, lalu tempel ke Data Input.",
    );
  }

  return statements;
}

function parseInputData(input, selectedTable) {
  if (/\bINSERT\s+INTO\b/i.test(input)) return parseInsertStatements(input);
  return parseTabularResult(input, selectedTable);
}

function updateSamplePanel() {
  const table = elements.tableType.value;
  const samples = SAMPLE_SELECTS[table];

  if (!samples || UNAVAILABLE_TABLES.has(table)) {
    elements.samplePanel.hidden = true;
    elements.sampleSql.textContent = "";
    return;
  }

  elements.samplePanel.hidden = false;
  elements.sampleSql.textContent = samples.join("\n");
  elements.sampleHint.textContent =
    table === "MAPPING_COMBINE"
      ? "Ganti keyword di dalam LIKE. Untuk MAPPING_COMBINE cukup gunakan 1 sample MAPPING, 1 MAPPING_GROUP, dan 1 MAPPING_GROUP_LINE sesuai data yang dicari."
      : "Ganti keyword di dalam LIKE sesuai data yang ingin dicari, jalankan query, lalu copy header + rows hasilnya ke Data Input.";
}

function getRule(statement, selectedTable) {
  if (selectedTable === "MAPPING_COMBINE") {
    const rule = MAPPING_RULES[statement.tableName];
    if (!rule) {
      throw new Error(
        `Mode MAPPING_COMBINE tidak menerima tabel ${statement.tableName}. Gunakan MAPPING, MAPPING_GROUP, atau MAPPING_GROUP_LINE.`,
      );
    }
    return rule;
  }

  if (statement.tableName !== selectedTable) {
    throw new Error(
      `Dropdown memilih ${selectedTable}, tetapi input berisi tabel ${statement.tableName}.`,
    );
  }

  return TABLE_RULES[selectedTable] || null;
}

function getGenericColumns(statement) {
  return statement.columns.filter((column) => !AUDIT_COLUMNS.has(column));
}

function getConversionColumns(statement, selectedTable, rule) {
  const row = createRow(statement);

  if (rule) {
    requireColumns(row, rule.columns, statement.tableName);
    return rule.columns;
  }

  const columns = getGenericColumns(statement);
  if (!columns.length) {
    throw new Error(`${selectedTable}: tidak ada kolom yang dapat dikonversi.`);
  }
  return columns;
}

function getKeyColumns(columns, rule) {
  if (rule?.keyColumns?.length) return rule.keyColumns;
  return [columns[0]];
}

function formatWhere(row, keyColumns) {
  return keyColumns
    .map((column) => `${column} = ${quoteProcedureValue(row[column])}`)
    .join(" AND ");
}

function valueOrEmptyString(value) {
  return isSqlNull(value) ? "''" : quoteProcedureValue(value);
}

function valueOrBlank(value) {
  return isSqlNull(value) ? "" : quoteProcedureValue(value);
}

function rowValueOrDefault(row, column, defaultValue = "''") {
  return column in row ? quoteProcedureValue(row[column]) : defaultValue;
}

function normalizeWholeNumber(value) {
  if (isSqlNull(value)) return "NULL";
  const raw = String(value).trim();
  if (/^[+-]?\d+\.0+$/.test(raw)) return raw.replace(/\.0+$/, "");
  return raw;
}

function chargeTextValue(value) {
  return quoteProcedureValue(value);
}

function chargeNumericValue(row, index) {
  const value = row[`C${index}_VALUE`];
  return index % 2 === 1
    ? normalizeWholeNumber(value)
    : quoteProcedureValue(value);
}

function unavailableTableMessage(tableName) {
  return `Fitur konversi ${tableName} belum tersedia untuk saat ini.`;
}

function convertInsert(statement, selectedTable, rule, columns) {
  const row = createRow(statement);

  // Pertahankan aturan khusus converter MAPPING_COMBINE.
  if (selectedTable === "MAPPING_COMBINE") {
    if (statement.tableName === "MAPPING") {
      return formatCall("MERGE_MAPPING", [
        quoteProcedureValue(row.ID),
        quoteProcedureValue(row.DESCRIPTION),
        quoteProcedureValue(row.MODULE),
      ]);
    }

    if (statement.tableName === "MAPPING_GROUP") {
      return formatCall(
        "MERGE_MAPPING_GROUP",
        columns.map((column) =>
          quoteProcedureValue(row[column], { alwaysQuote: true }),
        ),
      );
    }

    if (statement.tableName === "MAPPING_GROUP_LINE") {
      return formatCall(
        "MERGE_MAPPING_GROUP_LINE",
        columns.map((column) =>
          quoteProcedureValue(row[column], {
            alwaysQuote: true,
          }),
        ),
      );
    }
  }

  const procedureName = rule?.procedure || `MERGE_${selectedTable}`;
  return formatCall(
    procedureName,
    columns.map((column) => quoteProcedureValue(row[column])),
    selectedTable !== "MAPPING_COMBINE",
  );
}

function convertSelect(statement, columns, keyColumns) {
  const row = createRow(statement);
  return `SELECT ${columns.join(", ")} FROM MWCONFIG.${statement.tableName} WHERE ${formatWhere(row, keyColumns)};`;
}

function convertUpdate(statement, columns, keyColumns) {
  const row = createRow(statement);
  const keySet = new Set(keyColumns);
  const setColumns = columns.filter((column) => !keySet.has(column));

  if (!setColumns.length) {
    throw new Error(
      `${statement.tableName}: tidak ada kolom yang dapat di-update.`,
    );
  }

  const setClause = setColumns
    .map((column) => `${column} = ${quoteProcedureValue(row[column])}`)
    .join(", ");

  return `UPDATE MWCONFIG.${statement.tableName} SET ${setClause} WHERE ${formatWhere(row, keyColumns)};`;
}

function convertDelete(statement, keyColumns) {
  const row = createRow(statement);
  return `DELETE MWCONFIG.${statement.tableName} WHERE ${formatWhere(row, keyColumns)};`;
}

function ensureSelectedTable(statement, expectedTable) {
  if (statement.tableName !== expectedTable) {
    throw new Error(
      `Dropdown memilih ${expectedTable}, tetapi input berisi tabel ${statement.tableName}.`,
    );
  }
}

function convertRoutingTable(statement, operation) {
  ensureSelectedTable(statement, "ROUTING_TABLE");
  const row = createRow(statement);
  requireColumns(row, ROUTING_TABLE_COLUMNS, "ROUTING_TABLE");

  const where = ["CHANNEL", "CODE_START", "CODE_END"]
    .map((column) => `${column} = ${quoteProcedureValue(row[column])}`)
    .join(" AND ");

  if (operation === "SELECT") {
    return `SELECT ${ROUTING_TABLE_COLUMNS.join(", ")} FROM MWCONFIG.ROUTING_TABLE WHERE ${where};`;
  }

  if (operation === "UPDATE") {
    return `UPDATE MWCONFIG.ROUTING_TABLE SET QUEUE = ${quoteProcedureValue(row.QUEUE)}, STATUS = ${quoteProcedureValue(row.STATUS)}, SUBCODEX = ${quoteProcedureValue(row.SUBCODEX)}, REPLY_TO = ${quoteProcedureValue(row.REPLY_TO)}, REPLY_TO_QMGR = ${quoteProcedureValue(row.REPLY_TO_QMGR)}, MODIFIED_BY = CURRENT USER, MODIFIED_DATE = CURRENT TIMESTAMP WHERE ${where};`;
  }

  if (operation === "DELETE") {
    return `DELETE MWCONFIG.ROUTING_TABLE WHERE ${where};`;
  }

  return formatCall(
    "MERGE_ROUTING_TABLE",
    [
      quoteProcedureValue(row.CODE_START),
      quoteProcedureValue(row.CODE_END),
      quoteProcedureValue(row.CHANNEL),
      "CURRENT TIMESTAMP",
      "NULL",
      quoteProcedureValue(row.QUEUE),
      quoteProcedureValue(row.STATUS),
      quoteProcedureValue(row.SUBCODEX),
      "''",
      quoteProcedureValue(row.REPLY_TO),
      quoteProcedureValue(row.REPLY_TO_QMGR),
      "CURRENT USER",
      "CURRENT TIMESTAMP",
    ],
    true,
  );
}

function convertParamMapSpecial(statement, operation) {
  ensureSelectedTable(statement, "PARAM_MAP");
  const row = createRow(statement);
  requireColumns(row, PARAM_MAP_COLUMNS, "PARAM_MAP");
  const where = `GROUP = ${quoteProcedureValue(row.GROUP)} AND NAME = ${quoteProcedureValue(row.NAME)}`;

  if (operation === "SELECT") {
    return `SELECT ${PARAM_MAP_COLUMNS.join(", ")} FROM MWCONFIG.PARAM_MAP WHERE ${where};`;
  }

  if (operation === "UPDATE") {
    return `UPDATE MWCONFIG.PARAM_MAP SET VALUE = ${quoteProcedureValue(row.VALUE)}, DESCRIPTION = ${quoteProcedureValue(row.DESCRIPTION)}, SEQ = ${quoteProcedureValue(row.SEQ)} WHERE ${where};`;
  }

  if (operation === "DELETE") {
    return `DELETE MWCONFIG.PARAM_MAP WHERE ${where};`;
  }

  // Urutan parameter procedure: GROUP, NAME, VALUE, SEQ, DESCRIPTION.
  return formatCall(
    "MERGE_PARAM_MAP",
    [
      quoteProcedureValue(row.GROUP),
      quoteProcedureValue(row.NAME),
      quoteProcedureValue(row.VALUE),
      quoteProcedureValue(row.SEQ),
      quoteProcedureValue(row.DESCRIPTION),
    ],
    true,
  );
}

function convertErrorMap(statement, operation) {
  ensureSelectedTable(statement, "ERROR_MAP");
  const row = createRow(statement);
  requireColumns(row, ERROR_MAP_COLUMNS, "ERROR_MAP");
  const where = `GROUP = ${quoteProcedureValue(row.GROUP)} AND ORIGINAL = ${quoteProcedureValue(row.ORIGINAL)}`;

  if (operation === "SELECT") {
    return `SELECT ${ERROR_MAP_COLUMNS.join(", ")} FROM MWCONFIG.ERROR_MAP WHERE ${where};`;
  }

  if (operation === "UPDATE") {
    return `UPDATE MWCONFIG.ERROR_MAP SET TARGET = ${quoteProcedureValue(row.TARGET)}, DETAIL = ${quoteProcedureValue(row.DETAIL)}, MODIFIED_BY = CURRENT USER, TIMESTAMP = CURRENT TIMESTAMP WHERE ${where};`;
  }

  if (operation === "DELETE") {
    return `DELETE MWCONFIG.ERROR_MAP WHERE ${where};`;
  }

  return formatCall(
    "MERGE_ERROR_MAP",
    [
      quoteProcedureValue(row.GROUP),
      quoteProcedureValue(row.ORIGINAL),
      quoteProcedureValue(row.TARGET),
      quoteProcedureValue(row.DETAIL),
    ],
    true,
  );
}

function convertDtree(statement, operation) {
  ensureSelectedTable(statement, "DTREE");
  const row = createRow(statement);
  requireColumns(row, DTREE_REQUIRED_COLUMNS, "DTREE");
  const moduleValue = rowValueOrDefault(row, "MODULE", "''");
  const where = `GROUP = ${quoteProcedureValue(row.GROUP)} AND PATH = ${quoteProcedureValue(row.PATH)}`;

  if (operation === "SELECT") {
    return `SELECT ${DTREE_OUTPUT_COLUMNS.join(", ")} FROM MWCONFIG.DTREE WHERE ${where};`;
  }

  if (operation === "UPDATE") {
    return `UPDATE MWCONFIG.DTREE SET VALUE = ${quoteProcedureValue(row.VALUE)}, MODULE = ${moduleValue}, MODIFIED_BY = CURRENT USER, TIMESTAMP = CURRENT TIMESTAMP WHERE ${where};`;
  }

  if (operation === "DELETE") {
    return `DELETE MWCONFIG.DTREE WHERE ${where};`;
  }

  return formatCall(
    "MERGE_DTREE",
    [
      quoteProcedureValue(row.GROUP),
      quoteProcedureValue(row.PATH),
      quoteProcedureValue(row.VALUE),
      moduleValue,
    ],
    true,
  );
}

function convertDevTellerMap(statement, operation) {
  ensureSelectedTable(statement, "DEV_TELLER_MAP");
  const row = createRow(statement);
  requireColumns(row, DEV_TELLER_MAP_COLUMNS, "DEV_TELLER_MAP");
  const where = `GROUP = ${quoteProcedureValue(row.GROUP)} AND DEVICE_ID = ${quoteProcedureValue(row.DEVICE_ID)}`;

  if (operation === "SELECT") {
    return `SELECT ${DEV_TELLER_MAP_COLUMNS.join(", ")} FROM MWCONFIG.DEV_TELLER_MAP WHERE ${where};`;
  }

  if (operation === "UPDATE") {
    return `UPDATE MWCONFIG.DEV_TELLER_MAP SET DEVICE_NAME = ${quoteProcedureValue(row.DEVICE_NAME)}, TERMINAL_ID = ${quoteProcedureValue(row.TERMINAL_ID)}, TERMINAL_IP = ${quoteProcedureValue(row.TERMINAL_IP)}, TELLER_ID = ${quoteProcedureValue(row.TELLER_ID)}, CTRL_UNIT_ID = ${quoteProcedureValue(row.CTRL_UNIT_ID)}, MODIFIED_BY = CURRENT USER, TIMESTAMP = CURRENT TIMESTAMP WHERE ${where};`;
  }

  if (operation === "DELETE") {
    return `DELETE MWCONFIG.DEV_TELLER_MAP WHERE ${where};`;
  }

  return formatCall(
    "MERGE_DEV_TELLER_MAP",
    DEV_TELLER_MAP_COLUMNS.map((column) => quoteProcedureValue(row[column])),
    true,
  );
}

function convertClientTarget(statement, operation) {
  ensureSelectedTable(statement, "CLIENT_TARGET");
  const row = createRow(statement);
  requireColumns(row, CLIENT_TARGET_COLUMNS, "CLIENT_TARGET");
  const where = `CLIENT_ID = ${quoteProcedureValue(row.CLIENT_ID)} AND ID = ${quoteProcedureValue(row.ID)}`;

  if (operation === "SELECT") {
    return `SELECT ${CLIENT_TARGET_COLUMNS.join(", ")} FROM MWCONFIG.CLIENT_TARGET WHERE ${where};`;
  }

  if (operation === "UPDATE") {
    return `UPDATE MWCONFIG.CLIENT_TARGET SET HOST = ${quoteProcedureValue(row.HOST)}, SEQ = ${quoteProcedureValue(row.SEQ)}, WEIGHT = ${quoteProcedureValue(row.WEIGHT)} WHERE ${where};`;
  }

  if (operation === "DELETE") {
    return `DELETE MWCONFIG.CLIENT_TARGET WHERE ${where};`;
  }

  return formatCall(
    "CLIENT_TARGET",
    [
      quoteProcedureValue(row.CLIENT_ID),
      quoteProcedureValue(row.ID),
      quoteProcedureValue(row.HOST),
      quoteProcedureValue(row.SEQ),
      quoteProcedureValue(row.WEIGHT),
    ],
    true,
  );
}

function convertCharges(statement, operation) {
  ensureSelectedTable(statement, "CHARGES");
  const row = createRow(statement);
  requireColumns(row, CHARGES_COLUMNS, "CHARGES");
  const where = `ID = ${quoteProcedureValue(row.ID)}`;

  if (operation === "SELECT") {
    return `SELECT ${CHARGES_COLUMNS.join(", ")} FROM MWCONFIG.CHARGES WHERE ${where};`;
  }

  if (operation === "UPDATE") {
    const assignments = [];
    for (let index = 1; index <= 5; index += 1) {
      assignments.push(
        `C${index}_NAME = ${chargeTextValue(row[`C${index}_NAME`])}`,
        `C${index}_VALUE = ${chargeNumericValue(row, index)}`,
        `C${index}_SCRIPT = ${chargeTextValue(row[`C${index}_SCRIPT`])}`,
        `C${index}_ACCOUNT = ${chargeTextValue(row[`C${index}_ACCOUNT`])}`,
      );
    }
    assignments.push(
      "MODIFIED_BY = CURRENT USER",
      "TIMESTAMP = CURRENT TIMESTAMP",
    );
    return `UPDATE MWCONFIG.CHARGES SET ${assignments.join(", ")} WHERE ${where};`;
  }

  if (operation === "DELETE") {
    return `DELETE MWCONFIG.CHARGES WHERE ${where};`;
  }

  const parameters = [quoteProcedureValue(row.ID)];
  for (let index = 1; index <= 5; index += 1) {
    parameters.push(
      chargeNumericValue(row, index),
      chargeTextValue(row[`C${index}_NAME`]),
      chargeTextValue(row[`C${index}_SCRIPT`]),
      chargeTextValue(row[`C${index}_ACCOUNT`]),
    );
  }

  return formatCall("MERGE_CHARGES", parameters, true);
}

function convertMappingCombine(statement, operation) {
  const rule = getRule(statement, "MAPPING_COMBINE");
  const row = createRow(statement);
  requireColumns(row, rule.columns, statement.tableName);

  if (operation === "INSERT") {
    return convertInsert(statement, "MAPPING_COMBINE", rule, rule.columns);
  }

  if (operation === "SELECT") {
    return convertSelect(statement, rule.columns, rule.keyColumns);
  }

  if (operation === "DELETE") {
    return convertDelete(statement, rule.keyColumns);
  }

  return convertUpdate(statement, rule.columns, rule.keyColumns);
}

function convertStatement(statement, selectedTable, operation) {
  if (UNAVAILABLE_TABLES.has(selectedTable)) {
    throw new Error(unavailableTableMessage(selectedTable));
  }
  if (selectedTable === "ROUTING_TABLE") {
    return convertRoutingTable(statement, operation);
  }
  if (selectedTable === "PARAM_MAP") {
    return convertParamMapSpecial(statement, operation);
  }
  if (selectedTable === "MAPPING_COMBINE") {
    return convertMappingCombine(statement, operation);
  }
  if (selectedTable === "ERROR_MAP") {
    return convertErrorMap(statement, operation);
  }
  if (selectedTable === "DTREE") {
    return convertDtree(statement, operation);
  }
  if (selectedTable === "DEV_TELLER_MAP") {
    return convertDevTellerMap(statement, operation);
  }
  if (selectedTable === "CLIENT_TARGET") {
    return convertClientTarget(statement, operation);
  }
  if (selectedTable === "CHARGES") {
    return convertCharges(statement, operation);
  }

  const rule = getRule(statement, selectedTable);
  const columns = getConversionColumns(statement, selectedTable, rule);
  const keyColumns = getKeyColumns(columns, rule);
  const row = createRow(statement);
  requireColumns(row, keyColumns, statement.tableName);

  switch (operation) {
    case "SELECT":
      return convertSelect(statement, columns, keyColumns);
    case "UPDATE":
      return convertUpdate(statement, columns, keyColumns);
    case "DELETE":
      return convertDelete(statement, keyColumns);
    case "INSERT":
    default:
      return convertInsert(statement, selectedTable, rule, columns);
  }
}

function convertSql(sql, selectedTable, operation = "INSERT") {
  if (UNAVAILABLE_TABLES.has(selectedTable)) {
    throw new Error(unavailableTableMessage(selectedTable));
  }

  const statements = parseInputData(sql, selectedTable);
  const normalizedOperation = String(operation || "INSERT").toUpperCase();
  const allowedOperations = new Set(["INSERT", "SELECT", "UPDATE", "DELETE"]);

  if (!allowedOperations.has(normalizedOperation)) {
    throw new Error(`Jenis konversi ${normalizedOperation} tidak didukung.`);
  }

  const output = statements.map((statement) =>
    convertStatement(statement, selectedTable, normalizedOperation),
  );

  return {
    output: output.join("\n"),
    count: output.length,
    insertCount: countInsertStatements(sql),
    operation: normalizedOperation,
  };
}

function countInsertStatements(value) {
  return (value.match(/\bINSERT\s+INTO\b/gi) || []).length;
}

function updateInputStats() {
  const value = elements.inputSql.value;
  let rowCount = 0;

  if (value.trim()) {
    try {
      rowCount = parseInputData(value, elements.tableType.value).length;
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

let hasConvertedOnce = false;

function handleConvert(options = {}) {
  const { showSuccessToast = true, focusWhenEmpty = true } = options;
  const sql = elements.inputSql.value.trim();

  if (!sql) {
    if (focusWhenEmpty) elements.inputSql.focus();
    showFeedback("Masukkan data yang ingin dikonversi terlebih dahulu.");
    return false;
  }

  hasConvertedOnce = true;

  try {
    const result = convertSql(
      sql,
      elements.tableType.value,
      elements.operationType.value,
    );
    elements.outputSql.value = result.output;
    elements.outputStats.textContent = `${result.count} hasil ${result.operation} berhasil dibuat`;
    elements.copyButton.disabled = false;
    showFeedback(
      `${result.count} data berhasil dikonversi ke ${result.operation}.`,
      "success",
    );
    if (showSuccessToast) {
      showToast(`Data berhasil dikonversi ke ${result.operation}`);
    }
    return true;
  } catch (error) {
    elements.outputSql.value = "";
    elements.outputStats.textContent = "Konversi gagal";
    elements.copyButton.disabled = true;
    showFeedback(error.message || "Terjadi kesalahan saat membaca SQL.");
    return false;
  }
}

function regenerateIfAlreadyConverted() {
  if (!hasConvertedOnce || !elements.inputSql.value.trim()) {
    showFeedback();
    return;
  }

  handleConvert({ showSuccessToast: false, focusWhenEmpty: false });
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

async function copySampleSql() {
  const sample = elements.sampleSql.textContent.trim();
  if (!sample) return;

  try {
    await navigator.clipboard.writeText(sample);
  } catch (_error) {
    const range = document.createRange();
    range.selectNodeContents(elements.sampleSql);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand("copy");
    selection.removeAllRanges();
  }

  showToast("Sample SELECT berhasil disalin");
}

function clearEditors() {
  elements.inputSql.value = "";
  elements.outputSql.value = "";
  elements.outputStats.textContent = "Belum ada hasil";
  elements.copyButton.disabled = true;
  hasConvertedOnce = false;
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
elements.convertButton.addEventListener("click", () => handleConvert());
elements.copyButton.addEventListener("click", copyOutput);
elements.copySampleButton.addEventListener("click", copySampleSql);
elements.clearButton.addEventListener("click", clearEditors);
elements.layoutButton.addEventListener("click", toggleLayout);
elements.tableType.addEventListener("change", () => {
  const selectedTable = elements.tableType.value;
  updateSamplePanel();
  updateInputStats();

  if (UNAVAILABLE_TABLES.has(selectedTable)) {
    elements.outputSql.value = "";
    elements.outputStats.textContent = "Fitur belum tersedia";
    elements.copyButton.disabled = true;
    showFeedback(unavailableTableMessage(selectedTable));
    return;
  }

  regenerateIfAlreadyConverted();
});
elements.operationType.addEventListener("change", regenerateIfAlreadyConverted);

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    handleConvert();
  }
});

document.documentElement.dataset.appVersion = APP_VERSION;
updateInputStats();
updateSamplePanel();

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    splitSqlAware,
    parseInsertStatements,
    parseTabularResult,
    parseInputData,
    convertSql,
  };
}
