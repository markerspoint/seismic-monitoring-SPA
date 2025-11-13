// ---- BASIC MAP INITIALIZATION ----
const map = L.map("map", {
  center: [12.8797, 121.774],
  zoom: 5,
  tapTolerance: 40,
});

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

// Separate layer groups: one for quakes, one for user location
let markersLayer = L.layerGroup().addTo(map);
let userLayer = L.layerGroup().addTo(map);

// const API_URL = "http://localhost:3001/api/earthquakes"; // local
const API_URL = "/api/earthquakes"; // hosting

const lastUpdatedEl = document.getElementById("last-updated");
const lastUpdatedMobile = document.getElementById("last-updated-mobile");
const tableBody = document.getElementById("table-body");
const tableBodyMobile = document.getElementById("table-body-mobile");
const countBadge = document.getElementById("count-badge");
const errorToast = document.getElementById("error-toast");
const minMagSelect = document.getElementById("min-mag");
const refreshBtn = document.getElementById("refresh-btn");
const refreshBtnMobile = document.getElementById("refresh-btn-mobile");
const locateBtn = document.getElementById("locate-btn");

const mobileBtn = document.getElementById("mobile-menu-btn");
const mobileMenu = document.getElementById("mobile-menu");

// Mobile recent modal
const openRecentBtn = document.getElementById("open-recent-btn");
const recentModal = document.getElementById("recent-modal");
const recentModalBackdrop = document.getElementById("recent-modal-backdrop");
const closeRecentBtn = document.getElementById("close-recent-btn");

// Location modal
const locationModal = document.getElementById("location-modal");
const allowLocationBtn = document.getElementById("allow-location");
const denyLocationBtn = document.getElementById("deny-location");

let allEarthquakes = [];
let userLocationMarker = null;
let userLocationCircle = null;

function showError(message) {
  errorToast.textContent = message;
  errorToast.classList.remove("hidden");
  setTimeout(() => {
    errorToast.classList.add("hidden");
  }, 4000);
}

function formatDateTime(raw) {
  return raw || "N/A";
}

function updateLastUpdated() {
  const nowStr = new Date().toLocaleString();
  if (lastUpdatedEl) {
    lastUpdatedEl.innerHTML =
      "Last updated: <span class='font-medium'>" + nowStr + "</span>";
  }
  if (lastUpdatedMobile) {
    lastUpdatedMobile.textContent = nowStr;
  }
}

function clearMarkers() {
  markersLayer.clearLayers(); // don't clear userLayer here
}

function getFilteredEarthquakes() {
  const minMag = parseFloat(minMagSelect.value || "0");
  return allEarthquakes.filter((eq) =>
    isNaN(minMag) ? true : (eq.magnitude || 0) >= minMag
  );
}

function getMagnitudeColor(mag) {
  if (mag == null || isNaN(mag)) return "#64748b"; // slate (unknown)
  if (mag < 2.5) return "#3b82f6"; // blue  (very weak)
  if (mag < 4.0) return "#22c55e"; // green (light)
  if (mag < 5.0) return "#eab308"; // yellow (moderate)
  if (mag < 6.0) return "#f97316"; // orange (strong)
  return "#ef4444"; // red (very strong)
}

// Legend
const legend = L.control({ position: "topleft" });

legend.onAdd = function (map) {
  const div = L.DomUtil.create("div", "magnitude-legend");

  const ranges = [
    { label: "< 2.5", from: 0, to: 2.5 },
    { label: "2.5 – 3.9", from: 2.5, to: 4.0 },
    { label: "4.0 – 4.9", from: 4.0, to: 5.0 },
    { label: "5.0 – 5.9", from: 5.0, to: 6.0 },
    { label: "6.0+", from: 6.0, to: 10.0 },
  ];

  let html = `
        <div class="legend-title">Legend</div>
        <div class="legend-title" style="margin-top:6px;">Magnitude</div>
        <div class="legend-item" style="margin-bottom:4px;">
          <div style="
            width: 0;
            height: 0;
            border-left: 6px solid transparent;
            border-right: 6px solid transparent;
            border-bottom: 10px solid #ef4444;
          "></div>
          <span>Latest earthquake</span>
        </div>
      `;

  ranges.forEach((r) => {
    const sampleMag = (r.from + r.to) / 2;
    const color = getMagnitudeColor(sampleMag);

    html += `
          <div class="legend-item">
            <span class="color-box" style="background:${color};"></span>
            <span>${r.label}</span>
          </div>
        `;
  });

  div.innerHTML = html;
  return div;
};

legend.addTo(map);

function renderMarkers() {
  clearMarkers();
  const filtered = getFilteredEarthquakes();
  if (!filtered.length) return;

  // latest quake is the first one in the sorted list
  const latest = filtered[0];

  filtered.forEach((eq) => {
    if (
      typeof eq.lat !== "number" ||
      typeof eq.lon !== "number" ||
      Number.isNaN(eq.lat) ||
      Number.isNaN(eq.lon)
    ) {
      return;
    }

    const zoom = map.getZoom();
    const zoomFactor = 1 + (zoom - 5) * 0.3;
    const mag = eq.magnitude ?? 0;

    const baseSize = Math.max(mag * 3, 10);
    const size = baseSize * Math.max(zoomFactor, 0.5);

    const color = getMagnitudeColor(mag);
    const magLabel = mag != null && !Number.isNaN(mag) ? mag.toFixed(1) : "?";

    // LATEST quake → triangle marker
    if (eq === latest) {
      const triangleIcon = L.divIcon({
        className: "",
        html: `<div class="latest-quake" style="border-bottom-color:${color};"></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 20],
      });

      const marker = L.marker([eq.lat, eq.lon], { icon: triangleIcon });

      marker.bindPopup(`
            <div class="text-xs">
              <div class="font-bold text-sm mb-1" style="color:${color};">
                🔺 Latest earthquake
              </div>
              <div class="font-bold text-base mb-1" style="color:${color};">
                Magnitude: ${magLabel}
              </div>
              <div class="text-slate-400">${
                eq.location || "Unknown location"
              }</div>
              <div class="text-slate-400 mt-1">${formatDateTime(
                eq.datetime
              )}</div>
              <div class="text-slate-400">Depth: ${eq.depth_km ?? "?"} km</div>
              ${
                eq.detailLink
                  ? `<a href="${eq.detailLink}" target="_blank"
                       class="underline text-sky-300 hover:text-sky-200 mt-1 block">
                       View PHIVOLCS Report →
                     </a>`
                  : ""
              }
              <div class="mt-1 text-[11px] text-slate-400">Source: PHIVOLCS</div>
            </div>
          `);

      marker.addTo(markersLayer);
      return; // skip circle logic for latest
    }

    // All other quakes → circle markers
    const circle = L.circleMarker([eq.lat, eq.lon], {
      radius: size,
      weight: 2,
      color: color,
      fillColor: color,
      fillOpacity: 0.15,
    });

    const popupHtml = `
          <div class="text-xs z-50">
            <div class="font-bold text-lg mb-1" style="color: ${color};">
              Magnitude: ${magLabel}
            </div>
            <div class="text-slate-400">${
              eq.location || "Unknown location"
            }</div>
            <div class="text-slate-400 mt-1">${formatDateTime(
              eq.datetime
            )}</div>
            <div class="text-slate-400">Depth: ${eq.depth_km ?? "?"} km</div>
            ${
              eq.detailLink
                ? `<a href="${eq.detailLink}" target="_blank"
                    class="underline text-sky-300 hover:text-sky-200 mt-1 block">
                    View PHIVOLCS Report →
                  </a>`
                : ""
            }
            <div class="mt-1 text-[11px] text-slate-400">Source: PHIVOLCS</div>
          </div>
        `;

    circle.bindPopup(popupHtml);
    circle.addTo(markersLayer);
  });
}

function renderTable() {
  const filtered = getFilteredEarthquakes();

  tableBody.innerHTML = "";
  if (tableBodyMobile) tableBodyMobile.innerHTML = "";

  if (!filtered.length) {
    const emptyRowHtml =
      '<tr><td colspan="4" class="px-3 py-4 text-center text-slate-400">No earthquakes found for this filter.</td></tr>';

    tableBody.innerHTML = emptyRowHtml;
    if (tableBodyMobile) tableBodyMobile.innerHTML = emptyRowHtml;

    countBadge.textContent = "0 events";
    return;
  }

  filtered.forEach((eq) => {
    const mag =
      eq.magnitude != null && !Number.isNaN(eq.magnitude)
        ? eq.magnitude.toFixed(1)
        : "?";

    const pillClass =
      eq.magnitude >= 5
        ? "bg-red-600/20 text-red-400"
        : eq.magnitude >= 4
        ? "bg-amber-500/20 text-amber-300"
        : "bg-emerald-500/15 text-emerald-300";

    const rowHtml = `
      <td class="px-3 py-2 whitespace-nowrap">
        <span class="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${pillClass}">
          ${mag}
        </span>
      </td>
      <td class="px-3 py-2 align-top">
        <div class="text-xs text-slate-100">${formatDateTime(eq.datetime)}</div>
      </td>
      <td class="px-3 py-2 align-top">
        <div class="text-xs text-slate-100">${eq.location || "Unknown"}</div>
      </td>
      <td class="px-3 py-2 align-top text-right text-xs text-slate-200">
        ${eq.depth_km != null && !Number.isNaN(eq.depth_km) ? eq.depth_km : "?"}
      </td>
    `;

    // ----- DESKTOP ROW -----
    const trDesktop = document.createElement("tr");
    trDesktop.className = "border-b border-slate-800/60 hover:bg-slate-800/50";

    // If we have a PHIVOLCS detail link, make row clickable
    if (eq.detailLink) {
      trDesktop.classList.add("cursor-pointer");
      trDesktop.addEventListener("click", () => {
        window.open(eq.detailLink, "_blank");
      });
    }

    trDesktop.innerHTML = rowHtml;
    tableBody.appendChild(trDesktop);

    // ----- MOBILE ROW (MODAL) -----
    if (tableBodyMobile) {
      const trMobile = document.createElement("tr");
      trMobile.className = "border-b border-slate-800/60 hover:bg-slate-800/50";

      if (eq.detailLink) {
        trMobile.classList.add("cursor-pointer");
        trMobile.addEventListener("click", () => {
          window.open(eq.detailLink, "_blank");
        });
      }

      trMobile.innerHTML = rowHtml;
      tableBodyMobile.appendChild(trMobile);
    }
  });

  countBadge.textContent =
    filtered.length + (filtered.length === 1 ? " event" : " events");
}

// ---- Helpers to parse your API format ----
function parseNumber(val) {
  if (val === undefined || val === null) return null;
  const num = parseFloat(String(val).replace(/[^\d.-]/g, ""));
  return isNaN(num) ? null : num;
}

function parseCoord(val) {
  if (val === undefined || val === null) return null;
  let s = String(val).trim();
  let sign = 1;
  if (/[SW]/i.test(s)) sign = -1;
  const num = parseFloat(s.replace(/[^\d.]/g, ""));
  return isNaN(num) ? null : sign * num;
}

// ---- Locate user ----
function locateUser() {
  if (!navigator.geolocation) {
    showError("Geolocation is not supported by this browser.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;

      // Remove old user location visuals
      if (userLocationMarker) {
        userLayer.removeLayer(userLocationMarker);
      }
      if (userLocationCircle) {
        userLayer.removeLayer(userLocationCircle);
      }

      userLocationMarker = L.marker([latitude, longitude]).addTo(userLayer)
        .bindPopup(`
              <div class="text-xs">
                <div class="font-semibold mb-1">You are here!</div>
              </div>
            `);

      userLocationCircle = L.circle([latitude, longitude], {
        radius: accuracy || 500,
        weight: 1,
        fillOpacity: 0.1,
      }).addTo(userLayer);

      map.setView([latitude, longitude], 8);
      userLocationMarker.openPopup();
    },
    (err) => {
      console.error("Geolocation error:", err);

      if (err.code === err.PERMISSION_DENIED) {
        showError(
          "Location permission denied. Please allow location access in your browser."
        );
      } else if (err.code === err.POSITION_UNAVAILABLE) {
        showError(
          "Location unavailable. Try turning on Wi-Fi / GPS or disabling VPN."
        );
      } else if (err.code === err.TIMEOUT) {
        showError("Location request timed out. Please try again.");
      } else {
        showError("Unable to get your location.");
      }
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    }
  );
}

async function loadEarthquakes() {
  tableBody.innerHTML =
    '<tr><td colspan="4" class="px-3 py-4 text-center text-slate-400">Loading latest earthquakes…</td></tr>';
  if (tableBodyMobile) {
    tableBodyMobile.innerHTML =
      '<tr><td colspan="4" class="px-3 py-4 text-center text-slate-400">Loading latest earthquakes…</td></tr>';
  }

  try {
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error("API error: " + res.status);
    const data = await res.json();

    const rawArray = Array.isArray(data)
      ? data
      : data.data || data.earthquakes || [];

    allEarthquakes = rawArray.map((eq) => ({
      datetime: eq.dateTime || eq.datetime || eq.time || "",
      lat: parseCoord(eq.latitude ?? eq.lat),
      lon: parseCoord(eq.longitude ?? eq.lon),
      depth_km: parseNumber(eq.depth ?? eq.depth_km),
      magnitude: parseNumber(eq.magnitude ?? eq.mag),
      location: eq.location || "",
      detailLink: eq.detailLink || null,
    }));

    allEarthquakes.sort((a, b) => {
      return new Date(b.datetime) - new Date(a.datetime);
    });

    updateLastUpdated();
    renderMarkers();
    renderTable();
  } catch (err) {
    console.error(err);
    showError("Failed to load earthquakes. Check if the Node API is running.");
    tableBody.innerHTML =
      '<tr><td colspan="4" class="px-3 py-4 text-center text-red-400">Error loading data from API.</td></tr>';
    if (tableBodyMobile) {
      tableBodyMobile.innerHTML =
        '<tr><td colspan="4" class="px-3 py-4 text-center text-red-400">Error loading data from API.</td></tr>';
    }
    countBadge.textContent = "0 events";
  }
}

// ---- UI Wiring ----

// Mobile navbar toggle
mobileBtn?.addEventListener("click", () => {
  mobileMenu.classList.toggle("hidden");
});

// Mobile recent modal open/close
function openRecentModal() {
  recentModal.classList.remove("hidden");
  // Close the dropdown menu so it doesn't stay open behind
  mobileMenu.classList.add("hidden");
}

function closeRecentModal() {
  recentModal.classList.add("hidden");
}

openRecentBtn?.addEventListener("click", openRecentModal);
closeRecentBtn?.addEventListener("click", closeRecentModal);
recentModalBackdrop?.addEventListener("click", closeRecentModal);

// Location permission modal logic
window.addEventListener("DOMContentLoaded", () => {
  if (locationModal) {
    locationModal.classList.remove("hidden");
  }
});

allowLocationBtn?.addEventListener("click", () => {
  locationModal.classList.add("hidden");
  locateUser();
});

denyLocationBtn?.addEventListener("click", () => {
  locationModal.classList.add("hidden");
});

// Filters & buttons
minMagSelect.addEventListener("change", () => {
  renderMarkers();
  renderTable();
});

refreshBtn?.addEventListener("click", () => {
  loadEarthquakes();
});

refreshBtnMobile?.addEventListener("click", () => {
  loadEarthquakes();
});

locateBtn.addEventListener("click", () => {
  locateUser();
});

// Recompute marker size on zoom
map.on("zoomend", () => {
  renderMarkers();
});

// Initial load
loadEarthquakes();
