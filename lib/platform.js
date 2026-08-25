'use strict';

const { RemehaAPI } = require('./api');
const { RemehaAccessory, RemehaHotWaterAccessory } = require('./accessory');

const PLUGIN_NAME = '@juanmonaco/homebridge-remeha';
const PLATFORM_NAME = 'RemehaPlatform';
const DEFAULT_POLL_INTERVAL = 60; // seconds

class RemehaPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.UUIDGen = api.hap.uuid;

    this.accessories = new Map();    // uuid → platformAccessory
    this.remehaAccessories = new Map(); // climateZoneId → RemehaAccessory
    this.remehaHotWaterAccessories = new Map(); // hotWaterZoneId → RemehaHotWaterAccessory
    this.pollTimer = null;

    if (!this.config.email || !this.config.password) {
      this.log.error('homebridge-remeha: "email" and "password" are required in config');
      return;
    }

    this.pollIntervalSeconds = Math.max(30, Number(this.config.pollIntervalSeconds || DEFAULT_POLL_INTERVAL));

    this.client = new RemehaAPI(this.log, {
      email: this.config.email,
      password: this.config.password,
    });

    this.api.on('didFinishLaunching', () => {
      this.bootstrap().catch((err) => {
        this.log.error(`homebridge-remeha: bootstrap failed — ${err.message}`);
      });
    });

    this.api.on('shutdown', () => this.shutdown());
  }

  // Called by Homebridge for each cached accessory on startup
  configureAccessory(accessory) {
    this.accessories.set(accessory.UUID, accessory);
  }

  async bootstrap() {
    this.log.info('homebridge-remeha: connecting to BDR Thermea API');
    await this.client.authenticate();

    const dashboard = await this.client.getDashboard();
    const appliances = dashboard?.appliances || [];

    if (appliances.length === 0) {
      this.log.warn('homebridge-remeha: no appliances found for this account');
      return;
    }

    for (const appliance of appliances) {
      const climateZones = appliance.climateZones || [];
      for (const zone of climateZones) {
        this.createOrUpdateAccessory(appliance, zone);
      }
      const hotWaterZones = appliance.hotWaterZones || [];
      for (const zone of hotWaterZones) {
        this.createOrUpdateHotWaterAccessory(appliance, zone);
      }
    }

    this.api.updatePlatformAccessories(Array.from(this.accessories.values()));

    await this.refreshAll();
    this.startPolling();
  }

  createOrUpdateAccessory(appliance, zone) {
    // Trim whitespace the API sometimes pads into names
    zone.name = (zone.name || zone.climateZoneId).trim();

    const uuid = this.UUIDGen.generate(`${PLUGIN_NAME}:${zone.climateZoneId}`);
    let accessory = this.accessories.get(uuid);

    if (!accessory) {
      this.log.info(`homebridge-remeha: registering new accessory "${zone.name}"`);
      accessory = new this.api.platformAccessory(zone.name, uuid);
      accessory.context.climateZoneId = zone.climateZoneId;
      accessory.context.applianceId = appliance.applianceId;
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.set(uuid, accessory);
    }

    accessory.displayName = zone.name;
    accessory.context.zone = zone;
    accessory.context.appliance = appliance;

    const remehaAcc = new RemehaAccessory(this, accessory, zone, appliance);
    this.remehaAccessories.set(zone.climateZoneId, remehaAcc);
    remehaAcc.applyZone(zone);
  }

  createOrUpdateHotWaterAccessory(appliance, zone) {
    // Trim whitespace the API sometimes pads into names
    zone.name = (zone.name || zone.hotWaterZoneId).trim();

    const uuid = this.UUIDGen.generate(`${PLUGIN_NAME}:dhw:${zone.hotWaterZoneId}`);
    let accessory = this.accessories.get(uuid);

    if (!accessory) {
      this.log.info(`homebridge-remeha: registering new DHW accessory "${zone.name}"`);
      accessory = new this.api.platformAccessory(zone.name, uuid);
      accessory.context.hotWaterZoneId = zone.hotWaterZoneId;
      accessory.context.applianceId = appliance.applianceId;
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.set(uuid, accessory);
    }

    accessory.displayName = zone.name;
    accessory.context.zone = zone;
    accessory.context.appliance = appliance;

    const acc = new RemehaHotWaterAccessory(this, accessory, zone, appliance);
    this.remehaHotWaterAccessories.set(zone.hotWaterZoneId, acc);
    acc.applyZone(zone);
  }

  async refreshAll() {
    try {
      const dashboard = await this.client.getDashboard();
      const appliances = dashboard?.appliances || [];
      for (const appliance of appliances) {
        for (const zone of appliance.climateZones || []) {
          zone.name = (zone.name || zone.climateZoneId).trim();
          const acc = this.remehaAccessories.get(zone.climateZoneId);
          if (acc) acc.applyZone(zone);
        }
        for (const zone of appliance.hotWaterZones || []) {
          zone.name = (zone.name || zone.hotWaterZoneId).trim();
          const acc = this.remehaHotWaterAccessories.get(zone.hotWaterZoneId);
          if (acc) acc.applyZone(zone);
        }
      }
    } catch (err) {
      this.log.warn(`homebridge-remeha: poll failed — ${err.message}`);
    }
  }

  startPolling() {
    clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      this.refreshAll().catch((err) => {
        this.log.warn(`homebridge-remeha: polling error — ${err.message}`);
      });
    }, this.pollIntervalSeconds * 1000);
    this.log.debug(`homebridge-remeha: polling every ${this.pollIntervalSeconds}s`);
  }

  shutdown() {
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }
}

module.exports = { RemehaPlatform };
