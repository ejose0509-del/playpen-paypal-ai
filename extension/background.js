// Bramble for PlayPen: the only part of the extension that talks to the farm server.
// The farm link (origin + private token) comes from pair.js when the player opens their farm.

function allowedOrigin(origin) {
  try {
    const url = new URL(origin);
    if (url.origin !== origin) return false;
    if (url.protocol === "http:") return url.hostname === "127.0.0.1" || url.hostname === "localhost";
    return url.protocol === "https:" && url.hostname.endsWith(".onrender.com");
  } catch {
    return false;
  }
}

async function api({ path, method = "GET", body }) {
  const { link } = await chrome.storage.local.get("link");
  if (!link) return { ok: false, status: 0, data: { message: "Open your PlayPen farm once so I can follow you." } };
  if (typeof path !== "string" || !path.startsWith("/extension/api/")) return { ok: false, status: 400, data: {} };
  try {
    const response = await fetch(link.origin + path, {
      method,
      credentials: "omit",
      headers: { "X-PlayPen-Token": link.token, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await response.json(); } catch { /* an error page */ }
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: { message: "I can’t reach your farm. Is PlayPen running?" } };
  }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.type === "pair") {
    const origin = sender.origin;
    if (!allowedOrigin(origin) || message.origin !== origin || typeof message.token !== "string" || !message.token) {
      reply({ ok: false });
      return false;
    }
    chrome.storage.local.get("link").then(({ link }) => {
      const fresh = !link || link.token !== message.token || link.origin !== origin;
      chrome.storage.local.set({ link: { origin, token: message.token } }).then(() => reply({ ok: true, fresh }));
    });
    return true;
  }
  if (message.type === "api") {
    api(message).then(reply);
    return true;
  }
  if (message.type === "open-farm") {
    chrome.storage.local.get("link").then(({ link }) => chrome.tabs.create({ url: link ? link.origin : "http://127.0.0.1:8010" }));
    return false;
  }
  return false;
});
