<script>
    import { bigScale } from "../screen";
    import { pxToRem, remToPx } from "../screen.js";
    export let style = "";
    let clazz = "";
    export { clazz as class };

    export let x0 = 10;
    export let y0 = 10;
    export let x1 = x0 - 0.001; // makes it oriented so the text is upside-right for circles.
    export let y1 = y0;
    export let thick = 1;
    export let color = "#ffffff";
    export let arrowThick = 0;
    export let rounded = false;
    export let origin = [0, 0];
    export let scale = 1;

    // Use reactive declarations so that these values update when any of the inputs change:
    $: nx0 = origin[0] + x0 * scale;
    $: ny0 = origin[1] + y0 * scale;
    $: nx1 = origin[0] + x1 * scale;
    $: ny1 = origin[1] + y1 * scale;

    let arrowWidthPx = remToPx(thick * arrowThick, $bigScale);
    // If global var bigScale changes, recompute arrowWidthPx
    $: $bigScale, arrowWidthPx = remToPx(thick * arrowThick, $bigScale);
</script>

<div
    class="absolute top-0 left-0 {rounded ? 'rounded-full' : ''} {clazz}"
    style="background:{color};height:{thick}rem;width:{thick +
        Math.sqrt((nx1 - nx0) * (nx1 - nx0) + (ny1 - ny0) * (ny1 - ny0))}rem;transform: translate({nx1 - thick * 0.5}rem, {ny1 -
        thick * 0.5}rem) rotate({Math.atan2(-(ny1 - ny0), -(nx1 - nx0))}rad);transform-origin: {thick * 0.5}rem {thick *
        0.5}rem;{style}"
>
    {#if arrowThick > 0}
        <svg
            height={arrowWidthPx}
            width={arrowWidthPx}
            style="position:absolute;top:{-arrowWidthPx * 0.5 + remToPx(thick, $bigScale) * 0.5}px;left:{-thick *
                (rounded ? 0.21 : 0.5)}rem;opaXcity:0.5"
        >
            <polygon
                points="0,{arrowWidthPx * 0.5} {arrowWidthPx * 0.5},{arrowWidthPx*0.85} {arrowWidthPx * 0.5},{arrowWidthPx * 0.15}"
                style="fill:{color};"
            />
        </svg>
    {/if}
    <slot />
</div>
