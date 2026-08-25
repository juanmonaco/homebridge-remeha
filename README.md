# @juanmonaco/homebridge-remeha

Homebridge plugin for Brötje / Remeha boiler systems via the BDR Thermea cloud API.

Exposes your heating climate zones as native HomeKit thermostats, allowing you to:
- View current room temperature
- Set target temperature
- Switch between AUTO (schedule), HEAT (manual hold), and OFF (anti-frost) modes

## Supported Systems

Any Brötje or Remeha boiler managed via the **Brötje Home Komfort** or **Remeha Home** app (BDR Thermea cloud).

## Installation

```bash
npm install @juanmonaco/homebridge-remeha
```

## Configuration

Add to your Homebridge `config.json`:

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
| email | Yes | — | Brötje/Remeha app login email |
| password | Yes | — | Brötje/Remeha app login password |
| pollIntervalSeconds | No | 60 | How often to refresh temperature data (min 30s) |

## How It Works

Uses the BDR Thermea OAuth2 API (https://) — the same API used by the official app.
No local network access required, fully cloud-based.

## License

MIT © Juan Monaco
