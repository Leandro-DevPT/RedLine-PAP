function appointmentDateTime(appointment) {
    return new Date(`${appointment.date}T${appointment.time}:00`);
}

function displayDate(date) {
    return date.toLocaleDateString("pt-PT", { weekday: "short", day: "numeric", month: "short" });
}

function renderUpcoming(appointments, now) {
    const endOfWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const upcoming = appointments
        .filter((appointment) => {
            const dateTime = appointmentDateTime(appointment);
            return dateTime >= now && dateTime <= endOfWeek
                && !["Cancelado", "Concluído", "Faltou"].includes(appointment.status);
        })
        .sort((first, second) => appointmentDateTime(first) - appointmentDateTime(second))
        .slice(0, 5);
    const list = document.getElementById("upcomingList");
    list.replaceChildren();

    if (!upcoming.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "Não tens marcações próximas. Podes criar uma nova quando precisares.";
        list.appendChild(empty);
        return;
    }

    upcoming.forEach((appointment) => {
        const row = document.createElement("div");
        row.className = "appointment";
        const time = document.createElement("span");
        time.className = "time";
        time.textContent = appointment.time;
        const details = document.createElement("div");
        const title = document.createElement("b");
        title.textContent = appointment.title;
        const client = document.createElement("small");
        client.textContent = `${appointment.client || "Sem cliente"} · ${displayDate(appointmentDateTime(appointment))}`;
        details.append(title, client);
        const status = document.createElement("i");
        status.textContent = appointment.status;
        row.append(time, details, status);
        list.appendChild(row);
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    const session = sessionStorage.getItem("redline-session");
    if (session) document.getElementById("username").textContent = session.split("@")[0];

    try {
        const [appointments, clients] = await Promise.all([
            appRequest("/api/appointments"),
            appRequest("/api/clients")
        ]);
        const now = new Date();
        const today = [
            now.getFullYear(),
            String(now.getMonth() + 1).padStart(2, "0"),
            String(now.getDate()).padStart(2, "0")
        ].join("-");
        const todaysAppointments = appointments.filter((item) =>
            item.date === today && item.status !== "Cancelado"
        );
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const missedThisMonth = appointments.filter((item) =>
            item.status === "Faltou" && appointmentDateTime(item) >= monthStart
        );
        const unresolvedPast = appointments.filter((item) =>
            appointmentDateTime(item) < now && ["Agendado", "Confirmado", "Em curso"].includes(item.status)
        );

        document.getElementById("activeClients").textContent =
            clients.filter((client) => client.status === "Ativo").length;
        document.getElementById("todayAppointments").textContent = todaysAppointments.length;
        document.getElementById("todayDetail").textContent =
            `${todaysAppointments.filter((item) => item.status === "Concluído").length} concluídas`;
        document.getElementById("weekAppointments").textContent = appointments.filter((item) => {
            const dateTime = appointmentDateTime(item);
            return dateTime >= now && dateTime <= new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
                && !["Cancelado", "Concluído", "Faltou"].includes(item.status);
        }).length;
        document.getElementById("missedAppointments").textContent = missedThisMonth.length;
        document.getElementById("attentionTitle").textContent = unresolvedPast.length
            ? `${unresolvedPast.length} por atualizar`
            : "Tudo em dia";
        document.getElementById("attentionText").textContent = unresolvedPast.length
            ? "Há marcações passadas ainda sem resultado. Marca-as como concluídas, faltas ou canceladas."
            : "Não há marcações passadas pendentes de atualização.";
        renderUpcoming(appointments, now);
    } catch (error) {
        document.getElementById("dashboardMessage").textContent = error.message;
        document.getElementById("upcomingList").innerHTML =
            '<p class="empty-state">Não foi possível carregar a agenda.</p>';
        document.getElementById("attentionTitle").textContent = "Agenda indisponível";
        document.getElementById("attentionText").textContent = "Verifica a ligação ao servidor e tenta novamente.";
    }
});
