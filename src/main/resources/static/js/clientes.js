let clients = [];
let editingClientId = null;

function showClientMessage(text, success = false) {
    const message = document.getElementById("clientMessage");
    message.textContent = text;
    message.classList.toggle("success", success);
}

function renderClients() {
    const query = document.getElementById("clientSearch").value.trim().toLocaleLowerCase("pt-PT");
    const status = document.getElementById("clientFilter").value;
    const visible = clients.filter((client) => {
        const searchable = [client.name, client.type, client.email, client.phone].join(" ").toLocaleLowerCase("pt-PT");
        return searchable.includes(query) && (status === "Todos" || client.status === status);
    });
    const list = document.getElementById("clientsList");
    list.replaceChildren();
    document.getElementById("clientCount").textContent =
        `${visible.length} de ${clients.length} cliente${clients.length === 1 ? "" : "s"}`;

    if (!visible.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = clients.length ? "Nenhum cliente corresponde à pesquisa." : "Ainda não tens clientes. Regista o primeiro para manter o histórico num só lugar.";
        list.appendChild(empty);
        return;
    }

    visible.forEach((client) => {
        const card = document.createElement("article");
        card.className = "client-card";

        const initials = document.createElement("span");
        initials.className = "client-avatar";
        initials.setAttribute("aria-hidden", "true");
        initials.textContent = client.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("pt-PT");

        const details = document.createElement("div");
        details.className = "client-main";
        const name = document.createElement("h3");
        name.textContent = client.name;
        const contact = document.createElement("p");
        contact.textContent = [client.type, client.email, client.phone].filter(Boolean).join(" · ") || "Sem contactos adicionais";
        details.append(name, contact);

        const statusPill = document.createElement("span");
        statusPill.className = `status-pill${client.status === "Ativo" ? " is-active" : ""}`;
        statusPill.textContent = client.status;

        const actions = document.createElement("div");
        actions.className = "client-actions";
        const editButton = document.createElement("button");
        editButton.className = "text-button edit-client";
        editButton.type = "button";
        editButton.dataset.id = client.id;
        editButton.textContent = "Editar";
        const deleteButton = document.createElement("button");
        deleteButton.className = "text-button danger delete-client";
        deleteButton.type = "button";
        deleteButton.dataset.id = client.id;
        deleteButton.textContent = "Remover";
        actions.append(editButton, deleteButton);

        card.append(initials, details, statusPill, actions);
        list.appendChild(card);
    });
}

async function loadClients() {
    clients = await appRequest("/api/clients");
    renderClients();
}

function openClientModal(client = null) {
    const form = document.getElementById("clientForm");
    form.reset();
    editingClientId = client ? client.id : null;
    document.getElementById("clientModalTitle").textContent = client ? "Editar cliente" : "Novo cliente";
    if (client) {
        document.getElementById("clientName").value = client.name || "";
        document.getElementById("clientType").value = client.type || "";
        document.getElementById("clientEmail").value = client.email || "";
        document.getElementById("clientPhone").value = client.phone || "";
        document.getElementById("clientStatus").value = client.status || "Ativo";
    }
    document.getElementById("clientModal").hidden = false;
    document.getElementById("clientName").focus();
}

function closeClientModal() {
    document.getElementById("clientModal").hidden = true;
    editingClientId = null;
}

document.addEventListener("DOMContentLoaded", () => {
    const modal = document.getElementById("clientModal");
    document.getElementById("clientSearch").addEventListener("input", renderClients);
    document.getElementById("clientFilter").addEventListener("change", renderClients);
    document.getElementById("openClientModal").addEventListener("click", () => openClientModal());
    document.getElementById("closeClientModal").addEventListener("click", closeClientModal);
    document.getElementById("cancelClient").addEventListener("click", closeClientModal);

    document.getElementById("clientForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const submitButton = event.currentTarget.querySelector('button[type="submit"]');
        const payload = {
            name: document.getElementById("clientName").value.trim(),
            type: document.getElementById("clientType").value.trim(),
            email: document.getElementById("clientEmail").value.trim(),
            phone: document.getElementById("clientPhone").value.trim(),
            status: document.getElementById("clientStatus").value
        };
        const wasEditing = Boolean(editingClientId);
        submitButton.disabled = true;
        try {
            const path = editingClientId ? `/api/clients/${encodeURIComponent(editingClientId)}` : "/api/clients";
            await appRequest(path, {
                method: editingClientId ? "PUT" : "POST",
                body: JSON.stringify(payload)
            });
            closeClientModal();
            showClientMessage(wasEditing ? "Cliente atualizado." : "Cliente guardado.", true);
            try {
                await loadClients();
            } catch (error) {
                showClientMessage(`Alteração guardada, mas não foi possível atualizar a lista: ${error.message}`);
            }
        } catch (error) {
            showClientMessage(error.message);
        } finally {
            submitButton.disabled = false;
        }
    });

    document.getElementById("clientsList").addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-id]");
        if (!button) return;
        const client = clients.find((item) => item.id === button.dataset.id);
        if (!client) return;
        if (button.classList.contains("edit-client")) {
            openClientModal(client);
            return;
        }
        if (!window.confirm(`Remover o cliente ${client.name}?`)) return;
        try {
            await appRequest(`/api/clients/${encodeURIComponent(client.id)}`, { method: "DELETE" });
            await loadClients();
            showClientMessage("Cliente removido.", true);
        } catch (error) {
            showClientMessage(error.message);
        }
    });

    loadClients().catch((error) => showClientMessage(error.message));
});
