import Head from "next/head";
import { useEffect, useState } from "react";
import { shortenAddress } from "@/utils/format";

type Entry = { publicKey: string; totalXLM: string; federationName?: string | null };
type Leaderboard = { recipients: Entry[]; senders: Entry[]; totalTips: number; totalXLM: string };

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

function Ranking({ title, entries }: { title: string; entries: Entry[] }) {
  return (
    <section className="card overflow-hidden">
      <h2 className="mb-4 font-display text-xl font-semibold text-white">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-slate-400"><tr><th scope="col" className="py-2">Rank</th><th scope="col">Account</th><th scope="col" className="text-right">XLM</th></tr></thead>
          <tbody className="divide-y divide-white/5">
            {entries.map((entry, index) => (
              <tr key={entry.publicKey}>
                <th scope="row" className="py-3 font-medium text-slate-400">{index + 1}</th>
                <td className="font-mono text-slate-200" title={entry.publicKey}>{entry.federationName || shortenAddress(entry.publicKey, 8)}</td>
                <td className="text-right font-semibold text-stellar-300">{Number(entry.totalXLM).toLocaleString(undefined, { maximumFractionDigits: 7 })}</td>
              </tr>
            ))}
            {entries.length === 0 && <tr><td colSpan={3} className="py-8 text-center text-slate-500">No tips recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function LeaderboardPage() {
  const [data, setData] = useState<Leaderboard | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`${API_URL}/api/tips/leaderboard`);
        if (!response.ok) throw new Error("Unable to load leaderboard");
        const body = await response.json();
        if (active) { setData(body.data); setError(""); }
      } catch (err) { if (active) setError(err instanceof Error ? err.message : "Unable to load leaderboard"); }
    };
    void load();
    const interval = window.setInterval(load, 60_000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <Head><title>Community Tips Leaderboard | Stellar MicroPay</title></Head>
      <div className="mb-8 text-center"><h1 className="font-display text-4xl font-bold text-white">Community Tips Leaderboard</h1><p className="mt-2 text-slate-400">Celebrating the people powering the Stellar MicroPay community.</p></div>
      {error && <p role="alert" className="mb-6 rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-red-300">{error}</p>}
      <div className="mb-6 grid gap-4 sm:grid-cols-2"><div className="card text-center"><p className="text-sm text-slate-400">Tips processed</p><p className="mt-1 text-3xl font-bold text-white">{data?.totalTips ?? "—"}</p></div><div className="card text-center"><p className="text-sm text-slate-400">Total XLM tipped</p><p className="mt-1 text-3xl font-bold text-stellar-300">{data ? Number(data.totalXLM).toLocaleString(undefined, { maximumFractionDigits: 7 }) : "—"}</p></div></div>
      <div className="grid gap-6 lg:grid-cols-2"><Ranking title="Top recipients" entries={data?.recipients ?? []} /><Ranking title="Top senders" entries={data?.senders ?? []} /></div>
    </main>
  );
}
