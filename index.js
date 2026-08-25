'use strict';

const PLATFORM_NAME = 'RemehaPlatform';
const PLUGIN_NAME = '@juanmonaco/homebridge-remeha';

const { RemehaPlatform } = require('./lib/platform');

module.exports = (api) => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, RemehaPlatform);
};
