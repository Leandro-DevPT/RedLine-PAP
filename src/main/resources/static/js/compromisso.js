function localDateValue(date = new Date()) {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

let appointmentBeingEdited = null;

document.addEventListener("DOMContentLoaded", async () => {
    const form = document.getElementById("appointmentForm");
    const message = document.getElementById("appointmentMessage");
    const submit = form.querySelector('button[type="submit"]');
    const params = new URLSearchParams(window.location.search);
    const appointmentId = params.get("id");
    document.getElementById("appointmentDate").value = params.get("date") || localDateValue();
    document.getElementById("appointmentTime").value = params.get("time") || "09:00";

    try {
        const [clients, appointments] = await Promise.all([
            appRequest("/api/clients"),
            appointmentId ? appRequest("/api/appointments") : Promise.resolve([])
        ]);
        const select = document.getElementById("appointmentClient");
        clients.forEach((client) => {
            const option = document.createElement("option");
            option.value = client.id;
            option.textContent = `${client.name}${client.status === "Em espera" ? " (em espera)" : ""}`;
            select.appendChild(option);
        });
        if (appointmentId) {
            const appointment = appointments.find((item) => item.id === appointmentId);
            if (!appointment) {
                message.textContent = "A marcação que pretendes editar não foi encontrada.";
                submit.disabled = true;
                return;
            }
            appointmentBeingEdited = appointment;
            document.getElementById("appointmentHeading").textContent = "Editar marcação";
            document.getElementById("appointmentLead").textContent = "Atualiza o horário, o estado ou as notas. A aplicação volta a verificar sobreposições.";
            document.getElementById("saveAppointmentButton").textContent = "Guardar alterações";
            document.getElementById("appointmentTitle").value = appointment.title || "";
            document.getElementById("appointmentDate").value = appointment.date;
            document.getElementById("appointmentTime").value = appointment.time;
            document.getElementById("appointmentDuration").value = String(appointment.durationMinutes || 60);
            document.getElementById("appointmentStatus").value = appointment.status;
            document.getElementById("appointmentNotes").value = appointment.notes || "";
            if (appointment.clientId) {
                select.value = appointment.clientId;
            } else if (appointment.client) {
                select.options[0].textContent = `Sem cliente associado — ${appointment.client} (registo antigo)`;
            }
        } else if (params.get("clientId")) {
            select.value = params.get("clientId");
        }
    } catch (error) {
        message.textContent = `Não foi possível carregar os clientes: ${error.message}`;
        submit.disabled = true;
        return;
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const payload = Object.fromEntries(new FormData(form).entries());
        payload.durationMinutes = Number(payload.durationMinutes);
        const path = appointmentId
            ? `/api/appointments/${encodeURIComponent(appointmentId)}`
            : "/api/appointments";
        const method = appointmentId ? "PUT" : "POST";
        if (appointmentId && !payload.clientId) {
            if (appointmentBeingEdited && !appointmentBeingEdited.clientId && appointmentBeingEdited.client) {
                payload.client = appointmentBeingEdited.client;
                delete payload.clientId;
            }
        }
        submit.disabled = true;
        try {
            await appRequest(path, {
                method,
                body: JSON.stringify(payload)
            });
            message.className = "form-message success";
            message.textContent = appointmentId
                ? "Alterações guardadas. A regressar à agenda..."
                : "Marcação guardada. A regressar à agenda...";
            window.setTimeout(() => { window.location.href = "./appointments.html"; }, 700);
        } catch (error) {
            message.textContent = error.message;
            submit.disabled = false;
        }
    });
});
