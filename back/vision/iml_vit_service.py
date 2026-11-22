from __future__ import annotations

import base64
import hmac
import io
import json
import logging
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


MODEL_INPUT_SIZE = 1024
MAX_IMAGE_BYTES = 25 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
MODEL_VERSION = "iml-vit-1024"
LOGGER = logging.getLogger("notox.iml_vit")


def choose_device(torch: Any, requested: str) -> Any:
    if requested == "auto":
        if torch.cuda.is_available():
            return torch.device("cuda")
        if torch.backends.mps.is_available():
            return torch.device("mps")
        return torch.device("cpu")

    if requested == "cuda" and not torch.cuda.is_available():
        raise RuntimeError(
            "IML_DEVICE=cuda mais aucun GPU CUDA n'est disponible."
        )
    if requested == "mps" and not torch.backends.mps.is_available():
        raise RuntimeError(
            "IML_DEVICE=mps mais le backend Metal "
            "PyTorch n'est pas disponible."
        )
    if requested not in {"cpu", "cuda", "mps"}:
        raise RuntimeError("IML_DEVICE doit être auto, cpu, cuda ou mps.")
    return torch.device(requested)


def validate_bind_host(host: str, service_token: str) -> None:
    if host not in {"127.0.0.1", "::1", "localhost"} and not service_token:
        raise ValueError(
            "IML_VIT_SERVICE_TOKEN est requis lorsque le service "
            "n'est pas limité à localhost."
        )


class IMLViTLocalizer:
    def __init__(self) -> None:
        try:
            import numpy as np
            import torch
            import torch.nn.functional as functional
            from PIL import Image, ImageOps
        except ImportError as error:
            raise RuntimeError(
                "Dépendances IML-ViT absentes. "
                "Installez back/vision/requirements.txt."
            ) from error

        repo_path = (
            Path(os.environ.get("IML_VIT_REPO_PATH", ""))
            .expanduser()
            .resolve()
        )
        checkpoint_path = (
            Path(os.environ.get("IML_VIT_CHECKPOINT", ""))
            .expanduser()
            .resolve()
        )
        if not (repo_path / "iml_vit_model.py").is_file():
            raise RuntimeError(
                "IML_VIT_REPO_PATH doit pointer vers un "
                "checkout officiel IML-ViT."
            )
        if not checkpoint_path.is_file():
            raise RuntimeError(
                "IML_VIT_CHECKPOINT doit pointer vers le "
                "checkpoint IML-ViT téléchargé."
            )

        sys.path.insert(0, str(repo_path))
        try:
            from iml_vit_model import iml_vit_model
        except ImportError as error:
            raise RuntimeError(
                "Impossible de charger le code du modèle IML-ViT."
            ) from error

        self.np = np
        self.torch = torch
        self.functional = functional
        self.Image = Image
        self.ImageOps = ImageOps
        self.Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS

        requested_device = os.environ.get("IML_DEVICE", "auto").strip().lower()
        self.device = choose_device(torch, requested_device)
        self.model = iml_vit_model(input_size=MODEL_INPUT_SIZE)
        checkpoint = torch.load(
            checkpoint_path,
            map_location="cpu",
            weights_only=True,
        )
        if isinstance(checkpoint, dict) and isinstance(
            checkpoint.get("model"), dict
        ):
            checkpoint = checkpoint["model"]
        elif isinstance(checkpoint, dict) and isinstance(
            checkpoint.get("state_dict"), dict
        ):
            checkpoint = checkpoint["state_dict"]
        if not isinstance(checkpoint, dict):
            raise RuntimeError(
                "Le checkpoint ne contient pas de poids de modèle valides."
            )

        self.model.load_state_dict(checkpoint, strict=True)
        self.model.to(self.device)
        self.model.eval()

    def _prepare_image(self, image_bytes: bytes) -> tuple[Any, Any, int, int]:
        try:
            with self.Image.open(io.BytesIO(image_bytes)) as opened:
                if opened.format not in {"JPEG", "PNG", "WEBP"}:
                    raise ValueError(
                        "Format image non pris en charge par IML-ViT."
                    )
                width, height = opened.size
                if (
                    width < 1
                    or height < 1
                    or width * height > MAX_IMAGE_PIXELS
                ):
                    raise ValueError(
                        "La résolution de l'image "
                        "dépasse la limite autorisée."
                    )
                source = self.ImageOps.exif_transpose(opened).convert("RGB")
            source.load()
        except (OSError, self.Image.DecompressionBombError) as error:
            raise ValueError(
                "L'image est illisible ou trop volumineuse."
            ) from error

        original_width, original_height = source.size
        scale = min(
            1.0,
            MODEL_INPUT_SIZE / max(original_width, original_height),
        )
        resized_width = max(1, round(original_width * scale))
        resized_height = max(1, round(original_height * scale))
        resized = source.resize(
            (resized_width, resized_height),
            resample=self.Image.Resampling.BICUBIC,
        )

        canvas = self.Image.new(
            "RGB",
            (MODEL_INPUT_SIZE, MODEL_INPUT_SIZE),
            (0, 0, 0),
        )
        canvas.paste(resized, (0, 0))
        pixels = self.np.asarray(canvas, dtype=self.np.float32) / 255.0
        mean = self.np.asarray([0.485, 0.456, 0.406], dtype=self.np.float32)
        std = self.np.asarray([0.229, 0.224, 0.225], dtype=self.np.float32)
        normalized = (pixels - mean) / std
        tensor = (
            self.torch.from_numpy(normalized)
            .permute(2, 0, 1)
            .unsqueeze(0)
        )
        return tensor, resized, resized_width, resized_height

    def _render_heatmap(self, image: Any, probabilities: Any) -> str:
        np = self.np
        probabilities = np.nan_to_num(
            probabilities,
            nan=0.0,
            posinf=1.0,
            neginf=0.0,
        )
        probabilities = np.clip(probabilities, 0.0, 1.0)

        red = np.clip(1.5 - np.abs(4.0 * probabilities - 3.0), 0.0, 1.0)
        green = np.clip(1.5 - np.abs(4.0 * probabilities - 2.0), 0.0, 1.0)
        blue = np.clip(1.5 - np.abs(4.0 * probabilities - 1.0), 0.0, 1.0)
        colors = np.stack((red, green, blue), axis=-1) * 255.0
        alpha = np.clip((probabilities - 0.1) / 0.9, 0.0, 0.65)[..., None]

        source_pixels = np.asarray(image, dtype=np.float32)
        overlay = source_pixels * (1.0 - alpha) + colors * alpha
        output = self.Image.fromarray(
            np.clip(overlay, 0, 255).astype(np.uint8),
            mode="RGB",
        )
        buffer = io.BytesIO()
        output.save(buffer, format="PNG", optimize=True)
        encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
        return "data:image/png;base64," + encoded

    def localize(self, image_bytes: bytes) -> dict[str, Any]:
        tensor, resized, width, height = self._prepare_image(image_bytes)
        tensor = tensor.to(self.device)

        with self.torch.inference_mode():
            encoded = self.model.encoder_net(tensor)
            features = self.model.featurePyramid_net(encoded)
            logits = self.model.predict_head(list(features.values()))
            mask = self.functional.interpolate(
                logits,
                size=(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE),
                mode="bilinear",
                align_corners=False,
            )
            probabilities = (
                self.torch.sigmoid(mask)[0, 0, :height, :width]
                .cpu()
                .numpy()
            )

        return {
            "modelVersion": MODEL_VERSION,
            "imageWidth": width,
            "imageHeight": height,
            "heatmapDataUri": self._render_heatmap(resized, probabilities),
        }


class IMLRequestHandler(BaseHTTPRequestHandler):
    server_version = "NOTOX-IML/1.0"
    localizer: IMLViTLocalizer
    inference_lock = threading.Lock()
    service_token = os.environ.get("IML_VIT_SERVICE_TOKEN", "")

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        response = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(response)

    def do_GET(self) -> None:
        if self.path != "/health":
            self._send_json(404, {"error": "Not found."})
            return
        self._send_json(
            200,
            {
                "status": "ready",
                "modelVersion": MODEL_VERSION,
                "device": str(self.localizer.device),
            },
        )

    def do_POST(self) -> None:
        if self.path != "/v1/localize":
            self._send_json(404, {"error": "Not found."})
            return

        if self.service_token:
            authorization = self.headers.get("Authorization", "")
            expected = "Bearer " + self.service_token
            if not hmac.compare_digest(authorization, expected):
                self._send_json(401, {"error": "Unauthorized."})
                return

        content_type = (
            self.headers.get("Content-Type", "")
            .split(";", 1)[0]
            .strip()
            .lower()
        )
        if content_type not in {"image/jpeg", "image/png", "image/webp"}:
            self._send_json(
                415,
                {"error": "Expected a JPEG, PNG, or WebP image."},
            )
            return

        try:
            content_length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self._send_json(411, {"error": "Content-Length is required."})
            return
        if content_length < 1:
            self._send_json(400, {"error": "Image body is empty."})
            return
        if content_length > MAX_IMAGE_BYTES:
            self._send_json(413, {"error": "Image exceeds the 25 MB limit."})
            return

        image_bytes = self.rfile.read(content_length)
        if len(image_bytes) != content_length:
            self._send_json(400, {"error": "Image body is incomplete."})
            return

        try:
            with self.inference_lock:
                result = self.localizer.localize(image_bytes)
        except ValueError as error:
            self._send_json(400, {"error": str(error)})
            return
        except Exception:
            LOGGER.exception("IML-ViT inference failed.")
            self._send_json(
                503,
                {"error": "Image localization is temporarily unavailable."},
            )
            return

        self._send_json(200, result)


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    host = os.environ.get("IML_BIND_HOST", "127.0.0.1")
    port = int(os.environ.get("IML_PORT", "8001"))
    try:
        validate_bind_host(host, IMLRequestHandler.service_token)
    except ValueError as error:
        raise SystemExit(str(error)) from error

    try:
        localizer = IMLViTLocalizer()
    except Exception:
        LOGGER.exception("Unable to initialize IML-ViT.")
        raise SystemExit(1)

    IMLRequestHandler.localizer = localizer
    server = ThreadingHTTPServer((host, port), IMLRequestHandler)
    LOGGER.info(
        "IML-ViT ready on http://%s:%s using %s.",
        host,
        port,
        localizer.device,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        LOGGER.info("Stopping IML-ViT service.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
