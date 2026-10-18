/** The text and look of the badge in each state: on, the amber one that cannot be missed on a phone; off, a quiet grey. */
const ON = { text: "EPICENTER ON", style: "margin:0 0 6px;padding:3px 8px;font:700 15px/1.2 ui-monospace,Menlo,Consolas,monospace;border-radius:5px;background:#ffb454;color:#1a1200" } as const;
const OFF = { text: "epicenter off", style: "margin:0 0 6px;padding:3px 8px;font:700 15px/1.2 ui-monospace,Menlo,Consolas,monospace;border-radius:5px;background:#2b3440;color:#9fb0c6" } as const;

/** What the badge writes to: a line of the bench's card (a stand-in with these two fields in a test). */
interface BadgeElement {
  textContent: string | null;
  style: { cssText: string };
}

/**
 * The bench card's live label of which arm the page is running: `EPICENTER ON` or `epicenter off`, read from the knob itself (`read`), not from what the plan asked
 * for, so the label is the state the sim is in. `sync` costs one read and a compare per call and writes the page only when the arm changed, so the bench calls it every
 * frame (`frame` in `bench-frame.ts`): the label changes in the frame after the loop's step switches the knob (`enterBenchScene`), or the warm-up sweep turns it on and off.
 */
export class ArmBadge {
  private shown: boolean | null = null;
  private readonly element: BadgeElement;
  private readonly read: () => boolean;

  constructor(element: BadgeElement, read: () => boolean) {
    this.element = element;
    this.read = read;
  }

  sync(): void {
    const on = this.read();
    if (on === this.shown) return;
    this.shown = on;
    const look = on ? ON : OFF;
    this.element.textContent = look.text;
    this.element.style.cssText = look.style;
  }
}
