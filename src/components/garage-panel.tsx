import { useEffect, useRef, useState, type RefObject } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, ChevronUp, FlipHorizontal2, Redo2, Undo2 } from "lucide-react";
import { HexColorInput, HexColorPicker } from "react-colorful";
import { Button } from "@/components/ui/button";
import { RangeRow } from "@/components/hud-controls";
import { CarTypeButtons } from "@/components/hud-sections";
import { useCoarsePointer } from "@/components/use-coarse-pointer";
import type { CrashEngine } from "@/game/engine/engine";
import { SPRAY_RADIUS } from "@/game/engine/garage";
import type { GarageHud } from "@/game/hud/hud-store";
import { CAR_PARTS, hexOf, SPRAY_PALETTE, type CarPart } from "@/game/match/look-data";
import { cn } from "@/lib/utils";

const PART_LABEL: Record<CarPart, string> = { body: "Body", doors: "Doors", hood: "Hood", trunk: "Trunk", bumpers: "Bumpers", rims: "Rims", glass: "Glass tint" };
const SEGMENT = "h-11 px-1 text-xs pointer-fine:h-8";
const ROW = "flex min-h-11 items-center justify-between gap-2 px-1 pointer-fine:min-h-0";
/** What a press on the HUD can be besides the view (a colour popover is a dialog): tapping one of these while spraying is no drag on the paint. */
const HUD_CONTROL = "button, input, label, a, [role=dialog]";

/**
 * The garage's one colour control: `label` and a swatch of `value` (sRGB) opening the picker, the can's quick colours over
 * any colour (saturation, hue and hex), live while it is dragged. An upright phone opens it above the docked panel.
 */
function ColourRow({ label, value, onColour }: { label: string; value: number; onColour: (c: number) => void }) {
  const hex = `#${hexOf(value)}`;
  const upright = useCoarsePointer() && matchMedia("(orientation: portrait)").matches;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" aria-label={`${label}: ${hex}`} className={cn(ROW, "w-full rounded hover:bg-surface-2/70")}>
          <span className="text-xs text-muted">{label}</span>
          <span className="h-11 w-12 rounded border border-border pointer-fine:h-8" style={{ background: hex }} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side={upright ? "top" : "right"}
          align={upright ? "center" : "start"}
          sideOffset={8}
          collisionPadding={8}
          aria-label={`${label} colour`}
          className="garage-picker z-50 flex w-64 flex-col gap-2 rounded-lg bg-surface p-2 text-fg shadow-[var(--shadow-border)] phone-landscape:w-auto phone-landscape:flex-row"
        >
          <div className="grid grid-cols-5 gap-1 phone-landscape:grid-cols-3" role="group" aria-label="Quick colours">
            {SPRAY_PALETTE.slice(1).map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`#${hexOf(c)}`}
                aria-pressed={c === value}
                className={cn("h-11 rounded border pointer-fine:h-8 phone-landscape:w-11", c === value ? "border-fg ring-2 ring-fg" : "border-border")}
                style={{ background: `#${hexOf(c)}` }}
                onClick={() => onColour(c)}
              />
            ))}
          </div>
          <div className="flex flex-col gap-2 phone-landscape:w-44">
            <HexColorPicker color={hex} onChange={(h) => onColour(parseInt(h.slice(1), 16))} />
            <HexColorInput
              prefixed
              color={hex}
              aria-label={`${label} hex`}
              className="h-11 w-full rounded border border-border bg-surface-2 px-2 font-mono text-sm pointer-fine:h-8"
              onChange={(h) => onColour(parseInt((h.length === 4 ? h.replace(/[0-9a-f]/gi, "$&$&") : h).slice(1), 16))}
            />
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Two or more buttons, one pressed. */
function Segments<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: readonly (readonly [T, string])[]; onPick: (v: T) => void }) {
  return (
    <div className={cn("grid gap-0.5 rounded-md bg-surface-2/70 p-0.5", options.length === 2 ? "grid-cols-2" : "grid-cols-3")} role="group" aria-label={label}>
      {options.map(([id, text]) => (
        <Button key={id} variant={value === id ? "default" : "ghost"} aria-pressed={value === id} className={SEGMENT} onClick={() => onPick(id)}>
          {text}
        </Button>
      ))}
    </div>
  );
}

/**
 * The garage's editor: the car's type and part colours or the driver's build and clothes, and the spray can (on, size,
 * colour; a press on the car or the driver sprays), every colour picked with `ColourRow`. Picks ride the page URL; the spray stays in
 * this browser and goes to the other players when they join.
 */
export function GaragePanel({ garage, playerCar, engine }: { garage: GarageHud; playerCar: string; engine: RefObject<CrashEngine | null> }) {
  const [target, setTarget] = useState<"car" | "person">("car");
  // Collapsed, the panel is one row (what to paint, look or spray, the can's size), leaving a phone's view to the paint.
  const [collapsed, setCollapsed] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const { spray } = garage;
  useFoldOnViewPress(panel, spray.on, setCollapsed);
  useUndoKeys(engine);
  const edit = (
    <Segments
      label="Edit"
      value={target}
      options={[["car", "Car"], ["person", "Driver"]]}
      onPick={(picked) => {
        setTarget(picked);
        engine.current?.frameGarage(picked);
      }}
    />
  );
  const can = <Segments label="Spray can" value={spray.on ? "on" : "off"} options={[["off", "Look"], ["on", "Spray"]]} onPick={(v) => engine.current?.setSprayTool({ on: v === "on" })} />;
  const toggle = (
    <Button variant="ghost" className={cn(SEGMENT, "pointer-coarse:w-11")} aria-expanded={!collapsed} aria-label={collapsed ? "Show the garage editor" : "Hide the garage editor"} onClick={() => setCollapsed(!collapsed)}>
      {collapsed ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
    </Button>
  );
  // Portrait phones dock the panel at the column's bottom (the car keeps the top 60 %); a phone on its side keeps it a <= 13 rem strip under the Menu row.
  if (collapsed) {
    return (
      <div ref={panel} className="hud-panel pointer-events-auto flex w-full max-w-sm items-center gap-1 p-1 pointer-fine:sm:mt-auto portrait:pointer-coarse:mt-auto phone-landscape:max-w-52">
        <div className="phone-landscape:hidden">{edit}</div>
        <div className="phone-landscape:min-w-0 phone-landscape:flex-1">{can}</div>
        <div className="min-w-0 flex-1 phone-landscape:hidden">
          <SizeRow radius={spray.radius} engine={engine} />
        </div>
        {spray.on ? (
          <Button variant="ghost" className={cn(SEGMENT, "pointer-coarse:w-11")} aria-label="Undo the last stroke" disabled={garage.undo === 0} onClick={() => engine.current?.undoSpray()}>
            <Undo2 className="size-4" />
          </Button>
        ) : null}
        {toggle}
      </div>
    );
  }
  return (
    <div
      ref={panel}
      className="hud-panel pointer-events-auto w-full max-w-xs overflow-y-auto overscroll-contain p-1 max-h-[46vh] pointer-fine:space-y-1 pointer-fine:sm:max-h-[70vh] pointer-fine:sm:mt-auto pointer-coarse:grid pointer-coarse:max-w-sm pointer-coarse:grid-cols-1 pointer-coarse:gap-1 portrait:pointer-coarse:mt-auto portrait:pointer-coarse:max-h-[38dvh] phone-landscape:max-w-52 phone-landscape:max-h-[calc(100dvh-8rem)]"
    >
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">{edit}</div>
        {toggle}
      </div>
      {/* On a phone the spray block (look or spray, then the can's controls) sits right under the header and the part rows give way to it while the can is on: the Spray tab needs no scrolling to reach. */}
      <div className={cn("pointer-fine:space-y-1 pointer-coarse:order-1 pointer-coarse:gap-1", spray.on ? "pointer-coarse:hidden" : "pointer-coarse:grid pointer-coarse:grid-cols-1")}>
        {target === "car" ? (
          <>
            <CarTypeButtons playerCar={playerCar} engine={engine} className="grid-cols-4 phone-landscape:grid-cols-2 pointer-coarse:[&_button]:h-11" />
            {CAR_PARTS.map((part) => (
              <ColourRow key={part} label={PART_LABEL[part]} value={garage.car[part]} onColour={(c) => engine.current?.setCarColour(part, c)} />
            ))}
          </>
        ) : (
          <DriverRows garage={garage} engine={engine} />
        )}
      </div>
      <div className="border-border pointer-fine:space-y-1 pointer-fine:border-t pointer-fine:pt-1 pointer-coarse:order-0 pointer-coarse:grid pointer-coarse:grid-cols-1 pointer-coarse:gap-1">
        {can}
        <CanControls garage={garage} target={target} engine={engine} />
      </div>
    </div>
  );
}

/** Ctrl/Cmd+Z undoes the last stroke on what the panel edits, Ctrl/Cmd+Shift+Z or Ctrl+Y redoes it; never while typing in a field (its own undo). */
function useUndoKeys(engine: RefObject<CrashEngine | null>): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.target instanceof HTMLInputElement || (key !== "z" && key !== "y")) return;
      e.preventDefault();
      if (key === "y" || e.shiftKey) engine.current?.redoSpray();
      else engine.current?.undoSpray();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engine]);
}

/** On a touch screen, while spraying: a press on the view (not on `panel` or another HUD control) is the player painting, so `setCollapsed` folds the panel away to show the whole car. */
function useFoldOnViewPress(panel: RefObject<HTMLDivElement | null>, spraying: boolean, setCollapsed: (collapsed: boolean) => void): void {
  const touch = useCoarsePointer();
  useEffect(() => {
    if (!touch || !spraying) return;
    const foldOnViewPress = (event: PointerEvent) => {
      const pressed = event.target;
      if (!(pressed instanceof Element) || panel.current?.contains(pressed) || pressed.closest(HUD_CONTROL)) return;
      setCollapsed(true);
    };
    window.addEventListener("pointerdown", foldOnViewPress, { capture: true });
    return () => window.removeEventListener("pointerdown", foldOnViewPress, { capture: true });
  }, [touch, spraying, panel, setCollapsed]);
}

function SizeRow({ radius, engine }: { radius: number; engine: RefObject<CrashEngine | null> }) {
  return (
    <RangeRow
      label="Size"
      value={radius}
      min={SPRAY_RADIUS.min}
      max={SPRAY_RADIUS.max}
      step={0.01}
      shown={`${Math.round(radius * 100)} cm`}
      onValue={(r) => engine.current?.setSprayTool({ radius: r })}
    />
  );
}

function DriverRows({ garage, engine }: { garage: GarageHud; engine: RefObject<CrashEngine | null> }) {
  const { person, picked } = garage;
  return (
    <>
      <Segments label="Build" value={person.woman ? "w" : "m"} options={[["m", "Man"], ["w", "Woman"]]} onPick={(b) => engine.current?.setPersonPick({ woman: b === "w" })} />
      <ColourRow label="Shirt" value={person.shirt} onColour={(c) => engine.current?.setPersonPick({ shirt: c })} />
      <ColourRow label="Trousers" value={person.pants} onColour={(c) => engine.current?.setPersonPick({ pants: c })} />
      <ColourRow label="Hair" value={person.hair} onColour={(c) => engine.current?.setPersonPick({ hair: c })} />
      <div className="grid grid-cols-2 gap-0.5 rounded-md bg-surface-2/70 p-0.5" role="group" aria-label="Cap and moustache">
        <Button variant={picked.hat !== null ? "default" : "ghost"} aria-pressed={picked.hat !== null} className={SEGMENT} onClick={() => engine.current?.setPersonPick({ hat: picked.hat !== null ? null : person.shirt })}>
          Cap
        </Button>
        <Button variant={picked.mustache ? "default" : "ghost"} aria-pressed={picked.mustache} className={SEGMENT} onClick={() => engine.current?.setPersonPick({ mustache: !picked.mustache })}>
          Moustache
        </Button>
      </div>
      {picked.hat !== null ? <ColourRow label="Cap" value={picked.hat} onColour={(c) => engine.current?.setPersonPick({ hat: c })} /> : null}
    </>
  );
}

/** The can's controls under its Look / Spray switch: size, colour, Symmetric, undo and redo, and clearing `target`'s paint (a phone shows them only while spraying). */
function CanControls({ garage, target, engine }: { garage: GarageHud; target: "car" | "person"; engine: RefObject<CrashEngine | null> }) {
  const { spray } = garage;
  return (
    <div className={cn("pointer-fine:space-y-1 pointer-coarse:gap-1", spray.on ? "pointer-coarse:grid pointer-coarse:grid-cols-1" : "pointer-coarse:hidden")}>
      <SizeRow radius={spray.radius} engine={engine} />
      <ColourRow label="Spray colour" value={spray.colour} onColour={(c) => engine.current?.setSprayTool({ colour: c, on: true })} />
      <Button variant={spray.mirror ? "default" : "ghost"} aria-pressed={spray.mirror} className={cn(SEGMENT, "w-full")} onClick={() => engine.current?.setSprayTool({ mirror: !spray.mirror })}>
        <FlipHorizontal2 className="size-4" />
        Symmetric
      </Button>
      <div className="grid grid-cols-2 gap-0.5 rounded-md bg-surface-2/70 p-0.5" role="group" aria-label="Spray history">
        <Button variant="ghost" className={SEGMENT} disabled={garage.undo === 0} onClick={() => engine.current?.undoSpray()}>
          <Undo2 className="size-4" />
          Undo
        </Button>
        <Button variant="ghost" className={SEGMENT} disabled={garage.redo === 0} onClick={() => engine.current?.redoSpray()}>
          <Redo2 className="size-4" />
          Redo
        </Button>
      </div>
      <Button variant="ghost" className={cn(SEGMENT, "w-full")} onClick={() => engine.current?.clearSpray(target)}>
        Clear the {target === "car" ? "car's" : "driver's"} paint
      </Button>
      <p className="truncate px-1 text-xs text-muted idle:hidden phone-landscape:text-[11px]" role="status">
        {spray.on ? "Drag on the car or driver to spray" : "Drag to look around"}
      </p>
    </div>
  );
}
