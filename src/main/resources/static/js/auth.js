const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
let pendingUser = null;
let qrObjectUrl = null;

function randomSecret() {
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    let bits = "";
    bytes.forEach((byte) => { bits += byte.toString(2).padStart(8, "0"); });
    let secret = "";
    for (let index = 0; index < bits.length; index += 5) secret += base32Alphabet[parseInt(bits.slice(index, index + 5).padEnd(5, "0"), 2)];
    return secret;
}

function base32ToBytes(value) {
    let bits = "";
    value.replace(/=+$/, "").split("").forEach((character) => { bits += base32Alphabet.indexOf(character.toUpperCase()).toString(2).padStart(5, "0"); });
    const bytes = [];
    for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(parseInt(bits.slice(index, index + 8), 2));
    return new Uint8Array(bytes);
}

async function totp(secret) {
    const counter = Math.floor(Date.now() / 30000);
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setUint32(4, counter);
    const key = await crypto.subtle.importKey("raw", base32ToBytes(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
    const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, buffer));
    const offset = digest[digest.length - 1] & 15;
    const number = ((digest[offset] & 127) << 24) | ((digest[offset + 1] & 255) << 16) | ((digest[offset + 2] & 255) << 8) | (digest[offset + 3] & 255);
    return String(number % 1000000).padStart(6, "0");
}

function showMessage(text, success = false) { const element = document.getElementById("authMessage"); element.textContent = text; element.classList.toggle("success", success); }
function clearBrowserSession() {
    for (const key of ["redline-session", "redline-role", "redline-admin-token", "redline-admin-key"]) {
        sessionStorage.removeItem(key);
    }
}
async function api(path, options = {}) {
    let response;
    try {
        response = await fetch(path, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
    } catch (error) {
        throw new Error("Não foi possível contactar o servidor. Verifica a ligação e tenta novamente.");
    }
    const text = await response.text();
    let data = {};
    if (text) {
        try { data = JSON.parse(text); }
        catch (error) {
            const trimmed = text.trim();
            if (!trimmed) throw new Error("Resposta vazia do servidor.");
            data = trimmed;
        }
    }
    if (!response.ok) {
        const message = typeof data === "string" ? data : (data.error || "Não foi possível concluir o pedido.");
        throw new Error(message);
    }
    return typeof data === "string" ? { message: data } : data;
}
async function renderTotpInstructions(email, secret) {
    const message = document.getElementById("totpSetupMessage");
    const container = document.getElementById("qrcode-container");
    if (!message || !container) return;
    message.textContent = "A gerar o código QR...";

    let response;
    try {
        response = await fetch("/api/totp-qr", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, secret })
        });
    } catch (error) {
        message.textContent = "Não foi possível gerar o QR. Podes configurar a conta manualmente com o segredo abaixo.";
        return;
    }

    let data;
    try { data = await response.json(); }
    catch (error) {
        message.textContent = "O servidor devolveu uma resposta inválida. Podes configurar a conta manualmente com o segredo abaixo.";
        return;
    }
    if (!response.ok || typeof data.svg !== "string" || !data.svg.includes("<svg")) {
        message.textContent = data.error || "Não foi possível gerar o QR. Podes configurar a conta manualmente com o segredo abaixo.";
        return;
    }

    const nextObjectUrl = URL.createObjectURL(new Blob([data.svg], { type: "image/svg+xml" }));
    const image = document.createElement("img");
    image.alt = "Código QR para configurar o segundo fator";
    image.src = nextObjectUrl;
    container.replaceChildren(image);
    if (qrObjectUrl) URL.revokeObjectURL(qrObjectUrl);
    qrObjectUrl = nextObjectUrl;
    message.textContent = "Digitaliza o QR. O segredo não é enviado a serviços externos.";
}

function maximumAdultBirthDate() {
    const date = new Date();
    date.setFullYear(date.getFullYear() - 18);
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

document.addEventListener("DOMContentLoaded", () => {
    const registerForm = document.getElementById("registerForm");
    const loginForm = document.getElementById("loginForm");
    const verifyButton = document.getElementById("verifyAuthyButton");
    const birthDateInput = document.getElementById("birthDate");
    if (birthDateInput) birthDateInput.max = maximumAdultBirthDate();
    if (registerForm) registerForm.addEventListener("submit", (event) => {
        event.preventDefault();
        clearBrowserSession();
        const firstName = document.getElementById("firstName").value.trim();
        const lastName = document.getElementById("lastName").value.trim();
        const birthDate = document.getElementById("birthDate").value;
        const email = document.getElementById("email").value.trim().toLowerCase();
        const password = document.getElementById("password").value;
        pendingUser = { firstName, lastName, birthDate, email, password, secret: randomSecret() };
        document.getElementById("authySecret").value = pendingUser.secret;
        document.getElementById("authyCodeStep").hidden = false;
        registerForm.hidden = true;
        showMessage("Digitaliza o QR na tua app Authy e confirma o código.", true);
        renderTotpInstructions(pendingUser.email, pendingUser.secret);
    });
    if (loginForm) loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        clearBrowserSession();
        const email = document.getElementById("email").value.trim().toLowerCase();
        try {
            const account = await api("/api/login", {
                method: "POST",
                body: JSON.stringify({
                    email,
                    password: document.getElementById("password").value
                })
            });
            pendingUser = account;
            document.getElementById("authyCodeStep").hidden = false;
            loginForm.hidden = true;
            showMessage("Credenciais aceites. Confirma o segundo fator.", true);
        } catch (error) { showMessage(error.message); }
    });
    if (verifyButton) verifyButton.addEventListener("click", async () => {
        if (!pendingUser) return showMessage("Sessão de autenticação expirada. Começa novamente.");
        const code = document.getElementById("authyCode").value.trim();
        if (!/^\d{6}$/.test(code)) return showMessage("Introduz um código de 6 dígitos.");
        if (registerForm) {
            try { await api("/api/register", { method: "POST", body: JSON.stringify({ ...pendingUser, code }) }); }
            catch (error) { return showMessage(error.message); }
        } else {
            try {
                const account = await api("/api/verify-2fa", { method: "POST", body: JSON.stringify({ email: pendingUser.email, code }) });
                pendingUser = { ...pendingUser, ...account };
            }
            catch (error) { return showMessage(error.message); }
        }
        sessionStorage.setItem("redline-session", pendingUser.email);
        sessionStorage.setItem("redline-role", pendingUser.role || "user");
        if (pendingUser.adminToken) sessionStorage.setItem("redline-admin-token", pendingUser.adminToken);
        window.location.href = "./dashboard.html";
    });
});