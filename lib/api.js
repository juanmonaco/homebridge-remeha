'use strict';

const https = require('https');
const http = require('http');
const url = require('url');

const API_BASE = 'https://api.bdrthermea.net/Mobile/api';
const SUBSCRIPTION_KEY = 'df605c5470d846fc91e848b1cc653ddf';

const OAUTH_CLIENT_ID = '6ce007c6-0628-419e-88f4-bee2e6418eec';
const OAUTH_REDIRECT_URI = 'com.b2c.remehaapp://login-callback';
const OAUTH_SCOPE = 'openid https://bdrb2cprod.onmicrosoft.com/iotdevice/user_impersonation offline_access';
const OAUTH_AUTHORIZE_URL = 'https://remehalogin.bdrthermea.net/bdrb2cprod.onmicrosoft.com/oauth2/v2.0/authorize';
const OAUTH_TOKEN_URL = 'https://remehalogin.bdrthermea.net/bdrb2cprod.onmicrosoft.com/oauth2/v2.0/token?p=B2C_1A_RPSignUpSignInNewRoomV3.1';
const OAUTH_SELFASSERTED_URL = 'https://remehalogin.bdrthermea.net/bdrb2cprod.onmicrosoft.com/B2C_1A_RPSignUpSignInNewRoomv3.1/SelfAsserted';
const OAUTH_CONFIRMED_URL = 'https://remehalogin.bdrthermea.net/bdrb2cprod.onmicrosoft.com/B2C_1A_RPSignUpSignInNewRoomv3.1/api/CombinedSigninAndSignup/confirmed';

class RemehaAPI {
  constructor(log, options = {}) {
    this.log = log;
    this.email = options.email;
    this.password = options.password;
    this.accessToken = options.accessToken || null;
    this.refreshToken = options.refreshToken || null;
    this.tokenExpiry = options.tokenExpiry || null;
    this._cookies = {};
  }

  // ─── OAuth2 / Auth ──────────────────────────────────────────────────────────

  async authenticate() {
    this.log.debug('Remeha: starting OAuth2 login flow');

    const crypto = require('crypto');

    // Step 1 — generate PKCE code challenge
    const codeVerifier = crypto.randomBytes(64).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    const state = crypto.randomBytes(16).toString('base64url');

    const authorizeParams = new URLSearchParams({
      response_type: 'code',
      client_id: OAUTH_CLIENT_ID,
      redirect_uri: OAUTH_REDIRECT_URI,
      scope: OAUTH_SCOPE,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      p: 'B2C_1A_RPSignUpSignInNewRoomV3.1',
      brand: 'remeha',
      lang: 'en',
      nonce: 'defaultNonce',
      prompt: 'login',
      signUp: 'False',
    });

    // Step 2 — GET the authorize page to start a login transaction
    const authorizeResponse = await this._rawRequest(
      `${OAUTH_AUTHORIZE_URL}?${authorizeParams}`,
      { method: 'GET', followRedirects: true },
    );

    const requestId = authorizeResponse.headers['x-request-id'];
    if (!requestId) {
      throw new Error('Remeha auth: missing x-request-id header from authorize endpoint');
    }

    // Encode state properties for subsequent requests
    const statePropertiesJson = JSON.stringify({ TID: requestId });
    const stateProperties = Buffer.from(statePropertiesJson)
      .toString('base64url');

    // Extract CSRF token from cookies
    const csrfToken = this._cookies['x-ms-cpim-csrf'];
    if (!csrfToken) {
      throw new Error('Remeha auth: missing x-ms-cpim-csrf cookie');
    }

    // Step 3 — POST credentials to SelfAsserted endpoint
    const selfAssertedParams = new URLSearchParams({
      tx: `StateProperties=${stateProperties}`,
      p: 'B2C_1A_RPSignUpSignInNewRoomv3.1',
    });

    const credentialBody = new URLSearchParams({
      request_type: 'RESPONSE',
      signInName: this.email,
      password: this.password,
    });

    const selfAssertedResponse = await this._rawRequest(
      `${OAUTH_SELFASSERTED_URL}?${selfAssertedParams}`,
      {
        method: 'POST',
        headers: {
          'x-csrf-token': csrfToken,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: credentialBody.toString(),
        followRedirects: false,
      },
    );

    let selfAssertedJson;
    try {
      selfAssertedJson = JSON.parse(selfAssertedResponse.body);
    } catch {
      throw new Error('Remeha auth: unexpected response from SelfAsserted endpoint');
    }

    if (String(selfAssertedJson.status) !== '200') {
      throw new Error(`Remeha auth: credential rejection — check email/password (status: ${selfAssertedJson.status})`);
    }

    // Step 4 — GET the confirmed callback to get the auth code
    const confirmedParams = new URLSearchParams({
      rememberMe: 'false',
      csrf_token: csrfToken,
      tx: `StateProperties=${stateProperties}`,
      p: 'B2C_1A_RPSignUpSignInNewRoomv3.1',
    });

    const confirmedResponse = await this._rawRequest(
      `${OAUTH_CONFIRMED_URL}?${confirmedParams}`,
      { method: 'GET', followRedirects: false },
    );

    const locationHeader = confirmedResponse.headers['location'];
    if (!locationHeader) {
      throw new Error('Remeha auth: missing location redirect from confirmed endpoint');
    }

    // Parse auth code from the redirect location
    const parsedLocation = new URL(locationHeader.replace('com.b2c.remehaapp://', 'https://app/'));
    const authCode = parsedLocation.searchParams.get('code');
    if (!authCode) {
      throw new Error('Remeha auth: missing authorization code in redirect');
    }

    // Step 5 — exchange auth code for tokens
    await this._requestToken({
      grant_type: 'authorization_code',
      code: authCode,
      redirect_uri: OAUTH_REDIRECT_URI,
      code_verifier: codeVerifier,
      client_id: OAUTH_CLIENT_ID,
    });

    this.log.debug('Remeha: authentication successful');
  }

  async refreshAccessToken() {
    if (!this.refreshToken) {
      this.log.debug('Remeha: no refresh token, doing full re-auth');
      return this.authenticate();
    }

    this.log.debug('Remeha: refreshing access token');
    try {
      await this._requestToken({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
        client_id: OAUTH_CLIENT_ID,
      });
    } catch (err) {
      this.log.warn(`Remeha: token refresh failed (${err.message}), re-authenticating`);
      await this.authenticate();
    }
  }

  async ensureValidToken() {
    if (!this.accessToken) {
      await this.authenticate();
      return;
    }
    // Refresh 60 seconds before expiry
    const now = Date.now();
    if (this.tokenExpiry && now >= this.tokenExpiry - 60000) {
      await this.refreshAccessToken();
    }
  }

  async _requestToken(params) {
    const body = new URLSearchParams(params).toString();
    const response = await this._rawRequest(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      followRedirects: true,
    });

    let tokenData;
    try {
      tokenData = JSON.parse(response.body);
    } catch {
      throw new Error('Remeha auth: invalid JSON in token response');
    }

    if (response.statusCode === 400) {
      throw new Error(`Remeha auth: token request failed — ${tokenData.error_description || tokenData.error}`);
    }

    if (!tokenData.access_token) {
      throw new Error('Remeha auth: no access_token in token response');
    }

    this.accessToken = tokenData.access_token;
    this.refreshToken = tokenData.refresh_token || this.refreshToken;
    // expires_in is in seconds
    this.tokenExpiry = Date.now() + ((tokenData.expires_in || 3600) * 1000);
  }

  // ─── API Calls ──────────────────────────────────────────────────────────────

  async getDashboard() {
    const timestamp = Math.floor(Date.now() / 1000);
    return this._apiRequest('GET', `/homes/dashboard?t=${timestamp}`);
  }

  async setManual(climateZoneId, setpoint) {
    return this._apiRequest('POST', `/climate-zones/${climateZoneId}/modes/manual`, {
      roomTemperatureSetPoint: setpoint,
    });
  }

  async setTemporaryOverride(climateZoneId, setpoint) {
    return this._apiRequest('POST', `/climate-zones/${climateZoneId}/modes/temporary-override`, {
      roomTemperatureSetPoint: setpoint,
    });
  }

  async setSchedule(climateZoneId, heatingProgramId) {
    return this._apiRequest('POST', `/climate-zones/${climateZoneId}/modes/schedule`, {
      heatingProgramId,
    });
  }

  async setOff(climateZoneId) {
    return this._apiRequest('POST', `/climate-zones/${climateZoneId}/modes/anti-frost`);
  }

  // ─── HTTP helpers ───────────────────────────────────────────────────────────

  async _apiRequest(method, path, body = null) {
    await this.ensureValidToken();

    const reqUrl = `${API_BASE}${path}`;
    const headers = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    const response = await this._rawRequest(reqUrl, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null,
      followRedirects: true,
    });

    if (response.statusCode === 401) {
      // Token rejected — re-auth once and retry
      this.log.debug('Remeha API: 401 received, re-authenticating');
      this.accessToken = null;
      await this.ensureValidToken();
      const retryResponse = await this._rawRequest(reqUrl, {
        method,
        headers: {
          ...headers,
          'Authorization': `Bearer ${this.accessToken}`,
        },
        body: body ? JSON.stringify(body) : null,
        followRedirects: true,
      });
      return this._parseApiResponse(retryResponse, path);
    }

    return this._parseApiResponse(response, path);
  }

  _parseApiResponse(response, path) {
    if (response.statusCode >= 400) {
      throw new Error(`Remeha API error ${response.statusCode} for ${path}: ${response.body}`);
    }
    if (!response.body || response.body.trim() === '') {
      return null;
    }
    try {
      return JSON.parse(response.body);
    } catch {
      return null;
    }
  }

  // Low-level HTTP request — handles cookies, redirects, no external deps
  _rawRequest(reqUrl, options = {}) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(reqUrl);
      const isHttps = parsedUrl.protocol === 'https:';
      const lib = isHttps ? https : http;

      const cookieHeader = Object.entries(this._cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');

      const headers = {
        'User-Agent': 'Mozilla/5.0 (compatible; homebridge-remeha/1.0)',
        'Accept': 'application/json, text/html, */*',
        ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
        ...(options.headers || {}),
      };

      const body = options.body || null;
      if (body) {
        headers['Content-Length'] = Buffer.byteLength(body);
      }

      const reqOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || 'GET',
        headers,
      };

      const req = lib.request(reqOptions, (res) => {
        // Collect and persist Set-Cookie headers
        const setCookieHeaders = res.headers['set-cookie'] || [];
        for (const cookieStr of setCookieHeaders) {
          const [pair] = cookieStr.split(';');
          const eqIdx = pair.indexOf('=');
          if (eqIdx !== -1) {
            const name = pair.substring(0, eqIdx).trim();
            const value = pair.substring(eqIdx + 1).trim();
            this._cookies[name] = value;
          }
        }

        // Handle redirects
        if (
          options.followRedirects &&
          [301, 302, 303, 307, 308].includes(res.statusCode) &&
          res.headers['location']
        ) {
          const redirectUrl = res.headers['location'].startsWith('http')
            ? res.headers['location']
            : `${parsedUrl.protocol}//${parsedUrl.host}${res.headers['location']}`;

          // Stop following non-http redirects (e.g. com.b2c.remehaapp://)
          if (!redirectUrl.startsWith('http')) {
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body: '',
            });
            res.resume();
            return;
          }

          // Consume response body before redirecting
          res.resume();
          this._rawRequest(redirectUrl, {
            ...options,
            method: [301, 302, 303].includes(res.statusCode) ? 'GET' : options.method,
            body: [301, 302, 303].includes(res.statusCode) ? null : body,
          }).then(resolve).catch(reject);
          return;
        }

        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data,
          });
        });
      });

      req.on('error', reject);
      req.setTimeout(30000, () => {
        req.destroy(new Error(`Remeha HTTP request timed out: ${reqUrl}`));
      });

      if (body) {
        req.write(body);
      }
      req.end();
    });
  }
}

module.exports = { RemehaAPI };
