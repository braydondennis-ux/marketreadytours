import {spawn} from 'node:child_process';
import {browserAssets} from './browser-assets.mjs';
await browserAssets();
const env={...process.env,MRT_LANDING:'1',MRT_SIGNING_SECRET:'browser-test-signing',MRT_SQUARE_WEBHOOK_SECRET:'browser-test-square',MRT_SQUARE_ACCESS_TOKEN:'mock',MRT_SQUARE_LOCATION_ID:'mock',MRT_INSTANTLY_API_KEY:'mock',MRT_INSTANTLY_WEBHOOK_SECRET:'mock',MRT_TRANSACTIONAL_EMAIL_URL:'http://127.0.0.1:9/mock',MRT_TRANSACTIONAL_EMAIL_TOKEN:'mock',MRT_OUTBOUND_ALLOWLIST:'erik@marketreadysystems.ai'};
const child=spawn('npx',['firebase-tools','emulators:exec','--project=mrt-local-audit','--only=auth,database,storage,functions','npm run build && npx playwright test'],{env,stdio:'inherit'});
child.on('exit',code=>process.exit(code||0));
