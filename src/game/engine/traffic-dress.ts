/**
 * What a traffic car needs each time it is stood on a space: the full dress the first time (and to take its own paint back after a resident's), the paint alone when only the colour differs, nothing when nothing does. A full dress
 * makes materials and strings for the collector; a car stood on a space every few seconds must not.
 */
export class TrafficDress<Car extends object> {
  /** The paint (sRGB; null: its own) each car was last stood in; a car in it has been dressed. */
  private readonly worn = new WeakMap<Car, number | null>();
  private readonly dress: (car: Car) => void;
  private readonly paint: (car: Car, colour: number) => void;

  constructor(dress: (car: Car) => void, paint: (car: Car, colour: number) => void) {
    this.dress = dress;
    this.paint = paint;
  }

  stand(car: Car, colour: number | null): void {
    const worn = this.worn.get(car);
    if (worn === undefined || (worn !== null && colour === null)) this.dress(car);
    if (colour !== null && worn !== colour) this.paint(car, colour);
    this.worn.set(car, colour);
  }
}
