import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const eventsPath = path.join(dataDir, "events.json");
const samplesPath = path.join(dataDir, "samples.json");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 7088);
const wifiInterface = process.env.WIFI_INTERFACE || "en0";
const probeUrl = process.env.BANDWIDTH_PROBE_URL || "https://speed.cloudflare.com/__down?bytes=500000";
const captiveCheckUrl = process.env.CAPTIVE_CHECK_URL || "http://captive.apple.com/hotspot-detect.html";
const minimumHealthyMbps = Number(process.env.MIN_HEALTHY_MBPS || 1);
const minimumUsableMbps = Number(process.env.MIN_USABLE_MBPS || 0.15);

let status = {
  checkedAt: new Date().toISOString(),
  interface: wifiInterface,
  connected: false,
  hasBandwidth: false,
  health: "offline",
  ssid: null,
  ip: null,
  link: "unknown",
  lastBandwidthMbps: null,
  lastBandwidthAt: null,
  lastBandwidthError: null,
  captivePortal: {
    detected: false,
    loginUrl: null,
    checkedAt: null,
    reason: null
  },
  lastReconnectAt: null,
  lastBandwidthRestoredAt: null,
  lastBandwidthLostAt: null,
  lastDisconnectAt: null,
  lastChangedAt: null
};
let events = [];
let samples = [];
let speedTestRunning = false;
let diagnosticsCache = { at: 0, value: null };

function run(command, args, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const child = execFile(command, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        code: error?.code ?? 0
      });
    });
    child.stdin?.end();
  });
}

async function loadEvents() {
  await mkdir(dataDir, { recursive: true });
  if (existsSync(samplesPath)) {
    try {
      samples = JSON.parse(await readFile(samplesPath, "utf8")).slice(-500);
    } catch {
      samples = [];
    }
  }
  if (!existsSync(eventsPath)) return;
  try {
    events = JSON.parse(await readFile(eventsPath, "utf8")).slice(-100);
  } catch {
    events = [];
  }
}

async function saveEvents() {
  await mkdir(dataDir, { recursive: true });
  await writeFile(eventsPath, JSON.stringify(events.slice(-100), null, 2));
}

async function saveSamples() {
  await mkdir(dataDir, { recursive: true });
  await writeFile(samplesPath, JSON.stringify(samples.slice(-500), null, 2));
}

function addEvent(type, details = {}) {
  const event = { id: Date.now(), at: new Date().toISOString(), type, ...details };
  events.push(event);
  events = events.slice(-100);
  void saveEvents();
}

function addSample(sample) {
  samples.push(sample);
  samples = samples.slice(-500);
  void saveSamples();
}

function parseSSID(output) {
  const trimmed = output.trim();
  const prefix = "Current Wi-Fi Network: ";
  if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length).trim() || null;
  return null;
}

function parseSignalNoise(value) {
  const match = String(value || "").match(/(-?\d+)\s*dBm\s*\/\s*(-?\d+)\s*dBm/);
  if (!match) return { signalDbm: null, noiseDbm: null, snrDb: null };
  const signalDbm = Number(match[1]);
  const noiseDbm = Number(match[2]);
  return { signalDbm, noiseDbm, snrDb: signalDbm - noiseDbm };
}

function cleanMode(value) {
  return String(value || "")
    .replaceAll("spairport_security_mode_", "")
    .replaceAll("spairport_network_type_", "")
    .replaceAll("_", " ") || null;
}

function parseDefaultRoute(output) {
  const gateway = output.match(/gateway:\s+(.+)/)?.[1]?.trim() || null;
  const iface = output.match(/interface:\s+(.+)/)?.[1]?.trim() || null;
  const mtu = output.match(/mtu\s+(\d+)/)?.[1] || null;
  return { gateway, interface: iface, mtu: mtu ? Number(mtu) : null };
}

function parseDns(output) {
  const nameservers = [...output.matchAll(/nameserver\[\d+\]\s+:\s+(.+)/g)].map((match) => match[1].trim());
  return [...new Set(nameservers)].slice(0, 6);
}

function maskMac(value) {
  if (!value) return null;
  const parts = String(value).split(":");
  if (parts.length < 2) return "masked";
  return `**:**:**:**:${parts.at(-2)}:${parts.at(-1)}`;
}

async function getDiagnostics() {
  const now = Date.now();
  if (diagnosticsCache.value && now - diagnosticsCache.at < 30000) return diagnosticsCache.value;

  const [profiler, route, dns, power] = await Promise.all([
    run("system_profiler", ["SPAirPortDataType", "-json"], 12000),
    run("route", ["-n", "get", "default"]),
    run("scutil", ["--dns"]),
    run("networksetup", ["-getairportpower", wifiInterface])
  ]);

  let wifi = {};
  try {
    const parsed = JSON.parse(profiler.stdout);
    const interfaces = parsed.SPAirPortDataType?.[0]?.spairport_airport_interfaces || [];
    const primary = interfaces.find((item) => item._name === wifiInterface) || interfaces[0] || {};
    const current = primary.spairport_current_network_information || {};
    const signal = parseSignalNoise(current.spairport_signal_noise);
    const nearby = primary.spairport_airport_other_local_wireless_networks || [];
    wifi = {
      power: /:\s*On/i.test(power.stdout) ? "on" : "off",
      status: cleanMode(primary.spairport_status_information),
      currentNetworkName: current._name || null,
      channel: current.spairport_network_channel || null,
      countryCode: current.spairport_network_country_code || primary.spairport_wireless_country_code || null,
      phyMode: current.spairport_network_phymode || null,
      txRateMbps: current.spairport_network_rate || null,
      mcs: current.spairport_network_mcs ?? null,
      security: cleanMode(current.spairport_security_mode),
      signalNoise: current.spairport_signal_noise || null,
      signalDbm: signal.signalDbm,
      noiseDbm: signal.noiseDbm,
      snrDb: signal.snrDb,
      supportedPhyModes: primary.spairport_supported_phymodes || null,
      supportedChannelsCount: primary.spairport_supported_channels?.length || null,
      nearbyNetworksCount: nearby.length,
      strongestNearby: nearby.slice(0, 5).map((network) => {
        const strength = parseSignalNoise(network.spairport_signal_noise);
        return {
          name: network._name || "Hidden/Redacted",
          channel: network.spairport_network_channel || null,
          phyMode: network.spairport_network_phymode || null,
          security: cleanMode(network.spairport_security_mode),
          signalDbm: strength.signalDbm,
          snrDb: strength.snrDb
        };
      }),
      hardware: {
        cardType: primary.spairport_wireless_card_type || null,
        firmware: primary.spairport_wireless_firmware_version?.split("\n")[0] || null,
        macAddress: maskMac(primary.spairport_wireless_mac_address)
      }
    };
  } catch {
    wifi = { error: "Could not parse Wi-Fi profiler output" };
  }

  const value = {
    checkedAt: new Date().toISOString(),
    wifi,
    route: parseDefaultRoute(route.stdout),
    dnsServers: parseDns(dns.stdout)
  };
  diagnosticsCache = { at: now, value };
  return value;
}

async function probeBandwidth() {
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(probeUrl, {
      cache: "no-store",
      signal: controller.signal,
      headers: { "user-agent": "wifi-watch/0.1" }
    });
    if (!response.ok) throw new Error(`Probe returned HTTP ${response.status}`);
    const body = await response.arrayBuffer();
    const seconds = Math.max((performance.now() - started) / 1000, 0.001);
    return {
      ok: body.byteLength > 0,
      mbps: Math.round(((body.byteLength * 8) / seconds / 1_000_000) * 10) / 10,
      bytes: body.byteLength,
      at: new Date().toISOString(),
      error: null
    };
  } catch (error) {
    return {
      ok: false,
      mbps: 0,
      bytes: 0,
      at: new Date().toISOString(),
      error: error.name === "AbortError" ? "Bandwidth probe timed out" : error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

function classifyHealth(connected, probe) {
  if (!connected) return "offline";
  if (probe.captive?.detected) return "captive_portal";
  if (!probe.ok || probe.mbps < minimumUsableMbps) return "connected_no_bandwidth";
  if (probe.mbps < minimumHealthyMbps) return "degraded";
  return "healthy";
}

async function checkCaptivePortal() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(captiveCheckUrl, {
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
      headers: { "user-agent": "wifi-watch/0.1" }
    });
    const location = response.headers.get("location");
    if (location) {
      return {
        detected: true,
        loginUrl: new URL(location, captiveCheckUrl).toString(),
        checkedAt,
        reason: `Redirected from captive check with HTTP ${response.status}`
      };
    }
    const text = await response.text();
    const success = response.ok && /<BODY>Success<\/BODY>/i.test(text);
    return {
      detected: !success,
      loginUrl: !success ? captiveCheckUrl : null,
      checkedAt,
      reason: success ? null : `Unexpected captive-check response: HTTP ${response.status}`
    };
  } catch (error) {
    return {
      detected: false,
      loginUrl: null,
      checkedAt,
      reason: error.name === "AbortError" ? "Captive portal check timed out" : error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function getWifiStatus() {
  const [network, ip, ifconfig] = await Promise.all([
    run("networksetup", ["-getairportnetwork", wifiInterface]),
    run("ipconfig", ["getifaddr", wifiInterface]),
    run("ifconfig", [wifiInterface])
  ]);

  const ipAddress = ip.ok ? ip.stdout.trim() || null : null;
  const linkActive = /status:\s+active/i.test(ifconfig.stdout);
  const connected = Boolean(ipAddress && linkActive);
  const captive = connected ? await checkCaptivePortal() : { detected: false, loginUrl: null, checkedAt: new Date().toISOString(), reason: "Network interface is offline" };
  const probe = connected && !captive.detected
    ? await probeBandwidth()
    : { ok: false, mbps: 0, at: new Date().toISOString(), error: captive.detected ? "Captive portal detected" : "Network interface is offline", captive };
  probe.captive = captive;
  const health = classifyHealth(connected, probe);
  const hasBandwidth = health === "healthy" || health === "degraded";
  const ssid = parseSSID(network.stdout);
  const diagnostics = await getDiagnostics();
  const now = new Date().toISOString();
  const previous = status;

  const next = {
    checkedAt: now,
    interface: wifiInterface,
    connected,
    hasBandwidth,
    health,
    ssid,
    ip: ipAddress,
    link: linkActive ? "active" : "inactive",
    diagnostics,
    lastBandwidthMbps: connected ? probe.mbps : null,
    lastBandwidthAt: connected ? probe.at : null,
    lastBandwidthError: probe.error,
    captivePortal: captive,
    lastReconnectAt: previous.lastReconnectAt,
    lastBandwidthRestoredAt: previous.lastBandwidthRestoredAt,
    lastBandwidthLostAt: previous.lastBandwidthLostAt,
    lastDisconnectAt: previous.lastDisconnectAt,
    lastChangedAt: previous.lastChangedAt
  };

  if (!previous.connected && connected) {
    next.lastReconnectAt = now;
    next.lastChangedAt = now;
    addEvent("reconnected", { ssid, ip: ipAddress });
  } else if (previous.connected && !connected) {
    next.lastDisconnectAt = now;
    next.lastChangedAt = now;
    addEvent("disconnected");
  } else if (previous.connected && connected && previous.ip !== ipAddress) {
    next.lastChangedAt = now;
    addEvent("ip_changed", { from: previous.ip, to: ipAddress, ssid });
  } else if (previous.connected && connected && previous.ssid !== ssid && ssid) {
    next.lastChangedAt = now;
    addEvent("ssid_changed", { from: previous.ssid, to: ssid, ip: ipAddress });
  }

  if (!previous.hasBandwidth && hasBandwidth) {
    next.lastBandwidthRestoredAt = now;
    next.lastChangedAt = now;
    addEvent("bandwidth_restored", { mbps: probe.mbps, health, ssid, ip: ipAddress });
  } else if (previous.hasBandwidth && !hasBandwidth) {
    next.lastBandwidthLostAt = now;
    next.lastChangedAt = now;
    addEvent("bandwidth_lost", { health, error: probe.error, ssid, ip: ipAddress });
  } else if (previous.health !== health) {
    next.lastChangedAt = now;
    addEvent("health_changed", { from: previous.health, to: health, mbps: probe.mbps, error: probe.error });
  }

  if (!previous.captivePortal?.detected && captive.detected) {
    addEvent("captive_portal_detected", { loginUrl: captive.loginUrl, reason: captive.reason });
  }

  status = next;
  addSample({
    at: now,
    health,
    mbps: connected ? probe.mbps : 0,
    hasBandwidth,
    captivePortal: captive.detected
  });
}

function mbps(bitsPerSecond) {
  return Math.round((Number(bitsPerSecond || 0) / 1_000_000) * 10) / 10;
}

async function runSpeedTest() {
  if (speedTestRunning) {
    return { ok: false, error: "A speed test is already running." };
  }
  speedTestRunning = true;
  const startedAt = new Date().toISOString();
  addEvent("speedtest_started");
  try {
    const result = await run("networkQuality", ["-I", wifiInterface, "-c", "-M", "15"], 30000);
    if (!result.ok) {
      addEvent("speedtest_failed", { error: result.stderr || result.stdout });
      return { ok: false, startedAt, finishedAt: new Date().toISOString(), error: result.stderr || result.stdout };
    }

    let raw = null;
    try {
      raw = JSON.parse(result.stdout);
    } catch {
      return { ok: false, startedAt, finishedAt: new Date().toISOString(), error: "Could not parse networkQuality output.", output: result.stdout };
    }

    const summary = {
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      interface: raw.interface_name || wifiInterface,
      endpoint: raw.test_endpoint || null,
      downloadMbps: mbps(raw.dl_throughput),
      uploadMbps: mbps(raw.ul_throughput),
      baseRttMs: Math.round(Number(raw.base_rtt || 0)),
      responsiveness: Math.round(Number(raw.responsiveness || 0)),
      raw
    };
    addEvent("speedtest_completed", {
      downloadMbps: summary.downloadMbps,
      uploadMbps: summary.uploadMbps,
      baseRttMs: summary.baseRttMs
    });
    return summary;
  } finally {
    speedTestRunning = false;
  }
}

function sendJson(res, value, statusCode = 200) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(JSON.stringify(value, null, 2));
}

function securityHeaders(contentType) {
  return {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "geolocation=(), microphone=(), camera=(), payment=(), usb=(), bluetooth=()",
    "content-security-policy": "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
  };
}

function isLocalRequest(req) {
  const remote = req.socket.remoteAddress;
  const hostHeader = String(req.headers.host || "").toLowerCase();
  const localSocket = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  const localHost = hostHeader.startsWith("127.0.0.1:") || hostHeader.startsWith("localhost:");
  return localSocket && localHost;
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const cleanPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(publicDir, cleanPath));
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  const ext = path.extname(filePath);
  const type = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8"
  }[ext] || "application/octet-stream";
  try {
    const body = await readFile(filePath);
    res.writeHead(200, securityHeaders(type));
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

await loadEvents();
await getWifiStatus();
setInterval(() => void getWifiStatus(), 3000);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,OPTIONS",
      "access-control-allow-headers": "content-type"
    });
    res.end();
    return;
  }
  if (url.pathname === "/api/status") return sendJson(res, { status, speedTestRunning });
  if (url.pathname === "/api/events") return sendJson(res, { events: events.slice(-50).reverse() });
  if (url.pathname === "/api/samples") return sendJson(res, { samples: samples.slice(-120) });
  if (url.pathname === "/api/speedtest" && req.method === "POST") {
    if (!isLocalRequest(req)) return sendJson(res, { ok: false, error: "Speed test trigger is only available from localhost." }, 403);
    return sendJson(res, await runSpeedTest());
  }
  return serveStatic(req, res);
});

server.listen(port, host, () => {
  console.log(`wifi-watch listening on http://${host}:${port}`);
});
