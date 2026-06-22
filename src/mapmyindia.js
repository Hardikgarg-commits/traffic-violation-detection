const DEFAULT_CENTER = { lat: 12.9716, lng: 77.5946, label: 'Bengaluru command center' };

function mapKey() {
  return process.env.MAPMYINDIA_STATIC_KEY || process.env.MAPPLS_STATIC_KEY || '';
}

function restCredentials() {
  return {
    defaultKey: process.env.MAPPLS_DEFAULT_KEY || '',
    clientId: process.env.MAPPLS_CLIENT_ID || '',
    clientSecret: process.env.MAPPLS_CLIENT_SECRET || ''
  };
}

function authStatus() {
  const creds = restCredentials();
  return {
    provider: 'MapmyIndia / Mappls',
    staticKeyConfigured: Boolean(mapKey()),
    defaultKeyConfigured: Boolean(creds.defaultKey),
    clientIdConfigured: Boolean(creds.clientId),
    clientSecretConfigured: Boolean(creds.clientSecret),
    restApisReady: Boolean(creds.defaultKey && creds.clientId && creds.clientSecret),
    note: 'Secrets are kept server-side in .env and are never returned to the browser.'
  };
}

function mapConfig() {
  const key = mapKey();
  return {
    enabled: Boolean(key),
    provider: 'MapmyIndia / Mappls',
    key,
    sdkUrl: key ? `https://apis.mappls.com/advancedmaps/api/${encodeURIComponent(key)}/map_sdk?layer=vector&v=3.0&callback=__drishtiMapReady` : null,
    center: DEFAULT_CENTER,
    note: key
      ? 'Static key configured. Use registered camera coordinates for precise evidence mapping.'
      : 'Map key not configured. Add MAPMYINDIA_STATIC_KEY to .env.'
  };
}

function knownCameraLocations() {
  return [
    { id:'CAM-04', name:'MG Road / KR Circle sample zone', lat:12.9767, lng:77.5993, status:'Configured sample' },
    { id:'COMMAND', name:DEFAULT_CENTER.label, lat:DEFAULT_CENTER.lat, lng:DEFAULT_CENTER.lng, status:'Fallback center' }
  ];
}

module.exports = { mapConfig, knownCameraLocations, authStatus, restCredentials };
