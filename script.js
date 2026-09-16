// --- UI Logic ---
function toggleLayout() {
  const workspace = document.getElementById("workspace");
  if (workspace.classList.contains("row-layout")) {
    workspace.classList.remove("row-layout");
    workspace.classList.add("col-layout");
  } else {
    workspace.classList.remove("col-layout");
    workspace.classList.add("row-layout");
  }
}

// --- SQL Parser Utility ---
// Ekstrak baris data dalam kurung: VALUES (...), (...)
function extractRows(valString) {
  let rows = [];
  let inString = false;
  let current = "";
  let depth = 0;
  for (let i = 0; i < valString.length; i++) {
    let c = valString[i];
    if (c === "'" && (i === 0 || valString[i - 1] !== "\\"))
      inString = !inString;

    if (!inString) {
      if (c === "(") {
        if (depth === 0) {
          current = "";
          depth++;
          continue;
        }
        depth++;
      } else if (c === ")") {
        depth--;
        if (depth === 0) {
          rows.push(current);
          current = "";
          continue;
        }
      }
    }
    if (depth > 0) current += c;
  }
  return rows;
}

// Memecah kolom dipisahkan koma, melindungi koma dalam string/function
function splitSqlValues(rowString) {
  let cols = [];
  let inString = false;
  let current = "";
  for (let i = 0; i < rowString.length; i++) {
    let c = rowString[i];
    if (c === "'" && (i === 0 || rowString[i - 1] !== "\\"))
      inString = !inString;

    if (c === "," && !inString) {
      cols.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }
  cols.push(current.trim());
  return cols.map((col) => (col === "''" ? "NULL" : col));
}

// --- Conversion Logic ---
function processConversion() {
  const input = document.getElementById("inputSql").value;
  const type = document.getElementById("conversionType").value;
  let output = "";

  try {
    if (type === "MAPPING_COMBINE") {
      output = convertMappingCombine(input);
    } else if (type === "PARAM_MAP") {
      output = convertParamMap(input);
    } else {
      output =
        "-- Fitur konversi untuk " +
        type +
        " belum diimplementasikan sepenuhnya.\n-- Silakan tambahkan blok logika di javascript untuk tabel ini.";
    }
  } catch (error) {
    output =
      "-- Terjadi kesalahan saat parsing. Pastikan format INSERT INTO valid.\n" +
      error.message;
  }

  document.getElementById("outputSql").value = output;
}

function convertMappingCombine(sql) {
  let result = "";

  // 1. Parse MAPPING
  const mappingRegex =
    /INSERT INTO MWCONFIG\.MAPPING\s*\([^)]*\)\s*VALUES\s*\((.*?)\);/gs;
  let match;
  while ((match = mappingRegex.exec(sql)) !== null) {
    let cols = splitSqlValues(match[1]);
    if (cols.length >= 5) {
      let id = cols[0];
      let desc = cols[1];
      let module = cols[4];
      result += `CALL MWCONFIG.MERGE_MAPPING(${id}, ${desc}, ${module});\n`;
    }
  }

  result += "\n";

  // 2. Parse MAPPING_GROUP
  const groupRegex =
    /INSERT INTO MWCONFIG\.MAPPING_GROUP\s*\([^)]*\)\s*VALUES\s*([\s\S]*?);/gs;
  while ((match = groupRegex.exec(sql)) !== null) {
    let rows = extractRows(match[1]);
    rows.forEach((row) => {
      let cols = splitSqlValues(row);
      if (cols.length >= 6) {
        let mappingId = cols[0];
        let groupId = cols[1] !== "NULL" ? `'${cols[1]}'` : "NULL";
        let source = cols[2];
        let target = cols[3];
        let incMapping = cols[4];
        let incId = cols[5] !== "NULL" ? `'${cols[5]}'` : "NULL";
        result += `CALL MWCONFIG.MERGE_MAPPING_GROUP(${mappingId}, ${groupId}, ${source}, ${target}, ${incMapping}, ${incId});\n`;
      }
    });
  }

  result += "\n";

  // 3. Parse MAPPING_GROUP_LINE
  const lineRegex =
    /INSERT INTO MWCONFIG\.MAPPING_GROUP_LINE\s*\([^)]*\)\s*VALUES\s*([\s\S]*?);/gs;
  while ((match = lineRegex.exec(sql)) !== null) {
    let rows = extractRows(match[1]);
    rows.forEach((row) => {
      let cols = splitSqlValues(row);
      if (cols.length >= 5) {
        let mappingId = cols[0];
        let groupId = cols[1] !== "NULL" ? `'${cols[1]}'` : "NULL";
        let name = cols[2];
        let text = cols[3];
        let seq = cols[4] !== "NULL" ? `'${cols[4]}'` : "NULL";
        result += `CALL MWCONFIG.MERGE_MAPPING_GROUP_LINE(${mappingId}, ${groupId}, ${name}, ${text}, ${seq});\n`;
      }
    });
  }

  return result.trim();
}

function convertParamMap(sql) {
  let result = "";
  const paramRegex =
    /INSERT INTO MWCONFIG\.PARAM_MAP\s*\([^)]*\)\s*VALUES\s*([\s\S]*?);/gs;
  let match;

  while ((match = paramRegex.exec(sql)) !== null) {
    let rows = extractRows(match[1]);
    rows.forEach((row) => {
      let cols = splitSqlValues(row);
      if (cols.length >= 7) {
        let group = cols[0];
        let name = cols[1];
        let value = cols[2];
        let seq = cols[3];
        let desc = cols[6];

        result += `CALL MWCONFIG.MERGE_PARAM_MAP(${group}, ${name}, ${value}, ${seq}, ${desc});\n`;
      }
    });
  }
  return result.trim();
}
