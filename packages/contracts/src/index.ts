import { z } from 'zod';

export const sites = [
  { id: 'control', name: 'Simulation control', subtitle: 'Clock, scenarios and world operations', color: '#17324d', kind: 'control' },
  { id: 'gp', name: 'Riverside Practice', subtitle: 'Primary care · modern record', color: '#005eb8', kind: 'clinical' },
  { id: 'hospital', name: 'Epi-ish · Northbank', subtitle: 'Acute care · admissions and theatres', color: '#642f88', kind: 'clinical' },
  { id: 'legacy', name: 'Cerner? I Hardly Know Her', subtitle: 'Westhaven legacy EPR · browser workflow', color: '#60533f', kind: 'legacy' },
  { id: 'triage', name: 'Front Door', subtitle: 'Requests and patient navigation', color: '#007f78', kind: 'clinical' },
  { id: 'diagnostics', name: 'Path & Picture', subtitle: 'Pathology and radiology worklists', color: '#8c3b20', kind: 'clinical' },
  { id: 'referrals', name: 'Referral Exchange', subtitle: 'Services, referrals and booking', color: '#394f99', kind: 'clinical' },
  { id: 'pharmacy', name: 'Neighbourhood Pharmacy', subtitle: 'Prescriptions, stock and dispensing', color: '#137047', kind: 'clinical' },
  { id: 'community', name: 'Neighbourhood Care', subtitle: 'Virtual ward, home visits and support', color: '#087b89', kind: 'clinical' },
  { id: 'wearables', name: 'Home Signals', subtitle: 'Devices and remote observations', color: '#a02e57', kind: 'clinical' },
  { id: 'robotics', name: 'Fleet Operations', subtitle: 'Robots, deliveries and capacity', color: '#3e4e66', kind: 'clinical' },
  { id: 'patient', name: 'My Neighbourhood', subtitle: 'Synthetic patient and carer workspace', color: '#005eb8', kind: 'clinical' },
  { id: 'population', name: 'Population & Research', subtitle: 'Prevention, genomics and quality', color: '#635091', kind: 'clinical' },
  { id: 'hr', name: 'ES-Arrr', subtitle: 'Electronic Staff Record-ish · HR and absence', color: '#85476d', kind: 'clinical' },
  { id: 'roster', name: 'Allocate-ish', subtitle: 'Rostering · skill mix and safe staffing', color: '#304f87', kind: 'clinical' },
  { id: 'ambulance', name: 'CAD-astrophe', subtitle: 'Dispatch, handovers and emergency demand', color: '#087653', kind: 'clinical' },
] as const;
export type SiteId = typeof sites[number]['id'];
export type Patient = { id: string; name: string; birthDate: string; localIds: Record<string,string>; conditions: string[]; needs: string[]; goals: string[]; synthetic: true };
export type Resource = { id: string; patientId?: string; kind: string; title: string; status: string; owner: SiteId; visibleTo: SiteId[]; priority: 'routine'|'urgent'; createdAt: number; dueAt?: number; data: Record<string, unknown>; version: number };
export type SimEvent = { id: string; time: number; type: string; actor: string; resourceId?: string; patientId?: string; detail: string; visibleTo: SiteId[] };
export type Scheduled = { at: number; type: 'result'|'delivery'|'visit'|'arrival'|'observation'; resourceId?: string; patientId?: string };
export type World = { id: string; seed: number; rng: number; now: number; speed: number; paused: boolean; nextId: number; patients: Patient[]; resources: Resource[]; scheduled: Scheduled[]; agents: { id: string; enabled: boolean }[]; counters: Record<string,number>; faults: Record<string,boolean> };
export const actionSchema = z.object({
  type: z.enum(['create_task','create_referral','order_test','draft_prescription','book_appointment','send_message','schedule_visit','dispatch_robot','review','accept','complete','reject','dispense','collect','share_record','report_absence','restore_staff','allocate_shift']),
  patientId: z.string().optional(), resourceId: z.string().optional(),
  title: z.string().min(1).max(500).optional(), target: z.enum(sites.map(s => s.id) as [SiteId,...SiteId[]]).optional(),
  expectedVersion: z.number().int().positive().optional(),
});
export type Action = z.infer<typeof actionSchema>;
export const scenarios = [
  { id: 'pathology-outage', title: 'Pathology feed outage', description: 'Hold new results in diagnostics until the feed is restored.' },
  { id: 'staff-shortage', title: 'Community staffing shortage', description: 'Reduce available home-visit slots.' },
  { id: 'robot-failure', title: 'Robot maintenance incident', description: 'Prevent new dispatches until the fleet is restored.' },
  { id: 'demand-surge', title: 'Demand surge', description: 'Create a burst of new patient requests.' },
  { id: 'wearable-disconnect', title: 'Home device disconnection', description: 'Generate missing readings rather than normal observations.' },
] as const;
