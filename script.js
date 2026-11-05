// Local time in San Francisco
const clock = document.getElementById("clock");
const tick = () => {
  clock.textContent =
    new Date().toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/Los_Angeles",
    }) + " PT";
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
