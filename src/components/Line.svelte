<script>
    export let style = "";
    let clazz = "";
    export { clazz as class };

    export let x0 = 10;
    export let y0 = 10;
    export let x1 = 90;
    export let y1 = 90;
    export let thick = 1;
    export let color = "#ffffff";
</script>

<div
    class="absolute top-0 left-0 rounded-full {clazz}"
    style="background:{color};height:{thick}rem;width:{thick +
        Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0))}rem;transform: translate({x1 - thick * 0.5}rem, {y1 -
        thick * 0.5}rem) rotate({Math.atan2(-(y1 - y0), -(x1 - x0))}rad);transform-origin: {thick * 0.5}rem {thick * 0.5}rem;{style}"
><slot /></div>

<!-- <div class="bg-yellow-400 absolute" style="left:{100}px;top:{100}px;width:1px;height:1px"></div>
<div class="bg-yellow-400 absolute" style="left:{220}px;top:{320}px;width:1px;height:1px"></div>
<br /><br /><br /><br /><br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
{(Math.atan2(x1 - x0, -(y1 - y0)) * 180.0) / Math.PI} -->
