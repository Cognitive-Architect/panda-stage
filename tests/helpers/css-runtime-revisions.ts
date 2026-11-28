import { createHash } from 'node:crypto';
import { expect } from 'vitest';

// Issue #1427 approves new runtime bytes for these visual stylesheet owners.
// The split manifest and its historical receipts retain their original hashes.
const designV2Revisions: Record<string, { sha: string; length: number }> = {
  // Issues #1432–#1434 retire the replaced drawer and layout selectors.
  G049: { sha: '8209abc1be91eaece924cf0a8fd4af542a5e53e7361e228d8735cb2e6c2c4aed', length: 6882 },
  G056: { sha: '60a62e8f85c6af7a39a844cf265c5fcbee2be826c3393a5e8c5b2836d0a69fa8', length: 7320 },
  G122: { sha: '850d61a12fd8ba9fbb7b7b9b05c74594692712ab5cf7574f57e5c1e44056720a', length: 1148 },
  // Issue #1466 moves viewport controls to the canvas.
  G044: { sha: 'd91b8dedcbe45d235ce335f653f01f9861323f0d9bfa2f4a9784964250832dbe', length: 5301 },
  // Issue #1427 retains these approved design token revisions.
  G001: { sha: '890146dc15d36c3913ac573462afc2f9acbf88b5833923cfe879041bf3597011', length: 461 },
  G002: { sha: '005126f042474c2dfeb1d96ed1ff4825180d353440f28da9fa35830a9c945444', length: 234 },
  G018: { sha: '86fc1684daba75f4aec2bc4f187ceff8238f97c6289fa5e2df76b91bd1f5eedc', length: 9202 },
  G020: { sha: 'be2da10f86af8774cdbea43bace33e56c9dd122f08908903336c9b135ea65323', length: 4461 },
  G028: { sha: '891d785c3ba7bdea069e1130a4b7114ff4b2130d46871f2f82945674bbc1a4c8', length: 25104 },
  G034: { sha: 'f70ad4555457527ab88fe72eaae7615eabf88575872628fea1293adf6d751cf9', length: 5752 },
  G045: { sha: 'd3bcd1c23be2d11975a07ed469630b16e43791c6cdebcf3fb2da45ba44f77337', length: 1572 },
  G047: { sha: '188382a3a369d749f723dfa41d7dd11a4963f5a5f3f3bcf7aa45520db8244ff8', length: 1099 },
  G050: { sha: '4917c2068a03106c11242ce17f3d6bbe75d3ef115032359a49c72c94b1d25140', length: 1311 },
  G051: { sha: 'a97de58bd3abe0b791525025522b30e40b6e001a8a21e555c8888da925879373', length: 4330 },
  G052: { sha: 'a11fdc6cb283726073f3efe286eb1d70d9324fc4125d39c416b7ae854ea35c46', length: 1479 },
  G054: { sha: '8ab48abc684a85b7696b22bfbec5031419a1dfda39f4f0a54ce3d6d7ef55b66a', length: 4261 },
  G088: { sha: '287b045f8d995629ed92455eda9b76e429c3e202ba44a99fd629357b29241a70', length: 13116 },
  G090: { sha: '24d06d9e2542416cb080b785accb54d504621ee1b912fddbacd3768dd64ae305', length: 37914 },
  G093: { sha: '15efbf6b7820edf81bca6c6709926d9f5946c7e2c4492b7029a1ebac937a39c6', length: 1744 },
  G139: { sha: '00657e6901fc39176c2945e16dec6fb5abe7c56cfb90253efd6bee6ca7321540', length: 9508 },
  G140: { sha: '5306134a4e386b86904bd7b7dfb9045ec0016c3403b23e3d82a6562cef00b7b3', length: 14918 },
  G145: { sha: '8685660dac718e0c4e773e69349c0976a4d2ea6299a35dcd52919b725c294b9e', length: 13491 },
};

export function assertDesignV2StylesheetRevision(id: string, target: string): boolean {
  const expected = designV2Revisions[id];
  if (!expected) return false;

  expect(createHash('sha256').update(target, 'utf8').digest('hex'), id).toBe(expected.sha);
  expect(Buffer.byteLength(target, 'utf8'), id).toBe(expected.length);
  return true;
}
