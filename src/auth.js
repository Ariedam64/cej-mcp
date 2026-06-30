import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const ENV_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');
const TOKEN_URL = 'https://id.pass-emploi.beta.gouv.fr/auth/realms/pass-emploi/protocol/openid-connect/token';

let cachedToken = null;

function loadEnv() {
  if (existsSync(ENV_PATH)) return dotenv.parse(readFileSync(ENV_PATH, 'utf8'));
  return {
    CLIENT_ID: process.env.CLIENT_ID ?? '',
    CLIENT_SECRET: process.env.CLIENT_SECRET ?? '',
    REFRESH_TOKEN: process.env.REFRESH_TOKEN ?? '',
    ACCESS_TOKEN: process.env.ACCESS_TOKEN ?? '',
  };
}

function saveAccessToken(token) {
  cachedToken = token;
  if (!existsSync(ENV_PATH)) return;
  let raw = readFileSync(ENV_PATH, 'utf8');
  raw = raw.replace(/^ACCESS_TOKEN=.*$/m, `ACCESS_TOKEN=${token}`);
  writeFileSync(ENV_PATH, raw, 'utf8');
}

function isTokenExpired(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    return Date.now() / 1000 >= payload.exp - 60;
  } catch {
    return true;
  }
}

export async function getAccessToken() {
  if (cachedToken && !isTokenExpired(cachedToken)) return cachedToken;

  const env = loadEnv();
  if (env.ACCESS_TOKEN && !isTokenExpired(env.ACCESS_TOKEN)) {
    cachedToken = env.ACCESS_TOKEN;
    return env.ACCESS_TOKEN;
  }

  console.error('Token expiré — renouvellement...');

  const credentials = Buffer.from(`${env.CLIENT_ID}:${env.CLIENT_SECRET}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: env.REFRESH_TOKEN }),
  });

  const data = await res.json();
  if (!data.access_token) throw new Error(`Refresh échoué: ${JSON.stringify(data)}`);

  saveAccessToken(data.access_token);
  console.error('Token renouvelé (valide 24h)');
  return data.access_token;
}
