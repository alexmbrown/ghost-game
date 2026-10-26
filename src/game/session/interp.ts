import { lerp, lerpAngle } from '../core/math';

interface Sample {
  t: number;
  x: number;
  z: number;
  h: number;
}

/**
 * Timestamped position buffer. Rendering samples it slightly in the past so
 * there are almost always two real samples to blend between — the standard
 * "entity interpolation" technique for smooth networked movement.
 */
export class Interp {
  private buf: Sample[] = [];

  push(t: number, x: number, z: number, h: number): void {
    const last = this.buf[this.buf.length - 1];
    if (last && t <= last.t) {
      // Same or older timestamp: overwrite the newest sample.
      last.x = x;
      last.z = z;
      last.h = h;
      return;
    }
    this.buf.push({ t, x, z, h });
    if (this.buf.length > 40) this.buf.splice(0, this.buf.length - 40);
  }

  /** Drop history (after teleports) so we never blend across a jump. */
  reset(t: number, x: number, z: number, h: number): void {
    this.buf.length = 0;
    this.buf.push({ t, x, z, h });
  }

  get latest(): Sample | undefined {
    return this.buf[this.buf.length - 1];
  }

  sample(t: number, out: { x: number; z: number; heading: number }): boolean {
    const b = this.buf;
    if (b.length === 0) return false;
    if (t <= b[0].t) {
      out.x = b[0].x;
      out.z = b[0].z;
      out.heading = b[0].h;
      return true;
    }
    for (let i = b.length - 1; i > 0; i--) {
      const a = b[i - 1];
      const c = b[i];
      if (t >= a.t) {
        if (t >= c.t) {
          // Past the newest sample: hold (never extrapolate into walls).
          out.x = c.x;
          out.z = c.z;
          out.heading = c.h;
          return true;
        }
        const k = (t - a.t) / (c.t - a.t);
        out.x = lerp(a.x, c.x, k);
        out.z = lerp(a.z, c.z, k);
        out.heading = lerpAngle(a.h, c.h, k);
        return true;
      }
    }
    const first = b[0];
    out.x = first.x;
    out.z = first.z;
    out.heading = first.h;
    return true;
  }
}
