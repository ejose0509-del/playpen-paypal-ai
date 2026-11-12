// Willow Lane Market: Bramble scans the page for demo partner products.
// The scan reads the page's own product markup. A browser extension would do the same on real
// shopping sites. It is a local animation, not an AI call; the chat is where Claude answers.
import { createCompanion } from "./companion.js";

const market = document.getElementById("market");
const grid = document.getElementById("shop-grid");
const companion = createCompanion({
  csrf: market.dataset.csrf,
  url: market.dataset.companionUrl,
  place: "market",
});
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, still ? 0 : ms));

async function scan() {
  const partners = [...grid.querySelectorAll("[data-partner]")];
  await wait(500);
  companion.mood("think");
  companion.say("Let me sniff around this page…", 2400);
  grid.classList.add("scanning");
  await wait(1500);
  grid.classList.remove("scanning");
  for (const card of partners) {
    card.classList.add("found");
    await wait(260);
  }
  companion.mood("talk");
  companion.say(
    partners.length
      ? `I found ${partners.length} organic picks from 365 by Whole Foods Market, our demo partner brand! Tap “Ask Bramble” on any of them.`
      : "No demo partner products on this page.",
    9000,
  );
}

grid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-ask]");
  if (button) companion.ask(`Tell me about the ${button.dataset.ask}.`);
});

scan();
