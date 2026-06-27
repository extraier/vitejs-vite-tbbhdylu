import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { readFileSync } from "fs";

const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"));
initializeApp({ credential: cert(sa) });

// This is the IAM config check — to read Identity Platform config
// we need the Identity Toolkit API. Lets see what we can get.
try {
  const config = await getAuth().getAuth("dummy");  // throws but lets us confirm
} catch (e) {
  console.log("getAuth call:", e.message);
}

console.log("\nTo check Authorized Domains manually:");
console.log("https://console.firebase.google.com/project/savetheday-2377a/authentication/settings");
console.log("");
console.log("Or via gcloud (Identity Platform):");
console.log("gcloud identity-platform config describe --project=savetheday-2377a");
