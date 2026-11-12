// Farm ledger: the server's reward ledger, Sandbox orders and demo donations in AG Grid.
(async function () {
  const page = document.getElementById("ledger");
  const note = document.getElementById("ledger-note");
  const money = (value) => (value == null ? "" : `$${value.toFixed(2)}`);
  const kindIcon = { xp: "🌾", money: "💳", donation: "💛" };
  let group = "all";

  function when(params) {
    if (!params.value) return params.data.group === "money" ? "" : "Earlier";
    const date = new Date(params.value * 1000);
    const today = new Date().toDateString() === date.toDateString();
    return today
      ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : date.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  const columnDefs = [
    { field: "when", headerName: "When", valueFormatter: when, width: 100, sort: "desc", sortingOrder: ["desc", "asc"] },
    {
      field: "kind", headerName: "Type", width: 160, filter: "agTextColumnFilter",
      cellRenderer: (params) => `<span class="kind-dot" data-group="${params.data.group}" aria-hidden="true">${kindIcon[params.data.group] || ""}</span> ${params.value}`,
    },
    { field: "item", headerName: "Item", flex: 1, minWidth: 170, filter: "agTextColumnFilter" },
    { field: "xp", headerName: "XP", width: 80, type: "numericColumn", valueFormatter: (p) => (p.value ? `+${p.value}` : "") },
    { field: "amount", headerName: "Amount", width: 100, type: "numericColumn", valueFormatter: (p) => money(p.value) },
    { field: "status", headerName: "Status", width: 190, filter: "agTextColumnFilter" },
    { field: "reference", headerName: "Reference", width: 160 },
  ];

  const grid = agGrid.createGrid(document.getElementById("ledger-grid"), {
    columnDefs,
    rowData: [],
    defaultColDef: { sortable: true, resizable: true, suppressMovable: true },
    animateRows: true,
    overlayLoadingTemplate: '<span class="ledger-overlay">Opening the ledger…</span>',
    overlayNoRowsTemplate: '<span class="ledger-overlay">Nothing recorded yet. Harvest your first crop!</span>',
    isExternalFilterPresent: () => group !== "all",
    doesExternalFilterPass: (node) => node.data.group === group,
    getRowClass: (params) => `row-${params.data.group}`,
  });
  grid.showLoadingOverlay();

  function fitColumns() {
    const narrow = page.clientWidth < 640;
    grid.setColumnsVisible(["status", "reference"], !narrow);
    grid.setColumnsVisible(["kind"], page.clientWidth >= 420);
  }
  fitColumns();
  addEventListener("resize", fitColumns);

  for (const chip of document.querySelectorAll("[data-group]")) {
    if (!chip.matches("button")) continue;
    chip.addEventListener("click", () => {
      group = chip.dataset.group;
      for (const other of document.querySelectorAll(".ledger-chips button")) {
        other.setAttribute("aria-pressed", String(other === chip));
      }
      grid.onFilterChanged();
    });
  }
  document.getElementById("ledger-search").addEventListener("input", (event) => {
    grid.setGridOption("quickFilterText", event.target.value);
  });

  try {
    const response = await fetch(page.dataset.url);
    if (!response.ok) throw new Error();
    const { rows, summary } = await response.json();
    grid.setGridOption("rowData", rows);
    if (!rows.length) grid.showNoRowsOverlay();
    document.getElementById("tile-xp").textContent = summary.xp;
    document.getElementById("tile-rewards").textContent = `${summary.rewards} rewards earned`;
    document.getElementById("tile-donated").textContent = money(summary.donated);
    document.getElementById("tile-sandbox").textContent = money(summary.sandbox_paid);
  } catch {
    grid.hideOverlay();
    note.hidden = false;
    note.textContent = "The ledger couldn’t be loaded. Return to the farm and try again.";
  }
})();
