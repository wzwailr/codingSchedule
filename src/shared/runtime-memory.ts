// Soft GC policy for the pinned Node/V8 runtime. Old-space can still grow with
// live data; these flags do not impose a small hard heap limit or a GC timer.
export const v8MemoryArgs=['--optimize-for-size','--initial-old-space-size=8','--heap-growing-percent=10','--max-semi-space-size=1'] as const;
