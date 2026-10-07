from __future__ import annotations
import json
import os
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
import numpy as np
from cryptography.fernet import Fernet, InvalidToken
from .config import Settings
from .schemas import ReviewRequest

class ConflictError(ValueError): pass

class Store:
    def __init__(self, cfg: Settings):
        self.cfg = cfg
        cfg.data_dir.mkdir(parents=True, exist_ok=True)
        try: os.chmod(cfg.data_dir, 0o700)
        except OSError: pass
        self.path = cfg.data_dir/'attendance.sqlite3'
        key_path = cfg.data_dir/'encryption.key'
        if cfg.encryption_key:
            key = cfg.encryption_key.encode()
        elif key_path.exists():
            key = key_path.read_bytes().strip()
        else:
            if self.path.exists() and self.path.stat().st_size:
                raise RuntimeError('Database exists but encryption key is missing. Restore the original key; do not generate a replacement.')
            key = Fernet.generate_key()
            self._write_private(key_path, key)
        self.cipher = Fernet(key)
        token_path = cfg.data_dir/'access_token.txt'
        if cfg.api_token:
            self.token = cfg.api_token
        elif token_path.exists():
            self.token = token_path.read_text().strip()
        else:
            self.token = secrets.token_urlsafe(32)
            self._write_private(token_path, self.token.encode())
        if len(self.token)<24:
            raise RuntimeError('Stored access token is invalid. Restore a token with at least 24 characters or remove access_token.txt to generate a new one.')
        with self.db() as connection:
            connection.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value BLOB NOT NULL);
            CREATE TABLE IF NOT EXISTS classes (id TEXT PRIMARY KEY, name TEXT NOT NULL, created REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS students (
                id TEXT PRIMARY KEY, class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
                roll_number TEXT NOT NULL, name TEXT NOT NULL, authorization_record TEXT NOT NULL,
                created REAL NOT NULL, UNIQUE(class_id,roll_number));
            CREATE TABLE IF NOT EXISTS templates (
                id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
                model_id TEXT NOT NULL, embedding BLOB NOT NULL, thumbnail BLOB NOT NULL, created REAL NOT NULL);
            CREATE INDEX IF NOT EXISTS template_lookup ON templates(student_id,model_id);
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY, class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
                attendance_date TEXT NOT NULL, period TEXT NOT NULL, created REAL NOT NULL,
                version INTEGER NOT NULL DEFAULT 1, confirmed INTEGER NOT NULL DEFAULT 0,
                result BLOB NOT NULL, final_rows BLOB);
            CREATE INDEX IF NOT EXISTS sessions_lookup ON sessions(class_id,created);
            CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, timestamp REAL NOT NULL,
                action TEXT NOT NULL, object_id TEXT NOT NULL);
            ''')
            sentinel = connection.execute("SELECT value FROM meta WHERE key='encryption_check'").fetchone()
            if sentinel:
                try: self.cipher.decrypt(sentinel['value'])
                except InvalidToken as exc: raise RuntimeError('The encryption key does not match this database.') from exc
            else:
                connection.execute('INSERT INTO meta VALUES (?,?)',('encryption_check',self.cipher.encrypt(b'attendance-lab-v1')))
        self.purge_expired()

    @staticmethod
    def _write_private(path: Path, value: bytes):
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd,'wb') as stream: stream.write(value)

    @contextmanager
    def db(self, write: bool = False):
        connection = sqlite3.connect(self.path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute('PRAGMA foreign_keys=ON')
        connection.execute('PRAGMA secure_delete=ON')
        try:
            if write: connection.execute('BEGIN IMMEDIATE')
            yield connection
            connection.commit()
        except Exception:
            connection.rollback(); raise
        finally:
            connection.close()

    def encrypt(self, value) -> bytes:
        return self.cipher.encrypt(json.dumps(value, separators=(',',':'), allow_nan=False).encode())

    def decrypt(self, value: bytes):
        return json.loads(self.cipher.decrypt(value))

    @staticmethod
    def log(c, action, object_id):
        c.execute('INSERT INTO audit(timestamp,action,object_id) VALUES(?,?,?)',(time.time(),action,object_id))

    def classes(self):
        with self.db() as c:
            return [dict(row) for row in c.execute('''SELECT classes.*, COUNT(students.id) student_count
                FROM classes LEFT JOIN students ON classes.id=students.class_id
                GROUP BY classes.id ORDER BY classes.created''')]

    def class_get(self, class_id):
        with self.db() as c: row = c.execute('SELECT * FROM classes WHERE id=?',(class_id,)).fetchone()
        if row is None: raise KeyError('Class not found.')
        return dict(row)

    def class_create(self, name):
        class_id = uuid.uuid4().hex
        with self.db(write=True) as c:
            c.execute('INSERT INTO classes VALUES(?,?,?)',(class_id,name,time.time()))
            self.log(c,'class_created',class_id)
        return self.class_get(class_id)

    def class_delete(self, class_id):
        with self.db(write=True) as c:
            if c.execute('DELETE FROM classes WHERE id=?',(class_id,)).rowcount != 1: raise KeyError('Class not found.')
            self.log(c,'class_deleted',class_id)

    def students(self, class_id, model_id=None):
        self.class_get(class_id)
        with self.db() as c:
            rows = c.execute('''SELECT s.*, COUNT(t.id) sample_count FROM students s
                LEFT JOIN templates t ON s.id=t.student_id AND (? IS NULL OR t.model_id=?)
                WHERE s.class_id=? GROUP BY s.id ORDER BY LENGTH(s.roll_number),s.roll_number''',
                (model_id,model_id,class_id)).fetchall()
        return [dict(r) for r in rows]

    def student_get(self, student_id):
        with self.db() as c: row=c.execute('SELECT * FROM students WHERE id=?',(student_id,)).fetchone()
        if row is None: raise KeyError('Student not found.')
        return dict(row)

    def students_create(self, class_id, records):
        self.class_get(class_id)
        ids=[]
        with self.db(write=True) as c:
            count=c.execute('SELECT COUNT(*) FROM students WHERE class_id=?',(class_id,)).fetchone()[0]
            if count+len(records)>self.cfg.max_students: raise ValueError('Class exceeds the 200-student test limit.')
            try:
                for row in records:
                    student_id=uuid.uuid4().hex; ids.append(student_id)
                    c.execute('INSERT INTO students VALUES(?,?,?,?,?,?)',
                        (student_id,class_id,row.roll_number,row.name,row.authorization_record,time.time()))
                    self.log(c,'student_created',student_id)
            except sqlite3.IntegrityError as exc: raise ConflictError('A roll number is duplicated; no rows were imported.') from exc
        return [self.student_get(i) for i in ids]

    def student_delete(self, student_id):
        student=self.student_get(student_id)
        with self.db(write=True) as c:
            # Sessions may contain a person's face even when it was not identified.
            # Purge the whole class's test evidence, not only labeled face entries.
            c.execute('DELETE FROM sessions WHERE class_id=?',(student['class_id'],))
            c.execute('DELETE FROM students WHERE id=?',(student_id,))
            self.log(c,'student_deleted_and_class_sessions_purged',student_id)

    def templates(self, student_id, model_id):
        with self.db() as c:
            rows=c.execute('SELECT embedding FROM templates WHERE student_id=? AND model_id=? ORDER BY created',
                           (student_id,model_id)).fetchall()
        return [np.asarray(self.decrypt(r['embedding']),np.float32) for r in rows]

    def class_templates(self, class_id, model_id, student_ids):
        galleries={student_id:[] for student_id in student_ids}
        with self.db() as c:
            rows=c.execute('''SELECT t.student_id,t.embedding FROM templates t
                JOIN students s ON s.id=t.student_id
                WHERE s.class_id=? AND t.model_id=? ORDER BY t.created''',
                (class_id,model_id)).fetchall()
        for row in rows:
            if row['student_id'] in galleries:
                galleries[row['student_id']].append(np.asarray(self.decrypt(row['embedding']),np.float32))
        return [galleries[student_id] for student_id in student_ids]

    def class_reference_thumbnails(self, class_id, model_id, student_ids, limit=3):
        galleries={student_id:[] for student_id in student_ids}
        with self.db() as c:
            rows=c.execute('''SELECT t.student_id,t.thumbnail FROM templates t
                JOIN students s ON s.id=t.student_id
                WHERE s.class_id=? AND t.model_id=? ORDER BY t.created''',
                (class_id,model_id)).fetchall()
        for row in rows:
            if row['student_id'] in galleries and len(galleries[row['student_id']]) < limit:
                galleries[row['student_id']].append(self.decrypt(row['thumbnail']))
        return galleries

    def add_templates(self, student_id, model_id, samples):
        self.student_get(student_id)
        with self.db(write=True) as c:
            count=c.execute('SELECT COUNT(*) FROM templates WHERE student_id=? AND model_id=?',(student_id,model_id)).fetchone()[0]
            if count+len(samples)>self.cfg.max_templates: raise ValueError('Maximum 10 samples per student per model.')
            for embedding,thumbnail in samples:
                c.execute('INSERT INTO templates VALUES(?,?,?,?,?,?)',
                    (uuid.uuid4().hex,student_id,model_id,self.encrypt(embedding.tolist()),self.encrypt(thumbnail),time.time()))
            self.log(c,'templates_added',student_id)

    def delete_templates(self, student_id):
        student=self.student_get(student_id)
        with self.db(write=True) as c:
            c.execute('DELETE FROM templates WHERE student_id=?',(student_id,))
            c.execute('DELETE FROM sessions WHERE class_id=?',(student['class_id'],))
            self.log(c,'templates_deleted_and_class_sessions_purged',student_id)

    def save_session(self, class_id, attendance_date, period, result):
        session_id=uuid.uuid4().hex
        with self.db(write=True) as c:
            c.execute('INSERT INTO sessions(id,class_id,attendance_date,period,created,result) VALUES(?,?,?,?,?,?)',
                      (session_id,class_id,attendance_date,period,time.time(),self.encrypt(result)))
            self.log(c,'session_analyzed',session_id)
        return self.session_get(session_id)

    def session_get(self, session_id):
        with self.db() as c:
            row=c.execute('SELECT * FROM sessions WHERE id=? AND created>=?',
                          (session_id,time.time()-self.cfg.retention_days*86400)).fetchone()
        if row is None: raise KeyError('Session not found (it may have expired or been deleted).')
        result=dict(row)
        result['result']=self.decrypt(row['result'])
        result['final_rows']=self.decrypt(row['final_rows']) if row['final_rows'] else None
        return result

    def sessions(self, class_id):
        self.class_get(class_id)
        with self.db() as c:
            return [dict(row) for row in c.execute('''SELECT id,attendance_date,period,created,version,confirmed
                FROM sessions WHERE class_id=? AND created>=? ORDER BY created DESC LIMIT 100''',
                (class_id,time.time()-self.cfg.retention_days*86400))]

    def review(self, session_id, request: ReviewRequest):
        if not request.reviewed: raise ValueError('Teacher confirmation is required.')
        with self.db(write=True) as c:
            row=c.execute('SELECT * FROM sessions WHERE id=? AND created>=?',
                          (session_id,time.time()-self.cfg.retention_days*86400)).fetchone()
            if row is None: raise KeyError('Session not found.')
            if row['version'] != request.version: raise ConflictError('Session changed in another window. Reload before submitting.')
            result=self.decrypt(row['result'])
            expected={s['id'] for s in result['roster']}
            actual=[s.student_id for s in request.rows]
            if len(actual)!=len(set(actual)) or set(actual)!=expected:
                raise ValueError('Submit exactly one final status for every student in this session.')
            final=dict(confirmed_by=request.confirmed_by, confirmed_at=time.time(), rows=[r.model_dump() for r in request.rows])
            c.execute('UPDATE sessions SET version=version+1,confirmed=1,final_rows=? WHERE id=?',
                      (self.encrypt(final),session_id))
            self.log(c,'session_confirmed',session_id)
        return self.session_get(session_id)

    def session_delete(self, session_id):
        with self.db(write=True) as c:
            if c.execute('DELETE FROM sessions WHERE id=?',(session_id,)).rowcount!=1: raise KeyError('Session not found.')
            self.log(c,'session_deleted',session_id)

    def purge_expired(self):
        cutoff=time.time()-self.cfg.retention_days*86400
        with self.db(write=True) as c:
            count=c.execute('DELETE FROM sessions WHERE created<?',(cutoff,)).rowcount
            c.execute('DELETE FROM audit WHERE timestamp<?',(time.time()-90*86400,))
            if count: self.log(c,'expired_sessions_purged',str(count))
        return count
