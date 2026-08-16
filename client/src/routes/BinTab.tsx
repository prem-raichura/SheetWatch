import DriveBin from "../components/DriveBin";

// The Drive bin lives on its own route now — reached from the Bin button in the
// header rather than a toggle inside the Sheets tab.
export default function BinTab() {
  return (
    <div className="animate-fade-up space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900">Bin</h1>
        <p className="mt-1 text-sm text-ink-500">
          Spreadsheets in your Google Drive trash. Restore one to bring it back to{" "}
          <span className="font-medium text-ink-700">Your sheets</span>.
        </p>
      </div>

      {/* The sheets list refetches on mount, so a restore needs no callback here. */}
      <DriveBin onChanged={() => {}} />
    </div>
  );
}
