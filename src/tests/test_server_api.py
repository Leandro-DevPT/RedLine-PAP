import importlib
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
from datetime import datetime
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen


class ServerApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp_dir.name)
        cls.secret = "a" * 64
        cls.admin_key_file = cls.root / "admin_key"
        cls.session_key_file = cls.root / "session_secret"
        cls.admin_key_file.write_text(cls.secret, encoding="utf-8")
        cls.session_key_file.write_text("b" * 64, encoding="utf-8")
        cls.data_dir = cls.root / "data"

        cls.original_environment = {
            key: os.environ.get(key)
            for key in ("REDLINE_ADMIN_KEY_FILE", "REDLINE_SESSION_SECRET_FILE", "REDLINE_DATA_DIR")
        }
        os.environ["REDLINE_ADMIN_KEY_FILE"] = str(cls.admin_key_file)
        os.environ["REDLINE_SESSION_SECRET_FILE"] = str(cls.session_key_file)
        os.environ["REDLINE_DATA_DIR"] = str(cls.data_dir)

        python_dir = Path(__file__).resolve().parents[1] / "main" / "resources" / "static" / "py"
        sys.path.insert(0, str(python_dir))
        cls.app = importlib.import_module("server")
        cls.authy = importlib.import_module("authy")
        cls.httpd = cls.app.ThreadingHTTPServer(("127.0.0.1", 0), cls.app.RedlineHandler)
        cls.base_url = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=5)
        sys.path.remove(str(Path(__file__).resolve().parents[1] / "main" / "resources" / "static" / "py"))
        for key, value in cls.original_environment.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        sys.modules.pop("server", None)
        cls.temp_dir.cleanup()

    def request(self, path, method="GET", payload=None, authenticated=True):
        headers = {}
        data = None
        if authenticated:
            headers["X-Admin-Key"] = self.secret
        if payload is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(payload).encode("utf-8")
        request = Request(f"{self.base_url}{path}", data=data, headers=headers, method=method)
        try:
            with urlopen(request, timeout=5) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            with error:
                return error.code, json.loads(error.read().decode("utf-8"))

    def test_generates_totp_qr_svg_and_rejects_invalid_secrets(self):
        status, response = self.request(
            "/api/totp-qr",
            method="POST",
            payload={"email": "pessoa@example.pt", "secret": "JBSWY3DPEHPK3PXP"},
            authenticated=False,
        )
        self.assertEqual(status, 200)
        self.assertIn("<svg", response["svg"])
        self.assertIn("<path", response["svg"])

        status, response = self.request(
            "/api/totp-qr",
            method="POST",
            payload={"email": "pessoa@example.pt", "secret": "not-a-secret"},
            authenticated=False,
        )
        self.assertEqual(status, 400)
        self.assertIn("error", response)

    @unittest.skipUnless(os.name == "nt", "A geração automática só se aplica ao Windows.")
    def test_creates_persistent_local_secrets_when_environment_is_unset(self):
        variables = ("REDLINE_ADMIN_KEY_FILE", "REDLINE_SESSION_SECRET_FILE", "LOCALAPPDATA")
        previous = {name: os.environ.get(name) for name in variables}
        os.environ.pop("REDLINE_ADMIN_KEY_FILE", None)
        os.environ.pop("REDLINE_SESSION_SECRET_FILE", None)
        os.environ["LOCALAPPDATA"] = str(self.root / "Local AppData")
        try:
            admin_key = self.app.read_required_secret("REDLINE_ADMIN_KEY_FILE")
            session_secret = self.app.read_required_secret("REDLINE_SESSION_SECRET_FILE")
            self.assertGreaterEqual(len(admin_key), 32)
            self.assertGreaterEqual(len(session_secret), 32)
            self.assertNotEqual(admin_key, session_secret)
            self.assertEqual(
                self.app.read_required_secret("REDLINE_ADMIN_KEY_FILE"),
                admin_key,
            )
            self.assertTrue(
                (self.root / "Local AppData" / "Redline" / "secrets" / "admin_key").is_file()
            )
        finally:
            for name, value in previous.items():
                if value is None:
                    os.environ.pop(name, None)
                else:
                    os.environ[name] = value

    def test_client_and_appointment_workflow(self):
        status, _ = self.request("/api/clients", authenticated=False)
        self.assertEqual(status, 401)

        status, client = self.request(
            "/api/clients",
            method="POST",
            payload={"name": "Cliente de teste", "email": "cliente@example.pt", "status": "Ativo"},
        )
        self.assertEqual(status, 201)
        self.assertEqual(self.request("/api/clients")[1][0]["id"], client["id"])

        appointment_payload = {
            "title": "Sessão de teste",
            "clientId": client["id"],
            "date": "2030-01-02",
            "time": "10:00",
            "durationMinutes": 60,
            "status": "Agendado",
        }
        status, appointment = self.request("/api/appointments", method="POST", payload=appointment_payload)
        self.assertEqual(status, 201)
        self.assertEqual(appointment["client"], "Cliente de teste")

        conflict = {**appointment_payload, "time": "10:30", "durationMinutes": 30}
        status, _ = self.request("/api/appointments", method="POST", payload=conflict)
        self.assertEqual(status, 409)

        status, _ = self.request(
            f"/api/appointments/{appointment['id']}",
            method="PUT",
            payload={"status": "Concluído"},
        )
        self.assertEqual(status, 200)
        status, completed_slot = self.request("/api/appointments", method="POST", payload=conflict)
        self.assertEqual(status, 201)
        self.assertEqual(self.request(
            f"/api/appointments/{completed_slot['id']}", method="DELETE"
        )[0], 200)

        status, _ = self.request(f"/api/clients/{client['id']}", method="DELETE")
        self.assertEqual(status, 409)

        status, updated_client = self.request(
            f"/api/clients/{client['id']}",
            method="PUT",
            payload={"name": "Nome atualizado"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(updated_client["name"], "Nome atualizado")
        self.assertEqual(self.request("/api/appointments")[1][0]["client"], "Nome atualizado")

        status, _ = self.request(
            f"/api/appointments/{appointment['id']}",
            method="PUT",
            payload={"status": "Faltou"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(self.request("/api/appointments")[1][0]["status"], "Faltou")

        status, _ = self.request(f"/api/appointments/{appointment['id']}", method="DELETE")
        self.assertEqual(status, 200)
        status, _ = self.request(f"/api/clients/{client['id']}", method="DELETE")
        self.assertEqual(status, 200)

    def test_rejects_invalid_date(self):
        status, _ = self.request(
            "/api/appointments",
            method="POST",
            payload={"title": "Inválida", "date": "amanhã", "time": "25:90"},
        )
        self.assertEqual(status, 400)

    def test_age_gate_on_registration_and_login_uses_saved_birth_date(self):
        today = datetime.now().date()
        adult_birth_date = today.replace(year=today.year - 18).isoformat()
        underage_birth_date = today.replace(year=today.year - 17).isoformat()

        self.assertTrue(self.app.is_adult(adult_birth_date, today))
        self.assertFalse(self.app.is_adult(underage_birth_date, today))
        self.assertFalse(self.app.is_adult("invalid-date", today))
        self.assertFalse(self.app.is_adult((today.replace(year=today.year + 1)).isoformat(), today))

        totp_secret = "JBSWY3DPEHPK3PXP"
        totp_code = f"{self.authy._totp(totp_secret, int(datetime.now().timestamp())):06d}"
        status, _ = self.request(
            "/api/register",
            method="POST",
            payload={
                "firstName": "Pessoa",
                "lastName": "Menor",
                "birthDate": underage_birth_date,
                "email": "minor@example.pt",
                "password": "secure-password",
                "secret": totp_secret,
                "code": totp_code,
            },
        )
        self.assertEqual(status, 403)

        users = self.app.read_users()
        users["minor@example.pt"] = {
            "birthDate": underage_birth_date,
            "password": self.app.hash_password("secure-password"),
            "secret": totp_secret,
            "role": "user",
        }
        users["adult@example.pt"] = {
            "birthDate": adult_birth_date,
            "password": self.app.hash_password("secure-password"),
            "secret": totp_secret,
            "role": "user",
        }
        users["legacy@example.pt"] = {
            "password": self.app.hash_password("secure-password"),
            "secret": totp_secret,
            "role": "user",
        }
        self.app.write_users(users)

        status, _ = self.request(
            "/api/login",
            method="POST",
            payload={"email": "minor@example.pt", "password": "secure-password"},
        )
        self.assertEqual(status, 403)

        status, _ = self.request(
            "/api/verify-2fa",
            method="POST",
            payload={"email": "minor@example.pt", "code": totp_code},
        )
        self.assertEqual(status, 403)

        status, _ = self.request(
            "/api/login",
            method="POST",
            payload={"email": "adult@example.pt", "password": "secure-password"},
        )
        self.assertEqual(status, 200)

        status, _ = self.request(
            "/api/login",
            method="POST",
            payload={"email": "legacy@example.pt", "password": "secure-password"},
        )
        self.assertEqual(status, 200)
        self.assertNotIn("birthDate", self.app.read_users()["legacy@example.pt"])

        status, _ = self.request(
            "/api/verify-2fa",
            method="POST",
            payload={"email": "legacy@example.pt", "code": totp_code},
        )
        self.assertEqual(status, 200)


if __name__ == "__main__":
    unittest.main()
