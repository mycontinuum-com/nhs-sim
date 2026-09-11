import type { RecordChange, SimEvent } from './index.ts';
export type OperatorLogging = { since: string; retentionDays: number; maxRequestsPerWorld: number };
export type OperatorTeam = { team: string; teamName: string; world: string; scopes: string[]; patientCount: number; resourceCount: number; affectedPatientCount: number; requestCount: number; lastRequestAt: string | null };
export type OperatorRequest = { id: string; time: string; method: string; path: string; status: number; durationMs: number; team: string; world: string; patientIds: string[] };
export type OperatorChange = RecordChange & { resourceId: string; patientId?: string; title: string; kind: string };
export type OperatorTeams = { teams: OperatorTeam[]; logging: OperatorLogging };
export type OperatorActivity = { team: OperatorTeam; requests: OperatorRequest[]; patients: { id: string; name: string; changeCount: number; lastChangedAt: number }[]; changes: OperatorChange[]; events: SimEvent[]; logging: OperatorLogging };
export type OperatorSession = { apiKey: string; team: string; teamName: string; world: string; scopes: string[]; created: false };

export type OperatorDeletion = { deleted: true; world: string; teamName: string };
export type OperatorBulkDeletion = { deleted: true; teams: {world:string;teamName:string}[] };
export type OperatorAllTeamIncident = { id:string;enabled:boolean;affectedTeams:number;worlds:string[] };
