import { describe, expect, it } from "vitest";
import {
  normalizeCik,
  parseInformationTableXml,
  positionKey,
} from "@/lib/sec-13f/parser";

describe("parseInformationTableXml", () => {
  it("parses SEC 13F information table rows", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">
        <infoTable>
          <nameOfIssuer>SLB LIMITED</nameOfIssuer>
          <titleOfClass>  COM STK</titleOfClass>
          <cusip>806857108</cusip>
          <value>132399706</value>
          <shrsOrPrnAmt>
            <sshPrnamt>2576371</sshPrnamt>
            <sshPrnamtType>SH</sshPrnamtType>
          </shrsOrPrnAmt>
          <investmentDiscretion>SOLE</investmentDiscretion>
          <votingAuthority>
            <Sole>2576371</Sole>
            <Shared>0</Shared>
            <None>0</None>
          </votingAuthority>
        </infoTable>
        <ns1:infoTable>
          <ns1:nameOfIssuer>ACME &amp; CO</ns1:nameOfIssuer>
          <ns1:titleOfClass>COM</ns1:titleOfClass>
          <ns1:cusip>000000001</ns1:cusip>
          <ns1:value>1234</ns1:value>
          <ns1:putCall>CALL</ns1:putCall>
          <ns1:shrsOrPrnAmt>
            <ns1:sshPrnamt>10</ns1:sshPrnamt>
            <ns1:sshPrnamtType>SH</ns1:sshPrnamtType>
          </ns1:shrsOrPrnAmt>
        </ns1:infoTable>
      </informationTable>`;

    const holdings = parseInformationTableXml(xml);

    expect(holdings).toHaveLength(2);
    expect(holdings[0]).toMatchObject({
      issuerName: "SLB LIMITED",
      titleOfClass: "COM STK",
      cusip: "806857108",
      valueUsd: 132399706,
      shares: 2576371,
      shareType: "SH",
      investmentDiscretion: "SOLE",
      votingAuthoritySole: 2576371,
    });
    expect(holdings[1]).toMatchObject({
      issuerName: "ACME & CO",
      putCall: "CALL",
    });
  });

  it("aggregates duplicate positions before persistence", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <informationTable>
        <infoTable>
          <nameOfIssuer>MEGA CAP INC</nameOfIssuer>
          <titleOfClass>COM</titleOfClass>
          <cusip>123456789</cusip>
          <value>100</value>
          <shrsOrPrnAmt>
            <sshPrnamt>4</sshPrnamt>
            <sshPrnamtType>SH</sshPrnamtType>
          </shrsOrPrnAmt>
          <votingAuthority>
            <Sole>4</Sole>
            <Shared>0</Shared>
            <None>0</None>
          </votingAuthority>
        </infoTable>
        <infoTable>
          <nameOfIssuer>MEGA CAP INC</nameOfIssuer>
          <titleOfClass>COM</titleOfClass>
          <cusip>123456789</cusip>
          <value>25</value>
          <shrsOrPrnAmt>
            <sshPrnamt>1</sshPrnamt>
            <sshPrnamtType>SH</sshPrnamtType>
          </shrsOrPrnAmt>
          <votingAuthority>
            <Sole>1</Sole>
            <Shared>0</Shared>
            <None>0</None>
          </votingAuthority>
        </infoTable>
      </informationTable>`;

    const holdings = parseInformationTableXml(xml);

    expect(holdings).toHaveLength(1);
    expect(holdings[0]).toMatchObject({
      issuerName: "MEGA CAP INC",
      cusip: "123456789",
      valueUsd: 125,
      shares: 5,
      votingAuthoritySole: 5,
    });
  });
});

describe("positionKey", () => {
  it("normalizes position identifiers", () => {
    expect(
      positionKey({
        cusip: " 806857108 ",
        titleOfClass: " com   stk ",
        putCall: null,
      }),
    ).toBe("806857108|");
  });
});

describe("normalizeCik", () => {
  it("pads CIK values to 10 digits", () => {
    expect(normalizeCik("1608046")).toBe("0001608046");
    expect(normalizeCik("CIK 0001608046")).toBe("0001608046");
  });
});
