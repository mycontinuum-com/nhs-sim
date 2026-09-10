const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
url.searchParams.set('audience', 'sts.amazonaws.com');
const response = await fetch(url, {headers: {Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`}});
if (!response.ok) throw new Error('Could not request the deployment identity');
const {value} = await response.json();
const claims = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString());
console.log(JSON.stringify({subject: claims.sub, audience: claims.aud, ref: claims.ref}));
if (claims.sub !== 'repo:mycontinuum-com@75080444/nhs-sim@1364021222:ref:refs/heads/main' || claims.aud !== 'sts.amazonaws.com') {
  throw new Error('Deployment identity does not match the exact repository and main branch');
}
