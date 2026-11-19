const appointmentStatuses = ["Agendado", "Confirmado", "Em curso", "Concluído", "Cancelado", "Faltou"];
let appointments = [];

function showAppointmentListMessage(text, success = false) {
    const message = document.getElementById("appointmentListMessage");
    message.textContent = text;
    message.classList.toggle("success", success);
}

function formatAppointmentDate(date) {
    return new Date(`${date}T00:00:00`).toLocaleDateString("pt-PT", {
        weekday: "short",
        day: "numeric",
        month: "short"
    });
}

function renderAppointments() {
    const search = document.getElementById("appointmentSearch").value.trim().toLocaleLowerCase("pt-PT");
    const date = document.getElementById("appointmentDateFilter").value;
    const status = document.getElementById("appointmentStatusFilter").value;
    const visible = appointments
        .filter((item) => {
            const matchesSearch = `${item.title} ${item.client || ""}`.toLocaleLowerCase("pt-PT").includes(search);
            return matchesSearch && (!date || item.date === date) && (status === "Todas" || item.status === status);
        })
        .sort((first, second) => `${first.date} ${first.time}`.localeCompare(`${second.date} ${second.time}`));

    const list = document.getElementById("appointmentsList");
    list.replaceChildren();
    document.getElementById("agendaStatus").textContent =
        `${visible.length} de ${appointments.length} ${appointments.length === 1 ? "marcação" : "marcações"}`;
    if (!visible.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = appointments.length ? "Não há marcações para estes filtros." : "Ainda não existem marcações. Cria a primeira para começar a organizar a semana.";
        list.appendChild(empty);
        return;
    }

    visible.forEach((appointment) => {
        const item = document.createElement("article");
        item.className = "appointment appointment-card";

        const time = document.createElement("span");
        time.className = "time";
        time.textContent = appointment.time;

        const details = document.createElement("div");
        details.className = "appointment-details";
        const title = document.createElement("b");
        title.textContent = appointment.title;
        const client = document.createElement("small");
        const duration = appointment.durationMinutes ? ` · ${appointment.durationMinutes} min` : "";
        client.textContent = `${appointment.client || "Sem cliente"} · ${formatAppointmentDate(appointment.date)}${duration}`;
        details.append(title, client);
        if (appointment.notes) {
            const notes = document.createElement("small");
            notes.className = "appointment-notes";
            notes.textContent = appointment.notes;
            details.appendChild(notes);
        }

        const status = document.createElement("select");
        status.className = "appointment-status";
        status.setAttribute("aria-label", `Estado de ${appointment.title}`);
        status.dataset.id = appointment.id;
        appointmentStatuses.forEach((value) => {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = value;
            status.appendChild(option);
        });
        status.value = appointment.status;

        const actions = document.createElement("div");
        actions.className = "appointment-actions";
        const edit = document.createElement("a");
        edit.className = "text-button";
        edit.href = `./compromisso.html?id=${encodeURIComponent(appointment.id)}`;
        edit.textContent = "Editar";
        const save = document.createElement("button");
        save.className = "text-button save-appointment";
        save.type = "button";
        save.dataset.id = appointment.id;
        save.textContent = "Guardar estado";
        const remove = document.createElement("button");
        remove.className = "text-button danger delete-appointment";
        remove.type = "button";
        remove.dataset.id = appointment.id;
        remove.textContent = "Remover";
        actions.append(edit, save, remove);

        item.append(time, details, status, actions);
        list.appendChild(item);
    });
}

async function loadAppointments() {
    appointments = await appRequest("/api/appointments");
    renderAppointments();
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("agendaDate").textContent =
        new Date().toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" });
    document.getElementById("appointmentSearch").addEventListener("input", renderAppointments);
    document.getElementById("appointmentDateFilter").addEventListener("change", renderAppointments);
    document.getElementById("appointmentStatusFilter").addEventListener("change", renderAppointments);
    document.getElementById("clearAppointmentFilters").addEventListener("click", () => {
        document.getElementById("appointmentSearch").value = "";
        document.getElementById("appointmentDateFilter").value = "";
        document.getElementById("appointmentStatusFilter").value = "Todas";
        renderAppointments();
    });

    document.getElementById("appointmentsList").addEventListener("click", async (event) => {
        const save = event.target.closest(".save-appointment");
        const remove = event.target.closest(".delete-appointment");
        if (!save && !remove) return;
        const id = (save || remove).dataset.id;
        if (remove && !window.confirm("Remover esta marcação?")) return;
        try {
            if (save) {
                const status = document.querySelector(`.appointment-status[data-id="${CSS.escape(id)}"]`).value;
                await appRequest(`/api/appointments/${encodeURIComponent(id)}`, {
                    method: "PUT",
                    body: JSON.stringify({ status })
                });
                showAppointmentListMessage("Estado da marcação atualizado.", true);
            } else {
                await appRequest(`/api/appointments/${encodeURIComponent(id)}`, { method: "DELETE" });
                showAppointmentListMessage("Marcação removida.", true);
            }
            await loadAppointments();
        } catch (error) {
            showAppointmentListMessage(error.message);
        }
    });

    loadAppointments().catch((error) => {
        document.getElementById("agendaStatus").textContent = "Agenda indisponível";
        showAppointmentListMessage(error.message);
    });
});
