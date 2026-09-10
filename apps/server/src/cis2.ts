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
const page = (title: string, content: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · CIS2 simulator</title><style>*{box-sizing:border-box}body{margin:0;background:#edf1f2;color:#20323e;font:15px/1.5 system-ui,sans-serif}header{background:#123c51;color:white;padding:18px max(24px,calc((100vw - 1020px)/2));display:flex;align-items:center;justify-content:space-between;gap:20px}header a{color:white}a{color:#176684}main{max-width:1020px;margin:40px auto;padding:0 24px}h1{font-size:32px;letter-spacing:-1px;line-height:1.2;margin:10px 0 14px}h2{font-size:19px;margin:0 0 12px}p{color:#526370}small,.eyebrow{font-size:12px;letter-spacing:.05em}.eyebrow{text-transform:uppercase;font-weight:700;color:#347188}.grid{display:grid;grid-template-columns:1.2fr 1fr;gap:24px}.panel{background:white;padding:26px;border:1px solid #cbd7dc;border-radius:5px;margin:20px 0}.identity{display:block;padding:16px;border:1px solid #c5d0d6;margin:10px 0;border-radius:4px;cursor:pointer}.identity:has(input:checked){border-color:#1b728f;background:#eef8fb;box-shadow:inset 3px 0 #1b728f}.identity strong{display:block}.identity input{float:right}.identity span{display:block;font-size:13px;color:#526370}.identity select{margin-top:9px}button,.button{background:#176480;color:white;border:0;border-radius:3px;padding:12px 18px;font:600 14px system-ui;cursor:pointer;text-decoration:none;display:inline-block}button.secondary{background:#e9eef1;color:#254252}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px}input,select,textarea{font:inherit;padding:9px;border:1px solid #b9c9d0;border-radius:3px;max-width:100%}input:not([type=radio]),textarea{width:100%}label.field{display:block;margin:14px 0}label.field>span{display:block;margin-bottom:5px;font-size:13px;font-weight:600}pre{font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;background:#f1f4f5;padding:15px}code{font-size:12px}hr{border:0;border-top:1px solid #d8e0e4;margin:24px 0}.notice{padding:12px 16px;background:#fff6dd;border-left:3px solid #d7aa42;font-size:13px}#status{white-space:pre-wrap;font-size:13px}summary{cursor:pointer;font-weight:600}@media(max-width:700px){.grid{grid-template-columns:1fr}main{margin:25px auto}header{padding:14px 24px}h1{font-size:28px}}</style></head><body><header><strong>CIS2 <span style="font-weight:400;opacity:.75">/ identity simulator</span></strong><a href="/control/">Return to world</a></header><main>${content}</main></body></html>`;
const landing = () =>
  page(
    "Identity workbench",
    `<span class="eyebrow">Developer workbench</span><h1>Try a staff sign-in.</h1><p>Choose a fictional colleague and their working role. Inspect the resulting identity, or connect your own application.</p><div class="notice">Synthetic identities only. This local emulator is not NHS Care Identity Service 2 and does not authenticate real staff.</div><div class="grid"><section class="panel"><h2>Walk through an identity flow</h2><p>Start a browser sign-in with PKCE. After consent, this workbench exchanges the one-time code and shows the verified session response.</p><button id="start">Start staff sign-in</button><hr><h2>Connect an application</h2><p>Default client <code>nhs-sim-client</code><br>Callback <code>/cis2/callback</code></p><a href="/cis2/.well-known/openid-configuration">Open discovery document</a><p><small>Authorization code · PKCE S256 · RS256<br>Process-local sessions. A restart revokes them.</small></p></section><section class="panel"><h2>Operator controls</h2><p>Set a failure scenario, change token lifetime, or register exact callback URLs. Changes revoke existing sessions.</p><label class="field"><span>Operator token</span><input id="operator" type="password" autocomplete="off" placeholder="Operator access required"></label><button class="secondary" id="load">Unlock controls</button><div id="controls" hidden><label class="field"><span>Sign-in scenario</span><select id="scenario"><option value="normal">Normal sign-in</option><option value="deny">Consent denied</option><option value="unavailable">Service unavailable</option><option value="expired-session">Session expired</option></select></label><label class="field"><span>Token lifetime in seconds</span><input id="lifetime" type="number" min="30" max="3600"></label><details><summary>Registered applications</summary><p><small>Each application has an id, name and redirectUris array. Callbacks must match exactly.</small></p><textarea id="clients" rows="10" aria-label="Registered applications JSON"></textarea></details><div class="actions"><button id="save">Apply settings</button><button class="secondary" id="revoke">Revoke all sessions</button></div></div><p id="status" role="status"></p></section></div><script>const $=id=>document.getElementById(id);async function operator(method,body){const r=await fetch('/api/operator/cis2',{method,headers:{Authorization:'Bearer '+$('operator').value,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Error(data.message||data.error);return data}function show(data){$('controls').hidden=false;$('scenario').value=data.scenario;$('lifetime').value=data.tokenLifetimeSeconds;$('clients').value=JSON.stringify(data.clients,null,2);$('status').textContent='Scenario: '+data.scenario+'. '+data.active.tokens+' active tokens.'}for(const [id,run]of [['load',async()=>show(await operator('GET'))],['save',async()=>show(await operator('PUT',{scenario:$('scenario').value,tokenLifetimeSeconds:Number($('lifetime').value),clients:JSON.parse($('clients').value)}))],['revoke',async()=>show(await operator('DELETE'))]])$(id).onclick=async()=>{try{await run()}catch(e){$('status').textContent=e.message}};$('start').onclick=async()=>{try{const bytes=crypto.getRandomValues(new Uint8Array(32));const b64=b=>btoa(String.fromCharCode(...b)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');const verifier=b64(bytes),state=b64(crypto.getRandomValues(new Uint8Array(24))),nonce=b64(crypto.getRandomValues(new Uint8Array(24)));sessionStorage.setItem('cis2-demo',JSON.stringify({verifier,state}));const challenge=b64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));location.href='/cis2/authorize?'+new URLSearchParams({client_id:'nhs-sim-client',redirect_uri:location.origin+'/cis2/callback',response_type:'code',scope:'openid profile',code_challenge_method:'S256',code_challenge:challenge,state,nonce})}catch(e){$('status').textContent=e.message}};</script>`,
  );
function consent(interaction: ReturnType<MockOIDC["begin"]>) {
  return page(
    "Choose staff identity",
    `<span class="eyebrow">Staff sign-in</span><h1>Who are you working as?</h1><p><strong>${escape(interaction.client)}</strong> is requesting your fictional staff identity and selected role.</p><div class="notice">Training environment. Every person and organisation below is fictional.</div><form class="panel" method="post" action="/cis2/authorize"><input type="hidden" name="interaction" value="${escape(interaction.interaction)}"><input type="hidden" name="csrf" value="${escape(interaction.csrf)}">${cis2Identities.map((person, index) => `<label class="identity"><input type="radio" name="identity" value="${person.id}" ${index === 0 ? "checked" : ""}><strong>${person.name}</strong><span>${person.assignments[0]?.organisation}</span><select aria-label="Role for ${person.name}" name="assignment" ${index === 0 ? "" : "disabled"}>${person.assignments.map((role) => `<option value="${role.id}">${role.role}</option>`).join("")}</select></label>`).join("")}<p><small>Your name, staff identifier, role and organisation will be shared with this application.</small></p><div class="actions"><button name="action" value="continue">Continue with selected role</button><button class="secondary" name="action" value="cancel">Cancel sign-in</button></div><p id="consent-status" role="status"></p></form><script>document.querySelector("form").addEventListener("submit",async event=>{event.preventDefault();const form=event.currentTarget,button=event.submitter;const values=new URLSearchParams(new FormData(form));values.set("action",button?.value||"continue");try{const response=await fetch("/cis2/authorize",{method:"POST",headers:{Accept:"application/json"},body:values});const data=await response.json();if(!response.ok)throw Error(data.message||data.error);location.href=data.redirect}catch(error){document.getElementById("consent-status").textContent=error.message}});document.querySelectorAll('input[type=radio]').forEach(r=>r.addEventListener('change',()=>document.querySelectorAll('.identity').forEach(row=>row.querySelector('select').disabled=!row.querySelector('input').checked)));</script>`,
  );
}
const callback = () =>
  page(
    "Sign-in result",
    `<span class="eyebrow">Sign-in result</span><h1 id="heading">Completing sign-in…</h1><section class="panel"><pre id="result" role="status">Checking browser state and exchanging the code.</pre><div class="actions"><a class="button" href="/cis2/">Back to identity workbench</a><a class="button" href="/control/">Return to world</a></div></section><script>(async()=>{const out=document.getElementById('result');try{const p=new URLSearchParams(location.search),saved=sessionStorage.getItem('cis2-demo');history.replaceState(null,'','/cis2/callback');if(!saved)throw Error('No workbench session. Exchange the returned code from your application using its own PKCE verifier.');sessionStorage.removeItem('cis2-demo');const session=JSON.parse(saved);if(p.get('state')!==session.state)throw Error('State mismatch. Start a new sign-in.');if(p.get('error'))throw Error(p.get('error')+': '+p.get('error_description'));const response=await fetch('/cis2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:'nhs-sim-client',redirect_uri:location.origin+'/cis2/callback',code:p.get('code')||'',code_verifier:session.verifier})});const tokens=await response.json();if(!response.ok)throw Error(tokens.message);const info=await fetch('/cis2/userinfo',{headers:{Authorization:'Bearer '+tokens.access_token}});if(!info.ok)throw Error('Could not read signed-in identity');document.getElementById('heading').textContent='Staff identity confirmed';out.textContent=JSON.stringify({identity:await info.json(),expires_in:tokens.expires_in,token_type:tokens.token_type},null,2)}catch(e){document.getElementById('heading').textContent='Sign-in did not complete';out.textContent=e.message}})();</script>`,
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
      send(200, consent(interaction), true);
    } else if (path === "/cis2/authorize" && method === "POST") {
      const cookie =
        (req.headers.cookie ?? "")
          .split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith("cis2_interaction="))
          ?.slice("cis2_interaction=".length) ?? "";
      const redirect = oidc.complete(new URLSearchParams(await readBody(req)), cookie);
      if (req.headers.accept?.includes("application/json")) {
        res.setHeader("Set-Cookie", "cis2_interaction=; HttpOnly; SameSite=Lax; Path=/cis2/authorize; Max-Age=0");
        send(200, { redirect });
        return true;
      }
      res.writeHead(303, {
        Location: redirect,
        "Cache-Control": "no-store",
        "Set-Cookie": "cis2_interaction=; HttpOnly; SameSite=Lax; Path=/cis2/authorize; Max-Age=0",
      });
      res.end();
    } else send(404, { error: "not_found" });
  } catch (error) {
    if (error instanceof Cis2Error)
      send(error.status, { error: error.error, message: error.message });
    else if (error instanceof ZodError || error instanceof SyntaxError)
      send(400, { error: "invalid_request", message: error.message });
    else throw error;
  }
  return true;
}
