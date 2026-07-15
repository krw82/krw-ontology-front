import { describe, expect, it } from "vitest";
import { parseFilingIndexDocuments } from "./sec-filing-index";

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
});
