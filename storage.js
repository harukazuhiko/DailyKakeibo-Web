const DATABASE_NAME = "daily-kakeibo-local";
const DATABASE_VERSION = 1;
const STORE_NAME = "state";
const BACKUP_KEY = "backup";
const ADDED_COUNT_KEY = "added-record-count";

let databasePromise;

function openDatabase() {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("端末内ストレージを開けませんでした。"));
  });

  return databasePromise;
}

async function readValue(key) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("保存データを読み込めませんでした。"));
  });
}

async function writeValues(values) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    Object.entries(values).forEach(([key, value]) => store.put(value, key));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("端末内への保存に失敗しました。"));
    transaction.onabort = () => reject(transaction.error || new Error("端末内への保存が中断されました。"));
  });
}

export async function loadLocalState() {
  const [backup, addedRecords] = await Promise.all([
    readValue(BACKUP_KEY),
    readValue(ADDED_COUNT_KEY)
  ]);
  return { backup: backup || null, addedRecords: Number(addedRecords) || 0 };
}

export async function saveLocalState(backup, addedRecords) {
  await writeValues({
    [BACKUP_KEY]: backup,
    [ADDED_COUNT_KEY]: Math.max(0, Number(addedRecords) || 0)
  });
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
