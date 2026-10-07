from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, Field, ConfigDict, field_validator, model_validator

class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)

class MatchConfig(StrictModel):
    # Starting values, NOT calibrated probabilities or a guaranteed accuracy level.
    accept_threshold: float = Field(0.55, ge=0.0, le=1.0)
    review_threshold: float = Field(0.30, ge=-1.0, le=1.0)
    margin: float = Field(0.08, ge=0.0, le=1.0)
    conflict_margin: float = Field(0.05, ge=0.0, le=1.0)
    min_face_pixels: int = Field(48, ge=24, le=300)
    min_blur: float = Field(30.0, ge=0, le=1000)
    max_roll_degrees: float = Field(35, ge=0, le=90)
    max_pose_asymmetry: float = Field(0.85, ge=0.1, le=2.0)
    # YuNet's confidence is a detector signal, not identity confidence. A 0.75
    # floor retains usable large/sharp faces while similarity, margin and
    # competing-face checks remain responsible for automatic identity proposals.
    min_detection_score: float = Field(0.75, ge=0, le=1)

    @model_validator(mode='after')
    def thresholds(self):
        if self.review_threshold > self.accept_threshold:
            raise ValueError('review_threshold cannot exceed accept_threshold')
        return self

class ClassCreate(StrictModel):
    name: str = Field(min_length=1, max_length=100)

class StudentCreate(StrictModel):
    roll_number: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=120)
    authorization_record: str = Field(min_length=3, max_length=500)
    authorized: bool

    @field_validator('authorized')
    @classmethod
    def must_authorize(cls, value):
        if not value:
            raise ValueError('Record appropriate authorization before enrolling anyone.')
        return value

class ReviewRow(StrictModel):
    student_id: str
    status: Literal['present', 'absent', 'late', 'excused']

class ReviewRequest(StrictModel):
    version: int = Field(ge=1)
    confirmed_by: str = Field(min_length=1, max_length=100)
    reviewed: bool
    rows: list[ReviewRow] = Field(min_length=1, max_length=200)

class GroundTruth(StrictModel):
    # Record this independently of the model. Face keys are e.g. f001.
    present_student_ids: list[str] = Field(max_length=200)
    face_labels: dict[str, str | None]

class LLMAttendanceRow(StrictModel):
    roster_id: str = Field(pattern=r'^R\d{3}$')
    status: Literal['present', 'not_seen', 'uncertain']
    class_face_id: str | None = Field(default=None, pattern=r'^C\d{3}$')
    confidence: float = Field(ge=0, le=1)
    reason: str = Field(min_length=1, max_length=160)

    @model_validator(mode='after')
    def present_requires_face(self):
        if self.status == 'present' and self.class_face_id is None:
            raise ValueError('A present proposal requires a class face ID.')
        if self.status != 'present' and self.class_face_id is not None:
            raise ValueError('Only present proposals may include a class face ID.')
        return self

class LLMAttendanceResponse(StrictModel):
    rows: list[LLMAttendanceRow] = Field(min_length=1, max_length=80)
