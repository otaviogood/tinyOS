<svelte:options accessors />

<script>
    import { onMount } from "svelte";
    import Fast2dBQ from "./Fast2dBQ.svelte";

    // Realtime graph using Fast2dBQ lines
    export let size = 8; // UI scale for text/buttons
    export let yTicks = 5;
    export let xTickSpacing = 60;
    export let yRange = [0.0, 1.0]; // [min, max]
    export let labelY = "";
    export let labelX = "";
    export let unifyRanges = false; // if true, use each series.range if provided
    export let xScale = 2.0; // pixels per sample along X (right to left scroll)
    export let bgColor = 0x041a38; // overlay background (optional)
    export let gridColor = [0.08, 0.08, 0.10];
    export let zeroColor = [0.12, 0.12, 0.12];
    export let showGrid = true;
    export let showLegend = true;
    export let showRuler = true;
    export let showDebugGuides = false; // draw pixel/value-space reference lines
    export let showButtons = false; // show x/y zoom buttons in header
    // series = [{ key?:string, color:[r,g,b], values:number[], range?:{min,max} }]
    export let series = [];

    let wrapper;
    let fast2d;
    let rafId = 0;
    let pointerOn = false;
    let pointerXNorm = -1;
    let yScale = 1.0;
    let _lastDebug = null;
    let _lastLogTs = 0;

    function getZoomedRange(baseRange) {
        const mid = (baseRange[0] + baseRange[1]) * 0.5;
        return [ (baseRange[0] - mid) / yScale + mid, (baseRange[1] - mid) / yScale + mid ];
    }

    function getSeriesRange(s) {
        const base = (unifyRanges && s && s.range) ? [s.range.min, s.range.max] : yRange;
        return getZoomedRange(base);
    }

    function drawFrame() {
        if (!fast2d) { rafId = requestAnimationFrame(drawFrame); return; }
        fast2d.reset();

        const w = fast2d.getWidth();
        const h = fast2d.getHeight();
        if (!w || !h) { rafId = requestAnimationFrame(drawFrame); return; }
        const h1 =h;// Math.max(1, h - 1);

        // Grid lines
        if (showGrid) {
            const t = Math.max(2, yTicks | 0);
            for (let i = 0; i < t; i++) {
                const p = i / (t - 1); // 0 bottom .. 1 top for ticks? keep consistent with labels
                const y = (1 - p) * (h1 - 0.5) + p * 0.5; // top/bottom inset by 0.5 for crisp 1px
                fast2d.lineOneOffBack(0, y, w - 1, y, 1, gridColor);
            }
        }

        // Draw each series as a polyline of segments from right to left
        // Debug reference guides (pixel-space and value-space) to verify transforms
        if (showDebugGuides) {
            // Pixel-space guides: top, middle, bottom (Y in pixels)
            const yTop = 0.5;
            const yMid = h1 * 0.5;
            const yBot = h1 - 0.5;
            // console.log('[GraphRTBQ pixel guides]', { yTop, yMid, yBot, h1, w });

            const xSpanPix = Math.max(8, Math.min(64, w * 0.25));
            // Draw pixel-space guides as short RIGHT segments
            fast2d.lineOneOff(w - xSpanPix, yTop, w - 1, yTop, 6, [1.0, 0.025, 0.025]); // red: top pixel line
            fast2d.lineOneOff(w - xSpanPix, yMid, w - 1, yMid, 6, [0.025, 1.0, 0.025]); // green: middle pixel line
            fast2d.lineOneOff(w - xSpanPix, yBot, w - 1, yBot, 6, [0.025, 0.025, 1.0]); // blue: bottom pixel line

            fast2d.lineOneOff(w * 0.25, 0, w * 0.25, h1, 2, [1, 0, 1]);

            fast2d.lineOneOff(0, 0.5, w - 1, h1 - 0.5, 2, [1, 1, 1]);
            // Value-space guides: v=1.0 (magenta) and v=0.0 (yellow)
            const rngDbg = getZoomedRange(yRange);
            const yMinDbg = rngDbg[0];
            const yMaxDbg = rngDbg[1];
            const toYPix = (v) => {
                const tVal = Math.max(0, Math.min(1, (v - yMinDbg) / Math.max(1e-6, (yMaxDbg - yMinDbg))));
                return (1 - tVal) * (h1 - 0.5) + tVal * 0.5;
            };
            const yV1 = toYPix(1.0);
            const yV0 = toYPix(0.0);
            const yVn1 = toYPix(-1.0);
            const xSpan = Math.max(8, Math.min(64, w * 0.25));
            // Draw value-space guides as short left segments for easier differentiation
            fast2d.lineOneOff(0, yV1, xSpan, yV1, 1, [1.0, 0.0, 1.0]); // magenta: value 1.0
            fast2d.lineOneOff(0, yV0, xSpan, yV0, 1, [1.0, 1.0, 0.0]); // yellow: value 0.0
            fast2d.lineOneOff(0, yVn1, xSpan, yVn1, 1, [0.0, 1.0, 1.0]); // cyan: value -1.0

            _lastDebug = { range: [yMinDbg, yMaxDbg], yV1, yV0, yVn1, h: h1 };

            // Throttled console logging for copy/paste diagnostics
            // try {
            //     const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            //     if (now - _lastLogTs > 1000) {
            //         // eslint-disable-next-line no-console
            //         console.log('[GraphRTBQ]', {
            //             propYRange: yRange,
            //             yScale,
            //             effectiveRange: [yMinDbg, yMaxDbg],
            //             yPix_v1: Number.isFinite(yV1) ? Number(yV1.toFixed(1)) : yV1,
            //             yPix_v0: Number.isFinite(yV0) ? Number(yV0.toFixed(1)) : yV0,
            //             yPix_vN1: Number.isFinite(yVn1) ? Number(yVn1.toFixed(1)) : yVn1,
            //             h: h1,
            //             w,
            //         });
            //         _lastLogTs = now;
            //     }
            // } catch(_) {}
        }

        // Draw each series as a polyline of segments from right to left
        for (let si = 0; si < series.length; si++) {
            const s = series[si];
            if (!s || !Array.isArray(s.values) || s.values.length === 0) continue;
            const rng = getSeriesRange(s);
            const yMin = rng[0];
            const yMax = rng[1];
            const color = s.color || [1, 1, 1];
            if (showDebugGuides) {
                // Visualize this series' 0.0 baseline according to its effective range
                const t0 = Math.max(0, Math.min(1, (0.0 - yMin) / Math.max(1e-6, (yMax - yMin))));
                const y0 = (1 - t0) * (h1 - 0.5) + t0 * 0.5;
                const xSpan0 = Math.max(6, Math.min(48, w * 0.2));
                fast2d.lineOneOff(w - xSpan0, y0, w - 1, y0, 1, [1.0, 1.0, 1.0]); // white short segment at right
                try { if ((performance.now?.() || Date.now()) - _lastLogTs > 1000) console.log('[GraphRTBQ series baseline]', { key: s.key, yMin, yMax, y0: Number(y0.toFixed(1)) }); } catch(_) {}
            }
            let lastY = null;
            let sx = 0;
            // Walk latest to oldest
            for (let idx = s.values.length - 1; idx >= 0; idx--) {
                const v = s.values[idx];
                const tVal = Math.max(0, Math.min(1, (v - yMin) / Math.max(1e-6, (yMax - yMin))));
                // Map to screen Y with half-pixel inset for crisp lines: vMin->bottom, vMax->top
                const yPix = (1 - tVal) * (h1 - 0.5) + tVal * 0.5;
                const xRight = Math.max(0, Math.min(w - 1, w - 0 - sx * xScale));
                const xLeft = Math.max(0, Math.min(w - 1, w - xScale - sx * xScale));
                if (lastY != null) {
                    fast2d.lineOneOff(xLeft, yPix, xRight, lastY, 1, color);
                }
                if (sx * xScale > w || sx > 32768) break;
                sx++;
                lastY = yPix;
            }
        }

        // X tick marks at bottom when zoomed in
        if (showGrid && xScale > 4) {
            for (let i = 0; i < 2000; i++) {
                const x = w - i * xScale;
                if (x < 0) break;
                fast2d.lineOneOffBack(x, h1, x, Math.max(0, h1 - 8), 1, [0.2, 0.6, 1]);
            }
        }

        // Pointer ruler snapped to samples
        if (showRuler && pointerOn) {
            const xPix = Math.max(0, Math.min(w - 1, pointerXNorm * w));
            fast2d.lineOneOff(xPix, 0, xPix, h1, 1, [0.2, 0.3, 0.4]);
        }

        rafId = requestAnimationFrame(drawFrame);
    }

    function onMove(e) {
        const rect = wrapper.getBoundingClientRect();
        pointerXNorm = (e.clientX - rect.left) / Math.max(1, rect.width);
        pointerOn = true;
    }
    function onLeave() { pointerOn = false; }

    function sampleAtSnap(s) {
        if (!pointerOn) return "";
        const w = Math.max(1, fast2d ? fast2d.getWidth() : 1);
        const xPix = Math.max(0, Math.min(w - 1, pointerXNorm * w));
        const snap = Math.round((w - xPix) / Math.max(1, xScale));
        const idx = s.values.length - 1 - snap;
        if (idx < 0 || idx >= s.values.length) return "";
        const v = s.values[idx];
        if (!isFinite(v)) return "";
        // Format similar to GraphRT: dynamic digits, cap total digits
        const maxDigits = 4;
        let digits = Math.log10(Math.abs(v) + 1e-8);
        digits = Math.min(maxDigits, Math.max(0, maxDigits - Math.floor(digits)));
        return v.toFixed(digits);
    }

    onMount(() => {
        rafId = requestAnimationFrame(drawFrame);
        return () => { if (rafId) cancelAnimationFrame(rafId); };
    });
</script>

<div class="relative flex flex-col w-full h-full" style="font-size:{size * 1.4}px;line-height:{size * 1.4}px;">
    {#if showButtons || labelY}
        <div class="flex items-center gap-2" style="flex:0 0 {size * 2.0}px;">
            {#if showButtons}
                <button class="px-2 py-0.5 bg-black/40 rounded" on:click={() => (xScale = Math.max(0.25, xScale * 0.5))}>-</button>
                <div class="min-w-[3rem] text-center">x{(xScale < 1.0) ? '/' + (1.0/xScale).toFixed(0) : xScale.toFixed(0)}</div>
                <button class="px-2 py-0.5 bg-black/40 rounded" on:click={() => (xScale = Math.min(64, xScale * 2.0))}>+</button>
                <div class="w-2" />
                <button class="px-2 py-0.5 bg-black/40 rounded" on:click={() => (yScale = Math.max(0.25, yScale * 0.5))}>-</button>
                <div class="min-w-[3rem] text-center">y{(yScale < 1.0) ? '/' + (1.0/yScale).toFixed(0) : yScale.toFixed(0)}</div>
                <button class="px-2 py-0.5 bg-black/40 rounded" on:click={() => (yScale = Math.min(64, yScale * 2.0))}>+</button>
            {/if}
            {#if labelY}
                <div class="ml-auto opacity-80">{labelY}</div>
            {/if}
        </div>
    {/if}

    <div bind:this={wrapper} class="relative w-full h-full overflow-hidden" on:pointermove={onMove} on:pointerleave={onLeave}>
        <Fast2dBQ bind:this={fast2d} id="graph-rt-bq" bg_color={bgColor} />
        {#if showDebugGuides && _lastDebug}
            <!-- Labels pinned at computed y-positions for clarity -->
            <div class="absolute left-1 text-[0.70em] pointer-events-none select-none">
                <div style="position:absolute;top:{_lastDebug.yV1 - 6}px;color:#ff00ff">v=1.0</div>
                <div style="position:absolute;top:{_lastDebug.yV0 - 6}px;color:#ffff00">v=0.0</div>
                <div style="position:absolute;top:{_lastDebug.yVn1 - 6}px;color:#00ffff">v=-1.0</div>
            </div>
        {/if}
        {#if showLegend}
            <div class="absolute top-1 left-1 pl-5 rounded text-white text-xs">
                {#each series as s}
                    <div class="flex items-center gap-2 mb-0.5">
                        <div class="w-3 h-3 rounded-sm" style="background-color:rgb({(s.color?.[0]||1)*255},{(s.color?.[1]||1)*255},{(s.color?.[2]||1)*255})" />
                        <div class="min-w-[6rem] truncate">{s.key || 'series'}</div>
                        <div class="tabular-nums text-right min-w-[3rem]">{sampleAtSnap(s)}</div>
                    </div>
                {/each}
            </div>
        {/if}

        <!-- Y tick labels on right -->
        {#if showGrid}
            <div class="absolute top-0 bottom-0 flex flex-col justify-between text-white/80 text-[0.75em]">
                {#each Array(Math.max(2, yTicks|0)) as _, i}
                    {#key i}
                        {#if fast2d}
                            <div>{(() => {
                                const r = getZoomedRange(yRange);
                                const t = i/(Math.max(2,yTicks|0)-1); // 0 top .. 1 bottom
                                const v = (1.0 - t) * r[1] + t * r[0];
                                return v.toFixed(1);
                            })()}</div>
                        {/if}
                    {/key}
                {/each}
            </div>
        {/if}
    </div>

    {#if labelX}
        <div class="text-center opacity-80" style="flex:0 0 {size * 1.6}px;">{labelX}</div>
    {/if}
</div>

<style>
</style>


