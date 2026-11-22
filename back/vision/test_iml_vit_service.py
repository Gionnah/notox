import http.client
import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from types import SimpleNamespace
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from iml_vit_service import (
    IMLRequestHandler,
    MAX_IMAGE_BYTES,
    choose_device,
    validate_bind_host,
)


class DummyLocalizer:
    device = "cpu"

    def localize(self, image_bytes: bytes) -> dict[str, object]:
        return {
            "modelVersion": "iml-vit-1024",
            "imageWidth": 4,
            "imageHeight": 3,
            "heatmapDataUri": "data:image/png;base64,dGVzdA==",
        }


class IMLRequestHandlerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.original_token = IMLRequestHandler.service_token
        IMLRequestHandler.service_token = "test-token"
        IMLRequestHandler.localizer = DummyLocalizer()
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), IMLRequestHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever)
        cls.thread.start()
        cls.base_url = "http://127.0.0.1:{}".format(
            cls.server.server_address[1]
        )

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        IMLRequestHandler.service_token = cls.original_token

    def test_health_reports_ready_model(self) -> None:
        with urlopen(self.base_url + "/health") as response:
            data = json.loads(response.read())

        self.assertEqual(response.status, 200)
        self.assertEqual(data["status"], "ready")
        self.assertEqual(data["device"], "cpu")

    def test_localization_requires_service_token(self) -> None:
        request = Request(
            self.base_url + "/v1/localize",
            data=b"image",
            headers={"Content-Type": "image/png"},
            method="POST",
        )
        with self.assertRaises(HTTPError) as result:
            urlopen(request)

        self.assertEqual(result.exception.code, 401)

    def test_localization_returns_heatmap_for_valid_request(self) -> None:
        request = Request(
            self.base_url + "/v1/localize",
            data=b"image",
            headers={
                "Authorization": "Bearer test-token",
                "Content-Type": "image/png",
            },
            method="POST",
        )
        with urlopen(request) as response:
            data = json.loads(response.read())

        self.assertEqual(response.status, 200)
        self.assertEqual(data["modelVersion"], "iml-vit-1024")
        self.assertTrue(
            data["heatmapDataUri"].startswith("data:image/png;base64,")
        )

    def test_localization_rejects_oversized_content_length(self) -> None:
        connection = http.client.HTTPConnection(
            "127.0.0.1",
            self.server.server_address[1],
            timeout=5,
        )
        connection.request(
            "POST",
            "/v1/localize",
            body=None,
            headers={
                "Authorization": "Bearer test-token",
                "Content-Type": "image/png",
                "Content-Length": str(MAX_IMAGE_BYTES + 1),
            },
        )
        response = connection.getresponse()
        self.assertEqual(response.status, 413)
        connection.close()


class DeviceSelectionTests(unittest.TestCase):
    def test_auto_prefers_cuda_then_mps_then_cpu(self) -> None:
        torch = SimpleNamespace(
            cuda=SimpleNamespace(is_available=lambda: True),
            backends=SimpleNamespace(
                mps=SimpleNamespace(is_available=lambda: True)
            ),
            device=lambda name: name,
        )
        self.assertEqual(choose_device(torch, "auto"), "cuda")

        torch.cuda.is_available = lambda: False
        self.assertEqual(choose_device(torch, "auto"), "mps")

        torch.backends.mps.is_available = lambda: False
        self.assertEqual(choose_device(torch, "auto"), "cpu")

    def test_non_loopback_bind_requires_service_token(self) -> None:
        with self.assertRaises(ValueError):
            validate_bind_host("0.0.0.0", "")

        validate_bind_host("0.0.0.0", "test-token")
        validate_bind_host("127.0.0.1", "")


if __name__ == "__main__":
    unittest.main()
