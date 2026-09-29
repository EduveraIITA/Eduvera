# Third-party code, models and official references

This archive contains our module source, tests and documentation. It does not bundle pretrained model binaries, fonts, real student photos or student biometric templates. Dependency licenses and pretrained-weight/training-data terms remain separate from the MIT license on this module.

## OpenCV baseline

YuNet's model directory publishes an MIT license:
https://github.com/opencv/opencv_zoo/blob/main/models/face_detection_yunet/LICENSE

SFace's model directory publishes an Apache-2.0 license:
https://github.com/opencv/opencv_zoo/blob/main/models/face_recognition_sface/LICENSE

Official detection/alignment/recognition tutorial:
https://docs.opencv.org/4.x/d0/dd4/tutorial_dnn_face.html

The downloader references official OpenCV Zoo artifacts and checks these Git-LFS SHA-256 identities:

- `face_detection_yunet_2023mar.onnx`: `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4`, 232589 bytes.
- `face_recognition_sface_2021dec.onnx`: `0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79`, 38696353 bytes.

Metadata sources:
https://raw.githubusercontent.com/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
https://raw.githubusercontent.com/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx

The model-directory license statements are not a blanket certification of all commercial, training-data, privacy or biometric rights for a deployment. Preserve applicable license text/notices with redistributed weights and review their terms before distribution/use. This package's source license does not relicense third-party models.

## Optional SCRFD / ArcFace

InsightFace states that its code is MIT-licensed but its published pretrained models are restricted to non-commercial research unless otherwise licensed. No InsightFace model binaries or Python package are bundled. The optional adapter accepts explicitly supplied compatible ONNX files; obtain the appropriate rights to those files before use.

https://github.com/deepinsight/insightface
https://www.insightface.ai/

## Implementation interfaces

The independent backend adapters follow documented OpenCV/ONNX model contracts. The global assignment uses SciPy's linear-sum assignment solver, not a handwritten solver advertised as the Hungarian algorithm. SciPy documents its current implementation as a modified Jonker–Volgenant algorithm.

https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.linear_sum_assignment.html
https://fastapi.tiangolo.com/tutorial/request-files/
https://fastapi.tiangolo.com/tutorial/request-forms-and-files/
https://fastapi.tiangolo.com/tutorial/static-files/

Dependency packages are installed by pip; consult their distributed license files and perform a software-composition review before production use. The requirements file pins direct CPU application dependencies but is not a cryptographically locked, audited supply-chain manifest.
