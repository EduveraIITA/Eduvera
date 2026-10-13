from __future__ import annotations

import json
import secrets
import time
import uuid
from contextlib import contextmanager

import numpy as np
import psycopg
from cryptography.fernet import Fernet, InvalidToken
from psycopg import errors
from psycopg.rows import dict_row

from .config import Settings
from .schemas import ReviewRequest
from .store import ConflictError


class PostgresStore:
    """Durable Cloud SQL store for the private inference service."""

    def __init__(self, cfg: Settings):
        if not cfg.database_url:
            raise RuntimeError('DATABASE_URL is required for the PostgreSQL photo store.')
        if not cfg.encryption_key:
            raise RuntimeError('ATTENDANCE_ENCRYPTION_KEY is required for the PostgreSQL photo store.')
        if not cfg.api_token or len(cfg.api_token) < 24:
            raise RuntimeError('ATTENDANCE_API_TOKEN must contain at least 24 characters.')
        self.cfg=cfg
        self.url=cfg.database_url
        self.token=cfg.api_token
        self.cipher=Fernet(cfg.encryption_key.encode())
        with self.db(write=True) as c:
            row=c.execute("SELECT value FROM photo_inference_meta WHERE key='encryption_check'").fetchone()
            if row:
                try: self.cipher.decrypt(bytes(row['value']))
                except InvalidToken as exc: raise RuntimeError('The encryption key does not match the photo-inference store.') from exc
            else:
                c.execute('INSERT INTO photo_inference_meta(key,value) VALUES(%s,%s)',('encryption_check',self.cipher.encrypt(b'edura-photo-v1')))
        self.purge_expired()

    @contextmanager
    def db(self, write: bool=False):
        with psycopg.connect(self.url,row_factory=dict_row) as connection:
            try:
                yield connection
                if write: connection.commit()
            except Exception:
                connection.rollback(); raise

    def encrypt(self,value):
        return self.cipher.encrypt(json.dumps(value,separators=(',',':'),allow_nan=False).encode())

    def decrypt(self,value):
        return json.loads(self.cipher.decrypt(bytes(value)))

    @staticmethod
    def log(c,action,object_id):
        c.execute('INSERT INTO photo_inference_audit(action,object_id) VALUES(%s,%s)',(action,object_id))

    def classes(self):
        with self.db() as c:
            return list(c.execute('''SELECT classes.*,COUNT(students.id)::int student_count
                FROM photo_inference_classes classes LEFT JOIN photo_inference_students students ON students.class_id=classes.id
                GROUP BY classes.id ORDER BY classes.created''').fetchall())

    def class_get(self,class_id):
        with self.db() as c: row=c.execute('SELECT * FROM photo_inference_classes WHERE id=%s',(class_id,)).fetchone()
        if row is None: raise KeyError('Class not found.')
        return row

    def class_create(self,name):
        item=uuid.uuid4().hex
        with self.db(write=True) as c:
            c.execute('INSERT INTO photo_inference_classes(id,name,created) VALUES(%s,%s,%s)',(item,name,time.time()))
            self.log(c,'class_created',item)
        return self.class_get(item)

    def class_delete(self,class_id):
        with self.db(write=True) as c:
            if c.execute('DELETE FROM photo_inference_classes WHERE id=%s',(class_id,)).rowcount != 1: raise KeyError('Class not found.')
            self.log(c,'class_deleted',class_id)

    def students(self,class_id,model_id=None):
        self.class_get(class_id)
        with self.db() as c:
            return list(c.execute('''SELECT s.*,COUNT(t.id)::int sample_count FROM photo_inference_students s
                LEFT JOIN photo_inference_templates t ON s.id=t.student_id AND (%s IS NULL OR t.model_id=%s)
                WHERE s.class_id=%s GROUP BY s.id ORDER BY length(s.roll_number),s.roll_number''',(model_id,model_id,class_id)).fetchall())

    def student_get(self,student_id):
        with self.db() as c: row=c.execute('SELECT * FROM photo_inference_students WHERE id=%s',(student_id,)).fetchone()
        if row is None: raise KeyError('Student not found.')
        return row

    def students_create(self,class_id,records):
        self.class_get(class_id); ids=[]
        with self.db(write=True) as c:
            count=c.execute('SELECT COUNT(*) count FROM photo_inference_students WHERE class_id=%s',(class_id,)).fetchone()['count']
            if count+len(records)>self.cfg.max_students: raise ValueError('Class exceeds the 200-student test limit.')
            try:
                for row in records:
                    item=uuid.uuid4().hex;ids.append(item)
                    c.execute('''INSERT INTO photo_inference_students(id,class_id,roll_number,name,authorization_record,created)
                        VALUES(%s,%s,%s,%s,%s,%s)''',(item,class_id,row.roll_number,row.name,row.authorization_record,time.time()))
                    self.log(c,'student_created',item)
            except errors.UniqueViolation as exc:
                raise ConflictError('A roll number is duplicated; no rows were imported.') from exc
        return [self.student_get(item) for item in ids]

    def student_delete(self,student_id):
        student=self.student_get(student_id)
        with self.db(write=True) as c:
            c.execute('DELETE FROM photo_inference_sessions WHERE class_id=%s',(student['class_id'],))
            c.execute('DELETE FROM photo_inference_students WHERE id=%s',(student_id,))
            self.log(c,'student_deleted_and_class_sessions_purged',student_id)

    def templates(self,student_id,model_id):
        with self.db() as c: rows=c.execute('''SELECT embedding FROM photo_inference_templates
            WHERE student_id=%s AND model_id=%s ORDER BY created''',(student_id,model_id)).fetchall()
        return [np.asarray(self.decrypt(row['embedding']),np.float32) for row in rows]

    def class_templates(self,class_id,model_id,student_ids):
        galleries={item:[] for item in student_ids}
        with self.db() as c: rows=c.execute('''SELECT t.student_id,t.embedding FROM photo_inference_templates t
            JOIN photo_inference_students s ON s.id=t.student_id WHERE s.class_id=%s AND t.model_id=%s ORDER BY t.created''',(class_id,model_id)).fetchall()
        for row in rows:
            if row['student_id'] in galleries: galleries[row['student_id']].append(np.asarray(self.decrypt(row['embedding']),np.float32))
        return [galleries[item] for item in student_ids]

    def class_reference_thumbnails(self,class_id,model_id,student_ids,limit=3):
        galleries={item:[] for item in student_ids}
        with self.db() as c: rows=c.execute('''SELECT t.student_id,t.thumbnail FROM photo_inference_templates t
            JOIN photo_inference_students s ON s.id=t.student_id WHERE s.class_id=%s AND t.model_id=%s ORDER BY t.created''',(class_id,model_id)).fetchall()
        for row in rows:
            if row['student_id'] in galleries and len(galleries[row['student_id']])<limit:
                galleries[row['student_id']].append(self.decrypt(row['thumbnail']))
        return galleries

    def add_templates(self,student_id,model_id,samples):
        self.student_get(student_id)
        with self.db(write=True) as c:
            count=c.execute('''SELECT COUNT(*) count FROM photo_inference_templates
                WHERE student_id=%s AND model_id=%s''',(student_id,model_id)).fetchone()['count']
            if count+len(samples)>self.cfg.max_templates: raise ValueError('Maximum 10 samples per student per model.')
            for embedding,thumbnail in samples:
                c.execute('''INSERT INTO photo_inference_templates(id,student_id,model_id,embedding,thumbnail,created)
                    VALUES(%s,%s,%s,%s,%s,%s)''',(uuid.uuid4().hex,student_id,model_id,self.encrypt(embedding.tolist()),self.encrypt(thumbnail),time.time()))
            self.log(c,'templates_added',student_id)

    def delete_templates(self,student_id):
        student=self.student_get(student_id)
        with self.db(write=True) as c:
            c.execute('DELETE FROM photo_inference_templates WHERE student_id=%s',(student_id,))
            c.execute('DELETE FROM photo_inference_sessions WHERE class_id=%s',(student['class_id'],))
            self.log(c,'templates_deleted_and_class_sessions_purged',student_id)

    def save_session(self,class_id,attendance_date,period,result):
        item=uuid.uuid4().hex
        with self.db(write=True) as c:
            c.execute('''INSERT INTO photo_inference_sessions(id,class_id,attendance_date,period,created,result)
                VALUES(%s,%s,%s,%s,%s,%s)''',(item,class_id,attendance_date,period,time.time(),self.encrypt(result)))
            self.log(c,'session_analyzed',item)
        return self.session_get(item)

    def session_get(self,session_id):
        with self.db() as c: row=c.execute('''SELECT * FROM photo_inference_sessions
            WHERE id=%s AND created>=%s''',(session_id,time.time()-self.cfg.retention_days*86400)).fetchone()
        if row is None: raise KeyError('Session not found (it may have expired or been deleted).')
        result=dict(row);result['confirmed']=int(bool(row['confirmed']));result['result']=self.decrypt(row['result']);result['final_rows']=self.decrypt(row['final_rows']) if row['final_rows'] else None
        return result

    def sessions(self,class_id):
        self.class_get(class_id)
        with self.db() as c: return list(c.execute('''SELECT id,attendance_date,period,created,version,confirmed
            FROM photo_inference_sessions WHERE class_id=%s AND created>=%s ORDER BY created DESC LIMIT 100''',(class_id,time.time()-self.cfg.retention_days*86400)).fetchall())

    def review(self,session_id,request:ReviewRequest):
        if not request.reviewed: raise ValueError('Teacher confirmation is required.')
        with self.db(write=True) as c:
            row=c.execute('''SELECT * FROM photo_inference_sessions WHERE id=%s AND created>=%s FOR UPDATE''',(session_id,time.time()-self.cfg.retention_days*86400)).fetchone()
            if row is None: raise KeyError('Session not found.')
            if row['version']!=request.version: raise ConflictError('Session changed in another window. Reload before submitting.')
            result=self.decrypt(row['result']);expected={s['id'] for s in result['roster']};actual=[s.student_id for s in request.rows]
            if len(actual)!=len(set(actual)) or set(actual)!=expected: raise ValueError('Submit exactly one final status for every student in this session.')
            final=dict(confirmed_by=request.confirmed_by,confirmed_at=time.time(),rows=[r.model_dump() for r in request.rows])
            c.execute('''UPDATE photo_inference_sessions SET version=version+1,confirmed=1,final_rows=%s WHERE id=%s''',(self.encrypt(final),session_id))
            self.log(c,'session_confirmed',session_id)
        return self.session_get(session_id)

    def session_delete(self,session_id):
        with self.db(write=True) as c:
            if c.execute('DELETE FROM photo_inference_sessions WHERE id=%s',(session_id,)).rowcount!=1: raise KeyError('Session not found.')
            self.log(c,'session_deleted',session_id)

    def purge_expired(self):
        cutoff=time.time()-self.cfg.retention_days*86400
        with self.db(write=True) as c:
            count=c.execute('DELETE FROM photo_inference_sessions WHERE created<%s',(cutoff,)).rowcount
            c.execute("DELETE FROM photo_inference_audit WHERE created_at<now()-interval '90 days'")
            c.execute("DELETE FROM photo_inference_multimodal_usage WHERE created_at<now()-interval '370 days'")
            if count:self.log(c,'expired_sessions_purged',str(count))
        return count

    def reserve_multimodal(self,model:str):
        with self.db(write=True) as c:
            c.execute("SELECT pg_advisory_xact_lock(hashtext('photo_multimodal_budget'))")
            usage=c.execute('''SELECT count(*) FILTER(WHERE created_at>=now()-interval '1 day')::int daily,
                count(*) FILTER(WHERE created_at>=now()-interval '31 days')::int monthly
                FROM photo_inference_multimodal_usage''').fetchone()
            if usage['daily']>=self.cfg.multimodal_daily_limit or usage['monthly']>=self.cfg.multimodal_monthly_limit:
                raise RuntimeError('The camera-assistance allowance has been reached. Continue with the manual register.')
            c.execute('INSERT INTO photo_inference_multimodal_usage(id,model) VALUES(%s,%s)',(uuid.uuid4(),model))
