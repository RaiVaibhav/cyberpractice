import React from "react";
import { Dices, RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";

const DIFF_CLASS = {
  Starter: "border-emerald-500/40 text-emerald-400",
  Core: "border-sky-500/40 text-sky-400",
  Advanced: "border-amber-500/40 text-amber-400",
  Expert: "border-rose-500/40 text-rose-400",
};

export default function Header({ data, scenarios, currentId, onSelect, onReset }) {
  const diffClass = DIFF_CLASS[data.difficulty] || "border-sky-500/40 text-sky-400";

  function random() {
    const others = scenarios.filter((s) => s.id !== currentId);
    const pool = others.length ? others : scenarios;
    if (pool.length) onSelect(pool[Math.floor(Math.random() * pool.length)].id);
  }

  const groups = {};
  for (const s of scenarios) (groups[s.category] ||= []).push(s);

  return (
    <header className="flex flex-wrap items-center gap-3 border-b bg-card/40 px-4 py-2.5">
      <div className="flex items-center gap-2 font-semibold">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <span>cyberpractice</span>
        <span className="text-xs font-normal text-muted-foreground">· attack lab</span>
      </div>

      <div className="flex items-center gap-2">
        <Select value={currentId || ""} onValueChange={onSelect}>
          <SelectTrigger className="w-[300px]">
            <SelectValue placeholder="Choose a scenario" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(groups).map(([category, items]) => (
              <SelectGroup key={category}>
                <SelectLabel>{category}</SelectLabel>
                {items.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.subtype} — {s.difficulty}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={random} title="Random scenario">
          <Dices className="h-4 w-4" />
          Random
        </Button>
      </div>

      <div className="hidden items-center gap-2 lg:flex">
        <Badge variant="outline" className="text-muted-foreground">{data.subtype}</Badge>
        <Badge variant="outline" className={diffClass}>{data.difficulty}</Badge>
        <Badge variant="outline" className="border-primary/40 text-primary">{data.provider.label}</Badge>
      </div>

      <div className="flex-1" />
      <Button variant="ghost" size="sm" onClick={onReset}>
        <RotateCcw className="h-4 w-4" />
        Reset
      </Button>
    </header>
  );
}
