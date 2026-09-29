#!/usr/bin/env python3
"""Download the OpenCV CPU baseline with fixed SHA-256 verification.

No student data is sent. Never downloads InsightFace research-only weights.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
MODELS=[
    dict(name='yunet.onnx',directory='face_detection_yunet',upstream='face_detection_yunet_2023mar.onnx',
         sha256='8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4',size=232589,license='MIT'),
    dict(name='sface.onnx',directory='face_recognition_sface',upstream='face_recognition_sface_2021dec.onnx',
         sha256='0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79',size=38696353,license='Apache-2.0')]

def sha256(path):
    digest=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''): digest.update(block)
    return digest.hexdigest()

def download(directory: Path, check_only=False):
    directory.mkdir(parents=True,exist_ok=True)
    for model in MODELS:
        path=directory/model['name']
        if path.is_file() and sha256(path)==model['sha256']:
            print(f'Verified {path.name}'); continue
        if check_only: raise RuntimeError(f'Missing or incorrect model: {path}')
        url=f'https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/{model["directory"]}/{model["upstream"]}'
        temporary=path.with_suffix('.download')
        print(f'Downloading {path.name} ({model["size"]/1024/1024:.1f} MB)…',flush=True)
        try:
            request=urllib.request.Request(url,headers={'User-Agent':'ClassroomAttendanceLab/0.1'})
            with urllib.request.urlopen(request,timeout=90) as response,temporary.open('wb') as stream:
                total=0
                while block:=response.read(1024*1024):
                    total+=len(block)
                    if total>model['size']+1024: raise RuntimeError('Unexpected download size.')
                    stream.write(block)
            if temporary.stat().st_size!=model['size'] or sha256(temporary)!=model['sha256']:
                raise RuntimeError(f'Checksum mismatch for {path.name}. Do not use this file.')
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
        print(f'Verified {path.name}')
    (directory/'opencv-model-manifest.json').write_text(json.dumps(MODELS,indent=2)+'\n')
    print('OpenCV model files are ready. See THIRD_PARTY_NOTICES.md before deployment.')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--models-dir',type=Path,default=Path(os.getenv('MODELS_DIR',ROOT/'models')))
    parser.add_argument('--check',action='store_true',help='Verify existing files without network access.')
    args=parser.parse_args()
    try: download(args.models_dir,args.check)
    except Exception as exc:
        print(f'Model setup failed: {exc}\nCheck internet access and proxy settings, then retry. No substitute model was installed.',file=sys.stderr)
        sys.exit(1)
