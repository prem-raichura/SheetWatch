import { useState } from "react";
import { api } from "../lib/api";
import { Sheet } from "../types";
import Spinner from "./Spinner";

interface Props {
  onAdded: () => void;
}

export default function AddSheetBox({ onAdded }: Props) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await api.post<Sheet>("/api/sheets", { url: url.trim() });
      setUrl("");
      onAdded();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add sheet");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-line bg-surface p-4 shadow-card"
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://docs.google.com/spreadsheets/d/…"
          className="flex-1 rounded-lg border border-line bg-paper px-3 py-2 font-mono text-sm text-ink-900 placeholder:text-ink-300 outline-hidden transition-shadow focus:border-teal focus:ring-4 focus:ring-teal/10"
        />
        <button
          type="submit"
          disabled={loading || !url.trim()}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-foreground px-5 py-2 text-sm font-semibold text-background shadow-xs transition-all hover:bg-foreground/85 hover:shadow-md active:scale-[0.97] disabled:opacity-50 disabled:hover:shadow-xs"
        >
          {loading && <Spinner />}
          {loading ? "Adding…" : "Track"}
        </button>
      </div>
      {error && <p className="mt-2 font-mono text-xs text-coral-600">{error}</p>}
    </form>
  );
}
