import { describe, expect, it } from "vitest";
import { diffSheets, absoluteA1, setGridCell } from "../compare";

// Columns are spreadsheet letters (A, B, C…) and row 0 is real data.

describe("diffSheets — key matching", () => {
  // A = key, B = Status, C = Owner
  const master = [
    ["1", "Open", "Ada"],
    ["2", "Closed", "Grace"],
    ["3", "Open", "Linus"],
  ];

  it("matches rows by key even when the target is reordered", () => {
    const target = [
      ["3", "Open", "Linus"],
      ["2", "Pending", "Grace"], // B differs on key 2
      ["1", "Open", "Ada"],
    ];
    expect(diffSheets(master, target, "A", ["B", "C"])).toEqual([
      { keyValue: "2", rowRef: null, column: "B", masterValue: "Closed", targetValue: "Pending" },
    ]);
  });

  it("raises nothing when the compared columns already match", () => {
    const target = [
      ["1", "Open", "Ada"],
      ["2", "Closed", "Grace"],
      ["3", "Open", "Linus"],
    ];
    expect(diffSheets(master, target, "A", ["B", "C"])).toEqual([]);
  });

  it("does not invent rows for keys the target lacks", () => {
    const target = [
      ["1", "Open", "Ada"],
      ["2", "Closed", "Grace"],
      // key 3 missing → can't write it
    ];
    expect(diffSheets(master, target, "A", ["B", "C"])).toEqual([]);
  });
});

describe("diffSheets — deletion / clear propagation", () => {
  it("suggests clearing a target row whose key the master dropped", () => {
    const master = [["1", "Open"]];
    const target = [
      ["1", "Open"],
      ["2", "Stale"], // key 2 no longer in master
    ];
    expect(diffSheets(master, target, "A", ["B"])).toEqual([
      { keyValue: "2", rowRef: null, column: "B", masterValue: "", targetValue: "Stale" },
    ]);
  });

  it("suggests clearing every target value when the master is emptied", () => {
    const master: string[][] = [];
    const target = [
      ["1", "X"],
      ["2", "Y"],
    ];
    expect(diffSheets(master, target, "A", ["B"])).toEqual([
      { keyValue: "1", rowRef: null, column: "B", masterValue: "", targetValue: "X" },
      { keyValue: "2", rowRef: null, column: "B", masterValue: "", targetValue: "Y" },
    ]);
  });

  it("positional: clears target rows past the end of the master", () => {
    const master = [["a"]];
    const target = [["a"], ["b"]]; // row index 1 has no master counterpart
    expect(diffSheets(master, target, null, ["A"])).toEqual([
      { keyValue: "1", rowRef: "1", column: "A", masterValue: "", targetValue: "b" },
    ]);
  });
});

describe("diffSheets — positional fallback", () => {
  it("compares row-by-row when no key column is set", () => {
    const master = [["x"], ["y"]];
    const target = [["x"], ["z"]]; // row 1 differs
    expect(diffSheets(master, target, null, ["A"])).toEqual([
      { keyValue: "1", rowRef: "1", column: "A", masterValue: "y", targetValue: "z" },
    ]);
  });
});

describe("setGridCell + no re-raise after apply", () => {
  it("sets a cell, growing rows and columns with blanks", () => {
    const grid: string[][] = [["a"]];
    setGridCell(grid, 2, 3, "x");
    expect(grid).toEqual([["a"], [], ["", "", "", "x"]]);
  });

  it("stops raising a suggestion once the target snapshot is patched to master", () => {
    const master = [
      ["1", "Open"],
      ["2", "Closed"],
    ];
    const target = [
      ["1", "Open"],
      ["2", "Pending"],
    ];
    expect(diffSheets(master, target, "A", ["B"])).toHaveLength(1);
    setGridCell(target, 1, 1, "Closed"); // simulate the applied write
    expect(diffSheets(master, target, "A", ["B"])).toEqual([]);
  });
});

describe("absoluteA1", () => {
  it("maps a grid cell to tab-qualified A1 using the range origin", () => {
    expect(absoluteA1("B2:F100", "Team", 2, 1)).toBe("'Team'!C4");
  });

  it("handles an A1-origin range without a tab", () => {
    expect(absoluteA1("A1:Z1000", null, 0, 0)).toBe("A1");
    expect(absoluteA1("A1:Z1000", null, 4, 2)).toBe("C5");
  });
});
