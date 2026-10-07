"""Evaluate frozen automatic decisions, never teacher-corrected labels."""
from __future__ import annotations
import math
from .schemas import GroundTruth

def wilson(successes: int, total: int, z: float=1.96):
    if total==0: return None
    p=successes/total; denominator=1+z*z/total
    center=(p+z*z/(2*total))/denominator
    half=z*math.sqrt(p*(1-p)/total+z*z/(4*total*total))/denominator
    return [max(0,center-half),min(1,center+half)]

def ratio(a,b): return a/b if b else None

def evaluate(result: dict, truth: GroundTruth) -> dict:
    roster={s['id'] for s in result['roster']}
    present=set(truth.present_student_ids)
    if len(present)!=len(truth.present_student_ids) or not present<=roster:
        raise ValueError('Ground truth contains duplicate or non-roster present IDs.')
    face_ids={f['face_id'] for f in result['faces']}
    if set(truth.face_labels)!=face_ids:
        raise ValueError('Label every detected face exactly once. Use null for a visitor or false detection.')
    labels=[v for v in truth.face_labels.values() if v is not None]
    if not set(labels)<=present:
        raise ValueError('Every labeled student must also be in the independently recorded present list.')
    # Duplicate labels can reveal duplicate detections; do not silently discard them.
    accepted=result.get('automatic_assignments')
    if accepted is None:
        accepted=[f for f in result['faces'] if f['state']=='auto']
    correct=[f for f in accepted if truth.face_labels[f['face_id']]==f['student_id']]
    correct_ids={f['student_id'] for f in correct}
    accepted_ids={f['student_id'] for f in accepted}
    seen_correct_attendance=accepted_ids & present
    return dict(
        auto_identity_precision=ratio(len(correct),len(accepted)),
        auto_identity_precision_ci95=wilson(len(correct),len(accepted)),
        end_to_end_auto_recall=ratio(len(correct_ids),len(present)),
        end_to_end_auto_recall_ci95=wilson(len(correct_ids),len(present)),
        auto_attendance_precision=ratio(len(seen_correct_attendance),len(accepted_ids)),
        review_fraction=ratio(len(roster)-len(accepted_ids),len(roster)),
        counts=dict(automatic_face_assignments=len(accepted),correct_face_assignments=len(correct),
                    correctly_identified_present_students=len(correct_ids),actually_present=len(present),
                    roster_size=len(roster),detected_faces=len(face_ids),
                    duplicate_ground_truth_face_labels=len(labels)-len(set(labels))),
        caveats=['Confidence intervals are per-observation approximations; classroom/day correlations reduce effective sample size.',
                 'Attendance precision alone can hide two present students being swapped. Use identity precision.',
                 'This does not measure face-detection recall or verify capture freshness/liveness.'])
