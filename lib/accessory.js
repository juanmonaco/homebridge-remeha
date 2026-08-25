'use strict';

// Maps Remeha zone modes to HomeKit heating/cooling states
// zoneMode values seen in the API: Scheduling, Manual, TemporaryOverride, FrostProtection

class RemehaAccessory {
  constructor(platform, accessory, zone, appliance) {
    this.platform = platform;
    this.accessory = accessory;
    this.zone = zone;
    this.appliance = appliance;

    const { Service, Characteristic } = platform;

    // Internal state — seeded from zone data
    this.state = {
      currentTemperature: zone.roomTemperature ?? 20,
      targetTemperature: zone.setPoint ?? 20,
      zoneMode: zone.zoneMode ?? 'Scheduling',
      activeComfortDemand: zone.activeComfortDemand ?? 'Idle',
      setPointMin: zone.setPointMin ?? 5,
      setPointMax: zone.setPointMax ?? 30,
      activeHeatingClimateTimeProgramNumber: zone.activeHeatingClimateTimeProgramNumber ?? 1,
    };

    // Accessory information
    accessory.getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Manufacturer, 'Brötje / Remeha')
      .setCharacteristic(Characteristic.Model, appliance.applianceType || 'Boiler')
      .setCharacteristic(Characteristic.SerialNumber, appliance.applianceId)
      .setCharacteristic(Characteristic.Name, zone.name);

    // Thermostat service
    this.thermostat = accessory.getService(Service.Thermostat)
      || accessory.addService(Service.Thermostat, zone.name);

    this.thermostat
      .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
      .onGet(() => this._currentHeatingCoolingState());

    this.thermostat
      .getCharacteristic(Characteristic.TargetHeatingCoolingState)
      // Remeha boilers only heat — no cooling
      .setProps({
        validValues: [
          Characteristic.TargetHeatingCoolingState.OFF,
          Characteristic.TargetHeatingCoolingState.HEAT,
          Characteristic.TargetHeatingCoolingState.AUTO,
        ],
      })
      .onGet(() => this._targetHeatingCoolingState())
      .onSet(async (value) => this._setHeatingCoolingState(value));

    this.thermostat
      .getCharacteristic(Characteristic.CurrentTemperature)
      .onGet(() => this.state.currentTemperature);

    this.thermostat
      .getCharacteristic(Characteristic.TargetTemperature)
      .setProps({
        minValue: this.state.setPointMin,
        maxValue: this.state.setPointMax,
        minStep: 0.5,
      })
      .onGet(() => this.state.targetTemperature)
      .onSet(async (value) => this._setTargetTemperature(value));

    this.thermostat
      .getCharacteristic(Characteristic.TemperatureDisplayUnits)
      .onGet(() => Characteristic.TemperatureDisplayUnits.CELSIUS)
      .onSet(() => {}); // read-only, HomeKit requires a setter
  }

  // ─── HomeKit state mapping ──────────────────────────────────────────────────

  _currentHeatingCoolingState() {
    const { Characteristic } = this.platform;
    if (this.state.zoneMode === 'FrostProtection') {
      return Characteristic.CurrentHeatingCoolingState.OFF;
    }
    if (this.state.activeComfortDemand === 'Heating') {
      return Characteristic.CurrentHeatingCoolingState.HEAT;
    }
    return Characteristic.CurrentHeatingCoolingState.OFF;
  }

  _targetHeatingCoolingState() {
    const { Characteristic } = this.platform;
    switch (this.state.zoneMode) {
      case 'FrostProtection':
        return Characteristic.TargetHeatingCoolingState.OFF;
      case 'Manual':
      case 'TemporaryOverride':
        return Characteristic.TargetHeatingCoolingState.HEAT;
      case 'Scheduling':
      default:
        return Characteristic.TargetHeatingCoolingState.AUTO;
    }
  }

  // ─── HomeKit setters ────────────────────────────────────────────────────────

  async _setHeatingCoolingState(value) {
    const { Characteristic } = this.platform;
    const zoneId = this.zone.climateZoneId;

    try {
      if (value === Characteristic.TargetHeatingCoolingState.OFF) {
        // Anti-frost / off mode
        await this.platform.client.setOff(zoneId);
        this.state.zoneMode = 'FrostProtection';
        this.platform.log.info(`homebridge-remeha: ${this.zone.name} → OFF (anti-frost)`);

      } else if (value === Characteristic.TargetHeatingCoolingState.HEAT) {
        // Manual hold at current target
        await this.platform.client.setManual(zoneId, this.state.targetTemperature);
        this.state.zoneMode = 'Manual';
        this.platform.log.info(`homebridge-remeha: ${this.zone.name} → HEAT (manual ${this.state.targetTemperature}°C)`);

      } else if (value === Characteristic.TargetHeatingCoolingState.AUTO) {
        // Resume schedule
        await this.platform.client.setSchedule(
          zoneId,
          this.state.activeHeatingClimateTimeProgramNumber,
        );
        this.state.zoneMode = 'Scheduling';
        this.platform.log.info(`homebridge-remeha: ${this.zone.name} → AUTO (schedule)`);
      }

      this._pushStateToHomeKit();
    } catch (err) {
      this.platform.log.error(`homebridge-remeha: failed to set mode on ${this.zone.name} — ${err.message}`);
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
  }

  async _setTargetTemperature(value) {
    const zoneId = this.zone.climateZoneId;
    const target = Math.round(value * 2) / 2; // round to nearest 0.5

    try {
      if (this.state.zoneMode === 'Scheduling') {
        // Use temporary override so schedule resumes later
        await this.platform.client.setTemporaryOverride(zoneId, target);
        this.state.zoneMode = 'TemporaryOverride';
      } else {
        // Already in manual — just update setpoint
        await this.platform.client.setManual(zoneId, target);
        this.state.zoneMode = 'Manual';
      }

      this.state.targetTemperature = target;
      this.platform.log.info(`homebridge-remeha: ${this.zone.name} → target ${target}°C`);
      this._pushStateToHomeKit();
    } catch (err) {
      this.platform.log.error(`homebridge-remeha: failed to set temperature on ${this.zone.name} — ${err.message}`);
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
  }

  // ─── State sync from API poll ───────────────────────────────────────────────

  applyZone(zone) {
    this.zone = zone;
    this.state.currentTemperature = zone.roomTemperature ?? this.state.currentTemperature;
    this.state.targetTemperature = zone.setPoint ?? this.state.targetTemperature;
    this.state.zoneMode = zone.zoneMode ?? this.state.zoneMode;
    this.state.activeComfortDemand = zone.activeComfortDemand ?? this.state.activeComfortDemand;
    this.state.activeHeatingClimateTimeProgramNumber =
      zone.activeHeatingClimateTimeProgramNumber ?? this.state.activeHeatingClimateTimeProgramNumber;

    this._pushStateToHomeKit();
  }

  _pushStateToHomeKit() {
    const { Characteristic } = this.platform;
    this.thermostat.updateCharacteristic(
      Characteristic.CurrentHeatingCoolingState,
      this._currentHeatingCoolingState(),
    );
    this.thermostat.updateCharacteristic(
      Characteristic.TargetHeatingCoolingState,
      this._targetHeatingCoolingState(),
    );
    this.thermostat.updateCharacteristic(
      Characteristic.CurrentTemperature,
      this.state.currentTemperature,
    );
    this.thermostat.updateCharacteristic(
      Characteristic.TargetTemperature,
      this.state.targetTemperature,
    );
    this.thermostat.updateCharacteristic(
      Characteristic.TemperatureDisplayUnits,
      Characteristic.TemperatureDisplayUnits.CELSIUS,
    );
  }
}

module.exports = { RemehaAccessory };
