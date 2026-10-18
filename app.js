import { loadLocalState, requestPersistentStorage, saveLocalState } from "./storage.js";

const APPLE_EPOCH_OFFSET = 978307200;
const MAX_VISIBLE_RECORDS = 30;

const fileInput = document.querySelector("#backup-file");
const emptyState = document.querySelector("#empty-state");
const dashboard = document.querySelector("#dashboard");
const errorBox = document.querySelector("#load-error");
const monthPicker = document.querySelector("#month-picker");
const recordForm = document.querySelector("#record-form");
const recordTypePicker = document.querySelector("#record-type");
const recordDateInput = document.querySelector("#record-date");
const recordCategoryPicker = document.querySelector("#record-category");
const recordAmountInput = document.querySelector("#record-amount");
const recordMemoInput = document.querySelector("#record-memo");
const categoryHint = document.querySelector("#category-hint");
const backupExportPanel = document.querySelector("#backup-export-panel");
const addedRecordCount = document.querySelector("#added-record-count");
const receiptPhotoInput = document.querySelector("#receipt-photo");
const receiptPreview = document.querySelector("#receipt-preview");
const saveStatus = document.querySelector("#save-status");

let backup = null;
let addedRecords = 0;
let pendingReceiptImage = null;
let language = "ja";
let currencySymbol = "¥";
let moneyFormatter = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 });

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  try {
    const parsed = JSON.parse(await file.text());
    validateBackup(parsed);
    await saveLocalState(parsed, 0);
    activateBackup(parsed, file.name, 0);
    saveStatus.textContent = "この端末に保存しました。次回起動時に自動で開きます。";
  } catch (error) {
    showError(error instanceof Error ? error.message : "JSONファイルを読み込めませんでした。");
  } finally {
    fileInput.value = "";
  }
});

monthPicker.addEventListener("change", renderMonth);
recordTypePicker.addEventListener("change", populateRecordCategories);
recordForm.addEventListener("submit", addRecord);
document.querySelector("#export-backup-button").addEventListener("click", downloadUpdatedBackup);
receiptPhotoInput.addEventListener("change", updateReceiptPreview);

window.addEventListener("DOMContentLoaded", initializeApp, { once: true });

async function initializeApp() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  }
  const storageIsPersistent = await requestPersistentStorage();

  try {
    const saved = await loadLocalState();
    if (saved.backup) {
      validateBackup(saved.backup);
      activateBackup(saved.backup, "この端末の保存データ", saved.addedRecords);
      saveStatus.textContent = storageIsPersistent
        ? "この端末の保存データを開きました。"
        : "この端末の保存データを開きました。大切なデータは定期的にJSONで書き出してください。";
    }
  } catch {
    showError("この端末の保存データを読み込めませんでした。iPhoneアプリのバックアップを読み直してください。");
  }
}

function activateBackup(value, label, addedCount) {
  backup = value;
  addedRecords = addedCount;
  language = value.settings?.language === "english" ? "en" : "ja";
  currencySymbol = typeof value.settings?.currencySymbol === "string" ? value.settings.currencySymbol : "¥";
  moneyFormatter = new Intl.NumberFormat(language === "ja" ? "ja-JP" : "en-US", {
    maximumFractionDigits: 0
  });
  hideError();
  document.querySelector("#backup-label").textContent = label;
  emptyState.hidden = true;
  dashboard.hidden = false;
  backupExportPanel.hidden = false;
  addedRecordCount.textContent = addedRecords > 0 ? `${addedRecords}件の記録を追加済み` : "記録は自動保存されます";
  pendingReceiptImage = null;
  receiptPhotoInput.value = "";
  receiptPreview.hidden = true;
  populateMonths();
  populateRecordCategories();
  setDefaultRecordDate();
  renderMonth();
}

function validateBackup(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.records)) {
    throw new Error("Daily Kakeiboのバックアップ形式ではありません。アプリから書き出したJSONを選んでください。");
  }
  if (!Array.isArray(value.categories)) value.categories = [];
  if (!Array.isArray(value.receiptImages)) value.receiptImages = [];
  if (!Array.isArray(value.monthlyReports)) value.monthlyReports = [];
  if (!value.settings || typeof value.settings !== "object") value.settings = {};
}

function dateFromBackup(value) {
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  // Swift JSONEncoder encodes Date as seconds since 2001-01-01 by default.
  const seconds = value > 10_000_000_000 ? value / 1000 : value;
  const unixSeconds = seconds > 946684800 ? seconds : seconds + APPLE_EPOCH_OFFSET;
  const parsed = new Date(unixSeconds * 1000);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function dateLabel(date, options = { month: "short", day: "numeric" }) {
  return new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : "en-US", options).format(date);
}

function formatMoney(amount) {
  const safeAmount = Number(amount);
  return `${currencySymbol}${moneyFormatter.format(Number.isFinite(safeAmount) ? safeAmount : 0)}`;
}

function populateMonths() {
  const months = new Set();
  backup.records.forEach(record => {
    const date = dateFromBackup(record.date);
    if (date) months.add(periodKey(date));
  });

  const sortedMonths = [...months].sort().reverse();
  monthPicker.replaceChildren();
  if (sortedMonths.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = language === "ja" ? "記録なし" : "No records";
    monthPicker.append(option);
    monthPicker.disabled = true;
    return;
  }

  monthPicker.disabled = false;
  sortedMonths.forEach(key => {
    const [year, month] = key.split("-").map(Number);
    const option = document.createElement("option");
    option.value = key;
    option.textContent = new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : "en-US", {
      year: "numeric", month: "long"
    }).format(new Date(year, month - 1, 1));
    monthPicker.append(option);
  });
}

function populateRecordCategories() {
  if (!backup) return;
  const selectedType = recordTypePicker.value;
  const categories = backup.categories
    .filter(category => category.type === selectedType && !category.isHidden)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  recordCategoryPicker.replaceChildren();
  categories.forEach(category => {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.localizedNames?.[language]
      || category.localizedNames?.ja
      || category.localizedNames?.en
      || (language === "ja" ? "その他" : "Other");
    recordCategoryPicker.append(option);
  });

  const hasCategories = categories.length > 0;
  recordCategoryPicker.disabled = !hasCategories;
  document.querySelector("#add-record-button").disabled = !hasCategories;
  categoryHint.hidden = hasCategories;
  categoryHint.textContent = hasCategories
    ? ""
    : "この種類で選べるカテゴリーがありません。iPhoneアプリでカテゴリーを確認し、最新のバックアップを読み込んでください。";
}

function setDefaultRecordDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  recordDateInput.value = `${year}-${month}-${day}`;
}

async function addRecord(event) {
  event.preventDefault();
  if (!backup || !recordForm.reportValidity()) return;

  const category = backup.categories.find(item =>
    item.id === recordCategoryPicker.value && item.type === recordTypePicker.value && !item.isHidden
  );
  const amount = Number(recordAmountInput.value);
  if (!category || !Number.isFinite(amount) || amount <= 0) return;

  const [year, month, day] = recordDateInput.value.split("-").map(Number);
  const recordDate = new Date(year, month - 1, day, 12, 0, 0);
  if (Number.isNaN(recordDate.getTime())) return;

  const now = new Date();
  const appleSeconds = date => date.getTime() / 1000 - APPLE_EPOCH_OFFSET;
  const receiptImagePath = pendingReceiptImage ? `${createUUID()}.jpg` : null;
  const record = {
    id: createUUID(),
    type: recordTypePicker.value,
    date: appleSeconds(recordDate),
    categoryId: category.id,
    categoryNameSnapshot: category.localizedNames?.[language]
      || category.localizedNames?.ja
      || category.localizedNames?.en
      || "",
    amount,
    memo: recordMemoInput.value.trim(),
    receiptImagePath,
    createdAt: appleSeconds(now),
    updatedAt: appleSeconds(now)
  };
  backup.records.push(record);
  if (pendingReceiptImage) {
    backup.receiptImages.push({ fileName: receiptImagePath, data: pendingReceiptImage });
  }

  addedRecords += 1;
  saveStatus.textContent = "保存中…";
  document.querySelector("#add-record-button").disabled = true;
  try {
    await saveLocalState(backup, addedRecords);
    saveStatus.textContent = "この端末に自動保存しました。";
  } catch (error) {
    backup.records = backup.records.filter(item => item.id !== record.id);
    if (receiptImagePath) backup.receiptImages = backup.receiptImages.filter(image => image.fileName !== receiptImagePath);
    addedRecords -= 1;
    showError(error instanceof Error ? error.message : "記録を端末に保存できませんでした。");
    saveStatus.textContent = "保存できませんでした。空き容量を確認してください。";
    document.querySelector("#add-record-button").disabled = false;
    return;
  }
  document.querySelector("#add-record-button").disabled = false;
  addedRecordCount.textContent = `${addedRecords}件の記録`;
  backupExportPanel.hidden = false;
  document.querySelector("#backup-label").textContent = `読み込み済み · ${addedRecords}件追加`;
  populateMonths();
  monthPicker.value = periodKey(recordDate);
  renderMonth();
  recordAmountInput.value = "";
  recordMemoInput.value = "";
  pendingReceiptImage = null;
  receiptPhotoInput.value = "";
  receiptPreview.replaceChildren();
  receiptPreview.hidden = true;
  recordAmountInput.focus();
}

async function updateReceiptPreview() {
  const file = receiptPhotoInput.files?.[0];
  pendingReceiptImage = null;
  receiptPreview.replaceChildren();
  receiptPreview.hidden = true;
  if (!file) return;

  try {
    pendingReceiptImage = await optimizeReceiptImage(file);
    const image = document.createElement("img");
    image.src = `data:image/jpeg;base64,${pendingReceiptImage}`;
    image.alt = "レシートのプレビュー";
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "remove-receipt-button";
    removeButton.textContent = "写真を外す";
    removeButton.addEventListener("click", () => {
      pendingReceiptImage = null;
      receiptPhotoInput.value = "";
      receiptPreview.replaceChildren();
      receiptPreview.hidden = true;
    });
    receiptPreview.append(image, removeButton);
    receiptPreview.hidden = false;
  } catch {
    showError("レシート写真を読み込めませんでした。別の画像を選んでください。");
    receiptPhotoInput.value = "";
  }
}

async function optimizeReceiptImage(file) {
  const bitmap = await createImageBitmap(file);
  const maxDimension = 1800;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image canvas is unavailable.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(result => result ? resolve(result) : reject(new Error("Image conversion failed.")), "image/jpeg", 0.68);
  });
  return blobToBase64(blob);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error || new Error("画像を読み込めませんでした。"));
    reader.readAsDataURL(blob);
  });
}

function createUUID() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, character => {
    const value = Math.floor(Math.random() * 16);
    return (character === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}

function downloadUpdatedBackup() {
  if (!backup || addedRecords === 0) return;

  backup.exportedAt = new Date().getTime() / 1000 - APPLE_EPOCH_OFFSET;
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const date = new Date();
  const datePart = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  anchor.href = url;
  anchor.download = `DailyKakeibo-Backup-${datePart}-web.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderMonth() {
  if (!backup) return;
  const selectedMonth = monthPicker.value;
  const records = backup.records
    .map(record => ({ record, date: dateFromBackup(record.date) }))
    .filter(item => item.date && periodKey(item.date) === selectedMonth)
    .sort((a, b) => b.date - a.date);

  const expenses = records.filter(item => item.record.type === "expense");
  const incomes = records.filter(item => item.record.type === "income");
  const expenseTotal = sum(expenses);
  const incomeTotal = sum(incomes);
  const balance = incomeTotal - expenseTotal;

  document.querySelector("#balance-value").textContent = formatMoney(balance);
  document.querySelector("#balance-value").classList.toggle("negative", balance < 0);
  document.querySelector("#balance-caption").textContent = selectedMonth ? periodCaption(selectedMonth) : "";
  document.querySelector("#income-value").textContent = formatMoney(incomeTotal);
  document.querySelector("#income-caption").textContent = `${incomes.length}件の記録`;
  document.querySelector("#expense-value").textContent = formatMoney(expenseTotal);
  document.querySelector("#expense-caption").textContent = `${expenses.length}件の記録`;
  renderCategories(expenses, expenseTotal);
  renderRecords(records);
  renderReport(selectedMonth);
}

function sum(items) {
  return items.reduce((total, item) => total + (Number(item.record.amount) || 0), 0);
}

function monthLabel(key) {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : "en-US", {
    year: "numeric", month: "long"
  }).format(new Date(year, month - 1, 1));
}

function periodKey(date) {
  const closingDay = readClosingDay(backup?.settings?.closingDay);
  if (!closingDay || date.getDate() <= closingDay) return monthKey(date);
  const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return monthKey(nextMonth);
}

function periodCaption(key) {
  const [year, month] = key.split("-").map(Number);
  const closingDay = readClosingDay(backup?.settings?.closingDay);
  if (!closingDay) return monthLabel(key);

  const start = new Date(year, month - 2, closingDay + 1);
  const end = new Date(year, month - 1, closingDay);
  const startText = dateLabel(start, { month: "numeric", day: "numeric" });
  const endText = dateLabel(end, { month: "numeric", day: "numeric" });
  return `${monthLabel(key)}締め · ${startText}〜${endText}`;
}

function readClosingDay(value) {
  if (!value || typeof value !== "object") return null;
  if (Number.isInteger(value.day)) return value.day;
  if (Number.isInteger(value.day?._0)) return value.day._0;
  if (Number.isInteger(value.day?.["0"])) return value.day["0"];
  return null;
}

function categoryName(record) {
  const category = backup.categories.find(item => item.id === record.categoryId);
  const names = category?.localizedNames;
  return names?.[language] || names?.ja || names?.en || record.categoryNameSnapshot || (language === "ja" ? "その他" : "Other");
}

function renderCategories(expenses, total) {
  const host = document.querySelector("#category-list");
  const chart = document.querySelector("#category-chart");
  chart.replaceChildren();
  const groups = new Map();
  expenses.forEach(({ record }) => {
    const name = categoryName(record);
    groups.set(name, (groups.get(name) || 0) + (Number(record.amount) || 0));
  });

  const sorted = [...groups.entries()].sort((a, b) => b[1] - a[1]);
  document.querySelector("#category-count").textContent = `${sorted.length}カテゴリー`;
  host.replaceChildren();
  if (sorted.length === 0) {
    chart.replaceChildren();
    chart.hidden = true;
    host.append(emptyMessage("この月の支出記録はありません"));
    return;
  }

  chart.hidden = false;
  const palette = ["#367a59", "#e3a16d", "#7c9eaf", "#b07c9e", "#d1bb62", "#7b8f68", "#c47860", "#8890b7"];
  let stop = 0;
  const stops = sorted.map(([, amount], index) => {
    const start = stop;
    stop += total > 0 ? amount / total * 100 : 0;
    return `${palette[index % palette.length]} ${start}% ${stop}%`;
  });
  chart.style.background = `conic-gradient(${stops.join(", ")})`;
  const chartValue = document.createElement("strong");
  chartValue.textContent = formatMoney(total);
  chart.append(chartValue);

  sorted.slice(0, 7).forEach(([name, amount], index) => {
    const row = document.createElement("div");
    row.className = "category-row";
    const label = document.createElement("div");
    label.className = "category-name";
    label.textContent = name;
    label.style.setProperty("--category-color", palette[index % palette.length]);
    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.style.width = `${total > 0 ? Math.max(2, amount / total * 100) : 0}%`;
    track.append(fill);
    const amountLabel = document.createElement("div");
    amountLabel.className = "category-amount";
    amountLabel.textContent = formatMoney(amount);
    row.append(label, track, amountLabel);
    host.append(row);
  });
}

function renderRecords(records) {
  const host = document.querySelector("#record-list");
  document.querySelector("#record-count").textContent = `${records.length}件`;
  host.replaceChildren();
  if (records.length === 0) {
    host.append(emptyMessage("この月の記録はありません"));
    return;
  }

  records.slice(0, MAX_VISIBLE_RECORDS).forEach(({ record, date }) => {
    const type = record.type === "income" ? "income" : "expense";
    const row = document.createElement("div");
    row.className = "record-row";
    const receiptData = receiptImageBase64(record.receiptImagePath);
    const symbol = receiptData ? document.createElement("img") : document.createElement("div");
    symbol.className = receiptData ? "receipt-thumb" : `record-symbol ${type}`;
    if (receiptData) {
      symbol.src = `data:image/jpeg;base64,${receiptData}`;
      symbol.alt = "レシート写真";
    } else {
      symbol.textContent = type === "income" ? "↙" : "↗";
    }
    const main = document.createElement("div");
    main.className = "record-main";
    const title = document.createElement("div");
    title.className = "record-title";
    title.textContent = record.memo?.trim() || categoryName(record);
    const subtitle = document.createElement("div");
    subtitle.className = "record-subtitle";
    subtitle.textContent = `${dateLabel(date)} · ${categoryName(record)}`;
    main.append(title, subtitle);
    const amount = document.createElement("div");
    amount.className = `record-amount ${type}`;
    amount.textContent = `${type === "income" ? "+" : "−"}${formatMoney(record.amount)}`;
    row.append(symbol, main, amount);
    host.append(row);
  });

  if (records.length > MAX_VISIBLE_RECORDS) {
    const note = document.createElement("div");
    note.className = "record-empty";
    note.textContent = `最新${MAX_VISIBLE_RECORDS}件を表示しています`;
    host.append(note);
  }
}

function receiptImageBase64(fileName) {
  if (!fileName) return null;
  return backup.receiptImages.find(image => image.fileName === fileName)?.data || null;
}

function renderReport(selectedMonth) {
  const host = document.querySelector("#report-content");
  host.replaceChildren();
  const report = backup.monthlyReports.find(item => {
    const end = dateFromBackup(item.periodEnd);
    return end && periodKey(end) === selectedMonth;
  });
  if (!report) {
    const empty = document.createElement("span");
    empty.className = "report-empty";
    empty.textContent = "この月のレポートはまだありません。";
    host.append(empty);
    return;
  }

  const comment = document.createElement("div");
  comment.textContent = report.comment || report.title || "月次レポート";
  host.append(comment);
  if (report.targetBudgetAmount != null) {
    const stat = document.createElement("div");
    stat.className = "report-stat";
    const label = document.createElement("span");
    label.textContent = "予算";
    const value = document.createElement("strong");
    value.textContent = formatMoney(report.targetBudgetAmount);
    stat.append(label, value);
    host.append(stat);
  }
}

function emptyMessage(message) {
  const node = document.createElement("div");
  node.className = "record-empty";
  node.textContent = message;
  return node;
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function hideError() {
  errorBox.textContent = "";
  errorBox.hidden = true;
}
