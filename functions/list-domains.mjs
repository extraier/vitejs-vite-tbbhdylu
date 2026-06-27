import { initializeApp, cert } from "firebase-admin/app";
import { readFileSync } from "fs";

const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"));
initializeApp({ credential: cert(sa) });

// firebase-admin does NOT have an Admin SDK method for Authorized Domains.
// Must use the Identity Toolkit Admin REST API directly.
// The SA needs the "Firebase Authentication Admin" role.

// Step 1: get an OAuth2 token using the SA
import { GoogleAuth } from "google-auth-library";
const auth = new GoogleAuth({
  credentials: sa,
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});
const client = await auth.getClient();
const token = (await client.getAccessToken()).token;

console.log("token acquired, len:", token.length);

// Step 2: GET current config
const url = "https://identitytoolkit.googleapis.com/admin/v2/projects/savetheday-2377a/config";
const resp = await fetch(url, { headers: { Authorization: "Bearer " + token } });
const j = await resp.json();
if (j.authorizedDomains) {
  console.log("=== Authorized Domains ===");
  j.authorizedDomains.forEach(d => console.log("  -", d));
} else {
  console.log("=== Response ===");
  console.log(JSON.stringify(j, null, 2));
}
