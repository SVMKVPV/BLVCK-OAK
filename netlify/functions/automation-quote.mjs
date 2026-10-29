import { createHash } from 'node:crypto';
import contactSubmit from './contact-submit.mjs';
import { publicFeatureAccess } from '../lib/feature-access.mjs';
import { PortalError, readBody } from '../lib/portal-auth.mjs';
import { json } from '../lib/referrals.mjs';
import { calculateAutomationEstimate, automationBrief } from '../../automation-estimate.js';

// Reuse the existing enquiry storage, quota, consent checks and email delivery.
// Prices and the brief are rebuilt here; browser-supplied totals are never trusted.
export function prepareAutomationContact(body) {
 if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Enter valid project details.');
 const reference = String(body.reference || '');
 if (!/^BOA-[A-F0-9]{16}$/.test(reference)) throw new Error('Generate your estimate again before sending.');
 if (!/^[A-Za-z0-9-]{16,80}$/.test(String(body.requestId || ''))) throw new Error('Refresh the page and try again.');
 const estimate=calculateAutomationEstimate(body.selection);
 const message=automationBrief(estimate,reference);
 if(message.length>3000) throw new Error('Please shorten your notes before sending this quote request.');
 // Bind idempotency to the actual enquiry so edits cannot reuse a previous lead.
 const requestId=createHash('sha256').update(JSON.stringify([body.requestId,body.name,body.email,body.company,message])).digest('hex');
 return {name:body.name,email:body.email,company:body.company,website:body.website,acceptedPrivacy:body.acceptedPrivacy,requestId,service:'workflow-ai',message};
}
export default async function handler(request,context) {
 if(request.method!=='POST') return json({error:'Method not allowed.'},405);
 const denied=publicFeatureAccess(request); if(denied) return denied;
 let body;
 try { body=await readBody(request,16_384); }
 catch(error) { return json({error:error instanceof PortalError?error.message:'Enter valid project details.'},error instanceof PortalError?error.status:400); }
 let contact;
 try { contact=prepareAutomationContact(body); }
 catch(error) { return json({error:error.message},400); }
 const headers=new Headers(request.headers); headers.set('content-type','application/json'); headers.delete('content-length');
 return contactSubmit(new Request(request.url,{method:'POST',headers,body:JSON.stringify(contact)}),context);
}
