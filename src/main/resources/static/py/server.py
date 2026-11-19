"""Local Redline API and static-file server.

Run on Windows without extra setup, or configure REDLINE_ADMIN_KEY / REDLINE_SESSION_SECRET
(or their *_FILE equivalents), and optionally REDLINE_DATA_DIR.
"""
import hashlib
import base64
import calendar
import hmac
from io import BytesIO
import json
import os
import re
import secrets
import sys
from datetime import datetime, timedelta, timezone
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlencode, urlparse

from authy import verify_totp
import qrcode
from qrcode.image.svg import SvgPathImage


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.environ.get("REDLINE_DATA_DIR", ROOT.parent / "data"))
DATA_FILE = DATA_DIR / "users.json"
CLIENTS_FILE = DATA_DIR / "clients.json"
APPOINTMENTS_FILE = DATA_DIR / "appointments.json"
ADMIN_SESSION_TTL = 8 * 60 * 60
APPOINTMENT_STATUSES = ("Agendado", "Confirmado", "Em curso", "Concluído", "Cancelado", "Faltou")
CLIENT_STATUSES = ("Ativo", "Em espera")
LOCAL_SECRET_NAMES = {
    "REDLINE_ADMIN_KEY_FILE": "admin_key",
    "REDLINE_SESSION_SECRET_FILE": "session_secret",
}
SECRET_VALUE_NAMES = {
    "REDLINE_ADMIN_KEY_FILE": "REDLINE_ADMIN_KEY",
    "REDLINE_SESSION_SECRET_FILE": "REDLINE_SESSION_SECRET",
}


def local_secret_path(environment_variable):
    if os.name != "nt":
        raise RuntimeError(
            f"É obrigatório configurar {environment_variable} com o caminho de um segredo."
        )
    local_app_data = os.environ.get("LOCALAPPDATA")
    if not local_app_data:
        raise RuntimeError(
            f"LOCALAPPDATA não está definido; configura {environment_variable} manualmente."
        )
    try:
        secret_name = LOCAL_SECRET_NAMES[environment_variable]
    except KeyError as error:
        raise ValueError(f"Variável de segredo não suportada: {environment_variable}") from error
    return Path(local_app_data) / "Redline" / "secrets" / secret_name


def create_local_secret(secret_path):
    secret_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with secret_path.open("x", encoding="utf-8") as secret_file:
            secret_file.write(secrets.token_hex(32))
    except FileExistsError:
        pass


def read_required_secret(environment_variable):
    configured_path = os.environ.get(environment_variable)
    if configured_path and str(configured_path).strip():
        secret_path = Path(configured_path).expanduser()
        try:
            value = secret_path.read_text(encoding="utf-8").strip()
        except OSError as error:
            raise RuntimeError(
                f"Não foi possível ler o segredo indicado por {environment_variable}: {secret_path}"
            ) from error
    else:
        value_name = SECRET_VALUE_NAMES[environment_variable]
        value = os.environ.get(value_name, "").strip()
        if not value:
            if os.name == "nt":
                secret_path = local_secret_path(environment_variable)
                create_local_secret(secret_path)
                try:
                    value = secret_path.read_text(encoding="utf-8").strip()
                except OSError as error:
                    raise RuntimeError(
                        f"Não foi possível ler o segredo indicado por {environment_variable}: {secret_path}"
                    ) from error
            else:
                raise RuntimeError(
                    f"Configura {value_name} com o segredo ou {environment_variable} "
                    "com o caminho de um ficheiro de segredo."
                )

    if len(value) < 32:
        raise RuntimeError(
            f"O segredo indicado por {environment_variable} deve ter pelo menos 32 caracteres."
        )
    return value


ADMIN_KEY = read_required_secret("REDLINE_ADMIN_KEY_FILE")
ADMIN_SESSION_SECRET = read_required_secret("REDLINE_SESSION_SECRET_FILE")


def read_users():
    if not DATA_FILE.exists() or not DATA_FILE.read_text(encoding="utf-8").strip():
        return {}
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("users.json deve conter um objeto JSON.")
    return data


def write_users(users):
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = DATA_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(users, indent=2, ensure_ascii=False), encoding="utf-8")
    temporary.replace(DATA_FILE)


def read_clients():
    if not CLIENTS_FILE.exists() or not CLIENTS_FILE.read_text(encoding="utf-8").strip():
        return []
    data = json.loads(CLIENTS_FILE.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("clients.json deve conter uma lista JSON.")
    return data


def write_clients(clients):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    temporary = CLIENTS_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(clients, indent=2, ensure_ascii=False), encoding="utf-8")
    temporary.replace(CLIENTS_FILE)


def read_appointments():
    if not APPOINTMENTS_FILE.exists() or not APPOINTMENTS_FILE.read_text(encoding="utf-8").strip():
        return []
    data = json.loads(APPOINTMENTS_FILE.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("appointments.json deve conter uma lista JSON.")
    return data


def write_appointments(appointments):
    APPOINTMENTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = APPOINTMENTS_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(appointments, indent=2, ensure_ascii=False), encoding="utf-8")
    temporary.replace(APPOINTMENTS_FILE)


def valid_appointment_date(date, time):
    try:
        datetime.strptime(date, "%Y-%m-%d")
        datetime.strptime(time, "%H:%M")
    except (TypeError, ValueError):
        return False
    return True


def is_adult(birth_date, today=None):
    try:
        born = datetime.strptime(birth_date, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return False
    if born.isoformat() != birth_date:
        return False

    current_date = today or datetime.now().date()
    if born > current_date:
        return False

    birthday_this_year = (born.month, born.day)
    if born.month == 2 and born.day == 29 and not calendar.isleap(current_date.year):
        birthday_this_year = (2, 28)
    age = current_date.year - born.year
    if (current_date.month, current_date.day) < birthday_this_year:
        age -= 1
    return age >= 18


def appointment_conflicts(candidate, appointments, exclude_id=None):
    if candidate.get("status") == "Cancelado":
        return False
    start = datetime.strptime(f"{candidate['date']} {candidate['time']}", "%Y-%m-%d %H:%M")
    end = start + timedelta(minutes=int(candidate.get("durationMinutes", 60)))
    for existing in appointments:
        if existing.get("id") == exclude_id:
            continue
        if existing.get("status") in ("Concluído", "Cancelado", "Faltou"):
            continue
        existing_start = datetime.strptime(
            f"{existing['date']} {existing['time']}", "%Y-%m-%d %H:%M"
        )
        existing_end = existing_start + timedelta(minutes=int(existing.get("durationMinutes", 60)))
        if start < existing_end and existing_start < end:
            return True
    return False


def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 210_000).hex()
    return {"salt": salt, "hash": digest}


def password_matches(password, account):
    stored = account.get("password", {})
    if isinstance(stored, str):
        return secrets.compare_digest(stored, password)
    candidate = hash_password(password, stored.get("salt", ""))["hash"]
    return bool(stored.get("hash")) and secrets.compare_digest(candidate, stored["hash"])


def profile_matches(payload, account):
    fields = ("firstName", "lastName", "birthDate")
    values = {field: str(payload.get(field, "")).strip() for field in fields}
    if not all(values.values()):
        return False
    stored = {field: str(account.get(field, "")).strip() for field in fields}
    return not any(stored.values()) or all(stored[field] == values[field] for field in fields)


def create_admin_token(email):
    expires = int(time.time()) + ADMIN_SESSION_TTL
    payload = f"{email}|{expires}"
    signature = hmac.new(ADMIN_SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    token = f"{payload}|{signature}".encode()
    return base64.urlsafe_b64encode(token).decode()


def token_admin_authorized(token, users):
    try:
        decoded = base64.urlsafe_b64decode(token.encode()).decode()
        email, expires, signature = decoded.split("|", 2)
        payload = f"{email}|{expires}"
        expected = hmac.new(ADMIN_SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
        account = users.get(email)
        return (int(expires) >= int(time.time()) and account and account.get("role") == "admin"
                and hmac.compare_digest(signature, expected))
    except (ValueError, TypeError, UnicodeDecodeError):
        return False


class RedlineHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def json_response(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def request_json(self):
        length = int(self.headers.get("Content-Length", 0))
        if not length:
            return {}
        data = self.rfile.read(length).decode("utf-8")
        if not data.strip():
            return {}
        return json.loads(data)

    def admin_authorized(self, users=None):
        if secrets.compare_digest(self.headers.get("X-Admin-Key", ""), ADMIN_KEY):
            return True
        return token_admin_authorized(self.headers.get("X-Admin-Token", ""), users or read_users())

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        if path == "/py" or path.startswith("/py/"):
            return self.json_response({"error": "Rota não encontrada."}, 404)
        if path == "/api/appointments":
            if not self.admin_authorized():
                return self.json_response({"error": "É necessário iniciar sessão para consultar a agenda."}, 401)
            return self.json_response(read_appointments())
        if path == "/api/clients":
            if not self.admin_authorized():
                return self.json_response({"error": "É necessário iniciar sessão para consultar os clientes."}, 401)
            return self.json_response(read_clients())
        if path == "/api/admin/users":
            users = read_users()
            if not self.admin_authorized(users):
                return self.json_response({"error": "Chave de administrador inválida."}, 401)
            safe_users = [{"email": email, "role": account.get("role", "user"), "createdAt": account.get("createdAt", "")}
                          for email, account in users.items()]
            return self.json_response(safe_users)
        if path == "/api/admin/appointments":
            appointments = read_appointments()
            if not self.admin_authorized(read_users()):
                return self.json_response({"error": "Acesso de administrador inválido."}, 401)
            return self.json_response(appointments)
        if path == "/api/health":
            return self.json_response({"status": "ok"})
        super().do_GET()

    def do_HEAD(self):
        path = unquote(urlparse(self.path).path)
        if path == "/py" or path.startswith("/py/"):
            return self.send_error(404, "Rota não encontrada.")
        super().do_HEAD()

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            payload = self.request_json()
            if path == "/api/totp-qr":
                email = str(payload.get("email", "")).strip().lower()
                secret = str(payload.get("secret", "")).strip().upper()
                if len(email) > 254 or "@" not in email or not re.fullmatch(r"[A-Z2-7]{16}", secret):
                    return self.json_response({"error": "Email ou segredo de autenticação inválido."}, 400)
                label = f"{quote('Redline Agenda', safe='')}:{quote(email, safe='')}"
                parameters = urlencode({
                    "secret": secret,
                    "issuer": "Redline Agenda",
                    "algorithm": "SHA1",
                    "digits": 6,
                    "period": 30,
                })
                qr = qrcode.QRCode(
                    error_correction=qrcode.constants.ERROR_CORRECT_M,
                    box_size=8,
                    border=4,
                )
                qr.add_data(f"otpauth://totp/{label}?{parameters}")
                qr.make(fit=True)
                output = BytesIO()
                qr.make_image(image_factory=SvgPathImage).save(output)
                return self.json_response({"svg": output.getvalue().decode("utf-8")})
            if path in ("/api/appointments", "/api/admin/appointments"):
                users = read_users()
                if not self.admin_authorized(users):
                    return self.json_response({"error": "Acesso de administrador inválido."}, 401)
                title = str(payload.get("title", "")).strip()
                date = str(payload.get("date", "")).strip()
                appointment_time = str(payload.get("time", "")).strip()
                status = str(payload.get("status", "Agendado")).strip()
                client_id = str(payload.get("clientId", "")).strip()
                duration = int(payload.get("durationMinutes", 60))
                clients = read_clients()
                client = next((item for item in clients if item.get("id") == client_id), None)
                if client_id and not client:
                    return self.json_response({"error": "O cliente selecionado não existe."}, 400)
                if not title or not valid_appointment_date(date, appointment_time):
                    return self.json_response({"error": "Indica um título, uma data e uma hora válidos."}, 400)
                if duration < 15 or duration > 480:
                    return self.json_response({"error": "A duração deve estar entre 15 minutos e 8 horas."}, 400)
                if status not in APPOINTMENT_STATUSES:
                    return self.json_response({"error": "Estado de marcação inválido."}, 400)
                appointment = {
                    "id": secrets.token_hex(8),
                    "title": title,
                    "clientId": client_id or None,
                    "client": client.get("name", "") if client else str(payload.get("client", "")).strip(),
                    "date": date,
                    "time": appointment_time,
                    "durationMinutes": duration,
                    "status": status,
                    "notes": str(payload.get("notes", "")).strip(),
                }
                appointments = read_appointments()
                if appointment_conflicts(appointment, appointments):
                    return self.json_response({"error": "Este horário sobrepõe-se a outra marcação."}, 409)
                appointments.append(appointment)
                write_appointments(appointments)
                return self.json_response(appointment, 201)
            if path == "/api/clients":
                if not self.admin_authorized():
                    return self.json_response({"error": "Acesso de administrador inválido."}, 401)
                name = str(payload.get("name", "")).strip()
                status = str(payload.get("status", "Ativo")).strip()
                if not name or status not in CLIENT_STATUSES:
                    return self.json_response({"error": "Indica um nome e um estado de cliente válidos."}, 400)
                client = {
                    "id": secrets.token_hex(8),
                    "name": name,
                    "type": str(payload.get("type", "")).strip(),
                    "email": str(payload.get("email", "")).strip(),
                    "phone": str(payload.get("phone", "")).strip(),
                    "status": status,
                }
                clients = read_clients()
                clients.append(client)
                write_clients(clients)
                return self.json_response(client, 201)
            if path == "/api/register":
                first_name = payload.get("firstName", "").strip()
                last_name = payload.get("lastName", "").strip()
                birth_date = str(payload.get("birthDate", "")).strip()
                email = payload.get("email", "").strip().lower()
                password = payload.get("password", "")
                secret = payload.get("secret", "").strip().upper()
                code = str(payload.get("code", "")).strip()
                if not first_name or not last_name or not email or "@" not in email or len(password) < 8 or not secret or not verify_totp(secret, code):
                    return self.json_response({"error": "Dados de registo inválidos."}, 400)
                if not is_adult(birth_date):
                    return self.json_response({"error": "Só é possível criar uma conta a partir dos 18 anos."}, 403)
                users = read_users()
                if email in users:
                    return self.json_response({"error": "Já existe uma conta com este email."}, 409)
                users[email] = {"firstName": first_name, "lastName": last_name, "birthDate": birth_date, "password": hash_password(password), "secret": secret, "role": "user", "createdAt": datetime.now(timezone.utc).isoformat()}
                write_users(users)
                return self.json_response({"email": email}, 201)
            if path == "/api/login":
                email = payload.get("email", "").strip().lower()
                users = read_users()
                account = users.get(email)
                if not account or not password_matches(payload.get("password", ""), account):
                    return self.json_response({"error": "Email ou palavra-passe inválidos."}, 401)
                saved_birth_date = account.get("birthDate")
                if saved_birth_date and not is_adult(saved_birth_date):
                    return self.json_response({"error": "Só é possível iniciar sessão a partir dos 18 anos."}, 403)
                return self.json_response({"email": email, "role": account.get("role", "user")})
            if path == "/api/verify-2fa":
                email = payload.get("email", "").strip().lower()
                code = str(payload.get("code", "")).strip()
                account = read_users().get(email)
                saved_birth_date = account.get("birthDate") if account else None
                if saved_birth_date and not is_adult(saved_birth_date):
                    return self.json_response({"error": "Só é possível iniciar sessão a partir dos 18 anos."}, 403)
                if not account or not verify_totp(account.get("secret", ""), code):
                    return self.json_response({"error": "Código 2FA inválido ou expirado."}, 401)
                role = account.get("role", "user")
                response = {"email": email, "role": role}
                if role == "admin":
                    response["adminToken"] = create_admin_token(email)
                return self.json_response(response)
            return self.json_response({"error": "Rota não encontrada."}, 404)
        except (json.JSONDecodeError, KeyError, TypeError, ValueError):
            return self.json_response({"error": "Pedido inválido."}, 400)

    def do_PUT(self):
        parsed = urlparse(self.path)
        appointment_path = parsed.path.startswith(("/api/appointments/", "/api/admin/appointments/"))
        client_path = parsed.path.startswith("/api/clients/")
        if parsed.path != "/api/admin/users" and not appointment_path and not client_path:
            return self.json_response({"error": "Rota não encontrada."}, 404)
        users = read_users()
        if not self.admin_authorized(users):
            return self.json_response({"error": "Acesso de administrador inválido."}, 401)
        try:
            payload = self.request_json()
            if appointment_path:
                appointment_id = parsed.path.rsplit("/", 1)[-1]
                appointments = read_appointments()
                appointment = next((item for item in appointments if item.get("id") == appointment_id), None)
                if not appointment:
                    return self.json_response({"error": "Compromisso não encontrado."}, 404)
                if "clientId" in payload:
                    client_id = str(payload["clientId"]).strip()
                    client = next((item for item in read_clients() if item.get("id") == client_id), None)
                    if client_id and not client:
                        return self.json_response({"error": "O cliente selecionado não existe."}, 400)
                    appointment["clientId"] = client_id or None
                    appointment["client"] = client.get("name", "") if client else ""
                elif "client" in payload:
                    appointment["client"] = str(payload["client"]).strip()
                    appointment["clientId"] = None
                for field in ("title", "date", "time", "status", "notes"):
                    if field in payload:
                        appointment[field] = str(payload[field]).strip()
                if "durationMinutes" in payload:
                    appointment["durationMinutes"] = int(payload["durationMinutes"])
                else:
                    appointment.setdefault("durationMinutes", 60)
                if not appointment.get("title") or not valid_appointment_date(
                    appointment.get("date"), appointment.get("time")
                ):
                    return self.json_response({"error": "Indica um título, uma data e uma hora válidos."}, 400)
                if appointment["durationMinutes"] < 15 or appointment["durationMinutes"] > 480:
                    return self.json_response({"error": "A duração deve estar entre 15 minutos e 8 horas."}, 400)
                if appointment.get("status") not in APPOINTMENT_STATUSES:
                    return self.json_response({"error": "Estado de marcação inválido."}, 400)
                if appointment_conflicts(appointment, appointments, exclude_id=appointment_id):
                    return self.json_response({"error": "Este horário sobrepõe-se a outra marcação."}, 409)
                write_appointments(appointments)
                return self.json_response(appointment)
            if client_path:
                client_id = parsed.path.rsplit("/", 1)[-1]
                clients = read_clients()
                client = next((item for item in clients if item.get("id") == client_id), None)
                if not client:
                    return self.json_response({"error": "Cliente não encontrado."}, 404)
                if "name" in payload:
                    name = str(payload["name"]).strip()
                    if not name:
                        return self.json_response({"error": "O nome do cliente é obrigatório."}, 400)
                    client["name"] = name
                for field in ("type", "email", "phone"):
                    if field in payload:
                        client[field] = str(payload[field]).strip()
                if "status" in payload:
                    status = str(payload["status"]).strip()
                    if status not in CLIENT_STATUSES:
                        return self.json_response({"error": "Estado de cliente inválido."}, 400)
                    client["status"] = status
                appointments = read_appointments()
                linked_appointments = []
                for appointment in appointments:
                    if appointment.get("clientId") == client_id:
                        appointment["client"] = client["name"]
                        linked_appointments.append(appointment)
                write_clients(clients)
                if linked_appointments:
                    write_appointments(appointments)
                return self.json_response(client)
            email = payload.get("email", "").strip().lower()
            role = payload.get("role", "").strip().lower()
        except (json.JSONDecodeError, TypeError, ValueError):
            return self.json_response({"error": "Pedido inválido."}, 400)
        if email not in users or role not in ("user", "admin"):
            return self.json_response({"error": "Utilizador ou perfil inválido."}, 400)
        if users[email].get("role") == "admin" and role == "user" and sum(account.get("role") == "admin" for account in users.values()) == 1:
            return self.json_response({"error": "É necessário manter pelo menos um administrador."}, 400)
        users[email]["role"] = role
        write_users(users)
        return self.json_response({"email": email, "role": role})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith(("/api/appointments/", "/api/admin/appointments/")):
            users = read_users()
            if not self.admin_authorized(users):
                return self.json_response({"error": "Acesso de administrador inválido."}, 401)
            appointment_id = parsed.path.rsplit("/", 1)[-1]
            appointments = read_appointments()
            remaining = [item for item in appointments if item.get("id") != appointment_id]
            if len(remaining) == len(appointments):
                return self.json_response({"error": "Compromisso não encontrado."}, 404)
            write_appointments(remaining)
            return self.json_response({"deleted": appointment_id})
        if parsed.path.startswith("/api/clients/"):
            if not self.admin_authorized():
                return self.json_response({"error": "Acesso de administrador inválido."}, 401)
            client_id = parsed.path.rsplit("/", 1)[-1]
            clients = read_clients()
            client = next((item for item in clients if item.get("id") == client_id), None)
            if not client:
                return self.json_response({"error": "Cliente não encontrado."}, 404)
            appointments = read_appointments()
            if any(
                appointment.get("clientId") == client_id
                or (not appointment.get("clientId") and appointment.get("client") == client.get("name"))
                for appointment in appointments
            ):
                return self.json_response(
                    {"error": "Este cliente tem marcações associadas. Remove ou atualiza-as primeiro."},
                    409,
                )
            write_clients([item for item in clients if item.get("id") != client_id])
            return self.json_response({"deleted": client_id})
        if parsed.path != "/api/admin/users":
            return self.json_response({"error": "Rota não encontrada."}, 404)
        users = read_users()
        if not self.admin_authorized(users):
            return self.json_response({"error": "Acesso de administrador inválido."}, 401)
        email = parse_qs(parsed.query).get("email", [""])[0].strip().lower()
        if email not in users:
            return self.json_response({"error": "Utilizador não encontrado."}, 404)
        if users[email].get("role") == "admin":
            return self.json_response({"error": "A conta de administrador não pode ser removida."}, 400)
        del users[email]
        write_users(users)
        return self.json_response({"deleted": email})


if __name__ == "__main__":
    port = int(
        os.environ.get("PORT")
        or os.environ.get("REDLINE_PORT")
        or (sys.argv[1] if len(sys.argv) > 1 else 8000)
    )
    host = os.environ.get(
        "REDLINE_BIND_HOST",
        "0.0.0.0" if os.environ.get("PORT") else "127.0.0.1",
    )
    if os.name == "nt" and any(
        not os.environ.get(name, "").strip()
        and not os.environ.get(SECRET_VALUE_NAMES[name], "").strip()
        for name in LOCAL_SECRET_NAMES
    ):
        print(f"Segredos locais guardados em: {local_secret_path('REDLINE_ADMIN_KEY_FILE').parent}")
        print("A chave de administrador está no ficheiro admin_key dentro dessa pasta.")
    print(f"Redline disponível em {host}:{port}/index.html")
    ThreadingHTTPServer((host, port), RedlineHandler).serve_forever()
