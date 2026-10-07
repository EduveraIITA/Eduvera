"""Constrained proposals with an UNKNOWN alternative and conservative auto-acceptance.

Assignment optimizes *proposals*. It never turns an otherwise ambiguous face into
an automatic identity merely because another identity was allocated elsewhere.
"""
from __future__ import annotations
import numpy as np
from scipy.optimize import linear_sum_assignment
from .schemas import MatchConfig

def normalize(vector: np.ndarray) -> np.ndarray:
    vector = np.asarray(vector, dtype=np.float32).reshape(-1)
    length = float(np.linalg.norm(vector.astype(np.float64)))
    if not np.all(np.isfinite(vector)) or not np.isfinite(length) or length < 1e-8:
        raise ValueError('Invalid or zero face embedding.')
    return (vector.astype(np.float64) / length).astype(np.float32)

def similarity_matrix(queries: list[np.ndarray], galleries: list[list[np.ndarray]]) -> np.ndarray:
    result = np.full((len(queries), len(galleries)), -1.0, dtype=np.float32)
    if not queries:
        return result
    q = np.stack([normalize(x) for x in queries])
    for j, templates in enumerate(galleries):
        if templates:
            g = np.stack([normalize(x) for x in templates])
            if g.shape[1] != q.shape[1]:
                raise ValueError('Embedding dimensions differ; re-enroll with the active model.')
            # The max-template score must be calibrated at the actual gallery size.
            result[:, j] = np.clip((q @ g.T).max(axis=1), -1, 1)
    return result

def assign(scores: np.ndarray, quality_ok: list[bool], student_ids: list[str], cfg: MatchConfig) -> list[dict]:
    scores = np.asarray(scores, dtype=np.float64)
    if scores.ndim != 2 or scores.shape[1] != len(student_ids):
        raise ValueError('Expected a faces × students similarity matrix.')
    n, m = scores.shape
    if len(quality_ok) != n or len(set(student_ids)) != m:
        raise ValueError('Quality flags or student IDs are inconsistent.')
    if not np.isfinite(scores).all() or np.any(np.abs(scores) > 1.00001):
        raise ValueError('Similarity values must be finite and between -1 and 1.')
    if n == 0:
        return []
    # Each face gets a private dummy column worth zero: no forced roster match.
    utility = np.full((n, m + n), -1e6, dtype=float)
    eligible = scores >= cfg.review_threshold
    utility[:, :m] = np.where(eligible, scores - cfg.review_threshold + 1e-9, -1e6)
    utility[np.arange(n), m + np.arange(n)] = 0
    rows, cols = linear_sum_assignment(utility, maximize=True)
    chosen = dict(zip(rows.tolist(), cols.tolist()))
    result = []
    for i in range(n):
        order = np.argsort(-scores[i], kind='stable') if m else np.array([], dtype=int)
        candidates = [dict(student_id=student_ids[j], score=round(float(scores[i,j]), 6))
                      for j in order[:3] if scores[i,j] >= cfg.review_threshold]
        j = chosen[i]
        proposed = j < m and eligible[i, j]
        record = dict(student_id=student_ids[j] if proposed else None,
                      state='unknown', score=None, margin=None,
                      conflict_margin=None, candidates=candidates, reasons=[])
        if proposed:
            value = float(scores[i, j])
            alternatives = np.delete(scores[i], j)
            gap = value - float(alternatives.max()) if alternatives.size else 2.0
            # Low-quality duplicate detections also block automatic acceptance.
            rivals = np.delete(scores[:, j], i)
            conflict_gap = value - float(rivals.max()) if rivals.size else 2.0
            reasons = []
            if not quality_ok[i]: reasons.append('capture_quality')
            if value < cfg.accept_threshold: reasons.append('similarity_below_acceptance')
            if int(order[0]) != j or gap < cfg.margin: reasons.append('identity_ambiguity')
            if conflict_gap < cfg.conflict_margin: reasons.append('competing_face')
            record.update(state='review' if reasons else 'auto', score=round(value, 6),
                          margin=round(gap, 6), conflict_margin=round(conflict_gap, 6), reasons=reasons)
        elif not quality_ok[i]:
            record.update(state='low_quality', reasons=['capture_quality', 'no_safe_assignment'])
        else:
            record['reasons'] = ['no_safe_assignment']
        result.append(record)
    return result
