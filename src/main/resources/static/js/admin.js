let adminKey = sessionStorage.getItem("redline-admin-key") || "";
let adminToken = sessionStorage.getItem("redline-admin-token") || "";
let allUsers = [];

function adminHeaders() {
    const headers = {};
    if (adminToken) headers["X-Admin-Token"] = adminToken;
    if (adminKey) headers["X-Admin-Key"] = adminKey;
    return headers;
}

function adminMessage(text, success = false) {
    const element = document.getElementById("adminMessage");
    element.textContent = text;
    element.classList.toggle("success", success);
}

function userMessage(text) {
    document.getElementById("usersMessage").textContent = text;
}

function appointmentMessage(text) {
    document.getElementById("appointmentsMessage").textContent = text;
}

async function loadUsers() {
    let response;
    try {
        response = await fetch("/api/admin/users", { headers: adminHeaders() });
    } catch (error) {
        throw new Error("Não foi possível contactar o servidor. Verifica a ligação e tenta novamente.");
    }
    const text = await response.text();
    let data = [];
    if (text) {
        try { data = JSON.parse(text); }
        catch (error) {
            const trimmed = text.trim();
            if (!trimmed) throw new Error("Resposta vazia do servidor.");
            data = trimmed;
        }
    }
    if (!response.ok) {
        const message = typeof data === "string" ? data : (data.error || "Não foi possível carregar os utilizadores.");
        throw new Error(message);
    }
    allUsers = data;
    document.getElementById("userCount").textContent = String(allUsers.length);
    document.getElementById("adminCount").textContent = String(allUsers.filter((user) => user.role === "admin").length);
    renderUsers();
}

function renderUsers() {
    const query = document.getElementById("userSearch").value.trim().toLowerCase();
    const data = allUsers.filter((user) => (user.email || "").toLowerCase().includes(query));
    const body = document.getElementById("usersBody");
    body.replaceChildren();
    if (!data.length) {
        body.innerHTML = '<tr><td colspan="4" class="empty-state">Nenhum email encontrado.</td></tr>';
        return;
    }
    data.forEach((user) => {
        const row = document.createElement("tr");
        const email = user.email || "";
        const createdAt = user.createdAt ? new Date(user.createdAt) : null;
        const date = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.toLocaleDateString("pt-PT") : "-";
        const emailCell = document.createElement("td");
        emailCell.textContent = email;
        row.appendChild(emailCell);

        const roleCell = document.createElement("td");
        const roleSelect = document.createElement("select");
        roleSelect.className = "role-select";
        roleSelect.dataset.email = email;
        roleSelect.setAttribute("aria-label", `Perfil de ${email}`);
        [["user", "Utilizador"], ["admin", "Administrador"]].forEach(([value, label]) => {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = label;
            option.selected = user.role === value;
            roleSelect.appendChild(option);
        });
        roleCell.appendChild(roleSelect);
        row.appendChild(roleCell);

        const dateCell = document.createElement("td");
        dateCell.textContent = date;
        row.appendChild(dateCell);

        const actionsCell = document.createElement("td");
        const saveButton = document.createElement("button");
        saveButton.className = "save-role";
        saveButton.type = "button";
        saveButton.dataset.email = email;
        saveButton.textContent = "Guardar";
        const removeButton = document.createElement("button");
        removeButton.className = "remove-user";
        removeButton.type = "button";
        removeButton.dataset.email = email;
        removeButton.setAttribute("aria-label", `Remover ${email}`);
        removeButton.textContent = "Remover";
        actionsCell.append(saveButton, removeButton);
        row.appendChild(actionsCell);
        body.appendChild(row);
    });
}

async function loadAppointments() {
    const response = await fetch("/api/admin/appointments", { headers: adminHeaders() });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível carregar os compromissos.");
    const body = document.getElementById("appointmentsBody");
    body.replaceChildren();
    if (!data.length) {
        body.innerHTML = '<tr><td colspan="6" class="empty-state">Ainda não existem compromissos.</td></tr>';
        document.getElementById("appointmentCount").textContent = "0";
        return;
    }
    document.getElementById("appointmentCount").textContent = String(data.length);
    data.forEach((appointment) => {
        const row = document.createElement("tr");
        const title = appointment.title || "";
        const id = String(appointment.id || "");
        const addTextCell = (value) => {
            const cell = document.createElement("td");
            cell.textContent = value || "-";
            row.appendChild(cell);
        };
        addTextCell(title);
        addTextCell(appointment.client);

        const dateCell = document.createElement("td");
        const dateInput = document.createElement("input");
        dateInput.className = "appointment-date";
        dateInput.dataset.id = id;
        dateInput.type = "date";
        dateInput.value = appointment.date || "";
        dateInput.setAttribute("aria-label", `Data de ${title}`);
        dateCell.appendChild(dateInput);
        row.appendChild(dateCell);

        const timeCell = document.createElement("td");
        const timeInput = document.createElement("input");
        timeInput.className = "appointment-time";
        timeInput.dataset.id = id;
        timeInput.type = "time";
        timeInput.value = appointment.time || "";
        timeInput.setAttribute("aria-label", `Hora de ${title}`);
        timeCell.appendChild(timeInput);
        row.appendChild(timeCell);

        addTextCell(appointment.status);
        const actionsCell = document.createElement("td");
        const saveButton = document.createElement("button");
        saveButton.className = "save-appointment";
        saveButton.type = "button";
        saveButton.dataset.id = id;
        saveButton.textContent = "Guardar";
        const deleteButton = document.createElement("button");
        deleteButton.className = "delete-appointment";
        deleteButton.type = "button";
        deleteButton.dataset.id = id;
        deleteButton.textContent = "Eliminar";
        actionsCell.append(saveButton, deleteButton);
        row.appendChild(actionsCell);
        body.appendChild(row);
    });
}

function showAdminPanels() {
    document.getElementById("adminAccess").hidden = true;
    document.getElementById("adminOverview").hidden = false;
    document.getElementById("usersPanel").hidden = false;
    document.getElementById("appointmentsPanel").hidden = false;
}

async function enterAdmin(event) {
    event.preventDefault();
    adminKey = document.getElementById("adminKey").value;
    adminToken = "";
    sessionStorage.removeItem("redline-admin-token");
    try {
        await loadUsers();
        await loadAppointments();
        sessionStorage.setItem("redline-admin-key", adminKey);
        showAdminPanels();
    } catch (error) { adminMessage(error.message); }
}

document.addEventListener("DOMContentLoaded", async () => {
    document.getElementById("adminLoginForm").addEventListener("submit", enterAdmin);
    document.getElementById("userSearch").addEventListener("input", renderUsers);
    document.getElementById("refreshUsers").addEventListener("click", async () => {
        try { await loadUsers(); await loadAppointments(); userMessage("Lista atualizada."); }
        catch (error) { userMessage(error.message); }
    });
    document.getElementById("refreshAppointments").addEventListener("click", async () => {
        try { await loadAppointments(); appointmentMessage("Compromissos atualizados."); }
        catch (error) { appointmentMessage(error.message); }
    });
    document.getElementById("appointmentForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const payload = { title: document.getElementById("appointmentTitle").value.trim(), client: document.getElementById("appointmentClient").value.trim(), date: document.getElementById("appointmentDate").value, time: document.getElementById("appointmentTime").value, status: document.getElementById("appointmentStatus").value };
        const response = await fetch("/api/admin/appointments", { method: "POST", headers: { "Content-Type": "application/json", ...adminHeaders() }, body: JSON.stringify(payload) });
        const data = await response.json();
        if (!response.ok) return appointmentMessage(data.error || "Não foi possível criar o compromisso.");
        event.target.reset();
        await loadAppointments();
        appointmentMessage("Compromisso criado.");
    });
    document.getElementById("usersBody").addEventListener("click", async (event) => {
        const saveButton = event.target.closest(".save-role");
        if (saveButton) {
            const select = document.querySelector(`.role-select[data-email="${CSS.escape(saveButton.dataset.email)}"]`);
            const response = await fetch("/api/admin/users", { method: "PUT", headers: { "Content-Type": "application/json", ...adminHeaders() }, body: JSON.stringify({ email: saveButton.dataset.email, role: select.value }) });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                return userMessage(data.error || "Não foi possível atualizar o perfil.");
            }
            return userMessage("Perfil atualizado.");
        }
        const button = event.target.closest(".remove-user");
        if (!button) return;
        if (!window.confirm(`Remover ${button.dataset.email}?`)) return;
        const response = await fetch(`/api/admin/users?email=${encodeURIComponent(button.dataset.email)}`, { method: "DELETE", headers: adminHeaders() });
        const text = await response.text();
        let data = {};
        if (text) {
            try { data = JSON.parse(text); }
            catch (error) {
                const trimmed = text.trim();
                if (!trimmed) return userMessage("Resposta vazia do servidor.");
                return userMessage(trimmed);
            }
        }
        if (!response.ok) return userMessage(data.error || "Não foi possível remover o utilizador.");
        await loadUsers();
        userMessage("Utilizador removido.");
    });
    document.getElementById("appointmentsBody").addEventListener("click", async (event) => {
        const saveAppointment = event.target.closest(".save-appointment");
        if (saveAppointment) {
            const id = saveAppointment.dataset.id;
            const date = document.querySelector(`.appointment-date[data-id="${CSS.escape(id)}"]`).value;
            const time = document.querySelector(`.appointment-time[data-id="${CSS.escape(id)}"]`).value;
            const response = await fetch(`/api/admin/appointments/${encodeURIComponent(id)}`, { method: "PUT", headers: { "Content-Type": "application/json", ...adminHeaders() }, body: JSON.stringify({ date, time }) });
            const data = await response.json();
            if (!response.ok) return appointmentMessage(data.error || "Não foi possível alterar a data.");
            return appointmentMessage("Data do compromisso atualizada.");
        }
        const deleteAppointment = event.target.closest(".delete-appointment");
        if (deleteAppointment) {
            if (!window.confirm("Eliminar este compromisso?")) return;
            const response = await fetch(`/api/admin/appointments/${encodeURIComponent(deleteAppointment.dataset.id)}`, { method: "DELETE", headers: adminHeaders() });
            if (!response.ok) return appointmentMessage("Não foi possível eliminar o compromisso.");
            await loadAppointments();
            return appointmentMessage("Compromisso eliminado.");
        }
    });
    if (adminKey || adminToken) {
        document.getElementById("adminKey").value = adminKey;
        try {
            await loadUsers();
            await loadAppointments();
            showAdminPanels();
        } catch { sessionStorage.removeItem("redline-admin-key"); sessionStorage.removeItem("redline-admin-token"); adminKey = ""; adminToken = ""; }
    }
});
