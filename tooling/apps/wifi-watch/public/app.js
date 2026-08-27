const $ = (id) => document.getElementById(id);
const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });

function time(value) {
  if (!value) return "-";
  return fmt.format(new Date(value));
}

async function getJson(url, options) {
  const res = await fetch(url, { cache: "no-store", ...options });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function renderStatus(payload) {
  const { status, speedTestRunning } = payload;
  const labels = {
    healthy: "Healthy",
    degraded: "Degraded",
    captive_portal: "Login needed",
    connected_no_bandwidth: "No bandwidth",
    offline: "Offline"
  };
  const tone = status.health === "healthy" ? "ok" : ["degraded", "captive_portal"].includes(status.health) ? "warn" : "bad";
  $("badge").textContent = labels[status.health] || status.health;
  $("badge").className = `badge ${tone}`;
  $("signal").className = `signal ${tone}`;
  $("probeSpeed").textContent = status.lastBandwidthMbps ?? "-";
  $("checkedAt").textContent = `Checked ${time(status.checkedAt)}`;
  $("interfaceName").textContent = status.interface || "-";
  $("ip").textContent = status.ip || "-";
  $("ssid").textContent = status.ssid || "Unavailable";
  $("lastReconnect").textContent = time(status.lastReconnectAt);
  $("lastRestored").textContent = time(status.lastBandwidthRestoredAt);
  $("lastIssue").textContent = status.lastBandwidthError || time(status.lastBandwidthLostAt);
  if (status.captivePortal?.detected) {
    $("portal").classList.remove("hidden");
    $("portalReason").textContent = status.captivePortal.reason || "A login page may be required before bandwidth works.";
    $("portalLink").href = status.captivePortal.loginUrl || "http://captive.apple.com/hotspot-detect.html";
  } else {
    $("portal").classList.add("hidden");
  }
  $("runSpeed").disabled = speedTestRunning;
  if (speedTestRunning) $("runSpeed").textContent = "Running";
  else $("runSpeed").textContent = "Run";
}

function renderEvents(payload) {
  $("eventCount").textContent = payload.events.length;
  $("events").innerHTML = payload.events.map((event) => {
    const title = event.type.replaceAll("_", " ");
    const detail = [event.ssid, event.ip, event.downloadMbps ? `${event.downloadMbps} Mbps down` : null]
      .filter(Boolean)
      .join(" · ");
    return `<li><div><b>${title}</b><p class="muted">${detail || "No extra details"}</p></div><time>${time(event.at)}</time></li>`;
  }).join("");
}

async function refresh() {
  try {
    renderStatus(await getJson("/api/status"));
    renderEvents(await getJson("/api/events"));
  } catch (error) {
    $("badge").textContent = "Server error";
    $("badge").className = "badge bad";
  }
}

$("runSpeed").addEventListener("click", async () => {
  $("runSpeed").disabled = true;
  $("runSpeed").textContent = "Running";
  $("speedMeta").textContent = "Testing download, upload, and responsiveness from this Mac...";
  try {
    const result = await getJson("/api/speedtest", { method: "POST" });
    if (!result.ok) throw new Error(result.error || "Speed test failed");
    $("download").textContent = result.downloadMbps;
    $("upload").textContent = result.uploadMbps;
    $("latency").textContent = result.baseRttMs;
    $("speedMeta").textContent = `Endpoint: ${result.endpoint || "Apple networkQuality"} · ${time(result.finishedAt)}`;
  } catch (error) {
    $("speedMeta").textContent = error.message;
  } finally {
    await refresh();
  }
});

refresh();
setInterval(refresh, 3000);
