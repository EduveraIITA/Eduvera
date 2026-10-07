from __future__ import annotations
import threading
import time
from contextlib import contextmanager
from typing import BinaryIO
import cv2
import numpy as np
from .config import Settings
from .schemas import MatchConfig
from .matching import similarity_matrix, assign
from .vision import OpenCVBackend, SCRFDArcFaceBackend, decode_image, detect_tiled, quality, crop_face, jpeg_thumbnail
from .store import Store
from .llm import OllamaVisionAttendance, build_comparison_sheet, is_multimodal_unsupported_error

class BusyError(RuntimeError): pass

class AttendanceService:
    def __init__(self, cfg: Settings, store: Store, backend=None, llm_client=None):
        self.cfg,self.store,self._backend=cfg,store,backend
        self.llm=llm_client or OllamaVisionAttendance(cfg)
        self.lock=threading.Lock()

    @property
    def backend(self):
        if self._backend is None:
            self._backend=OpenCVBackend(self.cfg) if self.cfg.backend=='opencv' else SCRFDArcFaceBackend(self.cfg)
        return self._backend

    @contextmanager
    def exclusive(self):
        # OpenCV inference objects are shared and not used concurrently.
        # Fail fast instead of allowing an unbounded queue of decoded photos.
        if not self.lock.acquire(blocking=False): raise BusyError('Another photo is processing. Retry shortly.')
        try: yield
        finally: self.lock.release()

    def health(self):
        names=['yunet.onnx','sface.onnx'] if self.cfg.backend=='opencv' else ['scrfd.onnx','arcface.onnx']
        return dict(backend=self.cfg.backend, model_loaded=self._backend is not None,
                    model_id=self._backend.model_id if self._backend else None,
                    model_files_present=all((self.cfg.models_dir/n).is_file() for n in names),
                    missing_models=[n for n in names if not (self.cfg.models_dir/n).is_file()],
                    single_operator=True, accuracy_validated=False, retention_days=self.cfg.retention_days)

    def warmup(self):
        with self.exclusive():
            self.backend.detect(np.zeros((320,320,3),np.uint8))

    def llm_status(self):
        return self.llm.status()

    def enroll(self, student_id: str, payloads: list[bytes | BinaryIO], cfg: MatchConfig):
        if not 1<=len(payloads)<=10: raise ValueError('Upload 1–10 individual photos.')
        with self.exclusive():
            student=self.store.student_get(student_id)
            backend=self.backend
            existing=self.store.templates(student_id,backend.model_id)
            if len(existing)+len(payloads)>self.cfg.max_templates:
                raise ValueError('Maximum 10 samples per student. Clear samples before replacing them.')
            samples=[]; report=[]
            # A reference gallery benefits from modest left/right variation. The
            # classroom matcher keeps the caller's stricter defaults; only this
            # principal-authorized enrollment path permits a three-quarter pose
            # and a detector score down to the detector's own accepted floor.
            enrollment_cfg=cfg.model_copy(update={
                'min_face_pixels': max(56,cfg.min_face_pixels),
                'max_pose_asymmetry': max(1.25,cfg.max_pose_asymmetry),
                'min_detection_score': min(cfg.min_detection_score,self.cfg.detection_threshold),
            })
            # All-or-nothing enrollment: any invalid photo aborts the entire batch.
            for number,data in enumerate(payloads,1):
                if not isinstance(data, bytes):
                    data=data.read(self.cfg.max_upload_bytes+1)
                image=decode_image(data,self.cfg)
                detections,_=detect_tiled(image,backend,self.cfg)
                if not detections:
                    raise ValueError(
                        f'Photo {number}: no usable face was detected. Use a well-lit individual photo '
                        'with the face filling the frame. A slight left or right angle is supported; avoid a full profile.'
                    )
                if len(detections)>1:
                    raise ValueError(
                        f'Photo {number}: more than one face was detected. Crop the image so only this student is visible.'
                    )
                face=detections[0]
                measured=quality(image,face,enrollment_cfg)
                if not measured['ok']:
                    guidance={
                        'face_too_small': 'move closer so the face fills more of the frame',
                        'blur': 'hold the camera steady or choose a sharper photo',
                        'lighting': 'use even light on the face',
                        'head_roll': 'keep the head upright',
                        'pose_or_landmarks': 'use a slight side angle instead of a full profile',
                        'weak_detection': 'move closer and keep both eyes visible',
                    }
                    suggestions=[]
                    for reason in measured['reasons']:
                        suggestion=guidance.get(reason,'choose a clearer individual photo')
                        if suggestion not in suggestions: suggestions.append(suggestion)
                    raise ValueError(f'Photo {number}: {"; ".join(suggestions)}.')
                embedding=backend.embed(image,face)
                if any(float(embedding@old)>.9999 for old in existing+[s[0] for s in samples]):
                    raise ValueError(f'Photo {number} duplicates an existing sample. Use a genuinely different capture.')
                samples.append((embedding,jpeg_thumbnail(crop_face(image,face))))
                report.append(measured)
            self.store.add_templates(student_id,backend.model_id,samples)
            return dict(student_id=student_id, model_id=backend.model_id, added=len(samples),
                        total_samples=len(existing)+len(samples), quality=report)

    def analyze(self, class_id, attendance_date, period, data, cfg: MatchConfig, use_llm=False):
        with self.exclusive():
            start=time.perf_counter()
            backend=self.backend
            roster=self.store.students(class_id,backend.model_id)
            if not roster: raise ValueError('Add students and enrollment samples first.')
            galleries=self.store.class_templates(class_id,backend.model_id,[s['id'] for s in roster])
            if not any(galleries): raise ValueError('No enrollment samples for the active model. Enroll at least one student first.')
            llm_enabled=bool(use_llm)
            llm_warnings=[]
            if use_llm:
                status=self.llm.status()
                if not status.get('available'):
                    llm_enabled=False
                    llm_warnings.append(status.get('detail','Local AI cross-check is unavailable. Using face matching only.'))
                elif not status.get('installed'):
                    llm_enabled=False
                    llm_warnings.append(f'Local vision model {status["model"]} is not installed. Using face matching only.')
                elif status.get('supports_images') is False:
                    llm_enabled=False
                    llm_warnings.append(status.get('detail',f'The local model {status["model"]} cannot analyze images. Using face matching only.'))
            image=decode_image(data,self.cfg)
            faces,calls=detect_tiled(image,backend,self.cfg)
            quality_reports=[quality(image,f,cfg) for f in faces]
            vectors=[]
            for i,face in enumerate(faces):
                try: vectors.append(backend.embed(image,face))
                except (ValueError,RuntimeError,cv2.error):
                    # Keep the visible detection, but never manufacture an embedding.
                    vectors.append(None)
                    quality_reports[i]['ok']=False
                    quality_reports[i]['reasons'].append('embedding_failed')
            valid=[i for i,v in enumerate(vectors) if v is not None]
            scores=np.full((len(faces),len(roster)),-1.0,np.float32)
            if valid: scores[valid,:]=similarity_matrix([vectors[i] for i in valid],galleries)
            decisions=assign(scores,[q['ok'] for q in quality_reports],[s['id'] for s in roster],cfg)
            records=[]
            for i,(face,decision,q) in enumerate(zip(faces,decisions,quality_reports)):
                records.append(dict(face_id=f'f{i+1:03d}',box=[round(float(v),1) for v in face.box],
                                    detection_score=round(face.score,5),quality=q,
                                    thumbnail=jpeg_thumbnail(crop_face(image,face)),**decision))
            embedding_auto_ids={r['student_id'] for r in records if r['state']=='auto'}
            automatic_assignments=[dict(face_id=r['face_id'],student_id=r['student_id'],source='face_embeddings')
                                   for r in records if r['state']=='auto']
            proposal_ids=embedding_auto_ids
            llm_result=None
            analysis_mode='face_embeddings'
            if llm_enabled:
                try:
                    proposal_ids,automatic_assignments,llm_result,new_warnings=self._llm_proposals(
                        class_id,backend.model_id,roster,records)
                    llm_warnings.extend(new_warnings)
                    analysis_mode='local_llm'
                except Exception as exc:
                    if is_multimodal_unsupported_error(exc):
                        llm_warnings.append(f'The local model {self.llm.model} does not support image input. Using face matching only.')
                    else:
                        llm_warnings.append('Local AI cross-check could not be completed. Using face matching only.')
            for student in roster:
                student.pop('authorization_record',None)
                student['embedding_suggested_status']='present' if student['id'] in embedding_auto_ids else 'needs_review'
                student['suggested_status']='present' if student['id'] in proposal_ids else 'needs_review'
                student['suggestion_source']='local_llm' if analysis_mode=='local_llm' else 'face_embeddings'
            warnings=[]
            missing=sum(not g for g in galleries)
            if missing: warnings.append(f'{missing} students have no samples for the active model; review them manually.')
            if not faces: warnings.append('No faces detected. This is NOT evidence that the entire class is absent.')
            if any(not q['ok'] for q in quality_reports):
                warnings.append('Some faces failed quality checks. A closer capture or multi-angle reference photos may help.')
            warnings.extend(llm_warnings)
            warnings.append('Uncalibrated scores: this result is a proposal. Not-seen students are never automatically absent.')
            result=dict(model_id=backend.model_id,analysis_mode=analysis_mode,
                        config=cfg.model_dump(),roster=roster,faces=records,
                        automatic_assignments=automatic_assignments,llm=llm_result,
                        score_matrix=scores.tolist(),quality_ok=[q['ok'] for q in quality_reports],
                        image_size=dict(width=image.shape[1],height=image.shape[0]),
                        detector_calls=calls,elapsed_seconds=round(time.perf_counter()-start,3),warnings=warnings,
                        summary=dict(detected_faces=len(faces),auto_present=len(proposal_ids),
                                     embedding_auto_present=len(embedding_auto_ids),
                                     roster_needs_review=len(roster)-len(proposal_ids),
                                     face_needs_review=sum(r['state']!='auto' for r in records)))
            return self.store.save_session(class_id,attendance_date,period,result)

    def _llm_proposals(self, class_id, model_id, roster, records):
        references=self.store.class_reference_thumbnails(class_id,model_id,[s['id'] for s in roster])
        roster_sheet=[]; roster_map={}
        for index,student in enumerate(roster,1):
            code=f'R{index:03d}'; roster_map[code]=student['id']
            roster_sheet.append(dict(roster_id=code,roll_number=student['roll_number'],name=student['name'],
                                     thumbnails=references[student['id']]))
        face_sheet=[]; face_map={}
        for index,face in enumerate(records,1):
            code=f'C{index:03d}'; face_map[code]=face['face_id']
            face_sheet.append(dict(class_face_id=code,thumbnail=face['thumbnail']))
            face['llm_student_id']=None; face['llm_confidence']=None
        if not records:
            proposals=[dict(student_id=s['id'],roster_id=f'R{i:03d}',status='uncertain',class_face_id=None,
                            confidence=0.0,reason='No class face was detected.',applied=False)
                       for i,s in enumerate(roster,1)]
            return set(),[],dict(model=self.llm.model,elapsed_seconds=0,comparison_sheet=None,
                                  proposals=proposals),['The local LLM was not run because no class faces were detected.']
        sheet,metadata=build_comparison_sheet(roster_sheet,face_sheet)
        response,elapsed=self.llm.analyze(sheet,list(roster_map),list(face_map))
        returned={}; duplicate_roster=set()
        for row in response.rows:
            if row.roster_id in returned: duplicate_roster.add(row.roster_id)
            else: returned[row.roster_id]=row
        claimed={}
        for code,row in returned.items():
            if code in roster_map and row.status=='present' and row.class_face_id in face_map:
                claimed[row.class_face_id]=claimed.get(row.class_face_id,0)+1
        proposals=[]; assignments=[]; accepted=set(); warnings=[]
        for code,student_id in roster_map.items():
            row=returned.get(code)
            valid=(row is not None and code not in duplicate_roster and row.status=='present'
                   and row.class_face_id in face_map and claimed.get(row.class_face_id)==1
                   and row.confidence>=self.cfg.llm_accept_confidence)
            if row is None:
                proposal=dict(student_id=student_id,roster_id=code,status='uncertain',class_face_id=None,
                              confidence=0.0,reason='The model omitted this roster row.',applied=False)
            else:
                proposal=dict(student_id=student_id,roster_id=code,status=row.status,
                              class_face_id=face_map.get(row.class_face_id),confidence=row.confidence,
                              reason=row.reason,applied=valid)
            if valid:
                accepted.add(student_id)
                face_id=face_map[row.class_face_id]
                assignments.append(dict(face_id=face_id,student_id=student_id,source='local_llm',confidence=row.confidence))
                face=next(item for item in records if item['face_id']==face_id)
                face['llm_student_id']=student_id; face['llm_confidence']=row.confidence
            proposals.append(proposal)
        unexpected=sum(code not in roster_map for code in returned)
        if unexpected or duplicate_roster:
            warnings.append('The local LLM returned duplicate or unknown roster IDs; those rows were left for review.')
        if any(p['reason'].startswith('Local LLM output could not be safely mapped') for p in proposals):
            warnings.append('The local LLM response could not be safely mapped. All affected students remain for teacher review.')
        low_confidence=sum(1 for p in proposals if p['status']=='present' and not p['applied'])
        if low_confidence:
            warnings.append(f'{low_confidence} local LLM match(es) were below the acceptance rule or reused a class face; review them manually.')
        warnings.append(f'Local LLM proposed {len(accepted)} present student(s) using {self.llm.model}. Teacher confirmation is still required.')
        return accepted,assignments,dict(model=self.llm.model,elapsed_seconds=elapsed,
            comparison_sheet=metadata,proposals=proposals),warnings
