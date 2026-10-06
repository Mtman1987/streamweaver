FROM python:3.12-slim
WORKDIR /app
RUN apt-get update -qq && apt-get install --no-install-recommends -y ca-certificates curl libsndfile1 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
RUN mkdir /models && curl -fL --retry 3 https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx -o /models/kokoro.onnx && curl -fL --retry 3 https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin -o /models/voices.bin
RUN echo "6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb  /models/kokoro.onnx" | sha256sum -c - && echo "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d  /models/voices.bin" | sha256sum -c -
ENV OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 MKL_NUM_THREADS=2 PYTHONUNBUFFERED=1
COPY server.py smoke.py ./
USER 65534:65534
CMD ["python", "server.py"]
