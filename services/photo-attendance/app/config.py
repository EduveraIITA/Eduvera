from __future__ import annotations
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]

@dataclass
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.getenv('DATA_DIR', ROOT / 'data')))
    models_dir: Path = field(default_factory=lambda: Path(os.getenv('MODELS_DIR', ROOT / 'models')))
    backend: str = field(default_factory=lambda: os.getenv('FACE_BACKEND', 'opencv'))
    api_token: str | None = field(default_factory=lambda: os.getenv('ATTENDANCE_API_TOKEN'))
    encryption_key: str | None = field(default_factory=lambda: os.getenv('ATTENDANCE_ENCRYPTION_KEY'))
    max_upload_bytes: int = 24 * 1024 * 1024
    max_request_bytes: int = 128 * 1024 * 1024
    max_pixels: int = 50_000_000
    max_students: int = 200
    max_templates: int = 10
    retention_days: int = field(default_factory=lambda: int(os.getenv('SESSION_RETENTION_DAYS', '7')))
    tile_size: int = 1024
    tile_overlap: float = 0.22
    max_tiles: int = 100
    # Detect broadly, then apply the stricter, purpose-specific quality gate in
    # `quality()`. Keeping these concerns separate lets enrollment accept a
    # useful three-quarter reference without weakening classroom auto-matches.
    detection_threshold: float = field(default_factory=lambda: float(os.getenv('FACE_DETECTION_THRESHOLD', '0.60')))
    allowed_hosts: list[str] = field(default_factory=lambda: os.getenv(
        'ALLOWED_HOSTS', 'localhost,127.0.0.1,[::1],testserver').split(','))
    onnx_providers: list[str] = field(default_factory=lambda: os.getenv(
        'ONNX_PROVIDERS', 'CPUExecutionProvider').split(','))
    ollama_url: str = field(default_factory=lambda: os.getenv('OLLAMA_URL', 'http://127.0.0.1:11434'))
    ollama_model: str = field(default_factory=lambda: os.getenv('OLLAMA_MODEL', 'qwen3-vl:4b-instruct'))
    ollama_timeout_seconds: int = field(default_factory=lambda: int(os.getenv('OLLAMA_TIMEOUT_SECONDS', '240')))
    max_llm_faces: int = 80
    llm_accept_confidence: float = 0.60

    def __post_init__(self):
        self.data_dir = Path(self.data_dir)
        self.models_dir = Path(self.models_dir)
        if self.backend not in {'opencv', 'scrfd_arcface'}:
            raise ValueError('FACE_BACKEND must be opencv or scrfd_arcface.')
        if not 0.1 <= self.detection_threshold <= 1:
            raise ValueError('FACE_DETECTION_THRESHOLD must be between 0.1 and 1.')
        if not 1 <= self.retention_days <= 365:
            raise ValueError('SESSION_RETENTION_DAYS must be 1–365.')
        if self.api_token and len(self.api_token) < 24:
            raise ValueError('ATTENDANCE_API_TOKEN must have at least 24 characters.')
        parsed = urlparse(self.ollama_url)
        if parsed.scheme != 'http' or parsed.hostname not in {'127.0.0.1', 'localhost', '::1', 'host.docker.internal'} or parsed.username or parsed.query:
            raise ValueError('OLLAMA_URL must be a local HTTP endpoint.')
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/-]*(?::[A-Za-z0-9._-]+)?', self.ollama_model):
            raise ValueError('OLLAMA_MODEL contains unsupported characters.')
        if not 10 <= self.ollama_timeout_seconds <= 900:
            raise ValueError('OLLAMA_TIMEOUT_SECONDS must be 10-900.')
