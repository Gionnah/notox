# NOTOX IML-ViT service

This optional service runs image-manipulation localization locally with the
official IML-ViT PyTorch implementation. It does not call Gemini or an LLM.
The output is a model heatmap, not a legal conclusion.

## Requirements and model files

- Python 3.9 or newer.
- PyTorch 2.x and a device suitable for the 1024-pixel model input. The IML-ViT
  project documents a GPU with at least 6 GB of memory; CPU inference is
  supported by its demo but can be slow. Apple Silicon MPS may be selected by
  this service when available, but the upstream project does not document or
  guarantee MPS compatibility.
- The code uses the upstream MIT-licensed IML-ViT repository, pinned here to
  commit `07dd2be0f4ea27a5c97c9fa5ffbe236733833eac`.
- Obtain `iml-vit_checkpoint.pth` from the official download links in the
  [upstream checkpoint instructions](https://github.com/SunnyHaze/IML-ViT/blob/main/checkpoints/ckpt_download_page.md)
  and put it at `models/iml-vit_checkpoint.pth`. Model weights are not included
  in this repository.

The upstream checkpoint does not state its own license clearly. IML-ViT's code
is MIT, but its training code references MAE weights licensed CC BY-NC 4.0.
Confirm the checkpoint rights before commercial use.

## Install and start

From `back/vision`:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
git clone https://github.com/SunnyHaze/IML-ViT.git upstream
git -C upstream checkout 07dd2be0f4ea27a5c97c9fa5ffbe236733833eac
```

Set paths to the upstream checkout and checkpoint, then start the service:

```bash
export IML_VIT_REPO_PATH="$PWD/upstream"
export IML_VIT_CHECKPOINT="$PWD/models/iml-vit_checkpoint.pth"
python iml_vit_service.py
```

The service binds to `127.0.0.1:8001` by default. Configure
`IML_VIT_SERVICE_URL` in `back/.env` if the Express API uses another address.
For a separate container or host, set `IML_BIND_HOST`, restrict network access,
and configure the same random `IML_VIT_SERVICE_TOKEN` in both services.

`IML_DEVICE=auto` prefers CUDA, then MPS, then CPU. It can be set to `cuda`,
`mps`, or `cpu` to select a device explicitly. The service loads the model once
at startup and serializes inference to avoid concurrent GPU memory spikes.

## API

- `GET /health` reports readiness, model version, and selected device.
- `POST /v1/localize` accepts JPEG, PNG, or WebP bytes and returns a JSON
  heatmap data URI plus its dimensions.

Images are resized proportionally to fit within 1024 x 1024 and padded at the
bottom/right when smaller. The heatmap uses that same aspect ratio. The
original protected file is not changed; the Express API verifies its signed
manifest before forwarding a temporary image copy. Analysis results are not
stored by this service.

Results may be wrong, especially after resizing, compression, or edits unlike
the training data. A heatmap is an aid for review, not proof of manipulation,
ownership, or legal infringement.
