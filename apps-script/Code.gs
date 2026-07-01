/**
 * Snap&Collect data sync — Google Sheet -> GitHub -> Vercel.
 * Replaces the local Python watcher (snap_watcher.py) once cut over.
 * Bound to the Google Sheet (Extensions > Apps Script).
 *
 * One-time setup:
 *   1. Paste this file's contents as Code.gs in the Sheet's Apps Script project.
 *   2. Project Settings > Script Properties, add:
 *        GITHUB_TOKEN     - fine-grained PAT, "Contents: Read and write" only,
 *                           scoped to just this repo
 *        GITHUB_OWNER     - singpringachiraya-gif
 *        GITHUB_REPO      - snap-collect-kb
 *        GITHUB_BRANCH    - data-apps-script-test  (change to "main" only after testing)
 *        GITHUB_FILE_PATH - snap-collect-data.json
 *   3. Run setup() once from the editor (authorize when prompted).
 *   4. Reload the Sheet — a "Snap&Collect Data" menu appears with "Push data now".
 */

var SHEET_KEYWORDS = {
  stores: 'Y2026',
  rejects: 'Reject',
  nameMap: 'nam',
};

var DEBOUNCE_MS = 2 * 60 * 1000; // 2 minutes — matches the spirit of the legacy 60s+30s wait

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Snap&Collect Data')
    .addItem('Push data now', 'manualRunAndPush')
    .addToUi();
}

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onSheetEdit') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onSheetEdit')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onEdit()
    .create();
  SpreadsheetApp.getUi().alert('Setup complete. Editing the sheet will now sync automatically.');
}

function findSheetByKeyword_(ss, keyword) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().toLowerCase().indexOf(keyword.toLowerCase()) !== -1) {
      return sheets[i];
    }
  }
  return null;
}

function strip_(v) {
  return v ? String(v).trim() : '';
}

function extractStores_(ss) {
  var sheet = findSheetByKeyword_(ss, SHEET_KEYWORDS.stores);
  if (!sheet) return [];
  var rows = sheet.getDataRange().getValues().slice(1); // skip header row
  var out = [];
  rows.forEach(function (row) {
    var no = row[0], name = row[1], receipt_format = row[2], notes = row[3], category = row[4], extra = row[5];
    if (!name) return;
    out.push({
      no: no === '' ? null : no,
      name: strip_(name),
      receipt_format: strip_(receipt_format),
      notes: strip_(notes),
      category: strip_(category),
      extra: strip_(extra),
    });
  });
  return out;
}

function extractRejects_(ss) {
  var sheet = findSheetByKeyword_(ss, SHEET_KEYWORDS.rejects);
  if (!sheet) return [];
  var rows = sheet.getDataRange().getValues().slice(1);
  var out = [];
  rows.forEach(function (row) {
    var case_ = row[0], reason = row[1], message = row[2], store_note = row[3];
    if (!case_ && !message) return;
    out.push({
      case: strip_(case_),
      reason: strip_(reason),
      message: strip_(message),
      store_note: strip_(store_note),
    });
  });
  return out;
}

function extractNameMap_(ss) {
  var sheet = findSheetByKeyword_(ss, SHEET_KEYWORDS.nameMap);
  if (!sheet) return []; // no matching tab in the new Sheet — expected, stay empty
  var rows = sheet.getDataRange().getValues().slice(1);
  var out = [];
  rows.forEach(function (row) {
    var header_name = row[0], portal_name = row[1], note = row[2];
    if (!header_name && !portal_name) return;
    out.push({
      header_name: strip_(header_name),
      portal_name: strip_(portal_name),
      note: strip_(note),
    });
  });
  return out;
}

function computeCategories_(stores) {
  var set = {};
  stores.forEach(function (s) { if (s.category) set[s.category] = true; });
  return Object.keys(set).sort();
}

/** Data only — deliberately excludes generated_at, so it can be compared against the
 *  previous push without a fresh timestamp always making it look "changed". */
function buildData_() {
  var ss = SpreadsheetApp.getActive();
  var stores = extractStores_(ss);
  var name_map = extractNameMap_(ss);
  var rejects = extractRejects_(ss);
  var categories = computeCategories_(stores);
  return { stores: stores, name_map: name_map, rejects: rejects, categories: categories };
}

function stringifyWithTimestamp_(data, generatedAt) {
  return JSON.stringify(
    { stores: data.stores, name_map: data.name_map, rejects: data.rejects, categories: data.categories, generated_at: generatedAt },
    null,
    1
  );
}

function ghHeaders_() {
  var token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  return {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function ghContentsUrl_() {
  var p = PropertiesService.getScriptProperties();
  return 'https://api.github.com/repos/' + p.getProperty('GITHUB_OWNER') + '/' + p.getProperty('GITHUB_REPO') +
    '/contents/' + p.getProperty('GITHUB_FILE_PATH');
}

/** Fetch current file (sha + content) so updates can be compared/applied; pushes only if the
 *  actual data (not the timestamp) changed. */
function pushToGitHub_(data) {
  var branch = PropertiesService.getScriptProperties().getProperty('GITHUB_BRANCH');
  var getUrl = ghContentsUrl_() + '?ref=' + encodeURIComponent(branch);

  var getResp = UrlFetchApp.fetch(getUrl, { method: 'get', headers: ghHeaders_(), muteHttpExceptions: true });
  var sha = null;
  if (getResp.getResponseCode() === 200) {
    var current = JSON.parse(getResp.getContentText());
    sha = current.sha;
    var decodedBytes = Utilities.base64Decode(current.content.replace(/\n/g, ''));
    var decoded = Utilities.newBlob(decodedBytes).getDataAsString('UTF-8');
    var oldFull = JSON.parse(decoded);
    var oldData = { stores: oldFull.stores, name_map: oldFull.name_map, rejects: oldFull.rejects, categories: oldFull.categories };
    if (JSON.stringify(oldData) === JSON.stringify(data)) {
      Logger.log('No change detected — skipping push.');
      return { pushed: false, reason: 'unchanged' };
    }
  } else if (getResp.getResponseCode() !== 404) {
    Logger.log('Unexpected GET response: ' + getResp.getResponseCode() + ' ' + getResp.getContentText());
    throw new Error('GitHub GET failed: ' + getResp.getResponseCode());
  }

  var generatedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  var jsonString = stringifyWithTimestamp_(data, generatedAt);

  // Two-argument form is required: converts the JS string to UTF-8 bytes before encoding,
  // otherwise Thai characters get mangled.
  var encodedContent = Utilities.base64Encode(jsonString, Utilities.Charset.UTF_8);
  var body = {
    message: 'data: auto-refresh from Google Sheet [' + generatedAt + ']',
    content: encodedContent,
    branch: branch,
  };
  if (sha) body.sha = sha;

  var putResp = UrlFetchApp.fetch(ghContentsUrl_(), {
    method: 'put',
    contentType: 'application/json',
    headers: ghHeaders_(),
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });

  var code = putResp.getResponseCode();
  if (code !== 200 && code !== 201) {
    Logger.log('GitHub PUT failed: ' + code + ' ' + putResp.getContentText());
    throw new Error('GitHub push failed: ' + code);
  }
  Logger.log('Pushed successfully to ' + branch);
  return { pushed: true };
}

/** Called by the debounce trigger. */
function runExtractAndPush() {
  try {
    pushToGitHub_(buildData_());
  } catch (err) {
    Logger.log('runExtractAndPush error: ' + err);
  }
}

/** Menu item — lets the admin force an immediate push and see a plain-language result. */
function manualRunAndPush() {
  try {
    var result = pushToGitHub_(buildData_());
    SpreadsheetApp.getUi().alert(result.pushed ? 'Pushed successfully!' : 'No changes to push — data is already up to date.');
  } catch (err) {
    SpreadsheetApp.getUi().alert('Push failed: ' + err.message + '\n\nCheck Extensions > Apps Script > Executions for details.');
  }
}

/** Installable onEdit trigger (set up via setup()) — re-arms the debounce timer on relevant edits. */
function onSheetEdit(e) {
  var sheetName = e.range.getSheet().getName().toLowerCase();
  var relevant = Object.keys(SHEET_KEYWORDS).some(function (key) {
    return sheetName.indexOf(SHEET_KEYWORDS[key].toLowerCase()) !== -1;
  });
  if (!relevant) return;

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runExtractAndPush') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runExtractAndPush').timeBased().after(DEBOUNCE_MS).create();
}
