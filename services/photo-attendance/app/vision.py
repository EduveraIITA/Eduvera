from __future__ import annotations
import base64
import hashlib
import io
import math
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol
import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError
from pillow_heif import register_heif_opener
from .config import Settings
from .matching import normalize
from .schemas import MatchConfig

register_heif_opener()

SUPPORTED_IMAGE_FORMATS = {'JPEG', 'PNG', 'WEBP', 'HEIF'}

@dataclass
class Detection:
    box: np.ndarray                 # x1,y1,x2,y2 in original image coordinates
    landmarks: np.ndarray           # 5 × 2: eye, eye, nose, mouth, mouth
    score: float

class Backend(Protocol):
    model_id: str
    def detect(self, image: np.ndarray) -> list[Detection]: ...
    def embed(self, image: np.ndarray, face: Detection) -> np.ndarray: ...

def decode_image(data: bytes, cfg: Settings) -> np.ndarray:
    if not data or len(data) > cfg.max_upload_bytes:
        raise ValueError('Image is empty or exceeds the 24 MB per-image limit.')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as source:
                if source.format not in SUPPORTED_IMAGE_FORMATS:
                    raise ValueError('Use JPEG, PNG, WebP, HEIC or HEIF.')
                if getattr(source, 'n_frames', 1) != 1:
                    raise ValueError('Animated images are not supported.')
                if source.width * source.height > cfg.max_pixels or min(source.size) < 32:
                    raise ValueError('Image must be at least 32×32 and no more than 50 megapixels.')
                image = ImageOps.exif_transpose(source).convert('RGB')
                array = np.asarray(image)
        return cv2.cvtColor(array, cv2.COLOR_RGB2BGR)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ValueError('Unsupported, corrupt, or oversized image.') from exc

def fingerprint(paths: list[Path], prefix: str) -> str:
    digest = hashlib.sha256(prefix.encode())
    for path in paths:
        if not path.is_file():
            raise FileNotFoundError(f'Missing model: {path.name}. Run scripts/download_models.py, or install licensed ONNX weights.')
        with path.open('rb') as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(chunk)
    return f'{prefix}:{digest.hexdigest()[:24]}'

def nms(faces: list[Detection], threshold: float = .40) -> list[Detection]:
    if not faces: return []
    boxes = np.stack([f.box for f in faces]).astype(float)
    order = np.argsort(-np.array([f.score for f in faces]), kind='stable')
    areas = np.maximum(0, boxes[:, 2]-boxes[:, 0]) * np.maximum(0, boxes[:, 3]-boxes[:, 1])
    kept = []
    while order.size:
        i = int(order[0]); kept.append(i)
        other = order[1:]
        if not other.size: break
        lo = np.maximum(boxes[i, :2], boxes[other, :2])
        hi = np.minimum(boxes[i, 2:], boxes[other, 2:])
        inter = np.maximum(0, hi-lo).prod(axis=1)
        iou = inter / np.maximum(1e-9, areas[i] + areas[other] - inter)
        order = other[iou <= threshold]
    return [faces[i] for i in kept]

def suppress_nested_detections(
    faces: list[Detection], containment_threshold: float = .90, max_area_ratio: float = .35
) -> list[Detection]:
    """Remove small facial-region detections nested inside a full-face box.

    Ordinary IoU NMS does not remove a nose/eye false positive because its area is
    small compared with the containing face. Two real people can overlap, so this
    rule only removes the smaller box when almost all of it is inside a box at
    least ~3x larger. The larger face wins regardless of detector score.
    """
    if len(faces) < 2:
        return faces
    boxes = np.stack([face.box for face in faces]).astype(float)
    areas = np.maximum(0, boxes[:, 2] - boxes[:, 0]) * np.maximum(0, boxes[:, 3] - boxes[:, 1])
    removed: set[int] = set()
    for first in range(len(faces)):
        for second in range(first + 1, len(faces)):
            if first in removed or second in removed:
                continue
            if areas[first] <= 0 or areas[second] <= 0:
                continue
            small, large = (first, second) if areas[first] < areas[second] else (second, first)
            area_ratio = areas[small] / areas[large]
            if area_ratio > max_area_ratio:
                continue
            lo = np.maximum(boxes[small, :2], boxes[large, :2])
            hi = np.minimum(boxes[small, 2:], boxes[large, 2:])
            intersection = float(np.maximum(0, hi - lo).prod())
            if intersection / areas[small] >= containment_threshold:
                removed.add(small)
    return [face for index, face in enumerate(faces) if index not in removed]

def tile_origins(length: int, size: int, overlap: float) -> list[int]:
    if length <= size: return [0]
    step = max(1, int(size * (1 - overlap)))
    return sorted(set(list(range(0, length-size+1, step)) + [length-size]))

def detect_tiled(image: np.ndarray, backend: Backend, cfg: Settings) -> tuple[list[Detection], int]:
    height, width = image.shape[:2]
    xs = tile_origins(width, cfg.tile_size, cfg.tile_overlap)
    ys = tile_origins(height, cfg.tile_size, cfg.tile_overlap)
    if len(xs) * len(ys) > cfg.max_tiles:
        raise ValueError('Image needs too many detector tiles; reduce its resolution or capture a smaller area.')
    scale = min(1.0, 1280 / max(height, width))
    overview = cv2.resize(image, (max(1,round(width*scale)), max(1,round(height*scale)))) if scale < 1 else image
    sx, sy = overview.shape[1] / width, overview.shape[0] / height
    found = []
    for face in backend.detect(overview):
        found.append(Detection(face.box / [sx,sy,sx,sy], face.landmarks / [sx,sy], face.score))
    calls = 1
    if max(height, width) > cfg.tile_size:
        for y in ys:
            for x in xs:
                crop = image[y:min(y+cfg.tile_size,height), x:min(x+cfg.tile_size,width)]
                for face in backend.detect(crop):
                    found.append(Detection(face.box+[x,y,x,y], face.landmarks+[x,y], face.score))
                calls += 1
    valid = []
    for face in found:
        if not np.isfinite(face.box).all() or not np.isfinite(face.landmarks).all(): continue
        if not np.isfinite(face.score) or not 0<=face.score<=1: continue
        face.box = np.clip(face.box, [0,0,0,0], [width,height,width,height]).astype(np.float32)
        if face.box[2]-face.box[0] >= 4 and face.box[3]-face.box[1] >= 4:
            valid.append(face)
    faces = sorted(suppress_nested_detections(nms(valid)), key=lambda f: (float(f.box[1]),float(f.box[0])))
    if len(faces) > 250:
        raise ValueError('More than 250 detections. Check the photo or detector configuration.')
    return faces, calls

def crop_face(image: np.ndarray, face: Detection, pad: float = .12) -> np.ndarray:
    x1,y1,x2,y2 = face.box
    dx,dy = (x2-x1)*pad,(y2-y1)*pad
    h,w = image.shape[:2]
    return image[max(0,int(y1-dy)):min(h,math.ceil(y2+dy)), max(0,int(x1-dx)):min(w,math.ceil(x2+dx))].copy()

def jpeg_thumbnail(image: np.ndarray, size: int = 192) -> str:
    h,w = image.shape[:2]
    factor = min(1.0, size/max(h,w))
    small = cv2.resize(image, (max(1,round(w*factor)), max(1,round(h*factor))))
    ok, encoded = cv2.imencode('.jpg', small, [cv2.IMWRITE_JPEG_QUALITY, 85])
    if not ok: raise ValueError('Unable to encode face thumbnail.')
    return base64.b64encode(encoded).decode('ascii')

def quality(image: np.ndarray, face: Detection, cfg: MatchConfig) -> dict:
    crop = crop_face(image, face, 0)
    gray = cv2.cvtColor(cv2.resize(crop, (64,64)), cv2.COLOR_BGR2GRAY)
    blur = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    brightness = float(gray.mean())
    eye0,eye1,nose = face.landmarks[:3]
    delta = eye1-eye0
    roll = abs(math.degrees(math.atan2(float(delta[1]), float(delta[0]))))
    roll = min(roll, abs(180-roll))
    eye_distance = float(np.linalg.norm(delta))
    asymmetry = float(abs(np.linalg.norm(nose-eye0)-np.linalg.norm(nose-eye1)) / max(eye_distance,1))
    side = float(min(face.box[2]-face.box[0], face.box[3]-face.box[1]))
    reasons = []
    if side < cfg.min_face_pixels: reasons.append('face_too_small')
    if blur < cfg.min_blur: reasons.append('blur')
    if brightness < 30 or brightness > 230: reasons.append('lighting')
    if roll > cfg.max_roll_degrees: reasons.append('head_roll')
    if eye_distance < 8 or asymmetry > cfg.max_pose_asymmetry: reasons.append('pose_or_landmarks')
    if face.score < cfg.min_detection_score: reasons.append('weak_detection')
    return dict(ok=not reasons, reasons=reasons, face_pixels=round(side,1),
                blur=round(blur,1), brightness=round(brightness,1),
                roll_degrees=round(roll,1), pose_asymmetry=round(asymmetry,3))

class OpenCVBackend:
    """OpenCV Zoo YuNet + SFace. CPU baseline; not a 95%-validated model."""
    def __init__(self, cfg: Settings):
        paths = [cfg.models_dir/'yunet.onnx', cfg.models_dir/'sface.onnx']
        self.model_id = fingerprint(paths, 'yunet-sface-v1')
        self.detector = cv2.FaceDetectorYN.create(str(paths[0]), '', (320,320), cfg.detection_threshold, .3, 5000)
        self.recognizer = cv2.FaceRecognizerSF.create(str(paths[1]), '')

    def detect(self, image: np.ndarray) -> list[Detection]:
        self.detector.setInputSize((image.shape[1],image.shape[0]))
        _, rows = self.detector.detect(np.ascontiguousarray(image))
        if rows is None: return []
        return [Detection(np.array([r[0],r[1],r[0]+r[2],r[1]+r[3]], np.float32),
                          r[4:14].reshape(5,2).copy(), float(r[14])) for r in rows]

    def embed(self, image: np.ndarray, face: Detection) -> np.ndarray:
        x1,y1,x2,y2 = face.box
        row = np.concatenate(([x1,y1,x2-x1,y2-y1], face.landmarks.ravel(), [face.score])).astype(np.float32)
        aligned = self.recognizer.alignCrop(image, row)
        return normalize(self.recognizer.feature(aligned))

ARC_TEMPLATE = np.array([[38.2946,51.6963],[73.5318,51.5014],[56.0252,71.7366],
                         [41.5493,92.3655],[70.7299,92.2041]], np.float64)

def similarity_transform(source: np.ndarray, target: np.ndarray = ARC_TEMPLATE) -> np.ndarray:
    """Least-squares 2D similarity transform, excluding reflections."""
    source,target = np.asarray(source,float),np.asarray(target,float)
    if source.shape != (5,2) or target.shape != (5,2): raise ValueError('Five landmarks required.')
    a,b = source-source.mean(0), target-target.mean(0)
    variance = float((a*a).sum()/len(a))
    if variance < 1e-8: raise ValueError('Degenerate facial landmarks.')
    u,s,vt = np.linalg.svd(b.T @ a / len(a))
    sign = np.ones(2); sign[-1] = 1 if np.linalg.det(u@vt) >= 0 else -1
    rotation = u @ np.diag(sign) @ vt
    scale = float((s*sign).sum()/variance)
    matrix = scale*rotation
    return np.column_stack((matrix, target.mean(0)-matrix@source.mean(0))).astype(np.float32)

class SCRFDArcFaceBackend:
    """Explicit ONNX contract: SCRFD 9/15 outputs + 112×112 ArcFace RGB.

    Bring appropriately licensed weights. No weights are downloaded automatically.
    This does not claim to support every ONNX file bearing an ArcFace name.
    """
    def __init__(self, cfg: Settings):
        paths = [cfg.models_dir/'scrfd.onnx', cfg.models_dir/'arcface.onnx']
        self.model_id = fingerprint(paths, 'scrfd-arcface-rgb127-v1')
        try: import onnxruntime as ort
        except ImportError as exc:
            raise RuntimeError('Install requirements-onnx.txt for the SCRFD/ArcFace backend.') from exc
        available = ort.get_available_providers()
        if any(p not in available for p in cfg.onnx_providers):
            raise RuntimeError(f'Requested ONNX provider unavailable. Installed: {available}')
        options = ort.SessionOptions(); options.intra_op_num_threads = 2
        self.det = ort.InferenceSession(str(paths[0]), sess_options=options, providers=cfg.onnx_providers)
        self.rec = ort.InferenceSession(str(paths[1]), sess_options=options, providers=cfg.onnx_providers)
        self.det_input = self.det.get_inputs()[0]
        self.rec_input = self.rec.get_inputs()[0]
        count = len(self.det.get_outputs())
        if count not in (9,15): raise ValueError('Expected SCRFD with 9 or 15 outputs including five landmarks.')
        self.strides = [8,16,32] if count == 9 else [8,16,32,64,128]
        self.anchors = 2 if count == 9 else 1
        shape = self.det_input.shape
        self.height = shape[2] if isinstance(shape[2],int) else 640
        self.width = shape[3] if isinstance(shape[3],int) else 640
        if self.height % 32 or self.width % 32: raise ValueError('SCRFD input dimensions must be multiples of 32.')
        rshape = self.rec_input.shape
        if len(rshape) != 4 or rshape[2:] != [112,112]:
            raise ValueError('This adapter requires ArcFace NCHW 112×112 input.')
        self.threshold = cfg.detection_threshold

    def detect(self, image: np.ndarray) -> list[Detection]:
        h,w = image.shape[:2]
        ratio = min(self.width/w,self.height/h)
        nw,nh = max(1,int(w*ratio)),max(1,int(h*ratio))
        canvas = np.zeros((self.height,self.width,3),np.uint8)
        canvas[:nh,:nw] = cv2.resize(image,(nw,nh))
        blob = cv2.dnn.blobFromImage(canvas, 1/128, (self.width,self.height), (127.5,)*3, swapRB=True)
        outputs = self.det.run(None, {self.det_input.name: blob})
        faces = []; levels = len(self.strides)
        for i,stride in enumerate(self.strides):
            scores = np.asarray(outputs[i]).reshape(-1)
            boxes = np.asarray(outputs[i+levels]).reshape(-1,4) * stride
            points = np.asarray(outputs[i+2*levels]).reshape(-1,5,2) * stride
            grid_y,grid_x = np.mgrid[0:self.height//stride,0:self.width//stride]
            centers = np.stack([grid_x,grid_y],axis=-1).reshape(-1,2)*stride
            centers = np.repeat(centers,self.anchors,axis=0)
            if len(centers) != len(scores): raise ValueError('Unsupported SCRFD output layout.')
            selected = np.flatnonzero(scores >= self.threshold)
            for j in selected:
                center = centers[j]; distance = boxes[j]
                box = np.array([center[0]-distance[0],center[1]-distance[1],
                                center[0]+distance[2],center[1]+distance[3]],float)
                # Account for separate x/y resize rounding.
                xy_scale = np.array([nw/w,nh/h])
                faces.append(Detection(box/np.tile(xy_scale,2), (points[j]+center)/xy_scale,float(scores[j])))
        return nms(faces)

    def embed(self, image: np.ndarray, face: Detection) -> np.ndarray:
        aligned = cv2.warpAffine(image, similarity_transform(face.landmarks), (112,112), borderValue=0)
        blob = cv2.dnn.blobFromImage(aligned, 1/127.5, (112,112), (127.5,)*3, swapRB=True)
        return normalize(self.rec.run(None, {self.rec_input.name: blob})[0])
