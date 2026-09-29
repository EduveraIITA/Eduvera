import asyncio
from tempfile import SpooledTemporaryFile

from starlette.concurrency import run_in_threadpool
from starlette.datastructures import Headers
from starlette.responses import JSONResponse


class BoundedBodyMiddleware:
    """Bound uploads before multipart parsing without keeping whole bodies in RAM."""

    def __init__(self, app, max_bytes, max_in_flight=2, read_timeout=30):
        self.app = app
        self.max_bytes = max_bytes
        self.max_in_flight = max_in_flight
        self.in_flight = 0
        self.read_timeout = read_timeout

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope['method'] not in {'POST', 'PUT', 'PATCH'}:
            return await self.app(scope, receive, send)

        async def reject(detail, status, headers=None):
            await JSONResponse({'detail': detail}, status_code=status, headers=headers)(scope, receive, send)

        length = Headers(scope=scope).get('content-length')
        if length is not None:
            if not length.isascii() or not length.isdecimal():
                return await reject('Invalid Content-Length.', 400)
            if int(length) > self.max_bytes:
                return await reject('Request exceeds the upload limit.', 413)
        if self.in_flight >= self.max_in_flight:
            return await reject('Another upload is processing. Retry shortly.', 503, {'Retry-After': '3'})

        self.in_flight += 1
        try:
            # Spill above 1 MB; all disk I/O stays off the event loop. The slot is
            # held through processing so concurrent uploads cannot accumulate.
            with SpooledTemporaryFile(max_size=1024 * 1024) as body:
                total = 0
                while True:
                    try:
                        message = await asyncio.wait_for(receive(),timeout=self.read_timeout)
                    except asyncio.TimeoutError:
                        return await reject('Upload stalled. Check your connection and retry.',408)
                    if message['type'] == 'http.disconnect':
                        return
                    chunk = message.get('body', b'')
                    total += len(chunk)
                    if total > self.max_bytes:
                        return await reject('Request exceeds the upload limit.', 413)
                    await run_in_threadpool(body.write, chunk)
                    if not message.get('more_body', False):
                        break
                await run_in_threadpool(body.seek, 0)
                remaining = total
                finished = False

                async def replay():
                    nonlocal remaining, finished
                    if finished:
                        return await receive()
                    chunk = await run_in_threadpool(body.read, min(64 * 1024, remaining))
                    remaining -= len(chunk)
                    finished = remaining == 0
                    return {'type': 'http.request', 'body': chunk, 'more_body': not finished}

                await self.app(scope, replay, send)
        finally:
            self.in_flight -= 1
