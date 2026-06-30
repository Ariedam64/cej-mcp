import { getAccessToken } from './auth.js';
import dotenv from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ENV_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');
const BASE_URL = 'https://api.pass-emploi.beta.gouv.fr';

function getIdJeune() {
  if (existsSync(ENV_PATH)) {
    const env = dotenv.parse(readFileSync(ENV_PATH, 'utf8'));
    if (!env.ID_JEUNE) throw new Error('ID_JEUNE manquant dans .env');
    return env.ID_JEUNE;
  }
  if (!process.env.ID_JEUNE) throw new Error('ID_JEUNE manquant');
  return process.env.ID_JEUNE;
}

async function apiFetch(method, path, body) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${err}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function listActions() {
  const data = await apiFetch('GET', `/jeunes/${getIdJeune()}/home/actions`);
  return data?.actions ?? [];
}

export async function createAction(payload) {
  return apiFetch('POST', `/jeunes/${getIdJeune()}/action`, payload);
}

export async function updateAction(idAction, payload) {
  return apiFetch('PUT', `/actions/${idAction}`, payload);
}

export async function deleteAction(idAction) {
  return apiFetch('DELETE', `/actions/${idAction}`);
}
