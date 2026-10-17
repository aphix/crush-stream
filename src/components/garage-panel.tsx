import { useEffect, useRef, useState, type RefObject } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
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
/** What a press on the HUD can be besides the view: tapping one of these while spraying is no drag on the paint. */
const HUD_CONTROL = "button, input, label, a";

/** A native colour picker for `value` (sRGB) under `label`, live while it is dragged. */
function ColourRow({ label, value, onColour }: { label: string; value: number; onColour: (c: number) => void }) {
  return (
    <label className={ROW}>
      <span className="text-xs text-muted">{label}</span>
      <input
        type="color"
        aria-label={label}
        className="h-10 w-12 cursor-pointer rounded border border-border bg-transparent pointer-fine:h-8"
        value={`#${hexOf(value)}`}
        onChange={(e) => onColour(parseInt(e.target.value.slice(1), 16))}
      />
    </label>
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
 * The garage's editor: the car's type and part colours or the driver's build and clothes (a native colour picker each, live),
 * and the spray can (on, size, colour; a press on the car or the driver sprays). Picks ride the page URL; the spray stays in
 * this browser and goes to the other players when they join.
 */
export function GaragePanel({ garage, playerCar, engine }: { garage: GarageHud; playerCar: string; engine: RefObject<CrashEngine | null> }) {
  const [target, setTarget] = useState<"car" | "person">("car");
  // Collapsed, the panel is one row (what to paint, look or spray, the can's size), leaving a phone's view to the paint.
  const [collapsed, setCollapsed] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const touch = useCoarsePointer();
  const { person, picked, spray } = garage;
  // A drag that starts on the view while spraying is the player painting: fold the panel away so the whole car shows. It stays folded until the chevron is tapped.
  useEffect(() => {
    if (!touch || !spray.on) return;
    const foldOnViewPress = (event: PointerEvent) => {
      const pressed = event.target;
      if (!(pressed instanceof Element) || panel.current?.contains(pressed) || pressed.closest(HUD_CONTROL)) return;
      setCollapsed(true);
    };
    window.addEventListener("pointerdown", foldOnViewPress, { capture: true });
    return () => window.removeEventListener("pointerdown", foldOnViewPress, { capture: true });
  }, [touch, spray.on]);
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
  const size = (
    <RangeRow
      label="Size"
      value={spray.radius}
      min={SPRAY_RADIUS.min}
      max={SPRAY_RADIUS.max}
      step={0.01}
      shown={`${Math.round(spray.radius * 100)} cm`}
      onValue={(radius) => engine.current?.setSprayTool({ radius })}
    />
  );
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
        <div className="min-w-0 flex-1 phone-landscape:hidden">{size}</div>
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
        )}
      </div>
      <div className="border-border pointer-fine:space-y-1 pointer-fine:border-t pointer-fine:pt-1 pointer-coarse:order-0 pointer-coarse:grid pointer-coarse:grid-cols-1 pointer-coarse:gap-1">
        {can}
        <div className={cn("pointer-fine:space-y-1 pointer-coarse:gap-1", spray.on ? "pointer-coarse:grid pointer-coarse:grid-cols-1" : "pointer-coarse:hidden")}>
          {size}
          {/* Phone-landscape: one row of 44 px swatches that scrolls sideways (the strip is 13 rem wide); else the 8-column grid. */}
          <div className="grid grid-cols-8 gap-0.5 px-1 phone-landscape:flex phone-landscape:snap-x phone-landscape:overflow-x-auto phone-landscape:overscroll-x-contain" role="group" aria-label="Spray colour">
            {SPRAY_PALETTE.slice(1).map((c, k) => (
              <button
                key={c}
                type="button"
                aria-label={`Spray colour #${hexOf(c)}`}
                aria-pressed={spray.colour === k + 1}
                className={cn("h-11 rounded border pointer-fine:h-7 phone-landscape:w-11 phone-landscape:shrink-0 phone-landscape:snap-start", spray.colour === k + 1 ? "border-fg ring-2 ring-fg" : "border-border")}
                style={{ background: `#${hexOf(c)}` }}
                onClick={() => engine.current?.setSprayTool({ colour: k + 1, on: true })}
              />
            ))}
          </div>
          <Button variant="ghost" className={cn(SEGMENT, "w-full")} onClick={() => engine.current?.clearSpray(target)}>
            Clear the {target === "car" ? "car's" : "driver's"} paint
          </Button>
          <p className="truncate px-1 text-xs text-muted idle:hidden phone-landscape:text-[11px]" role="status">
            {spray.on ? "Drag on the car or driver to spray" : "Drag to look around"}
          </p>
        </div>
      </div>
    </div>
  );
}
