function appAuthHeaders() {
    const headers = {};
    const token = sessionStorage.getItem("redline-admin-token");
    const key = sessionStorage.getItem("redline-admin-key");
    if (token) headers["X-Admin-Token"] = token;
    if (key) headers["X-Admin-Key"] = key;
    return headers;
}

async function appRequest(path, options = {}) {
    let response;
    try {
        response = await fetch(path, {
            ...options,
            headers: {
                ...(options.body ? { "Content-Type": "application/json" } : {}),
                ...appAuthHeaders(),
                ...(options.headers || {})
            }
        });
    } catch (error) {
        throw new Error("Não foi possível contactar o servidor. Verifica a ligação e tenta novamente.");
    }

    const text = await response.text();
    let data = {};
    if (text) {
        try {
            data = JSON.parse(text);
        } catch (error) {
            throw new Error("O servidor devolveu uma resposta inválida.");
        }
    }
    if (!response.ok) {
        throw new Error(data.error || "Não foi possível concluir o pedido.");
    }
    return data;
}

document.addEventListener("DOMContentLoaded", () => {
    if (document.body.dataset.requiresAdmin === "true"
        && !sessionStorage.getItem("redline-admin-token")
        && !sessionStorage.getItem("redline-admin-key")) {
        window.location.replace("./admin.html");
        return;
    }

    document.querySelectorAll(".logout-link").forEach((link) => {
        link.addEventListener("click", () => {
            for (const key of ["redline-session", "redline-role", "redline-admin-token", "redline-admin-key"]) {
                sessionStorage.removeItem(key);
            }
        });
    });
});
