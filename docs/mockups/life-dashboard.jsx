import React, { useState, useEffect, useCallback } from "react";

// ---------- Design tokens ----------
// Field-notebook / trail-map aesthetic: warm parchment, pine green, ochre,
// slate — grounded rather than clinical, since this holds a real person's
// numbers and goals, not a generic SaaS metric.
const STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=IBM+Plex+Sans:wght@400;500;600&display=swap');

:root {
  --bg: #EDE8DC;
  --surface: #F8F5EC;
  --ink: #2B2A25;
  --ink-soft: #6B675C;
  --pine: #3E5C46;
  --pine-soft: #D9E3DA;
  --ochre: #B8863C;
  --ochre-soft: #F0E2C8;
  --slate: #52626B;
  --rust: #A6503A;
  --line: #D8D2C2;
}

.ldb-root {
  font-family: 'IBM Plex Sans', sans-serif;
  background: var(--bg);
  color: var(--ink);
  min-height: 100%;
  padding: 0;
}

.ldb-header {
  padding: 28px 24px 0;
}

.ldb-title {
  font-family: 'Fraunces', serif;
  font-weight: 600;
  font-size: 28px;
  letter-spacing: -0.01em;
  margin: 0;
}

.ldb-sub {
  color: var(--ink-soft);
  font-size: 14px;
  margin: 4px 0 20px;
}

.ldb-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--line);
  padding: 0 24px;
}

.ldb-tab {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 14px;
  font-weight: 500;
  color: var(--ink-soft);
  background: none;
  border: none;
  padding: 10px 14px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}

.ldb-tab.active {
  color: var(--pine);
  border-bottom-color: var(--pine);
}

.ldb-body {
  padding: 24px;
  max-width: 720px;
}

.ldb-section-title {
  font-family: 'Fraunces', serif;
  font-size: 19px;
  font-weight: 500;
  margin: 0 0 4px;
}

.ldb-section-note {
  color: var(--ink-soft);
  font-size: 13px;
  margin: 0 0 16px;
  max-width: 60ch;
}

.ldb-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 16px 18px;
  margin-bottom: 14px;
}

.ldb-day-row {
  display: grid;
  grid-template-columns: 84px 1fr;
  gap: 14px;
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
}
.ldb-day-row:last-child { border-bottom: none; }

.ldb-day-name {
  font-weight: 600;
  color: var(--pine);
  font-size: 14px;
}

.ldb-day-blocks div {
  font-size: 13px;
  color: var(--ink);
  line-height: 1.5;
}
.ldb-day-blocks .tag {
  color: var(--ink-soft);
}

.ldb-input {
  font-family: 'IBM Plex Sans', sans-serif;
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 4px;
  padding: 6px 8px;
  font-size: 14px;
  width: 100px;
  color: var(--ink);
}

.ldb-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
  font-size: 14px;
}
.ldb-row:last-child { border-bottom: none; }

.ldb-row-label { color: var(--ink); }
.ldb-row-sub { color: var(--ink-soft); font-size: 12px; }

.ldb-bignum {
  font-family: 'Fraunces', serif;
  font-size: 32px;
  font-weight: 600;
}

.ldb-tier-bar {
  height: 8px;
  border-radius: 4px;
  background: var(--line);
  overflow: hidden;
  margin-top: 6px;
}
.ldb-tier-fill {
  height: 100%;
  background: var(--pine);
}

.ldb-goal-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
}
.ldb-goal-row:last-child { border-bottom: none; }

.ldb-goal-name { flex: 1; font-size: 14px; }
.ldb-goal-cadence { font-size: 12px; color: var(--ink-soft); width: 110px; }

.ldb-counter-btn {
  width: 26px;
  height: 26px;
  border-radius: 4px;
  border: 1px solid var(--line);
  background: #fff;
  cursor: pointer;
  font-size: 15px;
  color: var(--pine);
  display: flex;
  align-items: center;
  justify-content: center;
}

.ldb-counter-val {
  font-weight: 600;
  min-width: 20px;
  text-align: center;
  font-size: 14px;
}

.ldb-journal-input {
  width: 100%;
  min-height: 70px;
  font-family: 'IBM Plex Sans', sans-serif;
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 10px;
  font-size: 14px;
  resize: vertical;
  box-sizing: border-box;
}

.ldb-journal-entry {
  border-bottom: 1px solid var(--line);
  padding: 10px 0;
}
.ldb-journal-date {
  font-size: 11px;
  color: var(--ink-soft);
  margin-bottom: 4px;
}

.ldb-save-btn {
  background: var(--pine);
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  margin-top: 8px;
}

.ldb-status {
  font-size: 12px;
  color: var(--ink-soft);
  margin-left: 10px;
}
`;

const SCHEDULE = [
  {
    day: "Mon / Fri",
    blocks: [
      "5:00–9:00 — self-care, pups, movement",
      "9:00–12:30 — PIN / business work",
      "12:30 — lunch, dog walk",
      "1:00–2:30 — nap",
      "2:30–3:00 — get ready",
      "3:00–9/10 — Bruges shift",
      "Evening — dinner, dog walk, movie w/ Dad",
    ],
  },
  {
    day: "Tue",
    blocks: [
      "Sleep in, lazy morning",
      "Clean, groceries, laundry, hobbies, languages",
      "5:00 — week-ahead planning + MBA work",
      "7:30–8:30 — study group",
      "9:00 — dinner w/ Dad",
    ],
  },
  {
    day: "Wed",
    blocks: [
      "5:00–8:00 — easing in, pups, self-care",
      "8:00 — day planning",
      "9:00–5:00 — PIN / MBA work",
      "6:00 — dog walk, head out",
      "7:00 — comedy club / bar / open evening",
    ],
  },
  {
    day: "Thu",
    blocks: ["Same as Tue", "7:30 — class instead of study group"],
  },
  {
    day: "Sat / Sun",
    blocks: [
      "5:00–7:30 — self + pup care",
      "8:00–4:40 — Bruges shift",
      "5:00 — dog walk, shower",
      "6:00–7:00 — make dinner",
      "7:00–10:00 — wind down / tinker",
    ],
  },
];

const DEFAULT_BUDGET = {
  income: 1047,
  necessities: 862.53,
  business: 109.2,
  comfy: 2184,
};

const DEFAULT_GOALS = [
  { name: "Camping trip", cadence: "Every other month", count: 0 },
  { name: "Road trip", cadence: "Quarterly", count: 0 },
  { name: "Nashville trip", cadence: "Annual", count: 0 },
  { name: "Concert", cadence: "Whenever it hits", count: 0 },
  { name: "Comedy club / bar night", cadence: "Weekly (Wed)", count: 0 },
  { name: "Community / local event", cadence: "Opportunistic", count: 0 },
  { name: "PIN paying members", cadence: "Goal: 13 to break even", count: 0 },
];

export default function LifeDashboard() {
  const [tab, setTab] = useState("schedule");
  const [budget, setBudget] = useState(DEFAULT_BUDGET);
  const [goals, setGoals] = useState(DEFAULT_GOALS);
  const [journal, setJournal] = useState([]);
  const [journalDraft, setJournalDraft] = useState("");
  const [status, setStatus] = useState("");
  const [loaded, setLoaded] = useState(false);

  // Load persisted state
  useEffect(() => {
    (async () => {
      try {
        const b = await window.storage.get("budget");
        if (b) setBudget(JSON.parse(b.value));
      } catch (e) {}
      try {
        const g = await window.storage.get("goals");
        if (g) setGoals(JSON.parse(g.value));
      } catch (e) {}
      try {
        const j = await window.storage.get("journal");
        if (j) setJournal(JSON.parse(j.value));
      } catch (e) {}
      setLoaded(true);
    })();
  }, []);

  const flash = (msg) => {
    setStatus(msg);
    setTimeout(() => setStatus(""), 1500);
  };

  const saveBudget = useCallback(
    async (next) => {
      setBudget(next);
      try {
        await window.storage.set("budget", JSON.stringify(next));
        flash("Saved");
      } catch (e) {
        flash("Save failed");
      }
    },
    []
  );

  const saveGoals = useCallback(async (next) => {
    setGoals(next);
    try {
      await window.storage.set("goals", JSON.stringify(next));
      flash("Saved");
    } catch (e) {
      flash("Save failed");
    }
  }, []);

  const saveJournal = useCallback(async (next) => {
    setJournal(next);
    try {
      await window.storage.set("journal", JSON.stringify(next));
      flash("Saved");
    } catch (e) {
      flash("Save failed");
    }
  }, []);

  const updateGoalCount = (idx, delta) => {
    const next = goals.map((g, i) =>
      i === idx ? { ...g, count: Math.max(0, g.count + delta) } : g
    );
    saveGoals(next);
  };

  const addJournalEntry = () => {
    if (!journalDraft.trim()) return;
    const entry = {
      text: journalDraft.trim(),
      date: new Date().toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    };
    saveJournal([entry, ...journal]);
    setJournalDraft("");
  };

  const gap = budget.comfy - budget.income;
  const cushion = budget.income - (budget.necessities + budget.business);
  const pinProgress = goals.find((g) => g.name.includes("PIN"));
  const pinPct = pinProgress ? Math.min(100, (pinProgress.count / 13) * 100) : 0;

  if (!loaded) {
    return (
      <div className="ldb-root">
        <style>{STYLE}</style>
        <div className="ldb-body">Loading…</div>
      </div>
    );
  }

  return (
    <div className="ldb-root">
      <style>{STYLE}</style>
      <div className="ldb-header">
        <h1 className="ldb-title">The Build</h1>
        <p className="ldb-sub">
          Schedule, money, and the life you're pointing toward — in one place.
        </p>
      </div>
      <div className="ldb-tabs">
        {[
          ["schedule", "Schedule"],
          ["budget", "Budget"],
          ["goals", "Goals"],
          ["journal", "Journal"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={`ldb-tab ${tab === key ? "active" : ""}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="ldb-body">
        {tab === "schedule" && (
          <>
            <h2 className="ldb-section-title">Weekly rhythm</h2>
            <p className="ldb-section-note">
              Built around your real Bruges shifts, not the ideal week. Every
              day has a floor even if nothing else happens.
            </p>
            <div className="ldb-card">
              {SCHEDULE.map((d) => (
                <div className="ldb-day-row" key={d.day}>
                  <div className="ldb-day-name">{d.day}</div>
                  <div className="ldb-day-blocks">
                    {d.blocks.map((b, i) => (
                      <div key={i}>{b}</div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === "budget" && (
          <>
            <h2 className="ldb-section-title">Where the money stands</h2>
            <p className="ldb-section-note">
              Edit any number as your real income or costs change — it saves
              automatically.
            </p>

            <div className="ldb-card">
              <div className="ldb-row">
                <span className="ldb-row-label">Bruges income (monthly)</span>
                <input
                  className="ldb-input"
                  type="number"
                  value={budget.income}
                  onChange={(e) =>
                    saveBudget({ ...budget, income: +e.target.value })
                  }
                />
              </div>
              <div className="ldb-row">
                <span className="ldb-row-label">Necessities</span>
                <input
                  className="ldb-input"
                  type="number"
                  value={budget.necessities}
                  onChange={(e) =>
                    saveBudget({ ...budget, necessities: +e.target.value })
                  }
                />
              </div>
              <div className="ldb-row">
                <span className="ldb-row-label">Business costs (tools + help)</span>
                <input
                  className="ldb-input"
                  type="number"
                  value={budget.business}
                  onChange={(e) =>
                    saveBudget({ ...budget, business: +e.target.value })
                  }
                />
              </div>
              <div className="ldb-row">
                <span className="ldb-row-label">"Comfy" target (car, insurance, fun, savings)</span>
                <input
                  className="ldb-input"
                  type="number"
                  value={budget.comfy}
                  onChange={(e) =>
                    saveBudget({ ...budget, comfy: +e.target.value })
                  }
                />
              </div>
            </div>

            <div className="ldb-card">
              <div className="ldb-row-sub">Cushion after necessities + business</div>
              <div
                className="ldb-bignum"
                style={{ color: cushion >= 0 ? "var(--pine)" : "var(--rust)" }}
              >
                ${cushion.toFixed(0)}
              </div>
              <div className="ldb-row-sub" style={{ marginTop: 10 }}>
                Gap to "comfy"
              </div>
              <div className="ldb-bignum" style={{ color: "var(--ochre)" }}>
                ${gap.toFixed(0)}
              </div>
              <div className="ldb-tier-bar">
                <div
                  className="ldb-tier-fill"
                  style={{
                    width: `${Math.min(100, (budget.income / budget.comfy) * 100)}%`,
                  }}
                />
              </div>
              <div className="ldb-row-sub" style={{ marginTop: 4 }}>
                {Math.round((budget.income / budget.comfy) * 100)}% of the way
                to comfy
              </div>
            </div>
          </>
        )}

        {tab === "goals" && (
          <>
            <h2 className="ldb-section-title">The life you're building</h2>
            <p className="ldb-section-note">
              Tap + each time it happens. This isn't a to-do list — it's proof
              it's real.
            </p>
            <div className="ldb-card">
              {pinProgress && (
                <div style={{ marginBottom: 16 }}>
                  <div className="ldb-row-sub">
                    PIN members toward break-even (13)
                  </div>
                  <div className="ldb-tier-bar">
                    <div
                      className="ldb-tier-fill"
                      style={{ width: `${pinPct}%`, background: "var(--ochre)" }}
                    />
                  </div>
                </div>
              )}
              {goals.map((g, i) => (
                <div className="ldb-goal-row" key={g.name}>
                  <div>
                    <div className="ldb-goal-name">{g.name}</div>
                    <div className="ldb-goal-cadence">{g.cadence}</div>
                  </div>
                  <button
                    className="ldb-counter-btn"
                    onClick={() => updateGoalCount(i, -1)}
                  >
                    −
                  </button>
                  <span className="ldb-counter-val">{g.count}</span>
                  <button
                    className="ldb-counter-btn"
                    onClick={() => updateGoalCount(i, 1)}
                  >
                    +
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === "journal" && (
          <>
            <h2 className="ldb-section-title">Notes to future you</h2>
            <p className="ldb-section-note">
              Quick reflections — what worked, what didn't, what changed.
              Bring these into the next planning conversation.
            </p>
            <div className="ldb-card">
              <textarea
                className="ldb-journal-input"
                placeholder="How's the week actually going..."
                value={journalDraft}
                onChange={(e) => setJournalDraft(e.target.value)}
              />
              <button className="ldb-save-btn" onClick={addJournalEntry}>
                Add entry
              </button>
              <span className="ldb-status">{status}</span>
            </div>
            <div className="ldb-card">
              {journal.length === 0 && (
                <div className="ldb-row-sub">No entries yet.</div>
              )}
              {journal.map((entry, i) => (
                <div className="ldb-journal-entry" key={i}>
                  <div className="ldb-journal-date">{entry.date}</div>
                  <div>{entry.text}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {status && tab !== "journal" && (
          <div className="ldb-status">{status}</div>
        )}
      </div>
    </div>
  );
}
