# @juanmonaco/homebridge-remeha

Homebridge plugin for Brötje / Remeha boiler systems via the BDR Thermea cloud API.

Exposes your heating climate zones as native HomeKit thermostats, allowing you to:
- View current room temperature
- Set target temperature
- Switch between AUTO (schedule), HEAT (manual hold), and OFF (anti-frost) modes

## Supported Systems

Any Brötje or Remeha boiler managed via the **Brötje Home Komfort** or **Remeha Home** app (BDR Thermea cloud).

## Installation

### Option 1 — Homebridge UI (recommended)

1. Open the Homebridge UI (port 8581)
2. Go to **Plugins** → search for `@juanmonaco/homebridge-remeha`
3. Click **Install**

### Option 2 — From GitHub

```bash
npm install github:juanmonaco/homebridge-remeha
```

Or add it directly to your Homebridge `package.json` dependencies:

```json
"@juanmonaco/homebridge-remeha": "github:juanmonaco/homebridge-remeha"
```

### Option 3 — Manual install on Docker-based Homebridge

Copy the plugin files into your Homebridge volume and register it:

```bash
# Copy plugin source into node_modules
cp -r homebridge-remeha /your/homebridge/volumes/homebridge/node_modules/@juanmonaco/homebridge-remeha

# Add to Homebridge package.json dependencies:
# "@juanmonaco/homebridge-remeha": "github:juanmonaco/homebridge-remeha"

# Restart Homebridge
docker restart homebridge
```

## Configuration

Add the following platform to your Homebridge `config.json`:

```json
{
  "platform": "RemehaPlatform",
  "name": "Remeha",
  "email": "your@email.com",
  "password": "yourpassword",
  "pollIntervalSeconds": 60
}
```

| Field | Required | Default | Description |
|---|---|---|---|
| `email` | Yes | — | Brötje/Remeha app login email |
| `password` | Yes | — | Brötje/Remeha app login password |
| `pollIntervalSeconds` | No | `60` | How often to refresh temperature data from the API (minimum 30s) |

## How It Works

Uses the BDR Thermea OAuth2 API (`https://api.bdrthermea.net/Mobile/api/`) — the same API used by the official Brötje Home Komfort and Remeha Home apps. Authentication uses the Azure AD B2C OAuth2 flow with PKCE.

No local network access to the boiler is required. Everything goes through the BDR Thermea cloud.

## Thermostat Modes

| HomeKit Mode | Remeha Mode | Behaviour |
|---|---|---|
| AUTO | Scheduling | Follows the boiler's configured time schedule |
| HEAT | Manual | Holds the target temperature indefinitely |
| OFF | Anti-frost | Sets the zone to frost protection (minimum temperature) |

Setting a target temperature while in AUTO mode activates a **temporary override** — the schedule resumes automatically at the next scheduled switch time.

## Updating the Plugin

The source lives at `/home/familypi/persistent/homebridge-remeha` on the Pi.
Git is configured with SSH — no token needed.

```bash
# SSH into the Pi
ssh familypi@familypi

# Go to the plugin source
cd /home/familypi/persistent/homebridge-remeha

# Edit files as needed, then:
git add .
git commit -m "fix: describe your change"
git push

# Sync the updated files into the Homebridge node_modules
sudo cp lib/api.js lib/platform.js lib/accessory.js index.js package.json \
  /home/familypi/persistent/homebridge/volumes/homebridge/node_modules/@juanmonaco/homebridge-remeha/
sudo cp -r lib/ \
  /home/familypi/persistent/homebridge/volumes/homebridge/node_modules/@juanmonaco/homebridge-remeha/

# Restart Homebridge to pick up the changes
sudo docker restart homebridge
```

## Requirements

- Node.js >= 18.0.0
- Homebridge >= 1.6.0
- A Brötje IDA / Remeha thermostat connected to the BDR Thermea cloud (set up via the official app)

## License

MIT © Juan Monaco
