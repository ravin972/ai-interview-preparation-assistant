'use client';

import React, { useState, useMemo } from 'react';
import type { Schedule, Question } from '../../types/kit.js';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card.js';
import { Badge } from '../ui/badge.js';
import { Clock, Calendar, ChevronRight, CheckCircle2 } from 'lucide-react';

export interface ScheduleViewProps {
  schedule: Schedule;
  questions: Question[];
}

export function ScheduleView({ schedule, questions }: ScheduleViewProps) {
  const [activeWeek, setActiveWeek] = useState<number>(1);
  const [selectedDayNum, setSelectedDayNum] = useState<number>(1);

  // Map question by id for fast resolution
  const questionMap = useMemo(() => {
    const map = new Map<string, Question>();
    for (const q of questions) {
      map.set(q.id, q);
    }
    return map;
  }, [questions]);

  // Group days into weeks of 7 days
  const weeks = useMemo(() => {
    const groups: Array<{ weekNum: number; days: typeof schedule.days }> = [];
    const daysPerWeek = 7;
    for (let i = 0; i < schedule.days.length; i += daysPerWeek) {
      groups.push({
        weekNum: Math.floor(i / daysPerWeek) + 1,
        days: schedule.days.slice(i, i + daysPerWeek),
      });
    }
    return groups;
  }, [schedule.days]);

  const currentWeekDays =
    weeks.find((w) => w.weekNum === activeWeek)?.days ?? schedule.days;
  const activeDay =
    schedule.days.find((d) => d.day === selectedDayNum) ?? schedule.days[0];

  const totalMinutes = useMemo(() => {
    return schedule.days.reduce((sum, d) => sum + d.minutes, 0);
  }, [schedule.days]);

  return (
    <div className="space-y-6">
      {/* Top Schedule Overview */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-lg border border-zinc-800 bg-[#121215]">
        <div className="space-y-1 font-mono text-xs">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-amber-400" />
            <h3 className="font-semibold text-zinc-100">
              {schedule.days_available}-Day Deterministic Study Plan
            </h3>
          </div>
          <p className="text-zinc-400">
            Clamped to 30–180 min per day. Must-have requirements prioritized.
          </p>
        </div>

        <div className="flex items-center gap-4 text-xs font-mono shrink-0">
          <div className="text-right">
            <span className="text-zinc-500 block text-[10px] uppercase">
              Total Duration
            </span>
            <span className="font-bold text-zinc-200">
              {Math.round(totalMinutes / 60)} hrs ({totalMinutes}m)
            </span>
          </div>
          <div className="text-right border-l border-zinc-800 pl-4">
            <span className="text-zinc-500 block text-[10px] uppercase">
              Schedule Invariant
            </span>
            <span className="text-emerald-400 font-semibold flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Exact Day Count</span>
            </span>
          </div>
        </div>
      </div>

      {/* Week Selector (if multi-week schedule) */}
      {weeks.length > 1 && (
        <div className="flex items-center gap-1 overflow-x-auto pb-1 border-b border-zinc-800">
          {weeks.map((w) => (
            <button
              key={w.weekNum}
              onClick={() => {
                setActiveWeek(w.weekNum);
                if (w.days[0]) setSelectedDayNum(w.days[0].day);
              }}
              className={`px-3.5 py-1.5 rounded text-xs font-mono transition-colors whitespace-nowrap ${
                activeWeek === w.weekNum
                  ? 'bg-zinc-100 text-zinc-950 font-bold'
                  : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
              }`}
            >
              Week {w.weekNum} (Days {w.days[0]?.day}–{w.days[w.days.length - 1]?.day})
            </button>
          ))}
        </div>
      )}

      {/* Days Grid & Day Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Days List */}
        <div className="lg:col-span-1 space-y-2">
          <span className="text-xs font-semibold text-zinc-400 font-mono uppercase tracking-wider block mb-1">
            Select Day
          </span>
          <div className="space-y-1.5 max-h-[520px] overflow-y-auto pr-1">
            {currentWeekDays.map((d) => {
              const isSelected = d.day === selectedDayNum;
              return (
                <button
                  key={d.day}
                  onClick={() => setSelectedDayNum(d.day)}
                  className={`w-full flex items-center justify-between p-3 rounded-md border text-left text-xs font-mono transition-all ${
                    isSelected
                      ? 'border-zinc-400 bg-zinc-800 text-zinc-100 font-semibold'
                      : 'border-zinc-800/80 bg-[#121215] text-zinc-400 hover:border-zinc-700 hover:bg-[#18181b]'
                  }`}
                >
                  <div className="space-y-0.5 truncate">
                    <div className="font-bold text-zinc-200">Day {d.day}</div>
                    <div className="text-[11px] text-zinc-500 truncate max-w-[180px]">
                      {d.focus}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
                      {d.minutes}m
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 text-zinc-600" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected Day Detail */}
        <div className="lg:col-span-2">
          {activeDay ? (
            <Card className="h-full">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-wider">
                      Day {activeDay.day} of {schedule.days_available}
                    </span>
                    <CardTitle className="text-base mt-1">
                      Focus: {activeDay.focus}
                    </CardTitle>
                  </div>

                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-300 shrink-0">
                    <Clock className="h-3.5 w-3.5 text-zinc-400" />
                    <span>{activeDay.minutes} minutes</span>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider font-mono">
                    Assigned Questions ({activeDay.question_ids.length})
                  </h4>

                  {activeDay.question_ids.length === 0 ? (
                    <p className="text-xs text-zinc-500 italic">
                      Review & consolidation session.
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      {activeDay.question_ids.map((qid) => {
                        const q = questionMap.get(qid);
                        if (!q) {
                          return (
                            <div
                              key={qid}
                              className="p-3 rounded bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-500"
                            >
                              Question {qid}
                            </div>
                          );
                        }

                        return (
                          <div
                            key={qid}
                            className="p-3.5 rounded-lg border border-zinc-800 bg-zinc-900/60 space-y-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-xs font-bold text-zinc-300 bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded">
                                  {q.id}
                                </span>
                                <Badge category={q.category} />
                                <Badge difficulty={q.difficulty} />
                              </div>
                            </div>

                            <p className="text-xs sm:text-sm font-medium text-zinc-200">
                              {q.prompt}
                            </p>

                            {q.requirement_ids.length > 0 && (
                              <div className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-500 pt-1">
                                <span>Mapped:</span>
                                {q.requirement_ids.map((rid) => (
                                  <span
                                    key={rid}
                                    className="px-1 py-0.2 rounded bg-zinc-900 border border-zinc-800 text-zinc-400"
                                  >
                                    {rid}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="p-8 text-center text-xs text-zinc-500 font-mono">
              Select a day to view details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
