import path from "node:path";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";

const require = createRequire(import.meta.url);
const firebaseCliAuth = require("firebase-tools/lib/auth");
const firebaseCliApi = require("firebase-tools/lib/apiv2");

const PRODUCTION_PROJECT_ID = "marketready-tours";
const PRODUCTION_PROJECT_NUMBER = "191980265978";
const PRODUCTION_APP_ID = "1:191980265978:web:f65000f9fd6387fa9dc443";
const PRODUCTION_DOMAIN = "marketreadytours.com";
const KEY_DISPLAY_NAME = "MarketReady Tours production App Check";
export const PRODUCTION_APPROVAL = "BRAYDON_APPROVED_MARKETREADY_PRODUCTION_CUTOVER";

function argValue(name) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : "";
}

export function assertProductionAppCheckApproval({project, apply, approval}) {
  if (project !== PRODUCTION_PROJECT_ID) {
    throw new Error(`Pass --project=${PRODUCTION_PROJECT_ID}; all other projects are refused`);
  }
  if (apply && approval !== PRODUCTION_APPROVAL) {
    throw new Error("Explicit Braydon production-cutover approval is required for --apply");
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

async function apiRequest(url, token, options = {}) {
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
  if (!response.ok) {
    const error = new Error(body.error?.message || `Google API request failed (${response.status})`);
    error.status = response.status;
    error.apiStatus = body.error?.status || "";
    throw error;
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
  if (current.error) throw new Error(current.error.message || "Could not enable reCAPTCHA Enterprise API");
}

function matchingKeys(keys) {
  return (keys || []).filter((key) =>
    key.displayName === KEY_DISPLAY_NAME &&
    (key.webSettings?.allowedDomains || []).includes(PRODUCTION_DOMAIN),
  );
}

export async function configureProductionAppCheck({project, apply, approval}) {
  assertProductionAppCheckApproval({project, apply, approval});
  const token = await accessToken();
  const serviceName =
    `projects/${PRODUCTION_PROJECT_NUMBER}/services/recaptchaenterprise.googleapis.com`;
  const serviceUrl = `https://serviceusage.googleapis.com/v1/${serviceName}`;
  let service = await apiRequest(serviceUrl, token);
  let apiEnabledDuringRun = false;
  if (service.state !== "ENABLED" && apply) {
    const operation = await apiRequest(`${serviceUrl}:enable`, token, {
      method: "POST",
      body: "{}",
    });
    await waitForOperation(operation, token);
    service = await apiRequest(serviceUrl, token);
    apiEnabledDuringRun = service.state === "ENABLED";
  }

  const configName =
    `projects/${PRODUCTION_PROJECT_NUMBER}/apps/${PRODUCTION_APP_ID}/recaptchaEnterpriseConfig`;
  const configUrl = `https://firebaseappcheck.googleapis.com/v1/${configName}`;
  const existingConfig = await apiRequest(configUrl, token);
  if (service.state !== "ENABLED") {
    return {
      mode: apply ? "apply" : "dry-run",
      project,
      domain: PRODUCTION_DOMAIN,
      recaptchaEnterpriseApiEnabled: false,
      existingMatchingKey: false,
      appCheckAlreadyRegistered: Boolean(existingConfig.siteKey),
      configured: false,
      siteKey: existingConfig.siteKey || "",
      serviceEnforcementChanged: false,
    };
  }

  const keysUrl = `https://recaptchaenterprise.googleapis.com/v1/projects/${PRODUCTION_PROJECT_ID}/keys`;
  const listed = await apiRequest(`${keysUrl}?pageSize=100`, token);
  const matches = matchingKeys(listed.keys);
  if (matches.length > 1) {
    throw new Error("Multiple matching production reCAPTCHA Enterprise keys exist; review manually");
  }

  let key = matches[0] || null;

  if (apply && !key) {
    key = await apiRequest(keysUrl, token, {
      method: "POST",
      body: JSON.stringify({
        displayName: KEY_DISPLAY_NAME,
        webSettings: {
          allowedDomains: [PRODUCTION_DOMAIN],
          allowAmpTraffic: false,
          integrationType: "SCORE",
        },
      }),
    });
  }

  const siteKey = key?.name?.split("/").pop() || "";
  if (apply && siteKey && existingConfig.siteKey !== siteKey) {
    await apiRequest(`${configUrl}?updateMask=siteKey,tokenTtl,riskAnalysis`, token, {
      method: "PATCH",
      body: JSON.stringify({
        name: configName,
        siteKey,
        tokenTtl: "3600s",
        riskAnalysis: {minValidScore: 0.5},
      }),
    });
  }

  return {
    mode: apply ? "apply" : "dry-run",
    project,
    domain: PRODUCTION_DOMAIN,
    recaptchaEnterpriseApiEnabled: service.state === "ENABLED",
    apiEnabledDuringRun,
    existingMatchingKey: matches.length === 1,
    appCheckAlreadyRegistered: Boolean(existingConfig.siteKey),
    configured: apply ? Boolean(siteKey) : Boolean(existingConfig.siteKey),
    siteKey: apply ? siteKey : existingConfig.siteKey || "",
    serviceEnforcementChanged: false,
  };
}

async function main() {
  const project = argValue("project");
  const apply = process.argv.includes("--apply");
  const approval = argValue("approval");
  const report = await configureProductionAppCheck({project, apply, approval});
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
