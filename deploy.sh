#!/bin/bash
# deploy.sh — pull latest from GitHub and restart Homebridge
set -e

PLUGIN_SRC="/home/familypi/persistent/homebridge-remeha"
PLUGIN_DST="/home/familypi/persistent/homebridge/volumes/homebridge/node_modules/@juanmonaco/homebridge-remeha"

echo "Pulling latest from GitHub..."
cd "$PLUGIN_SRC"
git pull

echo "Syncing files into Homebridge..."
sudo cp "$PLUGIN_SRC/index.js" "$PLUGIN_DST/"
sudo cp "$PLUGIN_SRC/package.json" "$PLUGIN_DST/"
sudo cp "$PLUGIN_SRC/config.schema.json" "$PLUGIN_DST/"
sudo cp "$PLUGIN_SRC/lib/api.js" "$PLUGIN_DST/lib/"
sudo cp "$PLUGIN_SRC/lib/platform.js" "$PLUGIN_DST/lib/"
sudo cp "$PLUGIN_SRC/lib/accessory.js" "$PLUGIN_DST/lib/"

echo "Restarting Homebridge..."
sudo docker restart homebridge

echo "Done. Tailing logs..."
sleep 8
sudo docker logs homebridge --tail 20
