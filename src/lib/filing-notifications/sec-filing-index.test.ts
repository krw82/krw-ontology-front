import { describe, expect, it } from "vitest";
import { isSecXslRenderedDocumentUrl, parseFilingIndexDocuments } from "./sec-filing-index";

describe("SEC filing index parser", () => {
  it("keeps metadata only and prioritizes a results exhibit", () => {
    const documents = parseFilingIndexDocuments({
      filingDetailUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/0000320193-26-000001-index.html",
      primaryDocumentName: "form8k.htm",
      html: `<table><tr><td>1</td><td>8-K</td><td><a href="form8k.htm">form8k.htm</a></td><td>8-K</td><td>1234</td></tr><tr><td>2</td><td>Earnings Results Release</td><td><a href="exhibit991.htm">exhibit991.htm</a></td><td>EX-99.1</td><td>4321</td></tr></table>`,
    });
    expect(documents).toHaveLength(2);
    expect(documents[0]).toMatchObject({ documentName: "exhibit991.htm", documentType: "EX-99.1", recommendationScore: 100 });
    expect(documents[1]).toMatchObject({ documentName: "form8k.htm", isPrimary: true, recommendationScore: 60 });
  });

  it("rejects non-SEC document links", () => {
    expect(parseFilingIndexDocuments({
      filingDetailUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/0000320193-26-000001-index.html",
      primaryDocumentName: null,
      html: `<tr><td>1</td><td>Bad</td><td><a href="https://example.com/file.htm">file.htm</a></td><td>EX-99</td><td>1</td></tr>`,
    })).toEqual([]);
  });

  it("keeps both an XSL-rendered Form 4 XML and its ownership XML source", () => {
    const documents = parseFilingIndexDocuments({
      filingDetailUrl: "https://www.sec.gov/Archives/edgar/data/1253512/000125351226000013/0001253512-26-000013-index.htm",
      primaryDocumentName: null,
      html: `<table><tr><td>1</td><td>Form 4 rendered view</td><td><a href="xslF345X06/form4-07152026_080703.xml">form4-07152026_080703.html</a></td><td>4</td><td>1</td></tr><tr><td>2</td><td>Form 4 ownership XML</td><td><a href="form4-07152026_080703.xml">form4-07152026_080703.xml</a></td><td>4</td><td>2</td></tr></table>`,
    });
    expect(documents).toHaveLength(2);
    expect(documents.map((document) => document.documentUrl)).toContain(
      "https://www.sec.gov/Archives/edgar/data/1253512/000125351226000013/form4-07152026_080703.xml",
    );
  });

  it("recognizes encoded SEC XSL Form 4 primary-document URLs", () => {
    expect(isSecXslRenderedDocumentUrl(
      "https://www.sec.gov/Archives/edgar/data/1535527/000125351226000013/xslF345X06%2Fform4.xml",
    )).toBe(true);
    expect(isSecXslRenderedDocumentUrl(
      "https://www.sec.gov/Archives/edgar/data/1253512/000125351226000013/form4.xml",
    )).toBe(false);
  });
});
