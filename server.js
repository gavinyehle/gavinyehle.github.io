import express from "express";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Replace with your OpenSky OAuth2 credentials
const clientId = "ravioli-api-client";
const clientSecret = "UnhFTieTu4LzuXnjXkmdlB7CyWREDNRl";

let cachedToken = null;
let tokenExpiry = null;

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && tokenExpiry && now < tokenExpiry) {
    return cachedToken;
  }

  const res = await fetch("https://opensky-network.org/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = now + data.expires_in * 1000;
  return cachedToken;
}

// Helper: fetch callsign info (origin, destination, airline, type)
async function getCallsignInfo(callsign) {
  if (!callsign) return null;
  try {
    const res = await fetch(`https://api.adsbdb.com/v0/callsign/${callsign.trim()}`);
    const data = await res.json();
    if (data && data.response) {
      return {
        airline: data.response.airline?.name || null,
        logo: data.response.airline?.logo || null,
        origin: data.response.origin?.iata_code || null,
        destination: data.response.destination?.iata_code || null,
        aircraftType: data.response.aircraft?.icao_code || null,
      };
    }
  } catch (e) {
    console.error("Callsign lookup failed:", e);
  }
  return null;
}

// Proxy endpoint: return only closest plane within 4 miles, <10k ft
app.get("/planes", async (req, res) => {
  try {
    const token = await getAccessToken();

    const r = await fetch("https://opensky-network.org/api/states/all", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await r.json();

    const lat = 47.57, lon = -122.39;
    const maxDist = 4 * 1852;
    const maxAlt = 3048;

    function distance(lat1, lon1, lat2, lon2) {
      const R = 6371000;
      const φ1 = lat1 * Math.PI / 180;
      const φ2 = lat2 * Math.PI / 180;
      const dφ = (lat2-lat1) * Math.PI / 180;
      const dλ = (lon2-lon1) * Math.PI / 180;
      const a = Math.sin(dφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(dλ/2)**2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }

    let closest = null;
    let minDist = Infinity;

    for (const s of (data.states || [])) {
      const callsign = s[1]?.trim();
      const lonP = s[5];
      const latP = s[6];
      const alt = s[13];

      if (!latP || !lonP || !alt) continue;
      if (alt > maxAlt) continue;

      const d = distance(lat, lon, latP, lonP);
      if (d < maxDist && d < minDist) {
        minDist = d;
        closest = { callsign, lat: latP, lon: lonP, alt };
      }
    }

    if (!closest) {
      return res.json({ plane: null });
    }

    // lookup extra info
    const info = await getCallsignInfo(closest.callsign);

    res.json({
      plane: {
        callsign: closest.callsign,
        altitude_ft: (closest.alt * 3.281).toFixed(0),
        distance_miles: (minDist / 1852).toFixed(1),
        ...info,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch planes" });
  }
});

// Serve static frontend
app.use(express.static(path.join(__dirname, "public")));

const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));