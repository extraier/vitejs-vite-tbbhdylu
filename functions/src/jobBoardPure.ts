/**
 * Split a job post into the owner record (keeps coupleUid) and the
 * public board record (does not). Both copies share an id.
 * Pure so unit tests don't load firebase-admin.
 */

export type JobWriteInput = {
  coupleUid: string;
  coupleName: string;
  weddingDate: string;
  serviceNeeded: string;
  venues: string[];
  budget: string;
  details: string;
};

export function buildJobRecords(input: JobWriteInput): {
  ownerRecord: JobWriteInput & { status: 'open'; proposalsCount: number; postedAt: string };
  publicRecord: Omit<JobWriteInput, 'coupleUid'> & {
    status: 'open';
    proposalsCount: number;
    postedAt: string;
  };
} {
  const shared = {
    coupleName: input.coupleName,
    weddingDate: input.weddingDate,
    serviceNeeded: input.serviceNeeded,
    venues: input.venues,
    budget: input.budget,
    details: input.details,
    status: 'open' as const,
    proposalsCount: 0,
    postedAt: '剛剛',
  };
  return {
    ownerRecord: { coupleUid: input.coupleUid, ...shared },
    publicRecord: shared,
  };
}
