/** A pointer that travels less (px) than this is a click, not a drag: the camera's own slop for a click on a car. */
const CLICK_PX = 8;
/** A still press held this long (s) is a hold, not a click: with a cable out the right button then reels, the middle button too. */
const HOLD_S = 0.25;
const RIGHT_BUTTON = 2;
const MIDDLE_BUTTON = 1;

/** What the mouse does for the tether. */
interface TetherMouseActions {
  /** A right click: hook. */
  fire(): void;
  /** A middle click: cut every cable. */
  cut(): void;
  /** Whether a cable (or a half-made one) is out: a held right button then reels. */
  cabled(): boolean;
  /** Whether the tether is on offer: the browser's own context menu stays off the canvas while it is. */
  offered(): boolean;
}

/** One mouse button held down on the canvas: how far it has moved, how long it has been held. */
class Press {
  id = -1;
  travel = 0;
  heldS = 0;
  /** A cable was out when the press began: holding then reels. */
  cabled = false;
  /** The hold has become a reel: its release is no click. */
  reeled = false;
  private lastX = 0;
  private lastY = 0;

  begin(e: PointerEvent, cabled: boolean): void {
    this.id = e.pointerId;
    this.travel = 0;
    this.heldS = 0;
    this.cabled = cabled;
    this.reeled = false;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  }

  /** The press's pointer moved: pointer lock reports no position, only movement. */
  move(e: PointerEvent): void {
    this.travel += Math.abs(e.movementX ?? e.clientX - this.lastX) + Math.abs(e.movementY ?? e.clientY - this.lastY);
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  }

  get down(): boolean {
    return this.id !== -1;
  }

  get still(): boolean {
    return this.travel < CLICK_PX;
  }
}

/**
 * The tether's mouse, Just Cause style, on buttons the camera leaves alone (its left button orbits and picks, so a drag that orbits never fires): a right click hooks (a press that
 * stays within `CLICK_PX` and is let go before `HOLD_S`, or any still press while no cable is out), a right button held still with a cable out reels, the middle button held reels and
 * a middle click cuts. A right drag does nothing.
 */
export class TetherMouse {
  private readonly canvas: HTMLElement;
  private readonly actions: TetherMouseActions;
  private readonly right = new Press();
  private readonly middle = new Press();

  constructor(canvas: HTMLElement, actions: TetherMouseActions) {
    this.canvas = canvas;
    this.actions = actions;
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onUp);
    canvas.addEventListener("contextmenu", this.onMenu);
  }

  /** Ages the held buttons by a frame; whether the mouse is reeling now. */
  reeling(wallDt: number): boolean {
    if (this.right.down) this.right.heldS += wallDt;
    if (this.middle.down) this.middle.heldS += wallDt;
    const rightReels = this.right.down && this.right.cabled && this.right.still && this.right.heldS >= HOLD_S;
    if (rightReels) this.right.reeled = true;
    const middleReels = this.middle.down && this.middle.still && this.middle.heldS >= HOLD_S;
    if (middleReels) this.middle.reeled = true;
    return rightReels || middleReels;
  }

  dispose(): void {
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("pointerup", this.onUp);
    this.canvas.removeEventListener("pointercancel", this.onUp);
    this.canvas.removeEventListener("contextmenu", this.onMenu);
  }

  private onDown = (e: PointerEvent): void => {
    if (e.button === RIGHT_BUTTON) this.right.begin(e, this.actions.cabled());
    else if (e.button === MIDDLE_BUTTON) {
      this.middle.begin(e, true);
      // Keeps the browser's middle-button autoscroll off the canvas.
      e.preventDefault();
    }
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerId === this.right.id) this.right.move(e);
    if (e.pointerId === this.middle.id) this.middle.move(e);
  };

  private onUp = (e: PointerEvent): void => {
    const clicked = e.type === "pointerup";
    if (e.pointerId === this.right.id) {
      this.right.id = -1;
      if (clicked && this.right.still && !this.right.reeled) this.actions.fire();
    }
    if (e.pointerId === this.middle.id) {
      this.middle.id = -1;
      if (clicked && this.middle.still && !this.middle.reeled) this.actions.cut();
    }
  };

  private onMenu = (e: Event): void => {
    if (this.actions.offered()) e.preventDefault();
  };
}
