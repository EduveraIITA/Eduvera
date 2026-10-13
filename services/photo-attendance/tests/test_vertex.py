from types import SimpleNamespace

from app.config import Settings
from app.llm import VertexGeminiVisionAttendance


class _Models:
    def __init__(self, text):
        self.text = text
        self.calls = []

    def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(text=self.text)


def _adapter(tmp_path, text):
    models = _Models(text)
    client = SimpleNamespace(models=models)
    settings = Settings(
        data_dir=tmp_path / "data",
        models_dir=tmp_path / "models",
        multimodal_provider="vertex",
        gemini_project="eduera-511111",
        gemini_model="gemini-3.1-flash-lite",
    )
    return VertexGeminiVisionAttendance(settings, client=client), models


def test_vertex_uses_structured_json_and_maps_reviewed_presence(tmp_path):
    adapter, models = _adapter(
        tmp_path,
        '{"rows":['
        '{"roster_id":"R001","status":"present","class_face_id":"C001","confidence":0.94,"reason":"clear match"},'
        '{"roster_id":"R002","status":"not_seen","class_face_id":"","confidence":0,"reason":"not visible"}'
        "]}",
    )

    result, _elapsed = adapter.analyze(b"jpeg-bytes", ["R001", "R002"], ["C001"])

    assert [row.status for row in result.rows] == ["present", "not_seen"]
    assert result.rows[0].class_face_id == "C001"
    request = models.calls[0]
    assert request["model"] == "gemini-3.1-flash-lite"
    assert request["config"]["response_mime_type"] == "application/json"
    assert request["config"]["response_json_schema"]["additionalProperties"] is False


def test_vertex_malformed_output_downgrades_every_student_to_review(tmp_path):
    adapter, _models = _adapter(tmp_path, "not-json")

    result, _elapsed = adapter.analyze(b"jpeg-bytes", ["R001", "R002"], ["C001"])

    assert [row.status for row in result.rows] == ["uncertain", "uncertain"]
    assert all(row.class_face_id is None for row in result.rows)
