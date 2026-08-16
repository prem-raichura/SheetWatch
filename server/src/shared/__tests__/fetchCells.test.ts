import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Auth } from "googleapis";

const batchGet = vi.fn();

vi.mock("googleapis", () => ({
  google: {
    sheets: () => ({ spreadsheets: { values: { batchGet } } }),
  },
}));

import { fetchCells } from "../google/sheets";

const auth = {} as Auth.OAuth2Client;

describe("fetchCells", () => {
  beforeEach(() => batchGet.mockReset());

  it("maps values back to the ranges that were asked for", async () => {
    batchGet.mockResolvedValue({
      data: {
        valueRanges: [{ values: [["42"]] }, { values: [["done"]] }],
      },
    });

    const values = await fetchCells("sheet-id", ["'Tab'!R21", "'Tab'!B4"], auth);
    expect(values).toEqual(["42", "done"]);
    expect(batchGet).toHaveBeenCalledWith({
      spreadsheetId: "sheet-id",
      ranges: ["'Tab'!R21", "'Tab'!B4"],
    });
  });

  it("returns null for an empty cell, keeping positions aligned", async () => {
    batchGet.mockResolvedValue({
      data: { valueRanges: [{}, { values: [["7"]] }] },
    });

    expect(await fetchCells("sheet-id", ["A1", "B1"], auth)).toEqual([null, "7"]);
  });

  it("skips the call when there is nothing to read", async () => {
    expect(await fetchCells("sheet-id", [], auth)).toEqual([]);
    expect(batchGet).not.toHaveBeenCalled();
  });
});
