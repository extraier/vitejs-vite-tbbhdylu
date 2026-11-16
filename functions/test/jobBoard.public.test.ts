import { describe, expect, it } from 'vitest';
import { buildJobRecords, isDuplicateProposal, proposalDocId } from '../src/jobBoardPure';

describe('buildJobRecords', () => {
  it('keeps coupleUid on the owner record and omits it from the public board', () => {
    const { ownerRecord, publicRecord } = buildJobRecords({
      coupleUid: 'couple-1',
      coupleName: '陳生陳太',
      weddingDate: '2026-12-01',
      serviceNeeded: '攝影服務',
      venues: ['酒店'],
      budget: 'HK$30,000',
      details: '全日',
    });

    expect(ownerRecord.coupleUid).toBe('couple-1');
    expect(ownerRecord.serviceNeeded).toBe('攝影服務');
    expect(publicRecord).not.toHaveProperty('coupleUid');
    expect(publicRecord.serviceNeeded).toBe('攝影服務');
    expect(publicRecord.status).toBe('open');
    expect(publicRecord.proposalsCount).toBe(0);
  });
});

describe('proposal duplicate key', () => {
  it('uses one id per vendor per job', () => {
    expect(proposalDocId('job-1', 'vendor-1')).toBe('job-1__vendor-1');
    expect(proposalDocId('job-1', 'vendor-2')).not.toBe(proposalDocId('job-1', 'vendor-1'));
  });

  it('treats a deterministic hit or an older auto-id row as a duplicate', () => {
    expect(isDuplicateProposal({
      vendorUid: 'vendor-1',
      directHit: true,
      matches: [],
    })).toBe(true);
    expect(isDuplicateProposal({
      vendorUid: 'vendor-1',
      directHit: false,
      matches: [{ vendorUid: 'vendor-1' }, { vendorUid: 'vendor-2' }],
    })).toBe(true);
    expect(isDuplicateProposal({
      vendorUid: 'vendor-1',
      directHit: false,
      matches: [{ vendorUid: 'vendor-2' }],
    })).toBe(false);
  });
});
