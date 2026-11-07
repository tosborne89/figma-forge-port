import { createHash, timingSafeEqual } from 'node:crypto';

// The Connect app compared passcodes with !==. Hashing first gives equal-length
// buffers, so timingSafeEqual never throws and the comparison is constant time.
export function passcodesMatch(expected: string, received: string): boolean {
  const a = createHash('sha256').update(expected).digest();

  const b = createHash('sha256').update(received).digest();

  return timingSafeEqual(a, b);
}
