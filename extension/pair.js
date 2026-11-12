// Runs on PlayPen pages only. Hands this farm's extension token to the background worker.
(function () {
  const meta = document.querySelector('meta[name="playpen-extension-token"]');
  if (!meta || !meta.content) return;
  chrome.runtime.sendMessage({ type: "pair", origin: location.origin, token: meta.content }, (result) => {
    if (!result || !result.ok || !result.fresh) return;
    const toast = document.createElement("div");
    toast.textContent = "🦔 Bramble can follow you around Chrome now.";
    toast.setAttribute("role", "status");
    Object.assign(toast.style, {
      position: "fixed", left: "16px", bottom: "16px", zIndex: 2147483647, padding: "10px 14px",
      borderRadius: "12px", background: "#486126", color: "#fff8e6", font: "600 15px/1.3 system-ui, sans-serif",
      boxShadow: "0 6px 20px #0004", transition: "opacity .4s",
    });
    document.body.append(toast);
    setTimeout(() => { toast.style.opacity = "0"; setTimeout(() => toast.remove(), 500); }, 4200);
  });
})();
