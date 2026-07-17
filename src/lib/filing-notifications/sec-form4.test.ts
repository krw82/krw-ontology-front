import { describe, expect, it } from "vitest";
import { parseSecForm4 } from "@/lib/filing-notifications/sec-form4";

describe("SEC Form 4 parser", () => {
  it("calculates a value only for a reported P/S transaction", () => {
    const parsed = parseSecForm4(`<?xml version="1.0"?>
      <ownershipDocument>
        <schemaVersion>5.3</schemaVersion>
        <reportingOwner>
          <reportingOwnerId><rptOwnerCik>12345</rptOwnerCik><rptOwnerName>Jane Director</rptOwnerName></reportingOwnerId>
          <reportingOwnerRelationship><isDirector>1</isDirector><isOfficer>0</isOfficer><isTenPercentOwner>0</isTenPercentOwner><isOther>0</isOther></reportingOwnerRelationship>
        </reportingOwner>
        <nonDerivativeTable>
          <nonDerivativeTransaction>
            <securityTitle><value>Common Stock</value></securityTitle>
            <transactionDate><value>2026-07-15</value></transactionDate>
            <transactionCoding><transactionCode>P</transactionCode><equitySwapInvolved>0</equitySwapInvolved><aff10b5One>1</aff10b5One></transactionCoding>
            <transactionAmounts>
              <transactionShares><value>100</value></transactionShares>
              <transactionPricePerShare><value>10.50</value></transactionPricePerShare>
              <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
            </transactionAmounts>
            <postTransactionAmounts><sharesOwnedFollowingTransaction><value>1100</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
            <ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature>
            <footnoteId id="F1" />
          </nonDerivativeTransaction>
          <nonDerivativeTransaction>
            <securityTitle><value>Restricted Stock</value></securityTitle>
            <transactionDate><value>2026-07-15</value></transactionDate>
            <transactionCoding><transactionCode>A</transactionCode></transactionCoding>
            <transactionAmounts><transactionShares><value>20</value></transactionShares></transactionAmounts>
          </nonDerivativeTransaction>
        </nonDerivativeTable>
      </ownershipDocument>`);

    expect(parsed.owners).toEqual([expect.objectContaining({ owner_cik: "12345", owner_name: "Jane Director", is_director: true })]);
    expect(parsed.transactions).toEqual([
      expect.objectContaining({ transaction_code: "P", transaction_shares: 100, transaction_price_per_share: 10.5, footnotes: ["F1"] }),
      expect.objectContaining({ transaction_code: "A", transaction_shares: 20, transaction_price_per_share: null }),
    ]);
    expect(parsed.summary).toMatchObject({
      transaction_count: 2,
      reported_purchase_count: 1,
      reported_purchase_value: 1050,
      reported_sale_value: null,
      tenb5_one_status: "yes",
      has_reported_open_market_trade: true,
    });
  });
});
