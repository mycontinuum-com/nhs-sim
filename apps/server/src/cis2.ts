import type { IncomingMessage, ServerResponse } from "node:http";
import { Cis2Error, MockOIDC, cis2Identities } from "../../../packages/nhs-mocks/src/cis2.ts";
import { ZodError } from "zod";
const escape = (value: unknown) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const page = (
  title: string,
  content: string,
) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · Care Identity simulator</title><style>
*{box-sizing:border-box}body{margin:0;background:#fff;color:#212b32;font:19px/1.5 Arial,Helvetica,sans-serif}a{color:#005eb8;text-decoration:underline;text-underline-offset:3px}a:hover{color:#003087}a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:4px solid #ffeb3b;outline-offset:3px;box-shadow:0 0 0 7px #212b32}.skip{position:absolute;left:16px;top:-100px;background:#ffeb3b;padding:8px;z-index:10}.skip:focus{top:12px}.masthead{background:#005eb8;color:white}.header-inner,.strip-inner{max-width:1100px;margin:auto;padding:22px 32px}.header-inner{display:flex;align-items:center;justify-content:space-between;gap:24px}.brand{font-size:32px;line-height:1.2;font-weight:700;letter-spacing:-.6px}.badge{display:inline-block;vertical-align:middle;margin-left:10px;padding:4px 7px;border:1px solid #ffffff80;font-size:12px;letter-spacing:1px}.masthead a{color:#fff;font-size:16px}.simulation{background:#ffdf68;color:#212b32}.strip-inner{padding-top:9px;padding-bottom:9px;font-size:14px}main{max-width:1100px;margin:0 auto;padding:44px 32px 64px}.service{max-width:760px}h1{font-size:40px;line-height:1.18;letter-spacing:-1px;margin:0 0 25px}h2,legend{font-size:24px;line-height:1.3;font-weight:700;margin:0 0 16px}p{margin:0 0 22px}.hint{color:#4c6272;font-size:16px}.back{display:inline-block;margin-bottom:24px;font-size:16px}.methods{display:grid;grid-template-columns:1fr 1fr;gap:20px}fieldset{margin:0;padding:0;border:0;min-width:0}.method,.role{display:block;position:relative;border:2px solid #aeb7bd;border-radius:4px;padding:20px;cursor:pointer;background:white}.method:has(input:checked),.role:has(input:checked){border-color:#005eb8;background:#f0f7fc;box-shadow:inset 0 0 0 1px #005eb8}.method>span{display:block;font-weight:700;padding-left:36px}.method input,.role input{position:absolute;left:20px;top:25px;width:24px;height:24px;margin:0;accent-color:#005eb8}.method small{display:block;color:#4c6272;font-size:14px;margin-top:16px}.card-art{margin:25px auto 10px;max-width:245px;height:138px;border:1px solid #aeb7bd;border-radius:9px;background:linear-gradient(145deg,#e9f0f5 73%,#aed2ee 73%,#aed2ee 82%,#79b6e1 82%);padding:16px;color:#005eb8;font-size:17px;font-weight:700;box-shadow:0 2px 3px #0001}.card-art .chip{display:block;width:34px;height:27px;margin:16px 0 7px;border:1px solid #97731f;border-radius:4px;background:repeating-linear-gradient(0deg,transparent 0 8px,#a98736 8px 9px),linear-gradient(90deg,#e5c768 48%,#ac8e3e 49% 51%,#e5c768 52%)}.card-art small{font-size:10px;margin:0;color:#315a77}.key-art{display:flex;align-items:center;justify-content:center;height:173px}.key-body{width:134px;height:54px;border-radius:9px;background:#40494e;box-shadow:inset 0 2px 3px #ffffff50;display:flex;align-items:center;justify-content:center}.key-body:after{content:'';width:30px;height:30px;border-radius:100%;background:#bac3c8}.key-plug{width:35px;height:35px;background:linear-gradient(90deg,#b6bdc1,#e1e5e7);border:1px solid #939da3}.primary,.secondary{display:inline-block;min-height:48px;padding:12px 24px;border:0;border-radius:4px;font:700 19px/1.5 Arial,sans-serif;cursor:pointer;text-decoration:none}.primary{background:#007f3b;color:white;box-shadow:0 4px 0 #004f25}.primary:hover{background:#00662f;color:white}.primary:disabled{opacity:.6;cursor:wait}.secondary{background:#e8edee;color:#212b32;box-shadow:0 4px 0 #aeb7bd}.actions{display:flex;align-items:center;gap:26px;flex-wrap:wrap;margin:30px 0 36px}.link-button{padding:0;border:0;background:none;color:#005eb8;font:inherit;text-decoration:underline;cursor:pointer}.technical{border-top:1px solid #aeb7bd;margin-top:36px;padding-top:22px;font-size:16px}.technical summary{color:#005eb8;cursor:pointer;text-decoration:underline;font-size:18px}.technical[open]>summary{margin-bottom:24px}.technical h2{font-size:21px}.operator{border-top:1px solid #d8dde0;margin-top:28px;padding-top:24px}label.field{display:block;margin:0 0 22px}label.field>span{display:block;font-weight:700;margin-bottom:7px}input:not([type=radio]),select,textarea{border:2px solid #4c6272;border-radius:0;background:white;color:#212b32;font:inherit;padding:9px 10px;max-width:100%}input:not([type=radio]),textarea{width:100%}select{min-height:48px;width:100%}pre{background:#f0f4f5;white-space:pre-wrap;overflow-wrap:anywhere;padding:18px;font:14px/1.5 monospace}code{font-size:14px}#status,#consent-status,#result{font-size:16px;margin-top:20px}#status:empty,#consent-status:empty{display:none}.client-request{border-left:5px solid #005eb8;background:#f0f4f5;padding:15px 18px;margin-bottom:28px;font-size:17px}.role{margin:12px 0;padding-left:60px}.role-content{display:grid;grid-template-columns:1.1fr 1fr;gap:20px}.role strong,.role small{display:block}.role small{font-size:15px;color:#4c6272}.role-job{border-left:1px solid #aeb7bd;padding-left:20px}.role-group[hidden],section[hidden],[hidden]{display:none!important}.summary-list{margin:0}.summary-list>div{display:grid;grid-template-columns:150px 1fr;gap:15px;padding:16px 0;border-bottom:1px solid #d8dde0}.summary-list dt{font-weight:700}.summary-list dd{margin:0}.success{border-top:6px solid #007f3b;background:#f0f4f5;padding:24px;margin:24px 0}.error{border:4px solid #d5281b;padding:22px;margin:24px 0}.error h2{font-size:24px}.footer{border-top:4px solid #d8dde0;background:#f0f4f5;padding:25px 32px;font-size:14px;color:#4c6272}.footer>div{max-width:1036px;margin:auto}@media(max-width:650px){body{font-size:17px}.header-inner{padding:20px}.brand{font-size:26px}.badge{font-size:10px;margin-left:5px}.header-inner>a{font-size:14px}.strip-inner{padding:8px 20px}main{padding:32px 20px 48px}h1{font-size:32px}.methods{gap:12px}.method{padding:16px 10px}.method input{left:12px;top:19px}.method>span{padding-left:34px;font-size:17px}.card-art{height:118px;padding:10px;font-size:14px}.key-art{height:153px}.key-body{width:90px}.key-plug{width:25px}.role-content{grid-template-columns:1fr;gap:8px}.role-job{border:0;padding:0}.summary-list>div{grid-template-columns:1fr;gap:5px}.actions{gap:20px}.primary,.secondary{font-size:17px}}
</style></head><body><a class="skip" href="#main">Skip to main content</a><header class="masthead"><div class="header-inner"><div class="brand">Care Identity <span class="badge">SIMULATOR</span></div><a href="/control/">Back to the neighbourhood</a></div></header><div class="simulation"><div class="strip-inner"><strong>SIMULATION</strong> · Fictional staff identities. This is not NHS authentication.</div></div><main id="main"><div class="service">${content}</div></main><footer class="footer"><div>A local care identity simulation for NHS-SIM. No real smartcard, security key or staff credentials are used.</div></footer></body></html>`;
const developerTools = `<details class="technical"><summary>Developer and operator tools</summary><h2>Connect your application</h2><p>Client <code>nhs-sim-client</code><br>Registered callback <code>/cis2/callback</code></p><p><a href="/cis2/.well-known/openid-configuration">Open the discovery document</a></p><p class="hint">Authorization code with PKCE S256 and RS256 identity tokens. Sessions and settings reset when the simulator restarts.</p><section class="operator"><h2>Operator controls</h2><p>Change the sign-in scenario or registered applications. Applying settings revokes existing sessions.</p><label class="field"><span>Simulation operator token</span><input id="operator" type="password" autocomplete="off" aria-describedby="operator-hint"></label><p class="hint" id="operator-hint">Use the local simulation operator token. Do not enter an NHS password or smartcard PIN.</p><button class="secondary" id="load">Unlock operator controls</button><div id="controls" hidden><label class="field"><span>Sign-in scenario</span><select id="scenario"><option value="normal">Normal sign-in</option><option value="deny">Consent denied</option><option value="unavailable">Service unavailable</option><option value="expired-session">Session expired</option></select></label><label class="field"><span>Token lifetime in seconds</span><input id="lifetime" type="number" min="30" max="3600"></label><details class="technical"><summary>Registered applications</summary><p>Each application has an id, name and redirectUris array. Callback URLs must match exactly.</p><textarea id="clients" rows="10" aria-label="Registered applications JSON"></textarea></details><div class="actions"><button class="primary" id="save">Apply settings</button><button class="secondary" id="revoke">Revoke all sessions</button></div></div><p id="status" role="status"></p></section></details>`;
const landing = () =>
  page(
    "Sign in",
    `<h1>Sign in with your Care Identity</h1><p>Choose how to simulate a staff sign-in. You will choose a fictional colleague and their role next.</p><form id="start-form"><fieldset><legend>Choose how to sign in</legend><div class="methods"><label class="method"><input type="radio" name="signin_method" value="smartcard" checked><span>Smartcard</span><div class="card-art" aria-hidden="true">Care Identity<span class="chip"></span><small>FICTIONAL STAFF CARD</small></div><small>Simulated smartcard. No reader or PIN needed.</small></label><label class="method"><input type="radio" name="signin_method" value="security-key"><span>Security key</span><div class="key-art" aria-hidden="true"><span class="key-body"></span><span class="key-plug"></span></div><small>Simulated security key. No device is accessed.</small></label></div></fieldset><div class="actions"><button class="primary" id="start">Simulate smartcard sign-in <span aria-hidden="true">›</span></button></div><p id="start-status" role="status"></p></form>${developerTools}<script>
const $=id=>document.getElementById(id);async function operator(method,body){const r=await fetch('/api/operator/cis2',{method,headers:{Authorization:'Bearer '+$('operator').value,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Error(data.message||data.error);return data}function show(data){$('controls').hidden=false;$('scenario').value=data.scenario;$('lifetime').value=data.tokenLifetimeSeconds;$('clients').value=JSON.stringify(data.clients,null,2);$('status').textContent='Scenario: '+data.scenario+'. '+data.active.tokens+' active tokens.'}for(const [id,run]of [['load',async()=>show(await operator('GET'))],['save',async()=>show(await operator('PUT',{scenario:$('scenario').value,tokenLifetimeSeconds:Number($('lifetime').value),clients:JSON.parse($('clients').value)}))],['revoke',async()=>show(await operator('DELETE'))]])$(id).onclick=async()=>{try{await run()}catch(e){$('status').textContent=e.message}};document.querySelectorAll('[name=signin_method]').forEach(input=>input.addEventListener('change',()=>{$('start').textContent='Simulate '+(input.value==='security-key'?'security key':'smartcard')+' sign-in ›'}));$('start-form').addEventListener('submit',async event=>{event.preventDefault();const signInMethod=new FormData(event.currentTarget).get('signin_method')||'smartcard';$('start').disabled=true;try{const b64=b=>btoa(String.fromCharCode(...b)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');const verifier=b64(crypto.getRandomValues(new Uint8Array(32))),state=b64(crypto.getRandomValues(new Uint8Array(24))),nonce=b64(crypto.getRandomValues(new Uint8Array(24)));sessionStorage.setItem('cis2-demo',JSON.stringify({verifier,state}));const challenge=b64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));location.href='/cis2/authorize?'+new URLSearchParams({client_id:'nhs-sim-client',redirect_uri:location.origin+'/cis2/callback',response_type:'code',scope:'openid profile',code_challenge_method:'S256',code_challenge:challenge,state,nonce,signin_method:signInMethod})}catch(e){$('start-status').textContent=e.message;$('start').disabled=false}});
</script>`,
  );
function consent(interaction: ReturnType<MockOIDC["begin"]>, signInMethod: string) {
  const method = signInMethod === "security-key" ? "security key" : "smartcard";
  return page(
    "Choose your role",
    `<a class="back" href="/cis2/">‹ Back to sign-in methods</a><h1>Choose your role</h1><p class="hint">${method === "smartcard" ? "Smartcard" : "Security key"} sign-in is simulated. No hardware has been checked.</p><div class="client-request"><strong>${escape(interaction.client)}</strong> is requesting your fictional staff identity, organisation and selected role.</div><form id="consent-form" method="post" action="/cis2/authorize"><input type="hidden" name="interaction" value="${escape(interaction.interaction)}"><input type="hidden" name="csrf" value="${escape(interaction.csrf)}"><label class="field"><span>Fictional staff identity</span><select name="identity" id="staff">${cis2Identities.map((person) => `<option value="${escape(person.id)}">${escape(person.name)}</option>`).join("")}</select></label><p>Select the role you want to work in for this session.</p>${cis2Identities.map((person, index) => `<fieldset class="role-group" data-identity="${escape(person.id)}" ${index ? "hidden disabled" : ""}><legend>Available roles for ${escape(person.name)}</legend>${person.assignments.map((role, roleIndex) => `<label class="role"><input type="radio" name="assignment" value="${escape(role.id)}" ${index === 0 && roleIndex === 0 ? "checked" : ""}><span class="role-content"><span><strong>${escape(role.organisation)}</strong><small>${escape(role.org)}</small></span><span class="role-job"><strong>${escape(role.role)}</strong><small>Fictional staff assignment</small></span></span></label>`).join("")}</fieldset>`).join("")}<div class="actions"><button class="primary" name="action" value="continue">Continue with selected role <span aria-hidden="true">›</span></button><button class="link-button" name="action" value="cancel">Cancel sign-in</button></div><p id="consent-status" role="status"></p></form><details class="technical"><summary>Technical session details</summary><p>Your role comes from the simulator's fictional staff directory. This browser interaction is valid for five minutes and is checked before a one-time authorization code is issued.</p></details><script>
document.getElementById('staff').addEventListener('change',event=>document.querySelectorAll('.role-group').forEach(group=>{const active=group.dataset.identity===event.target.value;group.hidden=!active;group.disabled=!active;if(active)group.querySelector('input').checked=true}));document.getElementById('consent-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=event.submitter;const values=new URLSearchParams(new FormData(form));values.set('action',button?.value||'continue');try{const response=await fetch('/cis2/authorize',{method:'POST',headers:{Accept:'application/json'},body:values});const data=await response.json();if(!response.ok)throw Error(data.message||data.error);location.href=data.redirect}catch(error){document.getElementById('consent-status').textContent=error.message}});
</script>`,
  );
}
const callback = () =>
  page(
    "Sign-in result",
    `<h1 id="heading">Completing sign-in</h1><p id="result" role="status">Checking your browser session.</p><section class="success" id="identity-summary" hidden><h2>You are signed in as</h2><dl class="summary-list"><div><dt>Name</dt><dd id="identity-name"></dd></div><div><dt>Organisation</dt><dd id="identity-organisation"></dd></div><div><dt>Role</dt><dd id="identity-role"></dd></div></dl></section><div class="actions"><a class="primary" href="/control/">Continue to the neighbourhood <span aria-hidden="true">›</span></a><a href="/cis2/">Choose another identity</a></div><details class="technical"><summary>Technical session details</summary><pre id="technical-result">No identity response yet.</pre></details><script>(async()=>{const out=document.getElementById('result');try{const p=new URLSearchParams(location.search),saved=sessionStorage.getItem('cis2-demo');history.replaceState(null,'','/cis2/callback');if(!saved)throw Error('No matching browser sign-in was found. Start again, or exchange the code from your own application.');sessionStorage.removeItem('cis2-demo');const session=JSON.parse(saved);if(p.get('state')!==session.state)throw Error('This response does not match your sign-in. Start again.');if(p.get('error'))throw Error(p.get('error_description')||p.get('error'));const response=await fetch('/cis2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:'nhs-sim-client',redirect_uri:location.origin+'/cis2/callback',code:p.get('code')||'',code_verifier:session.verifier})});const tokens=await response.json();if(!response.ok)throw Error(tokens.message||'The sign-in could not be completed.');const info=await fetch('/cis2/userinfo',{headers:{Authorization:'Bearer '+tokens.access_token}});if(!info.ok)throw Error('Could not read your simulated staff identity.');const identity=await info.json();document.getElementById('heading').textContent='Sign-in complete';out.textContent='Your fictional staff identity is ready to use in this simulation.';document.getElementById('identity-name').textContent=identity.name;document.getElementById('identity-organisation').textContent=identity.organisation;document.getElementById('identity-role').textContent=identity.role;document.getElementById('identity-summary').hidden=false;document.getElementById('technical-result').textContent=JSON.stringify({identity,expires_in:tokens.expires_in,token_type:tokens.token_type},null,2)}catch(e){document.getElementById('heading').textContent='We could not complete your sign-in';out.textContent=e.message}})();</script>`,
  );
const errorPage = (status: number, message: string) =>
  page(
    status === 503 ? "Sign-in is unavailable" : "There is a problem with your sign-in",
    `<h1>${status === 503 ? "Sign-in is unavailable" : "There is a problem with your sign-in"}</h1><div class="error"><h2>${status === 503 ? "Try again when the service is available" : "Start a new sign-in"}</h2><p>${escape(message)}</p></div><p>Your identity has not been changed.</p><div class="actions"><a class="primary" href="/cis2/">Back to sign-in</a><a href="/control/">Return to the neighbourhood</a></div>`,
  );
async function readBody(req: IncomingMessage) {
  let body = "";
  for await (const part of req) {
    body += part;
    if (body.length > 65536) throw new Cis2Error("invalid_request", "Body too large", 413);
  }
  return body;
}
export async function handleCis2({
  req,
  res,
  url,
  admin,
  oidc,
}: {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  admin: boolean;
  oidc: MockOIDC;
}): Promise<boolean> {
  const path = url.pathname,
    method = req.method ?? "GET";
  if (!path.startsWith("/cis2/") && path !== "/cis2" && path !== "/api/operator/cis2") return false;
  const browserPage =
    method === "GET" &&
    Boolean(req.headers.accept?.includes("text/html")) &&
    ![
      "/cis2/token",
      "/cis2/userinfo",
      "/cis2/jwks",
      "/cis2/session",
      "/cis2/.well-known/openid-configuration",
    ].includes(path);
  const send = (status: number, data: unknown, html = false) => {
    res.writeHead(status, {
      "Content-Type": html ? "text/html; charset=utf-8" : "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
    });
    res.end(html ? String(data) : JSON.stringify(data));
  };
  try {
    if (path === "/api/operator/cis2") {
      if (!admin || !req.headers.authorization?.startsWith("Bearer "))
        throw new Cis2Error("unauthorized", "Use the operator bearer token", 401);
      if (method === "GET") send(200, oidc.configuration());
      else if (method === "PUT") send(200, oidc.configure(JSON.parse(await readBody(req))));
      else if (method === "DELETE") {
        oidc.revoke();
        send(200, oidc.configuration());
      } else send(405, { error: "method_not_allowed" });
    } else if ((path === "/cis2/" || path === "/cis2") && method === "GET")
      send(200, landing(), true);
    else if (path === "/cis2/.well-known/openid-configuration" && method === "GET")
      send(200, oidc.discovery());
    else if (path === "/cis2/jwks" && method === "GET") send(200, await oidc.jwks());
    else if (path === "/cis2/token" && method === "POST") {
      const tokens = await oidc.token(new URLSearchParams(await readBody(req)));
      res.setHeader(
        "Set-Cookie",
        `cis2_staff=${tokens.access_token}; HttpOnly; SameSite=Lax; Path=/cis2/; Max-Age=${tokens.expires_in}${url.protocol === "https:" ? "; Secure" : ""}`,
      );
      send(200, tokens);
    } else if (path === "/cis2/session" && method === "GET") {
      const token =
        (req.headers.cookie ?? "")
          .split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith("cis2_staff="))
          ?.slice("cis2_staff=".length) ?? "";
      try {
        send(200, { identity: oidc.userinfo(token) });
      } catch {
        send(200, { identity: null });
      }
    } else if (path === "/cis2/userinfo" && method === "GET")
      send(200, oidc.userinfo((req.headers.authorization ?? "").replace(/^Bearer /, "")));
    else if (path === "/cis2/callback" && method === "GET") send(200, callback(), true);
    else if (path === "/cis2/authorize" && method === "GET") {
      const interaction = oidc.begin(url.searchParams);
      res.setHeader(
        "Set-Cookie",
        `cis2_interaction=${interaction.csrf}; HttpOnly; SameSite=Lax; Path=/cis2/authorize; Max-Age=300${url.protocol === "https:" ? "; Secure" : ""}`,
      );
      send(200, consent(interaction, url.searchParams.get("signin_method") ?? "smartcard"), true);
    } else if (path === "/cis2/authorize" && method === "POST") {
      const cookie =
        (req.headers.cookie ?? "")
          .split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith("cis2_interaction="))
          ?.slice("cis2_interaction=".length) ?? "";
      const redirect = oidc.complete(new URLSearchParams(await readBody(req)), cookie);
      if (req.headers.accept?.includes("application/json")) {
        res.setHeader(
          "Set-Cookie",
          "cis2_interaction=; HttpOnly; SameSite=Lax; Path=/cis2/authorize; Max-Age=0",
        );
        send(200, { redirect });
        return true;
      }
      res.writeHead(303, {
        Location: redirect,
        "Cache-Control": "no-store",
        "Set-Cookie": "cis2_interaction=; HttpOnly; SameSite=Lax; Path=/cis2/authorize; Max-Age=0",
      });
      res.end();
    } else if (browserPage)
      send(404, errorPage(404, "This sign-in page could not be found."), true);
    else send(404, { error: "not_found" });
  } catch (error) {
    if (error instanceof Cis2Error) {
      if (browserPage) send(error.status, errorPage(error.status, error.message), true);
      else send(error.status, { error: error.error, message: error.message });
    } else if (error instanceof ZodError || error instanceof SyntaxError)
      send(400, { error: "invalid_request", message: error.message });
    else throw error;
  }
  return true;
}
