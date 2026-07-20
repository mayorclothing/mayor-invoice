// UPS Tracking API v1 — OAuth client-credentials + package status lookup.
// Docs: https://developer.ups.com/api/reference/tracking/v1
// UPS_ENV=test uses the CIE sandbox host; anything else (or unset) uses production.
const BASE = process.env.UPS_ENV === 'test' ? 'https://wwwcie.ups.com' : 'https://onlinetools.ups.com';

let cachedToken = null; // { access_token, expiresAt }

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) return cachedToken.access_token;

  const creds = Buffer.from(`${process.env.UPS_CLIENT_ID}:${process.env.UPS_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${BASE}/security/v1/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${creds}`,
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`UPS OAuth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  cachedToken = { access_token: data.access_token, expiresAt: Date.now() + Number(data.expires_in) * 1000 };
  return cachedToken.access_token;
}

// Returns { status, statusCode, lastActivity: { description, location, date } } or null if UPS has no data yet.
async function trackPackage(trackingNumber) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}/api/track/v1/details/${encodeURIComponent(trackingNumber)}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'transId': `mayor-invoice-${Date.now()}`,
      'transactionSrc': 'mayor-invoice',
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`UPS tracking failed: ${res.status} ${await res.text()}`);

  const data = await res.json();
  const pkg = data?.trackResponse?.shipment?.[0]?.package?.[0];
  if (!pkg) return null;

  const activity = pkg.activity?.[0];
  return {
    status: pkg.currentStatus?.description || 'Unknown',
    statusCode: pkg.currentStatus?.code || '',
    lastActivity: activity ? {
      description: activity.status?.description || '',
      location: [activity.location?.address?.city, activity.location?.address?.stateProvince].filter(Boolean).join(', '),
      date: activity.date || '',
    } : null,
  };
}

module.exports = { trackPackage };
