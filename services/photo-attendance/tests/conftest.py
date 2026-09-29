from __future__ import annotations

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.schemas import LLMAttendanceResponse
from app.vision import Detection

TOKEN = "synthetic-test-token-not-for-deployment-2026"


class SyntheticVisionLlm:
    model = "synthetic-vision-only"

    def status(self):
        return {"available": True, "installed": True, "supports_images": True, "model": self.model}

    def analyze(self, _image, roster_ids, face_ids):
        rows = []
        for index, roster_id in enumerate(roster_ids):
            rows.append({
                "roster_id": roster_id,
                "status": "present" if index == 0 and face_ids else "not_seen",
                "class_face_id": face_ids[0] if index == 0 and face_ids else None,
                "confidence": 0.93 if index == 0 and face_ids else 0.0,
                "reason": "Synthetic visual comparison for contract testing.",
            })
        return LLMAttendanceResponse.model_validate({"rows": rows}), 0.01


class SyntheticNonVisionLlm:
    model = "synthetic-text-only"

    def status(self):
        return {
            "available": True,
            "installed": True,
            "supports_images": False,
            "model": self.model,
            "detail": "The local model synthetic-text-only does not support image input.",
        }

    def analyze(self, _image, _roster_ids, _face_ids):
        raise AssertionError("Non-vision local models must not receive image requests.")


class SyntheticFailingVisionLlm:
    model = "synthetic-vision-broken"

    def status(self):
        return {"available": True, "installed": True, "supports_images": True, "model": self.model}

    def analyze(self, _image, _roster_ids, _face_ids):
        raise RuntimeError('{"code":400,"message":"Multimodal data provided, but model does not support multimodal requests.","type":"invalid_request_error"}')


class SyntheticBackend:
    """Deterministic test doubles only; no face recognition is performed."""

    model_id = "synthetic-only-v1"

    def detect(self, image):
        signal = int(image[0, 0, 0])
        if signal == 0:
            return []
        if signal == 10:
            return [self.geometry(20, 30, 100), self.geometry(165, 30, 100)]
        if signal == 30:
            outer = self.geometry(40, 20, 180)
            inner = self.geometry(105, 85, 55)
            outer.score = 0.77
            inner.score = 0.91
            return [outer, inner]
        face = self.geometry(50, 45, 110)
        if signal in (20, 21):
            face.score = 0.78
        return [face]

    @staticmethod
    def geometry(x, y, size):
        landmarks = np.array(
            [
                [x + 0.30 * size, y + 0.35 * size],
                [x + 0.70 * size, y + 0.35 * size],
                [x + 0.50 * size, y + 0.57 * size],
                [x + 0.35 * size, y + 0.77 * size],
                [x + 0.65 * size, y + 0.77 * size],
            ],
            np.float32,
        )
        return Detection(np.array([x, y, x + size, y + size], np.float32), landmarks, 0.99)

    def embed(self, image, face):
        signal = int(image[0, 0, 0])
        index = (0 if face.box[0] < 100 else 1) if signal == 10 else (signal - 1) % 4
        vector = np.zeros(4, np.float32)
        vector[index] = 1
        return vector


def picture(signal=1, width=320, height=240):
    image = np.random.default_rng(7).integers(20, 230, (height, width, 3), dtype=np.uint8)
    image[0, 0, 0] = signal
    ok, buffer = cv2.imencode(".png", image)
    assert ok
    return buffer.tobytes()


@pytest.fixture
def client(tmp_path):
    settings = Settings(
        data_dir=tmp_path / "data",
        models_dir=tmp_path / "models",
        api_token=TOKEN,
    )
    with TestClient(
        create_app(settings, SyntheticBackend()),
        headers={"Authorization": "Bearer " + TOKEN},
    ) as test_client:
        yield test_client


@pytest.fixture
def llm_client(tmp_path):
    settings = Settings(
        data_dir=tmp_path / "llm-data",
        models_dir=tmp_path / "models",
        api_token=TOKEN,
    )
    with TestClient(
        create_app(settings, SyntheticBackend(), SyntheticVisionLlm()),
        headers={"Authorization": "Bearer " + TOKEN},
    ) as test_client:
        yield test_client


@pytest.fixture
def non_vision_llm_client(tmp_path):
    settings = Settings(
        data_dir=tmp_path / "non-vision-llm-data",
        models_dir=tmp_path / "models",
        api_token=TOKEN,
    )
    with TestClient(
        create_app(settings, SyntheticBackend(), SyntheticNonVisionLlm()),
        headers={"Authorization": "Bearer " + TOKEN},
    ) as test_client:
        yield test_client


@pytest.fixture
def failing_llm_client(tmp_path):
    settings = Settings(
        data_dir=tmp_path / "failing-llm-data",
        models_dir=tmp_path / "models",
        api_token=TOKEN,
    )
    with TestClient(
        create_app(settings, SyntheticBackend(), SyntheticFailingVisionLlm()),
        headers={"Authorization": "Bearer " + TOKEN},
    ) as test_client:
        yield test_client


@pytest.fixture
def seeded(client):
    classroom = client.post("/api/classes", json={"name": "Synthetic Class 7A"}).json()
    students = []
    for index in range(1, 4):
        student = client.post(
            f"/api/classes/{classroom['id']}/students",
            json={
                "roll_number": f"{index:02d}",
                "name": f"Test student {index}",
                "authorization_record": "Synthetic test authorization",
                "authorized": True,
            },
        ).json()
        response = client.post(
            f"/api/students/{student['id']}/samples",
            files=[("files", (f"{index}.png", picture(index), "image/png"))],
        )
        assert response.status_code == 200, response.text
        students.append(student)
    return classroom, students
