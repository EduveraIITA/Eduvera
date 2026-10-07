from __future__ import annotations

import asyncio
import contextlib
import secrets
from contextlib import asynccontextmanager
from datetime import date
from typing import Annotated

import cv2
from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .config import Settings
from .middleware import BoundedBodyMiddleware
from .schemas import ClassCreate, MatchConfig, StudentCreate
from .service import AttendanceService, BusyError
from .store import ConflictError, Store


def parse_config(raw: str) -> MatchConfig:
    try:
        return MatchConfig.model_validate_json(raw)
    except ValidationError as exc:
        raise ValueError(f"Invalid matching settings: {exc}") from exc


async def image_bytes(file: UploadFile, limit: int) -> bytes:
    try:
        data = await file.read(limit + 1)
    finally:
        await file.close()
    if len(data) > limit:
        raise ValueError("Uploaded image exceeds the 24 MB limit.")
    return data


def create_app(settings: Settings | None = None, backend=None, llm_client=None) -> FastAPI:
    cfg = settings or Settings()
    store = Store(cfg)
    service = AttendanceService(cfg, store, backend, llm_client)

    async def expiry_loop():
        while True:
            await asyncio.sleep(3600)
            await run_in_threadpool(store.purge_expired)

    @asynccontextmanager
    async def lifespan(_app):
        task = asyncio.create_task(expiry_loop())
        yield
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    app = FastAPI(
        title="Edura photo attendance inference",
        version="0.1.0",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.store = store
    app.state.service = service
    app.add_middleware(BoundedBodyMiddleware, max_bytes=cfg.max_request_bytes)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=cfg.allowed_hosts)

    @app.middleware("http")
    async def protect(request: Request, call_next):
        if request.url.path != "/api/health":
            supplied = request.headers.get("authorization", "")
            expected = "Bearer " + store.token
            if not secrets.compare_digest(supplied.encode("utf-8"), expected.encode("utf-8")):
                return JSONResponse(
                    {"detail": "Inference service credentials were not accepted."},
                    status_code=401,
                    headers={"Cache-Control": "no-store"},
                )
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        return response

    @app.exception_handler(KeyError)
    async def missing(_request, exc):
        return JSONResponse({"detail": str(exc).strip("'")}, status_code=404)

    @app.exception_handler(ConflictError)
    async def conflict(_request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=409)

    @app.exception_handler(ValueError)
    async def invalid(_request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=422)

    @app.exception_handler(FileNotFoundError)
    async def models_missing(_request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=503)

    @app.exception_handler(BusyError)
    async def busy(_request, exc):
        return JSONResponse(
            {"detail": str(exc)}, status_code=503, headers={"Retry-After": "3"}
        )

    @app.exception_handler(RuntimeError)
    async def runtime_error(_request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=503)

    @app.exception_handler(cv2.error)
    async def vision_error(_request, _exc):
        return JSONResponse(
            {
                "detail": "The face engine could not process this image. Try a clearer photo or verify the local models."
            },
            status_code=503,
        )

    @app.get("/api/health")
    def health():
        return service.health()

    @app.get("/api/llm/status")
    def llm_status():
        return service.llm_status()

    @app.get("/api/classes")
    def classes():
        store.purge_expired()
        return store.classes()

    @app.post("/api/classes", status_code=201)
    def create_class(payload: ClassCreate):
        return store.class_create(payload.name)

    @app.get("/api/classes/{class_id}/students")
    def students(class_id: str):
        active_model = service._backend.model_id if service._backend is not None else None
        return store.students(class_id, active_model)

    @app.post("/api/classes/{class_id}/students", status_code=201)
    def create_student(class_id: str, payload: StudentCreate):
        return store.students_create(class_id, [payload])[0]

    @app.post("/api/students/{student_id}/samples")
    async def enroll(
        student_id: str,
        files: Annotated[list[UploadFile], File()],
        config: Annotated[str, Form()] = "{}",
    ):
        if not 1 <= len(files) <= 10:
            raise ValueError("Upload 1-10 individual photos.")
        try:
            return await run_in_threadpool(
                service.enroll,
                student_id,
                [file.file for file in files],
                parse_config(config),
            )
        finally:
            for file in files:
                await file.close()

    @app.delete("/api/students/{student_id}/samples", status_code=204)
    def clear_samples(student_id: str):
        with service.exclusive():
            store.delete_templates(student_id)
        return Response(status_code=204)

    @app.post("/api/classes/{class_id}/sessions", status_code=201)
    async def analyze(
        class_id: str,
        file: Annotated[UploadFile, File()],
        attendance_date: Annotated[date, Form()],
        authorized: Annotated[bool, Form()],
        period: Annotated[str, Form()] = "Daily attendance",
        config: Annotated[str, Form()] = "{}",
        use_llm: Annotated[bool, Form()] = False,
    ):
        if not authorized:
            raise ValueError("Record the approved capture authority before processing.")
        if not 1 <= len(period.strip()) <= 100:
            raise ValueError("Period must contain 1-100 characters.")
        data = await image_bytes(file, cfg.max_upload_bytes)
        return await run_in_threadpool(
            service.analyze,
            class_id,
            attendance_date.isoformat(),
            period.strip(),
            data,
            parse_config(config),
            use_llm,
        )

    @app.get("/api/sessions/{session_id}")
    def session(session_id: str):
        return store.session_get(session_id)

    @app.delete("/api/sessions/{session_id}", status_code=204)
    def delete_session(session_id: str):
        store.session_delete(session_id)
        return Response(status_code=204)

    return app


app = create_app()
