const APPLE_EPOCH_OFFSET = 978307200;
const MAX_VISIBLE_RECORDS = 30;

const fileInput = document.querySelector("#backup-file");
const emptyState = document.querySelector("#empty-state");
const dashboard = document.querySelector("#dashboard");
const errorBox = document.querySelector("#load-error");
const monthPicker = document.querySelector("#month-picker");

let backup = null;
let language = "ja";
let currencySymbol = "¥";
let moneyFormatter = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 });

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  try {
    const parsed = JSON.parse(await file.text());
    validateBackup(parsed);
    backup = parsed;
    language = parsed.settings?.language === "english" ? "en" : "ja";
    currencySymbol = typeof parsed.settings?.currencySymbol === "string" ? parsed.settings.currencySymbol : "¥";
    moneyFormatter = new Intl.NumberFormat(language === "ja" ? "ja-JP" : "en-US", {
      maximumFractionDigits: 0
    });
    hideError();
    document.querySelector("#backup-label").textContent = file.name;
    emptyState.hidden = true;
    dashboard.hidden = false;
    populateMonths();
    renderMonth();
  } catch (error) {
    showError(error instanceof Error ? error.message : "JSONファイルを読み込めませんでした。");
  } finally {
    fileInput.value = "";
  }
});

monthPicker.addEventListener("change", renderMonth);

function validateBackup(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.records)) {
    throw new Error("Daily Kakeiboのバックアップ形式ではありません。アプリから書き出したJSONを選んでください。");
  }
  if (!Array.isArray(value.categories)) value.categories = [];
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
  const groups = new Map();
  expenses.forEach(({ record }) => {
    const name = categoryName(record);
    groups.set(name, (groups.get(name) || 0) + (Number(record.amount) || 0));
  });

  const sorted = [...groups.entries()].sort((a, b) => b[1] - a[1]);
  document.querySelector("#category-count").textContent = `${sorted.length}カテゴリー`;
  host.replaceChildren();
  if (sorted.length === 0) {
    host.append(emptyMessage("この月の支出記録はありません"));
    return;
  }

  sorted.slice(0, 7).forEach(([name, amount]) => {
    const row = document.createElement("div");
    row.className = "category-row";
    const label = document.createElement("div");
    label.className = "category-name";
    label.textContent = name;
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
    const symbol = document.createElement("div");
    symbol.className = `record-symbol ${type}`;
    symbol.textContent = type === "income" ? "↙" : "↗";
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
