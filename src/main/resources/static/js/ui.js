document.addEventListener("DOMContentLoaded", () => {
    const clock = document.createElement("time");
    clock.className = "site-clock";
    clock.setAttribute("aria-label", "Hora atual");
    document.body.appendChild(clock);

    const updateClock = () => {
        clock.textContent = new Intl.DateTimeFormat("pt-PT", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        }).format(new Date());
    };
    updateClock();
    window.setInterval(updateClock, 1000);

    const savedTheme = localStorage.getItem("redline-theme") || "light";
    document.documentElement.dataset.theme = savedTheme;
    document.querySelectorAll(".theme-toggle").forEach((button) => {
        button.textContent = savedTheme === "dark" ? "☀" : "◐";
        button.setAttribute("aria-label", savedTheme === "dark" ? "Usar tema claro" : "Usar tema escuro");
        button.addEventListener("click", () => {
            const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
            document.documentElement.dataset.theme = theme;
            localStorage.setItem("redline-theme", theme);
            button.textContent = theme === "dark" ? "☀" : "◐";
            button.setAttribute("aria-label", theme === "dark" ? "Usar tema claro" : "Usar tema escuro");
        });
    });

    const elements = document.querySelectorAll(".reveal");
    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add("visible");
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.12 });

    elements.forEach((element, index) => {
        element.style.transitionDelay = `${Math.min(index * 70, 280)}ms`;
        observer.observe(element);
    });
});