import { randomBytes, createHash } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import type { Engine } from '../../engine/src/index.ts';
import type { SiteId } from '../../contracts/src/index.ts';

export const catalogue = [
  {id:'pds',name:'PDS-ish',site:'gp',resource:'Patient',description:'Synthetic demographics: search and read'},
  {id:'ods',name:'ODS & Ends',site:'referrals',resource:'Organization',description:'Fictional organisation directory'},
  {id:'dos',name:'DoS Equis',site:'referrals',resource:'HealthcareService',description:'Service discovery and availability'},
  {id:'ers',name:'e-Re-ferrals',site:'referrals',resource:'ServiceRequest',kind:'referral',description:'Create, read, accept and reject referrals'},
  {id:'eps',name:'e-Pre-scripted',site:'pharmacy',resource:'MedicationRequest',kind:'prescription',description:'Draft, approve, dispense and collect'},
  {id:'eps-tracker',name:'Where Is My Prescription?',site:'pharmacy',resource:'MedicationRequest',kind:'prescription',description:'Read prescription lifecycle'},
  {id:'gp-connect',name:'GP Disconnect',site:'gp',resource:'Task',kind:'task',description:'Local primary-care task projection'},
  {id:'mesh',name:'MESH-terious',site:'gp',resource:'Communication',kind:'message',description:'Simplified JSON mailbox; not real MESH protocol'},
  {id:'scr',name:'Summary Scare Record',site:'gp',resource:'DocumentReference',kind:'document',description:'Visible shared documents only'},
  {id:'immunisations',name:'Jab-a-Dabba-Doo',site:'population',resource:'Immunization',kind:'vaccination',description:'Synthetic immunisation register'},
  {id:'screening',name:'Screen Time',site:'population',resource:'ServiceRequest',kind:'screening',description:'Screening follow-up register'},
  {id:'pathology',name:'Blood, Sweat & Tiers',site:'diagnostics',resource:'DiagnosticReport',kind:'test',description:'Delayed laboratory results'},
  {id:'radiology',name:'PACS to the Future',site:'diagnostics',resource:'DiagnosticReport',kind:'report',description:'Synthetic report metadata; no DICOM server'},
  {id:'appointments',name:'Slot Machine',site:'gp',resource:'Appointment',kind:'appointment',description:'Capacity-backed booking'},
] as const;
export function bundle(engine:Engine,world:string,id:string,q:string) {
  const api=catalogue.find(a=>a.id===id);if(!api)return undefined;
  if(id==='pds'){const ps=engine.patients(world,q);return {resourceType:'Bundle',type:'searchset',total:ps.total,entry:ps.items.map(p=>({resource:{resourceType:'Patient',id:p.id,identifier:[{system:'urn:nhs-sim:synthetic',value:p.id}],name:[{text:p.name}],birthDate:p.birthDate,meta:{tag:[{code:'SYNTHETIC'}]}}}))};}
  if(id==='ods'||id==='dos')return {resourceType:'Bundle',type:'searchset',entry:['gp','hospital','community','pharmacy','diagnostics'].map(site=>({resource:{resourceType:api.resource,id:site,name:site+' (fictional)',active:true}}))};
  const resources=engine.view(world,api.site as SiteId).resources.filter(r=>'kind' in api&&r.kind===api.kind&&(!q||r.patientId===q));
  return {resourceType:'Bundle',type:'searchset',total:resources.length,entry:resources.slice(0,100).map(r=>({resource:{resourceType:api.resource,id:r.id,status:r.status,subject:r.patientId?{reference:'Patient/'+r.patientId}:undefined,description:r.title,extension:[{url:'urn:nhs-sim:workflow',valueString:JSON.stringify(r.data)}],meta:{versionId:String(r.version),tag:[{code:'SIMPLIFIED-MOCK-NOT-FHIR-CONFORMANT'}]}}}))};
}
export class MockOIDC {
  origin:string; keys?:Awaited<ReturnType<typeof generateKeyPair>>;
  codes=new Map<string,{challenge:string;nonce:string;redirect:string;expires:number}>();
  tokens=new Map<string,number>();
  constructor(origin:string){this.origin=origin;}
  async init(){this.keys=await generateKeyPair('RS256');}
  discovery(){return {issuer:this.origin+'/cis2',authorization_endpoint:this.origin+'/cis2/authorize',token_endpoint:this.origin+'/cis2/token',userinfo_endpoint:this.origin+'/cis2/userinfo',jwks_uri:this.origin+'/cis2/jwks',response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],grant_types_supported:['authorization_code'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'],scopes_supported:['openid','profile']};}
  async jwks(){return {keys:[{...await exportJWK(this.keys!.publicKey),kid:'sim-key',alg:'RS256',use:'sig'}]};}
  authorize(params:URLSearchParams){
    const redirect=params.get('redirect_uri')??'';
    if(redirect!==this.origin+'/cis2/callback'||params.get('client_id')!=='nhs-sim-client'||params.get('response_type')!=='code'||params.get('code_challenge_method')!=='S256'||!params.get('code_challenge')||!params.get('state')||!params.get('nonce'))throw new Error('Use registered client nhs-sim-client, /cis2/callback and authorization code + PKCE S256, state and nonce');
    const code=randomBytes(24).toString('hex');
    this.codes.set(code,{redirect,challenge:params.get('code_challenge')!,nonce:params.get('nonce')!,expires:Date.now()+120000});
    const url=new URL(redirect);url.searchParams.set('code',code);url.searchParams.set('state',params.get('state')!);return url.toString();
  }
  async token(params:URLSearchParams){
    const code=params.get('code')??'',data=this.codes.get(code);this.codes.delete(code);
    if(!data||data.expires<Date.now()||params.get('grant_type')!=='authorization_code'||params.get('client_id')!=='nhs-sim-client'||params.get('redirect_uri')!==data.redirect||createHash('sha256').update(params.get('code_verifier')??'').digest('base64url')!==data.challenge)throw new Error('Invalid or expired authorization code / PKCE');
    const access_token=randomBytes(32).toString('hex');this.tokens.set(access_token,Date.now()+3600000);
    const id_token=await new SignJWT({name:'Dr Demo Clinician',nonce:data.nonce,nhs_sim:true}).setProtectedHeader({alg:'RS256',kid:'sim-key'}).setSubject('SIM-STAFF-1').setIssuer(this.origin+'/cis2').setAudience('nhs-sim-client').setIssuedAt().setExpirationTime('1h').sign(this.keys!.privateKey);
    return {access_token,id_token,token_type:'Bearer',expires_in:3600};
  }
  userinfo(token:string){if((this.tokens.get(token)??0)<Date.now())throw new Error('Invalid access token');return {sub:'SIM-STAFF-1',name:'Dr Demo Clinician',nhs_sim:true,org:'SIM-RIVERSIDE',role:'simulated-clinician'};}
}
