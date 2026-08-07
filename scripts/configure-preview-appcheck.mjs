#!/usr/bin/env node

import path from "node:path";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";

const require = createRequire(import.meta.url);
const firebaseCliAuth = require("firebase-tools/lib/auth");
const firebaseCliApi = require("firebase-tools/lib/apiv2");

const PREVIEW_PROJECT_ID = "marketready-tours-dev";
const PREVIEW_PROJECT_NUMBER = "665495379631";
const PREVIEW_APP_ID = "1:665495379631:web:1864e4638f2d22f72b3e5a";
const PREVIEW_DOMAINS = [
  "mrt-refresh.vercel.app",
  "marketready-refresh.vercel.app",
];
const KEY_DISPLAY_NAME = "MarketReady Tours preview App Check";
export const PREVIEW_APPROVAL = "ERIK_APPROVED_MARKETREADY_PREVIEW_APPCHECK";

function argValue(name) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : "";
}

export function assertPreviewAppCheckApproval({project, apply, approval}) {
  if (project !== PREVIEW_PROJECT_ID) {
    throw new Error(`Pass --project=${PREVIEW_PROJECT_ID}; all other projects are refused`);
  }
  if (apply && approval !== PREVIEW_APPROVAL) {
    throw new Error(`Pass --approval=${PREVIEW_APPROVAL} to change preview App Check`);
  }
}

async function accessToken() {
  const account = firebaseCliAuth.getGlobalDefaultAccount();
  if (!account) throw new Error("Firebase CLI is not logged in");
  firebaseCliAuth.setActiveAccount({}, account);
  const token = await firebaseCliApi.getAccessToken();
  if (!token) throw new Error("Firebase CLI did not return an access token");
  return token;
}

async function apiRequest(url, token, options = {}, allowNotFound = false) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.json().catch(() => ({}));
  if (allowNotFound && response.status === 404) return {};
  if (!response.ok) {
    throw new Error(body.error?.message || `Google API request failed (${response.status})`);
  }
  return body;
}

async function waitForOperation(operation, token) {
  let current = operation;
  for (let attempt = 0; attempt < 30 && !current.done; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    current = await apiRequest(`https://serviceusage.googleapis.com/v1/${current.name}`, token);
  }
  if (!current.done) throw new Error("Timed out enabling the reCAPTCHA Enterprise API");
  if (current.error) throw new Error(current.error.message || "Could not enable reCAPTCHA Enterprise");
}

function sameDomains(actual = [], expected = []) {
  return [...actual].sort().join("\n") === [...expected].sort().join("\n");
}

export async function configurePreviewAppCheck({project, apply, approval}) {
  assertPreviewAppCheckApproval({project, apply, approval});
  const token = await accessToken();
  const serviceName =
    `projects/${PREVIEW_PROJECT_NUMBER}/services/recaptchaenterprise.googleapis.com`;
  const serviceUrl = `https://serviceusage.googleapis.com/v1/${serviceName}`;
  let service = await apiRequest(serviceUrl, token);
  if (service.state !== "ENABLED" && apply) {
    const operation = await apiRequest(`${serviceUrl}:enable`, token, {
      method: "POST",
      body: "{}",
    });
    await waitForOperation(operation, token);
    service = await apiRequest(serviceUrl, token);
  }

  const configName =
    `projects/${PREVIEW_PROJECT_NUMBER}/apps/${PREVIEW_APP_ID}/recaptchaEnterpriseConfig`;
  const configUrl = `https://firebaseappcheck.googleapis.com/v1/${configName}`;
  const existingConfig = await apiRequest(configUrl, token, {}, true);
  const keysUrl = `https://recaptchaenterprise.googleapis.com/v1/projects/${PREVIEW_PROJECT_ID}/keys`;
  const listed = service.state === "ENABLED"
    ? await apiRequest(`${keysUrl}?pageSize=100`, token)
    : {keys: []};
  let key = (listed.keys || []).find((item) => item.displayName === KEY_DISPLAY_NAME) || null;

  if (apply && service.state === "ENABLED" && !key) {
    key = await apiRequest(keysUrl, token, {
      method: "POST",
      body: JSON.stringify({
        displayName: KEY_DISPLAY_NAME,
        webSettings: {
          allowedDomains: PREVIEW_DOMAINS,
          allowAmpTraffic: false,
          integrationType: "SCORE",
        },
      }),
    });
  } else if (apply && key && !sameDomains(key.webSettings?.allowedDomains, PREVIEW_DOMAINS)) {
    key = await apiRequest(
      `https://recaptchaenterprise.googleapis.com/v1/${key.name}?updateMask=webSettings.allowedDomains`,
      token,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: key.name,
          webSettings: {...key.webSettings, allowedDomains: PREVIEW_DOMAINS},
        }),
      },
    );
  }

  const siteKey = key?.name?.split("/").pop() || "";
  if (apply && siteKey && existingConfig.siteKey !== siteKey) {
    await apiRequest(`${configUrl}?updateMask=siteKey,tokenTtl,riskAnalysis`, token, {
      method: "PATCH",
      body: JSON.stringify({
        name: configName,
        siteKey,
        tokenTtl: "3600s",
        riskAnalysis: {minValidScore: 0.3},
      }),
    });
  }

  return {
    mode: apply ? "apply" : "dry-run",
    project,
    domains: PREVIEW_DOMAINS,
    recaptchaEnterpriseApiEnabled: service.state === "ENABLED",
    existingKey: Boolean(key),
    configured: Boolean(siteKey && (apply || existingConfig.siteKey === siteKey)),
    siteKey,
  };
}

async function main() {
  const project = argValue("project");
  const apply = process.argv.includes("--apply");
  const approval = argValue("approval");
  const report = await configurePreviewAppCheck({project, apply, approval});
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
