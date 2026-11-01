# Primitives (v2, "calm but alive")

Import from `./ui` (it re-exports this folder) or `./primitives`. Tokens live in `../styles.css`; the source is `docs/design-source/project/ds/aftercall/tokens.json` and the V2 boards next to it.

## Tokens

| Kind | Use |
|---|---|
| Text | `text-ink` titles, notes, names, amounts · `text-ink-2` text you still read · `text-muted` metadata only (times, counts, eyebrow) · `faint` never text |
| Surfaces | `bg-ground` window and sidebar · `bg-raised` every main page · `bg-elevated` things that float or that you operate · `bg-well` fields |
| Status | `verdigris` (accent, Verified, Paid, you) · `record` (recording, Failed) · `caution` (a person must decide). Each has `-tint`. Always with a word. |
| People | `--p1`..`--p6` grounds, `--p1i`..`--p6i` initials (`bg-p2 text-p2i`). Use `Avatar`, which picks the slot with `personHue()` from `@aftercall/core`. |
| Shadow | `shadow-1` cards at rest · `shadow-2` under the pointer, menus, tooltips · `shadow-pill` live pill, toasts · `shadow-float` sheets |
| Radius | `rounded-sm` 8 controls · `rounded-md` 14 cards · `rounded-lg` 20 sheets · `rounded-full` pills, avatars |
| Motion | `--dur-1` 120 ms, `--dur-2` 200, `--dur-3` 320, `--ease` (`ease-calm`). Keyframes `ac-in`, `ac-pop`, `ac-draw`, `ac-fill`, `ac-strike`, `ac-roll`, `ac-rise`, `ac-bar`, `ac-breathe`, `ac-countdown`, `ac-spin`. |
| Classes | `.press` dips to 0.97 when pressed · `.lift` lifts to shadow-2 on hover |

Type: `t-display` 36/42 serif (one per view) · `t-heading` 22/28 serif (greeting, sheet titles) · `t-reading` 18/29 serif · `t-quote` · `t-title` 16/22 · `t-section` 15/20 (section titles, sentence case) · body 14/21 · `t-eyebrow` 12/16 (the line above a title, with `text-muted`) · `t-label` uppercase, **pills only** · `t-mono` 13/18 · `t-figure` 28 · `t-figure-xl` 48 (one hero number).

Reduced motion: nothing moves, things fade. The `ac-*` keyframes that move become fades; spinners, meters and countdowns keep going; CSS transitions land at once. Motion's `MotionConfig reducedMotion="user"` drops transforms and keeps opacity.

## Motion

- Use `m.*` from `motion/react-m`, never `motion.*`: the app's `LazyMotion` is `strict` and throws on `motion.*`.
- `import { springs, enter, exit, dur, ease, view } from "./ui"`. Springs: `snappy` 500/35 (toggles, tabs, menus), `gentle` 260/30 (sheets, rows changing height), `bouncy` 400/18 (the tick, Paid only). `enter` 240 ms, `exit` 160 ms.
- `layout` and `layoutId` need `<LayoutMotion>` around them (loads `domMax` on demand). Tabs and the Toaster already do this.
- Exit animations need `<AnimatePresence>` around the conditional, with a `key`.

## Components

```tsx
<Button variant="primary|secondary|ghost|quiet|danger|record" size="sm|md|lg" loading icon={<Check size={14} />} onClick>Approve payment</Button>
<IconButton aria-label="New project" shortcut="⌘N" tooltipSide="bottom" size="sm|md" variant="ghost|quiet|secondary|primary"><Plus size={14} /></IconButton>
<Tooltip content="Verified" shortcut="⌘K" side="top|bottom">{trigger}</Tooltip>   // 400 ms hover, instant on keyboard focus; supplementary only

<Field label="NEAR account" hint="As in “pay the designer”." error={err}>
  <Input mono value onChange />          // also <TextArea>, <Select>; ids, aria-describedby, aria-invalid wired by Field
</Field>

<Card interactive tone="default|caution|record" pad="none|sm|md|lg" as="button" onClick>…</Card>   // radius 14, shadow-1, lifts when interactive
<Toggle checked onChange={setOn} label="Connected agents" description="On. Agents can read meetings." />   // or aria-label without label
<Tick checked={done} onChange={setDone} aria-labelledby={textId} working={claimedByAgent} />  <Strike on={done}>Send Ada the recap</Strike>   // working: an arc turns round the empty circle
<Pill tone="verdigris|caution|record|muted" icon={<Check size={12} />} live>Paid 14:06</Pill>
<SectionTitle count={3}>Follow-ups</SectionTitle>

<Menu label="Project options" align="end" trigger={(p) => <IconButton {...p} aria-label="Options"><MoreHorizontal size={14} /></IconButton>}
  items={[{ label: "Rename", onSelect }, null, { label: "Delete project", tone: "danger", onSelect }]} />   // null = divider

<Tabs id="meeting" label="Meeting views" items={[{ id: "notes", label: "Notes" }, { id: "transcript", label: "Transcript", count: 12 }]} value={tab} onChange={setTab} />
<TabPanel tabsId="meeting" value={tab}>…</TabPanel>

<Avatar name="Ines Rocha" size={28} ring="raised" decorative />   // 20–64; "You" on verdigris-tint
<AvatarStack people={["You", "Ada", "Theo Moss", "Sam Obi"]} max={3} size={28} ring="raised" />   // "+1", one accessible name
<MeProvider me={[account, "Victor"]}>…</MeProvider>   // which names are "you" (also matches "You", "Me")

<RollingNumber value={balance} format={(n) => formatUsdc(n)} />   // inside t-figure-xl; no roll on mount
<Meter level={rmsToLevel(rms)} tone="verdigris|ink|record" label="Your mic" />   // or levelRef={ref} for rAF updates
<StageList stages={[{ id: "gateway", label: "Gateway", state: "done|active|todo", detail: "…" }]} />
<Spinner size={14} tone="verdigris|current" label="Loading" />
```

### Dialogs

```tsx
<AnimatePresence>
  {open && <Dialog key="add-payee" title="Add a payee" intro="One line." onClose={close} placement="center|anchored|full" anchor={el} width={560} dismissible>…</Dialog>}
</AnimatePresence>
```

- Or keep it mounted and pass `open`. Portal, focus trap, focus goes back on close, Escape closes only the topmost overlay (dialogs and menus share one stack, `overlay.ts`). `initialFocus={ref}` picks the first focus; otherwise an `autoFocus` element, then the first control.
- `placement="anchored"` sits under `anchor` (or the window's top right) without dimming; `"full"` covers the window (onboarding).
- `Sheet` (`../Sheet.tsx`) is a thin wrapper kept for old call sites.

```tsx
const confirm = useConfirm();
if (!(await confirm({ title: "Delete “Fundraise”?", body: "Its 3 meetings move to “General”.", confirmLabel: "Delete project", tone: "danger" }))) return;
```

`tone: "danger"` focuses Cancel first. Labels are verbs naming the result, never OK. Needs `<DialogHost />` mounted (App does).

### Toasts

```tsx
toast({ text: "Recap to Ada dismissed", undo: () => restore(), tone: "neutral|verdigris|caution|record", action: { label: "Open", onClick }, duration: 6000, id });
deferred({ id: `pay:${fu.id}`, text: (s) => `Paying in ${s}…`, ms: 5000, run: () => pay(), undo: () => setRow(back) });
deferred({ id, quiet: true, … });  const p = useDeferred(id);   // quiet: no toast, the row draws the countdown from p.startedAt/p.endsAt and Undo calls p.cancel; ⌘Z and the announcement still work
```

- `toast` shows a pill at the bottom centre; it holds while hovered or focused. `record` tone is read out at once; others politely. ⌘Z takes back the newest undoable toast (not while typing).
- `deferred` runs `run` once after `ms` unless Undo or ⌘Z comes first. It is a module queue keyed by `id`: a second call with the same id (StrictMode, double click) joins the first. Nothing runs if the app quits first. A thrown `run` shows an error toast. Returns `{ cancel, flush }`.
- When to use which: an action that can still be taken back → `deferred` (soft delete, pay, send). A destructive action that can't → `useConfirm` with `tone: "danger"`. An error or a result → `toast`.

## Screenshots

`node scripts/screens.mjs` (from the repo root) starts the dev UI on a free port and saves every main view, light and dark, at 1280×820 with reduced motion, to `artifacts/screens/{theme}/`. `--url`, `--only home,wallet`, `--themes dark`, `--out` are optional. Baselines from before v2 are in `artifacts/screens/baseline/`. Add a view by adding an entry to `SHOTS`.
