function localAppointmentDate(appointment) {
    return new Date(`${appointment.date}T${appointment.time}:00`);
}

function renderDeliveryList(appointments) {
    const now = new Date();
    const upcoming = appointments
        .filter((appointment) =>
            localAppointmentDate(appointment) >= now
            && !["Cancelado", "Concluído", "Faltou"].includes(appointment.status)
        )
        .sort((first, second) => localAppointmentDate(first) - localAppointmentDate(second))
        .slice(0, 5);
    const list = document.getElementById("deliveryList");
    list.replaceChildren();

    if (!upcoming.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "Não há próximas marcações.";
        list.appendChild(empty);
        return;
    }

    upcoming.forEach((appointment) => {
        const row = document.createElement("div");
        row.className = "delivery-row";
        const details = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = appointment.title;
        const client = document.createElement("small");
        client.textContent = `${appointment.client || "Sem cliente"} · ${localAppointmentDate(appointment).toLocaleDateString("pt-PT", { day: "numeric", month: "short" })}`;
        details.append(title, client);
        const time = document.createElement("span");
        time.textContent = appointment.time;
        const status = document.createElement("i");
        status.textContent = appointment.status;
        row.append(details, time, status);
        list.appendChild(row);
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    try {
        const appointments = await appRequest("/api/appointments");
        const count = (status) => appointments.filter((item) => item.status === status).length;
        const completed = count("Concluído");
        const cancelled = count("Cancelado");
        const missed = count("Faltou");
        const eligible = appointments.length - cancelled;
        const percent = eligible ? Math.round((completed / eligible) * 100) : 0;

        document.getElementById("completedValue").textContent = completed;
        document.getElementById("plannedValue").textContent = count("Agendado") + count("Confirmado") + count("Em curso");
        document.getElementById("missedValue").textContent = missed;
        document.getElementById("cancelledValue").textContent = cancelled;
        document.getElementById("completionPercent").textContent = `${percent}%`;
        document.getElementById("completionDescription").textContent =
            `${completed} de ${eligible} marcações válidas foram concluídas; cancelamentos não entram no cálculo.`;
        document.getElementById("completionBar").style.width = `${percent}%`;
        document.getElementById("progressUpdated").textContent =
            `Atualizado em ${new Date().toLocaleString("pt-PT")}`;
        renderDeliveryList(appointments);
    } catch (error) {
        document.getElementById("progressMessage").textContent = error.message;
        document.getElementById("progressUpdated").textContent = "Não foi possível atualizar os dados.";
        document.getElementById("deliveryList").innerHTML =
            '<p class="empty-state">A agenda está indisponível.</p>';
    }
});
