// Theme toggle
const root = document.documentElement;
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");

document.querySelector(".theme-toggle").addEventListener("click", () => {
  const current = root.dataset.theme || (prefersDark.matches ? "dark" : "light");
  const next = current === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch (_) {}
});

// Local clock
const clock = document.getElementById("clock");
const tick = () => {
  clock.textContent = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
};
tick();
setInterval(tick, 15_000);

// Year
document.getElementById("year").textContent = new Date().getFullYear();

// Staggered reveal on scroll
const items = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );
  items.forEach((el, i) => {
    el.style.transitionDelay = `${Math.min(i, 2) * 90}ms`;
    io.observe(el);
  });
} else {
  items.forEach((el) => el.classList.add("in"));
}
