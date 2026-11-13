import { describe, expect, it } from 'vitest';
import { buildJobRecords } from '../src/jobBoardPure';

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
