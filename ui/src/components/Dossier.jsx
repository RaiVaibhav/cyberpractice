import React, { useState } from "react";
import { Lightbulb, Play, Lock, AlertTriangle } from "lucide-react";
import { api } from "../api.js";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const SectionTitle = ({ children }) => (
  <div className="mb-2 mt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{children}</div>
);

export default function Dossier({ data, activeTab, setActiveTab, pushMessage, mergeState }) {
  const hasActions = data.actions.length > 0;

  return (
    <div className="min-h-0 overflow-y-auto bg-card/20">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="p-3">
        <TabsList className="sticky top-0 z-10">
          <TabsTrigger value="brief">Brief</TabsTrigger>
          <TabsTrigger value="state">State</TabsTrigger>
          {hasActions && <TabsTrigger value="attack">Attack</TabsTrigger>}
          <TabsTrigger value="trace">Trace</TabsTrigger>
          <TabsTrigger value="help">Hints</TabsTrigger>
        </TabsList>

        <TabsContent value="brief">
          <BriefPane data={data} />
        </TabsContent>
        <TabsContent value="state">
          <StatePane data={data} />
        </TabsContent>
        {hasActions && (
          <TabsContent value="attack">
            <AttackPane data={data} pushMessage={pushMessage} mergeState={mergeState} onDone={() => setActiveTab("trace")} />
          </TabsContent>
        )}
        <TabsContent value="trace">
          <TracePane trace={data.trace} />
        </TabsContent>
        <TabsContent value="help">
          <HelpPane data={data} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BriefPane({ data }) {
  return (
    <div className="space-y-3 pt-1">
      <SectionTitle>Your mission</SectionTitle>
      <Card>
        <CardContent className="p-4 text-sm">
          <span className="font-semibold text-primary">Objective:</span> {data.objective}
        </CardContent>
      </Card>

      {data.background && (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">{data.background}</CardContent>
        </Card>
      )}

      {data.brief && (
        <>
          <SectionTitle>Scenario brief</SectionTitle>
          <Card>
            <CardContent className="p-3">
              <pre className="whitespace-pre-wrap font-mono text-xs text-muted-foreground">{data.brief.trim()}</pre>
            </CardContent>
          </Card>
        </>
      )}

      <SectionTitle>Target's system prompt</SectionTitle>
      <Card>
        <CardContent className="p-3">
          <pre className="whitespace-pre-wrap font-mono text-xs text-muted-foreground">{data.systemPrompt}</pre>
        </CardContent>
      </Card>

      <SectionTitle>Tools the model can call</SectionTitle>
      <div className="space-y-2">
        {data.tools.map((t) => (
          <Card key={t.name}>
            <CardContent className="p-3">
              <div className="flex items-center gap-2 font-mono text-sm text-primary">
                {t.name}
                {t.privileged && (
                  <span className="inline-flex items-center gap-1 text-xs text-amber-400">
                    <Lock className="h-3 w-3" /> privileged
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{t.description}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function StatePane({ data }) {
  const panels = data.panels || [];
  return (
    <div className="space-y-3 pt-1">
      {panels.length === 0 && <p className="text-sm italic text-muted-foreground">This scenario exposes no live state.</p>}
      {panels.map((panel) => (
        <div key={panel.id}>
          <SectionTitle>{panel.title}</SectionTitle>
          {panel.hint && <div className="mb-2 text-xs text-muted-foreground">{panel.hint}</div>}
          <Card>
            <CardContent className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 p-3 text-sm">
              {panel.rows.map((row, i) => (
                <React.Fragment key={i}>
                  <div className="text-muted-foreground">{row.label}</div>
                  <div className={cn("text-right font-mono text-xs", row.flag && "font-semibold text-rose-400")}>{row.value}</div>
                </React.Fragment>
              ))}
            </CardContent>
          </Card>
        </div>
      ))}
    </div>
  );
}

function AttackPane({ data, pushMessage, mergeState, onDone }) {
  return (
    <div className="space-y-3 pt-1">
      <SectionTitle>Out-of-band actions</SectionTitle>
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          These happen outside your chat — planting data or simulating another user. This is how you stage an indirect attack.
        </CardContent>
      </Card>
      {data.actions.map((action) => (
        <ActionForm key={action.id} action={action} appName={data.app.name} pushMessage={pushMessage} mergeState={mergeState} onDone={onDone} />
      ))}
    </div>
  );
}

function ActionForm({ action, appName, pushMessage, mergeState, onDone }) {
  const [values, setValues] = useState(() => {
    const init = {};
    for (const f of action.fields || []) init[f.name] = f.default || "";
    return init;
  });
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const res = await api.post("/api/action", { action: action.id, fields: values });
      mergeState(res);
      if (res.transcript) {
        pushMessage({ role: "victim", who: values.username || "victim", text: res.transcript.user });
        pushMessage({ role: "assistant", who: appName, text: res.transcript.reply });
      }
      pushMessage({ role: "sys", text: "· " + res.note + " ·" });
      onDone();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-pink-900/40">
      <CardContent className="space-y-2 p-4">
        <div className="font-medium">{action.label}</div>
        <div className="text-xs text-muted-foreground">{action.description}</div>
        {(action.fields || []).map((f) => (
          <div key={f.name} className="space-y-1">
            <label className="text-xs text-muted-foreground">{f.label || f.name}</label>
            {f.type === "textarea" ? (
              <Textarea
                rows={f.rows || 3}
                placeholder={f.placeholder || ""}
                value={values[f.name]}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                className="font-mono text-xs"
              />
            ) : (
              <Input
                placeholder={f.placeholder || ""}
                value={values[f.name]}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                className="font-mono text-xs"
              />
            )}
          </div>
        ))}
        <Button variant="outline" className="mt-1 w-full border-pink-800/50 hover:border-pink-600" onClick={run} disabled={busy}>
          <Play className="h-4 w-4" />
          {action.label}
        </Button>
      </CardContent>
    </Card>
  );
}

const KIND_LABEL = { trust: "trust ⚠", guardrail: "guardrail", solved: "✓ solved", action: "action", reply: "reply" };

function TracePane({ trace }) {
  return (
    <div className="space-y-2 pt-1">
      <SectionTitle>Data-flow trace</SectionTitle>
      <div className="text-xs text-muted-foreground">
        Every hop between you, the model, and its tools. Pink = attacker-controlled text being read as instructions.
      </div>
      {!trace || trace.length === 0 ? (
        <div className="text-sm italic text-muted-foreground">No activity yet. Send a message.</div>
      ) : (
        <div className="font-mono text-xs">
          {trace.map((t, i) => {
            const hop = t.from && t.to ? `${t.from} → ${t.to}` : t.actor ? `[${t.actor}]` : KIND_LABEL[t.kind] || t.kind;
            const isTrust = t.kind === "trust" || t.kind === "actor";
            const isSolved = t.kind === "solved";
            return (
              <div
                key={i}
                className={cn(
                  "flex gap-2 border-b border-dashed border-border/60 py-1.5",
                  isTrust && "border-l-2 border-l-pink-500 bg-pink-950/30 pl-2",
                  isSolved && "border-l-2 border-l-emerald-500 bg-emerald-950/30 pl-2",
                  t.status === "blocked" && "bg-rose-950/20",
                )}
              >
                <div className="min-w-[92px] shrink-0 text-muted-foreground">{hop}</div>
                <div
                  className={cn(
                    "flex-1 whitespace-pre-wrap break-words",
                    t.kind === "user" && "text-sky-400",
                    t.kind === "call" && "text-emerald-400",
                    t.kind === "result" && "text-muted-foreground",
                    isTrust && "text-pink-400",
                    isSolved && "text-emerald-400",
                    t.status === "blocked" && "text-rose-400",
                    t.status === "bypassed" && "text-amber-400",
                  )}
                >
                  {t.text}
                  {t.injected && <span className="ml-1.5 rounded bg-pink-900/60 px-1 text-[10px] text-pink-300">injected</span>}
                  {t.tainted && <span className="ml-1.5 rounded bg-amber-900/50 px-1 text-[10px] text-amber-300">tainted data</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HelpPane({ data }) {
  const [hints, setHints] = useState([]);
  const [exhausted, setExhausted] = useState(false);
  const [solution, setSolution] = useState(null);
  const [showSolution, setShowSolution] = useState(false);

  async function reveal() {
    const res = await api.post("/api/hint");
    if (res.hint) setHints((h) => [...h, res.hint]);
    if (res.exhausted) setExhausted(true);
  }

  async function toggleSolution() {
    if (!showSolution && solution === null) {
      const r = await api.post("/api/solution");
      setSolution(r.solution);
    }
    setShowSolution((v) => !v);
  }

  return (
    <div className="space-y-3 pt-1">
      <SectionTitle>Hints ({data.hintCount} available)</SectionTitle>
      <Button variant="outline" size="sm" onClick={reveal} disabled={exhausted}>
        <Lightbulb className="h-4 w-4" />
        Reveal a hint
      </Button>
      <div className="space-y-2">
        {hints.map((h, i) => (
          <div key={i} className="rounded-r-md border-l-2 border-amber-500 bg-amber-950/20 px-3 py-2 text-sm">
            {h}
          </div>
        ))}
      </div>

      <SectionTitle>Walkthrough</SectionTitle>
      <Button variant="ghost" size="sm" onClick={toggleSolution} className="text-muted-foreground">
        <AlertTriangle className="h-4 w-4" />
        {showSolution ? "Hide" : "Show"} the full solution (spoiler)
      </Button>
      {showSolution && solution && (
        <Card>
          <CardContent className="p-3">
            <pre className="whitespace-pre-wrap font-mono text-xs text-muted-foreground">{solution}</pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
