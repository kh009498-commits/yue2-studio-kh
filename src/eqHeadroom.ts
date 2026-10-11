// Sample the actual cascaded Web Audio response, including overlapping bands.
// Compensating only the largest slider misses boosts between band centers.
export function eqHeadroomGain(filters: BiquadFilterNode[], sampleRate: number): number {
  if (!filters.some(filter => filter.gain.value > 0)) return 1;
  const count = 512;
  const upper = sampleRate / 2 * 0.999;
  const frequencies = Float32Array.from({ length: count }, (_, index) => 1 * upper ** (index / (count - 1)));
  const magnitude = new Float32Array(count);
  const phase = new Float32Array(count);
  const combined = new Float64Array(count).fill(1);
  for (const filter of filters) {
    filter.getFrequencyResponse(frequencies, magnitude, phase);
    for (let index = 0; index < count; index++) combined[index] *= magnitude[index];
  }
  const peak = Math.max(1, ...combined);
  // One extra dB for small response-sampling errors and transient peaks.
  return 10 ** (-1 / 20) / peak;
}
