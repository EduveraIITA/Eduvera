from __future__ import annotations
import base64
import io
import json
import math
import re
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from PIL import Image, ImageDraw, ImageFont, ImageOps, UnidentifiedImageError
from pydantic import ValidationError
from .config import Settings
from .schemas import LLMAttendanceResponse


SHEET_LIMIT = 80
OLLAMA_ATTENDANCE_SCHEMA = {
    'type':'object',
    'properties':{
        'rows':{
            'type':'array',
            'items':{
                'type':'object',
                'properties':{
                    'roster_id':{'type':'string'},
                    'status':{'type':'string','enum':['present','not_seen','uncertain']},
                    'class_face_id':{'type':'string'},
                    'confidence':{'type':'number'},
                    'reason':{'type':'string'},
                },
                'required':['roster_id','status','class_face_id','confidence','reason'],
                'additionalProperties':False,
            },
        },
    },
    'required':['rows'],
    'additionalProperties':False,
}


def _error_text(value) -> str:
    if isinstance(value, dict):
        for key in ('message', 'error', 'detail'):
            if isinstance(value.get(key), str):
                return value[key]
        return json.dumps(value, separators=(',', ':'))
    return str(value)


def is_multimodal_unsupported_error(error: Exception | str) -> bool:
    text = str(error).lower()
    return (
        'does not support multimodal' in text
        or 'multimodal request' in text
        or 'image input' in text and 'not support' in text
    )


def _normalized_code(value, prefix: str) -> str | None:
    text=str(value or '').strip().upper()
    match=re.fullmatch(rf'{prefix}0*(\d{{1,3}})',text)
    if not match: return None
    number=int(match.group(1))
    return f'{prefix}{number:03d}' if 1 <= number <= 999 else None


def _json_object(raw) -> dict:
    if not isinstance(raw,str): raise ValueError('Model content is not text.')
    text=raw.strip()
    try: value=json.loads(text)
    except json.JSONDecodeError:
        if text.startswith('```') and text.endswith('```'):
            text=re.sub(r'^```(?:json)?\s*|\s*```$','',text,flags=re.IGNORECASE)
        else:
            start,end=text.find('{'),text.rfind('}')
            if start < 0 or end <= start: raise ValueError('Model content does not contain JSON.')
            text=text[start:end+1]
        value=json.loads(text)
    if not isinstance(value,dict): raise ValueError('Model JSON must be an object.')
    return value


def parse_attendance_content(raw, roster_ids: list[str], face_ids: list[str]) -> LLMAttendanceResponse:
    """Normalize harmless VLM formatting drift, while downgrading unsafe rows to review."""
    content=_json_object(raw)
    source=content.get('rows')
    if not isinstance(source,list): raise ValueError('Model JSON does not contain an attendance row list.')
    expected_roster=set(roster_ids); expected_faces=set(face_ids); rows=[]
    for item in source[:SHEET_LIMIT]:
        if not isinstance(item,dict): continue
        roster_id=_normalized_code(item.get('roster_id'),'R')
        if roster_id not in expected_roster: continue
        status=str(item.get('status') or '').strip().lower().replace(' ','_')
        if status in {'absent','missing','not_present','not_found'}: status='not_seen'
        if status not in {'present','not_seen','uncertain'}: status='uncertain'
        class_face_id=_normalized_code(item.get('class_face_id'),'C')
        reason=str(item.get('reason') or 'The model provided no explanation.').strip()[:160]
        if not reason: reason='The model provided no explanation.'
        try: confidence=float(item.get('confidence',0))
        except (TypeError,ValueError): confidence=0.0
        if math.isfinite(confidence) and 1 < confidence <= 100: confidence/=100
        if not math.isfinite(confidence) or not 0 <= confidence <= 1: confidence=0.0
        if status!='present':
            class_face_id=None
        elif class_face_id not in expected_faces:
            status,class_face_id,confidence='uncertain',None,0.0
            reason=('Invalid or missing class-face label; teacher review required. '+reason)[:160]
        rows.append(dict(roster_id=roster_id,status=status,class_face_id=class_face_id,
                         confidence=confidence,reason=reason))
    if not rows:
        raise ValueError('No model rows could be mapped to this roster.')
    return LLMAttendanceResponse.model_validate({'rows':rows})


def manual_review_response(roster_ids: list[str], reason: str) -> LLMAttendanceResponse:
    return LLMAttendanceResponse.model_validate({'rows':[
        dict(roster_id=roster_id,status='uncertain',class_face_id=None,confidence=0.0,reason=reason)
        for roster_id in roster_ids]})


def _font(size: int, bold: bool = False):
    names = ['DejaVuSans-Bold.ttf', 'Arial Bold.ttf'] if bold else ['DejaVuSans.ttf', 'Arial.ttf']
    for name in names:
        try: return ImageFont.truetype(name, size)
        except OSError: pass
    return ImageFont.load_default()


def _decode_thumbnail(encoded: str) -> Image.Image:
    try:
        with Image.open(io.BytesIO(base64.b64decode(encoded, validate=True))) as image:
            return image.convert('RGB')
    except (ValueError, OSError, UnidentifiedImageError) as exc:
        raise ValueError('A stored face thumbnail is unreadable.') from exc


def _fit_text(draw: ImageDraw.ImageDraw, text: str, width: int, font) -> str:
    if draw.textbbox((0, 0), text, font=font)[2] <= width: return text
    shortened = text
    while shortened and draw.textbbox((0, 0), shortened + '...', font=font)[2] > width:
        shortened = shortened[:-1]
    return shortened + '...'


def _paste_contained(canvas: Image.Image, image: Image.Image, box: tuple[int, int, int, int]):
    x1, y1, x2, y2 = box
    fitted = ImageOps.contain(image, (x2-x1, y2-y1), Image.Resampling.LANCZOS)
    x = x1 + (x2-x1-fitted.width)//2
    y = y1 + (y2-y1-fitted.height)//2
    canvas.paste(fitted, (x, y))


def build_comparison_sheet(roster: list[dict], faces: list[dict]) -> tuple[bytes, dict]:
    """Create one labeled image: enrollment references left, current detections right."""
    if len(roster) > SHEET_LIMIT or len(faces) > SHEET_LIMIT:
        raise ValueError(f'Local LLM mode supports at most {SHEET_LIMIT} roster students and {SHEET_LIMIT} detected faces per photo.')
    columns, tile_w, tile_h, gap = 4, 218, 196, 12
    panel_pad, header_h = 24, 88
    panel_w = columns*tile_w + (columns-1)*gap + 2*panel_pad
    row_count = max(1, math.ceil(max(len(roster), len(faces))/columns))
    width = panel_w*2
    height = header_h + panel_pad + row_count*tile_h + (row_count-1)*gap + panel_pad
    canvas = Image.new('RGB', (width, height), '#f4f7f3')
    draw = ImageDraw.Draw(canvas)
    heading, label, detail = _font(28, True), _font(18, True), _font(15)

    draw.rectangle((0, 0, panel_w-1, height-1), fill='#f8faf7', outline='#cedbd3')
    draw.rectangle((panel_w, 0, width-1, height-1), fill='#ffffff', outline='#cedbd3')
    draw.text((panel_pad, 24), 'ENROLLED ROSTER', fill='#173a35', font=heading)
    draw.text((panel_w+panel_pad, 24), "TODAY'S DETECTED FACES", fill='#173a35', font=heading)

    def tile_origin(index: int, offset: int):
        row, column = divmod(index, columns)
        return offset + panel_pad + column*(tile_w+gap), header_h + panel_pad + row*(tile_h+gap)

    for index, student in enumerate(roster):
        x, y = tile_origin(index, 0)
        draw.rounded_rectangle((x, y, x+tile_w, y+tile_h), radius=6, fill='#ffffff', outline='#cedbd3')
        draw.text((x+10, y+9), student['roster_id'], fill='#176258', font=label)
        caption = f"{student['roll_number']}  {student['name']}"
        draw.text((x+10, y+34), _fit_text(draw, caption, tile_w-20, detail), fill='#344c48', font=detail)
        thumbs = student.get('thumbnails', [])
        if thumbs:
            image_gap = 6
            image_w = (tile_w-20-image_gap*(len(thumbs)-1))//len(thumbs)
            for photo_index, encoded in enumerate(thumbs):
                left = x+10+photo_index*(image_w+image_gap)
                _paste_contained(canvas, _decode_thumbnail(encoded), (left, y+62, left+image_w, y+tile_h-10))
        else:
            draw.rectangle((x+10, y+62, x+tile_w-10, y+tile_h-10), fill='#e9eeea')
            draw.text((x+29, y+113), 'NO REFERENCE PHOTO', fill='#7b8986', font=detail)

    for index, face in enumerate(faces):
        x, y = tile_origin(index, panel_w)
        draw.rounded_rectangle((x, y, x+tile_w, y+tile_h), radius=6, fill='#f8faf7', outline='#cedbd3')
        draw.text((x+10, y+9), face['class_face_id'], fill='#176258', font=label)
        _paste_contained(canvas, _decode_thumbnail(face['thumbnail']), (x+10, y+39, x+tile_w-10, y+tile_h-10))

    output = io.BytesIO()
    canvas.save(output, format='JPEG', quality=91, optimize=True)
    return output.getvalue(), {'width': width, 'height': height, 'roster_count': len(roster), 'face_count': len(faces)}


class OllamaVisionAttendance:
    def __init__(self, cfg: Settings):
        self.url = cfg.ollama_url.rstrip('/')
        self.model = cfg.ollama_model
        self.timeout = cfg.ollama_timeout_seconds

    def _request(self, path: str, payload: dict | None = None, timeout: float | None = None):
        data = json.dumps(payload, separators=(',', ':')).encode() if payload is not None else None
        request = Request(self.url+path, data=data, headers={'Content-Type': 'application/json'},
                          method='POST' if data is not None else 'GET')
        try:
            with urlopen(request, timeout=timeout or self.timeout) as response:
                return json.loads(response.read())
        except HTTPError as exc:
            try: detail = json.loads(exc.read()).get('error')
            except (ValueError, AttributeError): detail = None
            raise RuntimeError(_error_text(detail) if detail else f'Local Ollama request failed with HTTP {exc.code}.') from exc
        except (URLError, TimeoutError, OSError) as exc:
            raise RuntimeError('Local Ollama is not available. Start Ollama and try again, or turn off Local LLM attendance.') from exc
        except json.JSONDecodeError as exc:
            raise RuntimeError('Local Ollama returned an unreadable response.') from exc

    def status(self) -> dict:
        try:
            payload = self._request('/api/tags', timeout=1.5)
            names = {row.get('name') or row.get('model') for row in payload.get('models', [])}
            installed = self.model in names or self.model+':latest' in names
            if not installed:
                return {'available': True, 'installed': False, 'supports_images': False, 'model': self.model}
            try:
                info = self._request('/api/show', {'model': self.model}, timeout=1.5)
            except RuntimeError as exc:
                return {'available': True, 'installed': True, 'supports_images': False,
                        'model': self.model, 'detail': f'Could not verify image support for {self.model}: {exc}'}
            capabilities = info.get('capabilities') if isinstance(info, dict) else None
            supports_images = any(str(item).lower() in {'vision', 'multimodal', 'image'} for item in capabilities or [])
            if not supports_images:
                return {'available': True, 'installed': True, 'supports_images': False,
                        'model': self.model, 'detail': f'The local model {self.model} does not support image input.'}
            return {'available': True, 'installed': True, 'supports_images': True, 'model': self.model}
        except RuntimeError as exc:
            return {'available': False, 'installed': False, 'supports_images': False, 'model': self.model, 'detail': str(exc)}

    def analyze(self, image: bytes, roster_ids: list[str], face_ids: list[str]):
        schema = OLLAMA_ATTENDANCE_SCHEMA
        prompt = (
            'This is a local, teacher-reviewed attendance comparison sheet. The left panel contains enrolled '
            'students labeled R001, R002, and so on; a student may have multiple reference angles in one tile. '
            "The right panel contains faces detected in today's class photo labeled C001, C002, and so on. "
            'Match facial identity only. Names and roll numbers are labels, not visual evidence. Use each C code '
            'at most once. Mark present only for a clear visual identity match. Use uncertain for a possible match '
            'and not_seen when there is no reasonable candidate. Return one row for every roster ID. '
            f'Roster IDs: {", ".join(roster_ids)}. Class face IDs: {", ".join(face_ids)}. '
            'For not_seen or uncertain, class_face_id must be an empty string. Confidence is your visual-match '
            'confidence from 0 to 1; it is not a calibrated probability. '
            'Return JSON that exactly follows this schema: '+json.dumps(schema, separators=(',', ':'))
        )
        started = time.perf_counter()
        messages = [{'role': 'user', 'content': prompt,
                     'images': [base64.b64encode(image).decode('ascii')]}]
        request = {
            'model': self.model,
            'messages': messages,
            'format': schema,
            'stream': False,
            'think': False,
            'keep_alive': '10m',
            'options': {'temperature': 0, 'seed': 0, 'num_ctx': 16384},
        }
        for attempt in range(2):
            payload = self._request('/api/chat', request)
            raw=payload.get('message',{}).get('content','') if isinstance(payload,dict) else ''
            try:
                return parse_attendance_content(raw,roster_ids,face_ids),round(time.perf_counter()-started,3)
            except (ValueError,ValidationError,json.JSONDecodeError):
                if attempt:
                    fallback=manual_review_response(roster_ids,'Local LLM output could not be safely mapped; teacher review required.')
                    return fallback,round(time.perf_counter()-started,3)
                messages.extend([
                    {'role':'assistant','content':raw[:8000]},
                    {'role':'user','content':'Correct the response. Return only the required JSON object, one row for every roster ID. Use an empty class_face_id unless status is present.'},
                ])
        raise AssertionError('unreachable')
