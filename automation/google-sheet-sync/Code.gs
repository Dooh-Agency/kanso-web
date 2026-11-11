/**
 * Sincronización sin costo adicional entre la grilla de KANSO y el planificador
 * (Cloudflare Pages: base D1 e imágenes en R2).
 *
 * Instalación: ver SETUP.md en esta misma carpeta.
 * Las claves quedan sólo en Script Properties de Google Apps Script.
 */

// Versión actual: sincroniza con Cloudflare en lugar de Supabase.
const PLANNER_SYNC_VERSION = '2026.11.11.1';

const PLANNER_CONFIG = {
  sheetName: 'Grilla semanal',
  headerRow: 4,
  assetsHeader: 'Assets finales (Drive)',
  // Se usa sólo si no existe DRIVE_ASSETS_FOLDER_ID: se crea junto a la planilla.
  defaultAssetsFolderName: 'Assets finales',
  // Se usa sólo si no existe TANDAS_FOLDER_ID: se crea junto a la planilla.
  defaultBatchesFolderName: 'Tandas para importar',
  importedPrefix: '✓ Importada · ',
  timeZone: 'America/Argentina/Buenos_Aires',
};

// Acciones del planificador: valor que se escribe en “Estado” y etiqueta para “Observaciones”.
const REVIEW_ACTIONS = {
  approve: { status: 'Aprobado', label: 'Aprobado' },
  request_changes: { status: 'Cambios solicitados', label: 'Pedido de cambios' },
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Planificador KANSO')
    .addItem('Importar tanda nueva', 'importBatches')
    .addItem('Sincronizar con el planificador', 'syncPlanner')
    .addItem('Crear carpetas de assets', 'createAssetFolders')
    .addSeparator()
    .addItem('Activar sincronización cada hora', 'enableHourlySync')
    .addItem('Desactivar sincronización cada hora', 'disableHourlySync')
    .addToUi();
}

function syncPlanner() {
  const api = plannerApi_();
  const grid = readGrid_();
  if (!grid) {
    notify_('No hay piezas para sincronizar.');
    return;
  }
  const { spreadsheet, sheet, headerIndex, rawRows } = grid;
  const requiredHeaders = ['Pieza', 'Canal', 'Formato', 'Objetivo', 'Tema', 'Copy ES', 'Dirección visual', 'Estado'];
  requiredHeaders.forEach((header) => {
    if (headerIndex[header] === undefined) {
      throw new Error(`Falta el encabezado obligatorio “${header}” en la fila ${PLANNER_CONFIG.headerRow}.`);
    }
  });

  const folders = ensureAssetFolders_(sheet, headerIndex, rawRows);
  const report = { createdOrUpdated: 0, assets: 0, uploads: 0, skipped: 0, removed: 0, links: 0, errors: folders.errors.slice() };
  const sourceKeys = [];

  rawRows.forEach((row, offset) => {
    const rowNumber = PLANNER_CONFIG.headerRow + 1 + offset;
    if (!value_(row, headerIndex, 'Pieza') || !value_(row, headerIndex, 'Tema')) {
      report.skipped += 1;
      return;
    }
    const sourceKey = `${spreadsheet.getId()}:${sheet.getSheetId()}:${rowNumber}`;
    sourceKeys.push(sourceKey);
    try {
      const result = syncRow_(api, sourceKey, row, headerIndex, rowNumber);
      report.createdOrUpdated += 1;
      report.assets += result.assets;
      report.uploads += result.uploads;
    } catch (error) {
      report.errors.push(`Fila ${rowNumber}: ${error.message}`);
    }
  });

  // Carga en “URL publicada” el link de los posts que ya salieron en Instagram.
  try {
    report.links = writePublishedLinks_(api, spreadsheet, sheet, headerIndex);
  } catch (error) {
    report.errors.push(`Links de Instagram: ${error.message}`);
  }

  // Quita del planificador las filas que ya no existen en la grilla.
  if (sourceKeys.length) {
    try {
      report.removed = apiRequest_(api, { op: 'prune', source_keys: sourceKeys }).removed;
    } catch (error) {
      report.errors.push(`Limpieza: ${error.message}`);
    }
  }

  const message = [
    `Piezas sincronizadas: ${report.createdOrUpdated}`,
    `Carpetas nuevas: ${folders.created}`,
    `Assets encontrados: ${report.assets} (subidos ahora: ${report.uploads})`,
    `Links de Instagram cargados: ${report.links}`,
    `Piezas quitadas del planificador: ${report.removed}`,
    `Filas sin pieza o tema: ${report.skipped}`,
  ];
  if (report.errors.length) {
    message.push('', `Errores (${report.errors.length}):`, report.errors.slice(0, 8).join('\n'));
  }
  notify_(message.join('\n'));
}

/**
 * Pide al planificador los posts de Instagram ya publicados que coinciden con
 * piezas sin link (por el copy o por el día de salida) y escribe el link en
 * “URL publicada” y “Publicado” en “Estado publicación”. Nunca pisa un link
 * que ya esté cargado.
 */
function writePublishedLinks_(api, spreadsheet, sheet, headerIndex) {
  const urlColumn = headerIndex['URL publicada'];
  if (urlColumn === undefined) return 0;
  const result = apiRequest_(api, { op: 'instagram_links' });
  const prefix = `${spreadsheet.getId()}:${sheet.getSheetId()}:`;
  let written = 0;
  (result.links || []).forEach((link) => {
    if (link.source_key.indexOf(prefix) !== 0) return;
    const rowNumber = Number(link.source_key.slice(prefix.length));
    if (!rowNumber) return;
    const urlCell = sheet.getRange(rowNumber, urlColumn + 1);
    if (String(urlCell.getValue()).trim()) return;
    urlCell.setValue(link.permalink);
    const statusColumn = headerIndex['Estado publicación'];
    if (statusColumn !== undefined) sheet.getRange(rowNumber, statusColumn + 1).setValue('Publicado');
    written += 1;
  });
  return written;
}

// Envía una fila al planificador y sube solo los archivos de Drive nuevos o modificados.
function syncRow_(api, sourceKey, row, headerIndex, rowNumber) {
  const item = apiRequest_(api, { op: 'upsert_item', item: itemPayload_(sourceKey, row, headerIndex, rowNumber) });
  const stored = item.keys || [];
  let uploads = 0;

  const toKey = (file, prefix) => `items/${item.id}/${prefix}${file.getId()}-${file.getLastUpdated().getTime()}-${safeFileName_(file.getName())}`;
  const upload = (file, key) => {
    if (stored.indexOf(key) !== -1) return;
    uploadAsset_(api, key, file);
    uploads += 1;
  };

  const assets = listDriveFiles_(value_(row, headerIndex, 'Assets finales (Drive)')).map((file) => {
    const key = toKey(file, '');
    upload(file, key);
    return { r2_key: key, asset_type: assetType_(file), drive_file_id: file.getId(), alt_text: file.getName() };
  });
  const cover = listDriveFiles_(value_(row, headerIndex, 'Preview / cover'))[0];
  const previewKey = cover ? toKey(cover, 'preview-') : null;
  if (cover) upload(cover, previewKey);

  apiRequest_(api, { op: 'set_assets', item_id: item.id, assets: assets, preview_key: previewKey });
  return { assets: assets.length, uploads: uploads };
}

/**
 * Endpoint de la aplicación web: el planificador (Pages Function, ya validada
 * por Cloudflare Access) envía aprobaciones, pedidos de cambio y el orden de
 * publicación armado con drag & drop. Se publica
 * como “Ejecutar como: yo” y “Acceso: cualquier usuario”; solo acepta pedidos
 * con la clave PLANNER_SYNC_SECRET (ver SETUP.md).
 */
function doPost(e) {
  let result;
  try {
    const request = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    result = { ok: true, item: request.action === 'reorder' ? reorderAction_(request) : reviewAction_(request) };
  } catch (error) {
    result = { ok: false, error: error.message };
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

// Escribe la decisión en la grilla (fuente de verdad) y vuelve a sincronizar esa fila.
function reviewAction_(request) {
  const api = plannerApi_();
  if (!sameSecret_(String(request.secret || ''), api.secret)) throw new Error('Clave inválida.');
  const action = REVIEW_ACTIONS[request.action];
  if (!action) throw new Error('Acción desconocida.');
  const comment = String(request.comment || '').trim();
  if (request.action === 'request_changes' && !comment) throw new Error('Escribí qué hay que cambiar.');
  const email = String(request.email || '').trim();
  if (!email) throw new Error('Falta el email de quien revisa.');
  const sourceKey = String(request.source_key || '');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const grid = readGrid_();
    const { row, rowNumber } = gridRow_(grid, sourceKey, request.title);

    const statusColumn = grid.headerIndex['Estado'];
    const notesColumn = grid.headerIndex['Observaciones'];
    if (statusColumn === undefined || notesColumn === undefined) {
      throw new Error('Faltan los encabezados “Estado” u “Observaciones” en la grilla.');
    }
    const stamp = Utilities.formatDate(new Date(), PLANNER_CONFIG.timeZone, 'yyyy-MM-dd HH:mm');
    const entry = `${stamp} · ${email} · ${action.label}${comment ? `: ${comment}` : ''}`;
    const previous = value_(row, grid.headerIndex, 'Observaciones');
    const notes = previous ? `${entry}\n${previous}` : entry;

    grid.sheet.getRange(rowNumber, statusColumn + 1).setValue(action.status);
    grid.sheet.getRange(rowNumber, notesColumn + 1).setValue(notes);
    SpreadsheetApp.flush();
    row[statusColumn] = action.status;
    row[notesColumn] = notes;

    syncRow_(api, sourceKey, row, grid.headerIndex, rowNumber);
    return { status: action.status };
  } finally {
    lock.releaseLock();
  }
}

// Fila de la grilla que corresponde a una pieza del planificador.
function gridRow_(grid, sourceKey, title) {
  const [spreadsheetId, sheetId, rowText] = String(sourceKey || '').split(':');
  const rowNumber = Number(rowText);
  if (!grid || spreadsheetId !== grid.spreadsheet.getId() || Number(sheetId) !== grid.sheet.getSheetId() || !rowNumber) {
    throw new Error('La pieza no pertenece a esta grilla.');
  }
  const row = grid.rawRows[rowNumber - PLANNER_CONFIG.headerRow - 1];
  // La referencia es la fila: si alguien insertó o movió filas, no se escribe sobre otra pieza.
  if (!row || value_(row, grid.headerIndex, 'Tema') !== String(title || '')) {
    throw new Error('La grilla cambió desde la última sincronización. Sincronizá y volvé a intentar.');
  }
  return { row: row, rowNumber: rowNumber };
}

/**
 * Orden de publicación armado en el planificador. Cada pieza movida toma `Día` y
 * `Fecha/hora salida` de la fila indicada (las fechas se intercambian, no se
 * inventan). Las filas cuya `Pieza relacionada` es una pieza movida (su story y
 * su adaptación para LinkedIn) se corren los mismos días y conservan su horario. Las piezas
 * programadas, publicadas o descartadas no se tocan. Cada cambio queda en
 * `Observaciones` y las filas modificadas se vuelven a sincronizar.
 */
function reorderAction_(request) {
  const api = plannerApi_();
  if (!sameSecret_(String(request.secret || ''), api.secret)) throw new Error('Clave inválida.');
  const email = String(request.email || '').trim();
  if (!email) throw new Error('Falta el email de quien ordena.');
  const moves = Array.isArray(request.moves) ? request.moves : [];
  if (!moves.length) throw new Error('No hay cambios de orden para guardar.');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const grid = readGrid_();
    const headerIndex = grid ? grid.headerIndex : {};
    const dateColumn = headerIndex['Fecha/hora salida'];
    const dayColumn = headerIndex['Día'];
    const notesColumn = headerIndex['Observaciones'];
    if (dateColumn === undefined || notesColumn === undefined) {
      throw new Error('Faltan los encabezados “Fecha/hora salida” u “Observaciones” en la grilla.');
    }
    const timeZone = grid.spreadsheet.getSpreadsheetTimeZone();
    const locked = (row) => ['scheduled', 'published', 'rejected'].indexOf(normalizeStatus_(value_(row, headerIndex, 'Estado'))) !== -1;

    // Se leen todas las fechas antes de escribir, porque las piezas intercambian lugares.
    const changes = new Map();
    const movedPieces = [];
    moves.forEach((move) => {
      const target = gridRow_(grid, move.source_key, move.title);
      const source = gridRow_(grid, move.from_source_key, move.from_title);
      if (locked(target.row)) {
        throw new Error(`“${move.title}” está programada, publicada o descartada: no se puede mover.`);
      }
      if (!source.row[dateColumn]) throw new Error(`“${move.from_title}” no tiene fecha en la grilla.`);
      if (changes.has(target.rowNumber)) throw new Error('Una pieza aparece dos veces en el pedido.');
      changes.set(target.rowNumber, {
        row: target.row,
        previous: target.row[dateColumn],
        date: source.row[dateColumn],
        day: dayColumn === undefined ? undefined : source.row[dayColumn],
      });
      movedPieces.push(target.rowNumber);
    });

    // La story y la adaptación de cada pieza se corren con ella.
    let followed = 0;
    if (headerIndex['Pieza relacionada'] !== undefined) {
      movedPieces.forEach((rowNumber) => {
        const change = changes.get(rowNumber);
        const piece = value_(change.row, headerIndex, 'Pieza').toLowerCase();
        const before = naiveTime_(change.previous, timeZone);
        const after = naiveTime_(change.date, timeZone);
        // Se corren días enteros: cada pieza asociada conserva su propio horario.
        const day = 24 * 60 * 60 * 1000;
        const delta = before === null || after === null ? 0 : Math.round((after - after % day - (before - before % day)) / day) * day;
        if (!piece || !delta) return;
        grid.rawRows.forEach((row, offset) => {
          const relatedRow = PLANNER_CONFIG.headerRow + 1 + offset;
          if (changes.has(relatedRow) || locked(row)) return;
          if (value_(row, headerIndex, 'Pieza relacionada').toLowerCase() !== piece) return;
          const current = naiveTime_(row[dateColumn], timeZone);
          if (current === null) return;
          const shifted = current + delta;
          changes.set(relatedRow, {
            row: row,
            previous: row[dateColumn],
            date: shiftedDate_(row[dateColumn], delta),
            day: dayColumn === undefined || !value_(row, headerIndex, 'Día') ? undefined : dayLabel_(shifted),
          });
          followed += 1;
        });
      });
    }

    const stamp = Utilities.formatDate(new Date(), PLANNER_CONFIG.timeZone, 'yyyy-MM-dd HH:mm');
    changes.forEach((change, rowNumber) => {
      const entry = `${stamp} · ${email} · Reordenado: ${dateText_(change.previous, timeZone)} → ${dateText_(change.date, timeZone)}`;
      const previousNotes = value_(change.row, headerIndex, 'Observaciones');
      const notes = previousNotes ? `${entry}\n${previousNotes}` : entry;
      grid.sheet.getRange(rowNumber, dateColumn + 1).setValue(change.date);
      if (change.day !== undefined) grid.sheet.getRange(rowNumber, dayColumn + 1).setValue(change.day);
      grid.sheet.getRange(rowNumber, notesColumn + 1).setValue(notes);
      change.row[notesColumn] = notes;
    });
    SpreadsheetApp.flush();

    // Se releen las filas para sincronizar lo que quedó escrito (Sheets puede convertir textos en fechas).
    const updated = readGrid_();
    changes.forEach((change, rowNumber) => {
      const row = updated.rawRows[rowNumber - PLANNER_CONFIG.headerRow - 1];
      syncRow_(api, `${updated.spreadsheet.getId()}:${updated.sheet.getSheetId()}:${rowNumber}`, row, updated.headerIndex, rowNumber);
    });
    return { moved: movedPieces.length, followed: followed };
  } finally {
    lock.releaseLock();
  }
}

// Fecha y hora “de reloj” en milisegundos, sin zona horaria, para calcular desplazamientos.
function naiveTime_(value, timeZone) {
  if (!value) return null;
  const text = value instanceof Date ? Utilities.formatDate(value, timeZone, 'yyyy-MM-dd HH:mm') : String(value).trim();
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0), Number(match[5] || 0));
}

// Corre una fecha de la grilla conservando su tipo: fecha de Sheets o texto `AAAA-MM-DD HH:MM`.
function shiftedDate_(value, delta) {
  if (value instanceof Date) return new Date(value.getTime() + delta);
  const text = String(value).trim();
  const shifted = new Date(naiveTime_(text, PLANNER_CONFIG.timeZone) + delta);
  const pad = (number) => String(number).padStart(2, '0');
  const date = `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
  return /\d{1,2}:\d{2}/.test(text) ? `${date} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}` : date;
}

// “Lunes 09/11”, el formato de la columna `Día`.
function dayLabel_(time) {
  const names = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const date = new Date(time);
  const pad = (number) => String(number).padStart(2, '0');
  return `${names[date.getUTCDay()]} ${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}`;
}

function dateText_(value, timeZone) {
  if (!value) return 'sin fecha';
  return value instanceof Date ? Utilities.formatDate(value, timeZone, 'yyyy-MM-dd HH:mm') : String(value).trim();
}

function plannerApi_() {
  const properties = PropertiesService.getScriptProperties().getProperties();
  const url = removeTrailingSlash_(properties.PLANNER_API_URL);
  const secret = properties.PLANNER_SYNC_SECRET;
  if (!url || !secret) {
    throw new Error('Faltan PLANNER_API_URL o PLANNER_SYNC_SECRET en Script Properties. Ver SETUP.md.');
  }
  return { url: url, secret: secret };
}

function sameSecret_(received, expected) {
  if (!received || !expected || received.length !== expected.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) diff |= received.charCodeAt(index) ^ expected.charCodeAt(index);
  return diff === 0;
}

function createAssetFolders() {
  const grid = readGrid_();
  if (!grid) {
    notify_('No hay piezas en la grilla.');
    return;
  }
  const result = ensureAssetFolders_(grid.sheet, grid.headerIndex, grid.rawRows);
  const message = [`Carpetas nuevas: ${result.created}`];
  if (result.errors.length) {
    message.push('', `Errores (${result.errors.length}):`, result.errors.slice(0, 8).join('\n'));
  }
  notify_(message.join('\n'));
}

/**
 * Agrega a la grilla las tandas preparadas como CSV (UTF-8) en “Tandas para importar”.
 * Se leen como texto sin convertir, para que Drive no transforme valores como
 * “Lunes 09/11” en fechas. Las columnas se emparejan por nombre de encabezado
 * (fila 1 de la tanda); las que no existen en la grilla se ignoran. Cada tanda
 * importada se renombra con “✓ Importada · ” para no volver a cargarla.
 */
function importBatches() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(PLANNER_CONFIG.sheetName);
  if (!sheet) {
    throw new Error(`No se encontró la hoja “${PLANNER_CONFIG.sheetName}”.`);
  }
  const lastColumn = sheet.getLastColumn();
  const headerIndex = indexHeaders_(sheet.getRange(PLANNER_CONFIG.headerRow, 1, 1, lastColumn).getDisplayValues()[0]);

  const folder = namedFolder_(spreadsheet, 'TANDAS_FOLDER_ID', PLANNER_CONFIG.defaultBatchesFolderName);
  const files = folder.getFilesByType(MimeType.CSV);
  const report = { batches: [], rows: 0, errors: [] };

  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName();
    if (name.indexOf(PLANNER_CONFIG.importedPrefix) === 0) continue;

    let destination = null;
    try {
      const values = Utilities.parseCsv(file.getBlob().getDataAsString('UTF-8'));
      const sourceHeaders = values[0].map((header) => String(header).trim());
      const rows = values.slice(1)
        .filter((row) => row.some((cell) => String(cell).trim() !== ''))
        .map((row) => {
          const target = new Array(lastColumn).fill('');
          sourceHeaders.forEach((header, index) => {
            if (headerIndex[header] !== undefined) target[headerIndex[header]] = row[index];
          });
          return target;
        });
      if (!rows.length) throw new Error('no tiene filas con datos');

      const firstRow = sheet.getLastRow() + 1;
      destination = sheet.getRange(firstRow, 1, rows.length, lastColumn);
      const model = sheet.getRange(PLANNER_CONFIG.headerRow + 1, 1, 1, lastColumn);
      model.copyTo(destination, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      // Texto plano para que Sheets no convierta “Lunes 09/11” en fecha; sólo
      // “Fecha/hora salida” conserva el formato de fecha de la grilla.
      destination.setNumberFormat('@');
      const dateColumn = headerIndex['Fecha/hora salida'];
      if (dateColumn !== undefined) {
        sheet.getRange(firstRow, dateColumn + 1, rows.length, 1)
          .setNumberFormat(model.getCell(1, dateColumn + 1).getNumberFormat());
      }
      // Valores antes que validaciones: así un valor fuera de la lista queda
      // marcado en la celda en lugar de cortar la importación.
      destination.setValues(rows);
      model.copyTo(destination, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
      // Confirma la escritura antes de marcar la tanda como importada.
      SpreadsheetApp.flush();

      file.setName(`${PLANNER_CONFIG.importedPrefix}${name}`);
      report.batches.push(`${name} (${rows.length} filas)`);
      report.rows += rows.length;
    } catch (error) {
      if (destination) destination.clear();
      report.errors.push(`${name}: ${error.message}`);
    }
  }

  const folders = report.rows ? ensureAssetFolders_(sheet, headerIndex, readGrid_().rawRows) : { created: 0, errors: [] };
  const message = report.batches.length
    ? [`Tandas importadas: ${report.batches.length}`, report.batches.join('\n'), '', `Carpetas nuevas: ${folders.created}`]
    : ['No hay tandas nuevas en “Tandas para importar”.'];
  const errors = report.errors.concat(folders.errors);
  if (errors.length) {
    message.push('', `Errores (${errors.length}):`, errors.slice(0, 8).join('\n'));
  }
  notify_(message.join('\n'));
}

function enableHourlySync() {
  removeSyncTriggers_();
  ScriptApp.newTrigger('syncPlanner').timeBased().everyHours(1).create();
  notify_('Sincronización cada hora activada. Para pausarla, usá “Desactivar sincronización cada hora”.');
}

function disableHourlySync() {
  const removed = removeSyncTriggers_();
  notify_(removed ? 'Sincronización cada hora desactivada.' : 'No había una sincronización horaria activa.');
}

function removeSyncTriggers_() {
  const triggers = ScriptApp.getProjectTriggers().filter((trigger) => trigger.getHandlerFunction() === 'syncPlanner');
  triggers.forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  return triggers.length;
}

function readGrid_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(PLANNER_CONFIG.sheetName);
  if (!sheet) {
    throw new Error(`No se encontró la hoja “${PLANNER_CONFIG.sheetName}”.`);
  }

  const lastColumn = sheet.getLastColumn();
  const headers = sheet.getRange(PLANNER_CONFIG.headerRow, 1, 1, lastColumn).getDisplayValues()[0];
  const headerIndex = indexHeaders_(headers);

  const lastRow = sheet.getLastRow();
  if (lastRow <= PLANNER_CONFIG.headerRow) return null;

  const rawRows = sheet
    .getRange(PLANNER_CONFIG.headerRow + 1, 1, lastRow - PLANNER_CONFIG.headerRow, lastColumn)
    .getValues();
  return { spreadsheet, sheet, headerIndex, rawRows };
}

/**
 * Crea una carpeta de Drive por pieza (“01-IG · Tema”) y escribe su link en
 * “Assets finales (Drive)”. Nunca reemplaza un link existente; si la carpeta ya
 * existe con ese nombre, la reutiliza para no duplicarla.
 */
function ensureAssetFolders_(sheet, headerIndex, rawRows) {
  const result = { created: 0, errors: [] };
  const column = headerIndex[PLANNER_CONFIG.assetsHeader];
  if (column === undefined) {
    result.errors.push(`Falta el encabezado “${PLANNER_CONFIG.assetsHeader}”: no se crearon carpetas.`);
    return result;
  }

  let root = null;
  rawRows.forEach((row, offset) => {
    const piece = value_(row, headerIndex, 'Pieza');
    const title = value_(row, headerIndex, 'Tema');
    if (!piece || !title || value_(row, headerIndex, PLANNER_CONFIG.assetsHeader)) return;

    const rowNumber = PLANNER_CONFIG.headerRow + 1 + offset;
    try {
      root = root || namedFolder_(sheet.getParent(), 'DRIVE_ASSETS_FOLDER_ID', PLANNER_CONFIG.defaultAssetsFolderName);
      const name = `${piece} · ${title}`;
      const existing = root.getFoldersByName(name);
      const reused = existing.hasNext();
      const folder = reused ? existing.next() : root.createFolder(name);
      if (!reused) result.created += 1;

      const url = folder.getUrl();
      sheet.getRange(rowNumber, column + 1).setValue(url);
      row[column] = url;
    } catch (error) {
      result.errors.push(`Fila ${rowNumber}: no se pudo crear la carpeta (${error.message})`);
    }
  });
  return result;
}

// Devuelve la carpeta configurada en `propertyName` o crea (o reutiliza) `defaultName`
// junto a la planilla y guarda su ID para las próximas ejecuciones.
function namedFolder_(spreadsheet, propertyName, defaultName) {
  const properties = PropertiesService.getScriptProperties();
  const configuredId = properties.getProperty(propertyName);
  if (configuredId) return DriveApp.getFolderById(configuredId);

  const parents = DriveApp.getFileById(spreadsheet.getId()).getParents();
  const parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const existing = parent.getFoldersByName(defaultName);
  const folder = existing.hasNext() ? existing.next() : parent.createFolder(defaultName);
  properties.setProperty(propertyName, folder.getId());
  return folder;
}

// En una ejecución programada no hay interfaz: el resumen queda en el registro de ejecuciones.
function notify_(message) {
  try {
    const ui = SpreadsheetApp.getUi();
    ui.alert('Planificador KANSO', message, ui.ButtonSet.OK);
  } catch (error) {
    console.log(message);
  }
}

function itemPayload_(sourceKey, row, headerIndex, rowNumber) {
  const title = value_(row, headerIndex, 'Tema');
  return {
    source_key: sourceKey,
    piece: value_(row, headerIndex, 'Pieza'),
    project: projectFromTitle_(title),
    title: title,
    channel: normalizeChannel_(value_(row, headerIndex, 'Canal')),
    format: value_(row, headerIndex, 'Formato'),
    objective: value_(row, headerIndex, 'Objetivo'),
    caption_es: value_(row, headerIndex, 'Copy ES'),
    caption_en: value_(row, headerIndex, 'Copy EN'),
    creative_direction: value_(row, headerIndex, 'Dirección visual'),
    canva_url: canvaUrl_(value_(row, headerIndex, 'Dirección visual')),
    asset_url: value_(row, headerIndex, 'Assets finales (Drive)') || null,
    scheduled_at: dateValue_(row, headerIndex, 'Fecha/hora salida'),
    status: normalizeStatus_(value_(row, headerIndex, 'Estado')),
    publish_requested: yes_(value_(row, headerIndex, 'Programar publicación')),
    // “Publicado” en esta columna: la pieza ya está cargada en la red. El
    // planificador la muestra como programada hasta su fecha y publicada después.
    publication_state: String(value_(row, headerIndex, 'Estado publicación')),
    published_url: value_(row, headerIndex, 'URL publicada') || null,
    review_notes: value_(row, headerIndex, 'Observaciones'),
    sort_order: 100000 - rowNumber,
  };
}

function apiRequest_(api, payload) {
  const response = UrlFetchApp.fetch(`${api.url}/api/sync/planner`, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    headers: { 'X-Planner-Secret': api.secret },
    muteHttpExceptions: true,
  });
  return parseApiResponse_(response, payload.op);
}

function uploadAsset_(api, key, file) {
  const response = UrlFetchApp.fetch(`${api.url}/api/sync/planner-asset?key=${encodeURIComponent(key)}`, {
    method: 'put',
    contentType: file.getMimeType(),
    payload: file.getBlob().getBytes(),
    headers: { 'X-Planner-Secret': api.secret },
    muteHttpExceptions: true,
  });
  parseApiResponse_(response, `subir ${file.getName()}`);
}

function parseApiResponse_(response, label) {
  const status = response.getResponseCode();
  const body = response.getContentText();
  let result = null;
  try {
    result = JSON.parse(body);
  } catch (error) {
    result = null;
  }
  if (status < 200 || status >= 300 || !result || !result.ok) {
    throw new Error(`El planificador respondió ${status} (${label}): ${(result && result.error) || body.slice(0, 200)}`);
  }
  return result;
}

// Archivos de imagen o video de una carpeta (en orden natural) o de un enlace a un archivo.
function listDriveFiles_(source) {
  const id = driveIdFromUrl_(source);
  if (!id) return [];

  // Los assets finales pueden ser carpetas; Preview / cover siempre es un archivo.
  // No se intenta abrir un JPG como carpeta: DriveApp puede devolver resultados
  // inconsistentes para ese caso y dejar el cover fuera de la sincronización.
  if (String(source).indexOf('/folders/') !== -1) {
    const iterator = DriveApp.getFolderById(id).getFiles();
    const files = [];
    while (iterator.hasNext()) {
      const file = iterator.next();
      if (isMedia_(file)) files.push(file);
    }
    return files.sort((a, b) => a.getName().localeCompare(b.getName(), undefined, { numeric: true, sensitivity: 'base' }));
  }

  const file = DriveApp.getFileById(id);
  return isMedia_(file) ? [file] : [];
}

function isMedia_(file) {
  const mimeType = file.getMimeType();
  return mimeType.indexOf('image/') === 0 || mimeType.indexOf('video/') === 0;
}

function assetType_(file) {
  return file.getMimeType().indexOf('video/') === 0 ? 'video' : 'image';
}

function indexHeaders_(headers) {
  return headers.reduce((result, header, index) => {
    const clean = String(header).trim();
    if (clean) result[clean] = index;
    return result;
  }, {});
}

function value_(row, headerIndex, name) {
  const index = headerIndex[name];
  if (index === undefined || row[index] === null || row[index] === undefined) return '';
  if (row[index] instanceof Date) return row[index];
  return String(row[index]).trim();
}

function dateValue_(row, headerIndex, name) {
  const value = value_(row, headerIndex, name);
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString();
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function projectFromTitle_(title) {
  return title.split('—')[0].trim() || 'KANSO';
}

function normalizeChannel_(channel) {
  const normalized = String(channel).toLowerCase();
  if (normalized.indexOf('ambos') !== -1 || (normalized.indexOf('instagram') !== -1 && normalized.indexOf('linkedin') !== -1)) return 'both';
  if (normalized.indexOf('linkedin') !== -1 || normalized === 'li') return 'linkedin';
  return 'instagram';
}

function normalizeStatus_(status) {
  const normalized = String(status).toLowerCase().trim();
  if (normalized === 'aprobado' || normalized === 'approved') return 'approved';
  if (normalized === 'en revisión' || normalized === 'en revision' || normalized === 'review') return 'review';
  if (normalized === 'cambios solicitados' || normalized === 'revisar' || normalized === 'changes_requested') return 'changes_requested';
  if (normalized === 'descartado' || normalized === 'rechazado' || normalized === 'rejected') return 'rejected';
  if (normalized === 'programado' || normalized === 'scheduled') return 'scheduled';
  if (normalized === 'publicado' || normalized === 'published') return 'published';
  return 'draft';
}

function yes_(value) {
  return ['si', 'sí', 'yes', 'true', '1'].indexOf(String(value).toLowerCase().trim()) !== -1;
}

// Primer enlace de Canva escrito en “Dirección visual”, para abrir el diseño desde el planificador.
function canvaUrl_(text) {
  const match = String(text || '').match(/https:\/\/(?:www\.)?canva\.com\/[^\s)\]]+/);
  return match ? match[0] : null;
}

function driveIdFromUrl_(value) {
  if (!value) return null;
  const stringValue = String(value);
  const folderMatch = stringValue.match(/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) return folderMatch[1];
  const fileMatch = stringValue.match(/(?:\/d\/|id=)([a-zA-Z0-9_-]+)/);
  return fileMatch ? fileMatch[1] : null;
}

function removeTrailingSlash_(value) {
  return String(value || '').replace(/\/$/, '');
}

function safeFileName_(value) {
  return String(value || 'asset').replace(/[^a-zA-Z0-9._-]/g, '-');
}
