import { useState } from "react";
import type { Settings } from "@shared/types";
import {
  clampMinutes,
  DEFAULT_IGNORE_GLOBS,
  normalizeReviewSettings,
  parseGlobs,
  type ReviewSettings,
} from "@shared/reviewUpdates";

const PRESETS = [1, 2, 5];

function CheckRow({
  k,
  label,
  hint,
  disabled,
  r,
  set,
}: {
  k: keyof ReviewSettings;
  label: string;
  hint?: string;
  disabled?: boolean;
  r: ReviewSettings;
  set: (p: Partial<ReviewSettings>) => void;
}) {
  return (
    <label
      className={`flex items-start gap-2.5 py-1.5 ${disabled ? "opacity-50" : ""}`}
    >
      <input
        type="checkbox"
        className="mt-[3px]"
        disabled={disabled}
        checked={!!r[k]}
        onChange={(e) =>
          set({ [k]: e.target.checked } as Partial<ReviewSettings>)
        }
      />
      <span>
        {label}
        {hint && <span className="block text-[12px] text-faint">{hint}</span>}
      </span>
    </label>
  );
}

function Group({
  title,
  children,
  toggle,
}: {
  title: string;
  children: React.ReactNode;
  toggle?: React.ReactNode;
}) {
  return (
    <div className="border-b border-line px-5 py-3.5">
      <div className="mb-1 flex items-center gap-3 font-medium">
        <span className="flex-1">{title}</span>
        {toggle}
      </div>
      {children}
    </div>
  );
}

/**
 * Settings › Reviews: when a PR you review changed for you, how you hear about it, and whether
 * coming back to it opens on Since your review. See docs/prd/review-updates.md.
 */
export function ReviewSettingsSection({
  settings,
  save,
}: {
  settings: Settings;
  save: (patch: Partial<Settings>) => void;
}) {
  const r = normalizeReviewSettings(settings.reviews);
  const set = (patch: Partial<ReviewSettings>) =>
    save({ reviews: { ...r, ...patch } });
  const [globs, setGlobs] = useState(r.ignoreGlobs.join(", "));
  const custom = !PRESETS.includes(r.pollMinutes);
  const [minutes, setMinutes] = useState(custom ? String(r.pollMinutes) : "");
  const input =
    "rounded-md border border-line bg-bg px-2 py-1 outline-none focus:border-faint";
  const off = !r.notify;

  const Check = (p: {
    k: keyof ReviewSettings;
    label: string;
    hint?: string;
    disabled?: boolean;
  }) => <CheckRow {...p} r={r} set={set} />;

  return (
    <div>
      <Group
        title="Tell me when a PR I'm reviewing changes for me"
        toggle={
          <input
            type="checkbox"
            aria-label="Review updates"
            checked={r.notify}
            onChange={(e) => set({ notify: e.target.checked })}
          />
        }
      >
        <div className="text-[12px] text-faint">
          PRs you've reviewed. Merges from the base branch and rebases that keep
          the same changes don't count.
        </div>
        {Check({
          k: "onCode",
          label: "The PR's own changes moved",
          hint: "New or edited code in the PR, not counting the base branch",
          disabled: off,
        })}
        {Check({
          k: "onReply",
          label: "Someone answers my comment",
          disabled: off,
        })}
        {Check({
          k: "onRerequest",
          label: "I'm asked to review again",
          disabled: off,
        })}
        {Check({
          k: "onReady",
          label: "A draft is marked ready for review",
          disabled: off,
        })}
        {Check({
          k: "onChecksFailed",
          label: "Checks start failing",
          disabled: off,
        })}
        {Check({
          k: "onAnyPush",
          label: "Any push at all",
          hint: "Even ones that change nothing in the PR",
          disabled: off,
        })}
      </Group>

      <Group title="Keep quiet about">
        {Check({
          k: "quietBaseMerges",
          label: "Merges from the base branch",
          disabled: off,
        })}
        {Check({
          k: "quietSameRebase",
          label: "Rebases that leave the changes the same",
          disabled: off,
        })}
        {Check({
          k: "ignoreOn",
          label: "Files matching these patterns",
          hint: "Also left out of Since your review. Commas or new lines between patterns; * stays in a folder, ** crosses folders, a pattern without / matches the file name anywhere.",
          disabled: off,
        })}
        <div className="ml-6 flex items-start gap-2 pb-1.5">
          <textarea
            aria-label="Ignored files"
            rows={2}
            className={`${input} min-w-0 flex-1 resize-y font-mono text-[12px]`}
            value={globs}
            disabled={off || !r.ignoreOn}
            onChange={(e) => setGlobs(e.target.value)}
            onBlur={() => set({ ignoreGlobs: parseGlobs(globs) })}
          />
          <button
            className="rounded-md border border-line px-2 py-1 text-[12px] text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
            disabled={off || !r.ignoreOn}
            title={DEFAULT_IGNORE_GLOBS.join(", ")}
            onClick={() => {
              setGlobs(DEFAULT_IGNORE_GLOBS.join(", "));
              set({ ignoreGlobs: DEFAULT_IGNORE_GLOBS });
            }}
          >
            Reset
          </button>
        </div>
        <label
          className={`flex items-center gap-2.5 py-1.5 ${off ? "opacity-50" : ""}`}
        >
          <input
            type="checkbox"
            disabled={off}
            checked={r.minLinesOn}
            onChange={(e) => set({ minLinesOn: e.target.checked })}
          />
          <span>Changes under</span>
          <input
            type="number"
            min={1}
            aria-label="Smallest change in lines"
            className={`${input} w-16`}
            disabled={off || !r.minLinesOn}
            defaultValue={r.minLines}
            onBlur={(e) => set({ minLines: Number(e.target.value) })}
          />
          <span>lines</span>
        </label>
      </Group>

      <Group title="Show it">
        {Check({
          k: "showInList",
          label: 'Bold with a dot on the PRs page, and "new" on the sidebar',
          disabled: off,
        })}
        {Check({
          k: "osNotify",
          label: "macOS notification",
          hint: "Clicking it opens the PR on Since your review.",
          disabled: off,
        })}
        <label
          className={`flex items-center gap-2.5 py-1.5 ${off || !r.osNotify ? "opacity-50" : ""}`}
        >
          <input
            type="checkbox"
            disabled={off || !r.osNotify}
            checked={r.quietHoursOn}
            onChange={(e) => set({ quietHoursOn: e.target.checked })}
          />
          <span>Only between</span>
          <input
            type="time"
            aria-label="From"
            className={input}
            disabled={off || !r.osNotify || !r.quietHoursOn}
            value={r.from}
            onChange={(e) => set({ from: e.target.value })}
          />
          <span>and</span>
          <input
            type="time"
            aria-label="To"
            className={input}
            disabled={off || !r.osNotify || !r.quietHoursOn}
            value={r.to}
            onChange={(e) => set({ to: e.target.value })}
          />
        </label>
      </Group>

      <Group
        title='Open reviewed PRs on "Since your review"'
        toggle={
          <input
            type="checkbox"
            aria-label="Open on Since your review"
            checked={r.openSinceReview}
            onChange={(e) => set({ openSinceReview: e.target.checked })}
          />
        }
      >
        <div className="text-[12px] text-faint">
          Coming back to a PR you reviewed, the Files list and diff start on
          what the author changed since then. All changes is one click away, and
          your pick is kept per workspace.
        </div>
        {Check({
          k: "syncViewed",
          label: 'Sync "Viewed" ticks with GitHub',
          hint: "Each file in the diff gets GitHub's own Viewed tick. GitHub clears it when the file changes.",
        })}
      </Group>

      <Group title="Check GitHub every">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-line text-[12px]">
            {PRESETS.map((m) => (
              <button
                key={m}
                className={`px-2.5 py-1 first:rounded-l-md ${r.pollMinutes === m ? "bg-raised text-fg" : "text-muted hover:bg-hover hover:text-fg"}`}
                onClick={() => {
                  setMinutes("");
                  set({ pollMinutes: m });
                }}
              >
                {m} min
              </button>
            ))}
            <span
              className={`flex items-center gap-1 rounded-r-md border-l border-line px-2 ${custom ? "bg-raised text-fg" : "text-muted"}`}
            >
              <input
                type="number"
                min={1}
                max={120}
                aria-label="Custom minutes"
                placeholder="Custom"
                className="w-14 bg-transparent py-1 outline-none placeholder:text-faint"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                onBlur={() =>
                  minutes.trim() && set({ pollMinutes: clampMinutes(minutes) })
                }
                onKeyDown={(e) =>
                  e.key === "Enter" && (e.target as HTMLInputElement).blur()
                }
              />
              min
            </span>
          </div>
          <span className="text-[12px] text-faint">
            Also when you open the PRs page or a PR you review, and when the
            window comes to the front. Uses your gh sign-in.
          </span>
        </div>
      </Group>
    </div>
  );
}
