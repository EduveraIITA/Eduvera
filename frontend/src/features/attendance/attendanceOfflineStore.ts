import type { TeacherAttendanceResponse, TeacherAttendanceSaveInput } from "../operations/api";

const databaseName = "omnischool-attendance-continuity";
const recordStore = "encrypted-records";
const keyStore = "device-keys";

interface EncryptedRecord {
  id: string;
  kind: "snapshot" | "queue";
  ownerId: string;
  classSectionId: string;
  date: string;
  expiresAt: string;
  updatedAt: string;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
}

export interface QueuedAttendanceCapture {
  id: string;
  ownerId: string;
  classSectionId: string;
  date: string;
  createdAt: string;
  input: TeacherAttendanceSaveInput;
  screen: TeacherAttendanceResponse;
}

function requestValue<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("The attendance device store could not be opened."));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("The attendance device store could not be updated."));
    transaction.onabort = () => reject(transaction.error ?? new Error("The attendance device update was cancelled."));
  });
}

async function database() {
  if (typeof indexedDB === "undefined" || !globalThis.crypto?.subtle) throw new Error("Secure offline attendance is unavailable on this browser.");
  const request = indexedDB.open(databaseName, 2);
  request.onupgradeneeded = (event) => {
    const db = request.result;
    // Version 1 records were not account-scoped. Remove them instead of risking
    // a roster from a shared device being shown to the next signed-in user.
    if (event.oldVersion < 2 && db.objectStoreNames.contains(recordStore)) db.deleteObjectStore(recordStore);
    if (!db.objectStoreNames.contains(recordStore)) {
      const records = db.createObjectStore(recordStore, { keyPath: "id" });
      records.createIndex("kind", "kind", { unique: false });
      records.createIndex("ownerId", "ownerId", { unique: false });
    }
    if (!db.objectStoreNames.contains(keyStore)) db.createObjectStore(keyStore);
  };
  return requestValue(request);
}

async function deviceKey(db: IDBDatabase, ownerId: string) {
  const created = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  // A read inside a serialized write transaction prevents two tabs from both
  // creating a different key and making one tab's encrypted records unreadable.
  const write = db.transaction(keyStore, "readwrite");
  const store = write.objectStore(keyStore);
  const keyId = `attendance-aes-key:${ownerId}`;
  const existing = await requestValue(store.get(keyId)) as CryptoKey | undefined;
  if (!existing) store.put(created, keyId);
  await transactionDone(write);
  return existing ?? created;
}

async function encrypt(value: unknown, db: IDBDatabase, ownerId: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await deviceKey(db, ownerId), plaintext);
  return { iv: iv.buffer, ciphertext };
}

async function decrypt<T>(record: EncryptedRecord, db: IDBDatabase) {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(record.iv) },
    await deviceKey(db, record.ownerId),
    record.ciphertext,
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

async function put(id: string, ownerId: string, kind: EncryptedRecord["kind"], classSectionId: string, date: string, expiresAt: string, value: unknown) {
  const db = await database();
  try {
    const sealed = await encrypt(value, db, ownerId);
    const transaction = db.transaction(recordStore, "readwrite");
    transaction.objectStore(recordStore).put({ id, ownerId, kind, classSectionId, date, expiresAt, updatedAt: new Date().toISOString(), ...sealed } satisfies EncryptedRecord);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

async function get<T>(id: string, allowExpired = false) {
  const db = await database();
  try {
    const transaction = db.transaction(recordStore, "readonly");
    const record = await requestValue(transaction.objectStore(recordStore).get(id)) as EncryptedRecord | undefined;
    if (!record) return null;
    if (!allowExpired && Date.parse(record.expiresAt) < Date.now()) {
      const cleanup = db.transaction(recordStore, "readwrite");
      cleanup.objectStore(recordStore).delete(id);
      await transactionDone(cleanup);
      return null;
    }
    return await decrypt<T>(record, db);
  } finally {
    db.close();
  }
}

export async function attendanceDeviceId(ownerId: string) {
  const db = await database();
  try {
    const read = db.transaction(keyStore, "readonly");
    const key = `attendance-device-id:${ownerId}`;
    const existing = await requestValue(read.objectStore(keyStore).get(key)) as string | undefined;
    if (existing) return existing;
    const id = `web-${crypto.randomUUID()}`;
    const write = db.transaction(keyStore, "readwrite");
    write.objectStore(keyStore).put(id, key);
    await transactionDone(write);
    return id;
  } finally {
    db.close();
  }
}

const snapshotId = (ownerId: string, classSectionId: string, date: string) => `snapshot:${ownerId}:${classSectionId}:${date}`;
const queueId = (ownerId: string, classSectionId: string, date: string) => `queue:${ownerId}:${classSectionId}:${date}`;

export function cacheAttendanceSnapshot(ownerId: string, screen: TeacherAttendanceResponse) {
  return put(snapshotId(ownerId, screen.class.id, screen.date), ownerId, "snapshot", screen.class.id, screen.date, screen.continuity_snapshot.expires_at, screen);
}

export function readAttendanceSnapshot(ownerId: string, classSectionId: string, date: string) {
  return get<TeacherAttendanceResponse>(snapshotId(ownerId, classSectionId, date));
}

export async function queueAttendanceCapture(capture: QueuedAttendanceCapture) {
  await put(queueId(capture.ownerId, capture.classSectionId, capture.date), capture.ownerId, "queue", capture.classSectionId, capture.date, capture.input.roster_expires_at!, capture);
}

export function readQueuedAttendanceCapture(ownerId: string, classSectionId: string, date: string) {
  // Expired queues are still evidence. Keep them until the server can quarantine
  // and reconcile them instead of silently deleting the observation.
  return get<QueuedAttendanceCapture>(queueId(ownerId, classSectionId, date), true);
}

export async function listQueuedAttendanceCaptures(ownerId: string) {
  const db = await database();
  try {
    const transaction = db.transaction(recordStore, "readonly");
    const records = await requestValue(transaction.objectStore(recordStore).index("kind").getAll("queue")) as EncryptedRecord[];
    const captures: QueuedAttendanceCapture[] = [];
    for (const record of records.filter((item) => item.ownerId === ownerId)) {
      captures.push(await decrypt<QueuedAttendanceCapture>(record, db));
    }
    return captures;
  } finally {
    db.close();
  }
}

export async function removeQueuedAttendanceCapture(ownerId: string, classSectionId: string, date: string) {
  const db = await database();
  try {
    const transaction = db.transaction(recordStore, "readwrite");
    transaction.objectStore(recordStore).delete(queueId(ownerId, classSectionId, date));
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export function applyQueuedCapture(screen: TeacherAttendanceResponse, capture: QueuedAttendanceCapture): TeacherAttendanceResponse {
  const values = new Map(capture.input.records.map((record) => [record.student_id, record]));
  return {
    ...screen,
    roster: screen.roster.map((student) => ({ ...student, ...values.get(student.id) })),
    latest_capture: {
      id: capture.id,
      source: "offline_device",
      status: "pending",
      received_at: capture.createdAt,
      roster_expires_at: capture.input.roster_expires_at!,
    },
  };
}
